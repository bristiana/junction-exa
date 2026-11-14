"""Vali HTTP API and injectable research/browser workers."""
import asyncio
from datetime import datetime, timedelta, timezone
from contextvars import ContextVar
import hmac
import json
import re
from io import BytesIO
from urllib.parse import urlsplit, unquote
import threading
import time
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field

from .config import Config
from .exa import ExaClient, ExaError
from .monitors import provision_watch, delete_monitor, verify_delivery, delivery_update
from .guard import SlidingWindow, authenticate, check_origin, check_task_budget
from .research import FIND_SCHEMA, SYSTEM_PROMPT, build_query, build_run_request, map_find_output, progress_from_events
from .jev import JevClient
from .router import route
from .store import make_store, now
from .uploads import oversized_request
from .voice_agent import add_voice_routes
from vali_wa.flow import WhatsAppFlow
from vali_wa.webhook import parse_webhook, verify_signature
from vali_wa.render import render_result, render_execution_update, render_error
from .wa_channel import ChannelAPI, push_task, log_failure, logger as whatsapp_logger

TERMINAL = {'completed', 'failed', 'cancelled'}


class TaskBody(BaseModel):
    task: str = Field(min_length=1, max_length=20000)
    page: dict | None = None
    effort: Literal['minimal', 'low', 'medium', 'high', 'xhigh', 'auto', 'ultra'] = 'low'
    previous_task_id: str | None = None


class LinkBody(BaseModel):
    code: str = Field(pattern=r'^[0-9]{6}$', max_length=6)


class ProfileBody(BaseModel):
    profile: dict[str, str]


class ExecuteBody(BaseModel):
    action_index: int | None = Field(default=None, ge=0)
    start_url: str | None = None
    goal: str | None = None
    profile: dict[str, str] | None = None


class MessageBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


ACTIVE_EXECUTION = {'starting', 'running', 'awaiting_approval', 'submitting'}


def research_from_run(run, kind='agent'):
    error = run.get('error')
    return dict(kind=kind, status=run.get('status', 'queued'), run_id=run.get('id'), progress=[],
                output=run.get('output'), cost=(run.get('costDollars') or {}).get('total'),
                stop_reason=run.get('stopReason'), error=error.get('message') if isinstance(error, dict) else error)


def poll_research_once(task_id, application=None):
    application = application or app
    store, exa = application.state.store, application.state.exa
    task = store.get_task(task_id)
    if not task or task['research']['status'] in TERMINAL:
        return True
    previous = task['research']
    try:
        run = exa.get_run(previous['run_id'])
        research = research_from_run(run)
        research['progress'] = previous.get('progress', [])
        if research['status'] not in TERMINAL:
            try:
                progress = progress_from_events(exa.get_events(previous['run_id']).get('data', []))
                if progress:
                    research['progress'] = progress
            except ExaError:
                store.record_failure(task_id, 'research.events', 'Research progress is temporarily unavailable.')
    except ExaError as exc:
        if exc.status != 404:
            store.record_failure(task_id, 'research.poll', 'Research service is temporarily unavailable.')
            return False
        research = {**previous, 'status': 'failed', 'error': 'The run was not found.'}
    if store.update_research(task_id, research, expected=previous) and research['status'] in {'completed', 'failed'}:
        push_task(application, task_id, render_result)
    return research['status'] in TERMINAL


def research_poller_loop(task_id, application=None):
    application = application or app
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        if poll_research_once(task_id, application):
            return
        time.sleep(4)
    store = application.state.store
    task = store.get_task(task_id)
    if task and task['research']['status'] not in TERMINAL:
        old = task['research']
        if store.update_research(task_id, {**old, 'status': 'failed', 'error': 'Research timed out.'}, expected=old):
            push_task(application, task_id, render_result)


def run_browser_session(task_id, goal, start_url, profile, application=None):
    """Wire the separately owned browser agent to persistent execution state."""
    application = application or app
    store = application.state.store
    def patch_execution(tid, patch=None, **kwargs):
        previous = (store.get_task(tid)['execution'] or {}).get('status')
        execution = store.patch_execution(tid, patch, **kwargs)
        if execution.get('status') != previous and execution.get('status') in {'awaiting_approval', 'done', 'failed', 'stopped'}:
            push_task(application, tid, render_execution_update)
        return execution

    try:
        from vali_agent import run_browser_agent, AgentHooks
    except ImportError:
        patch_execution(task_id, {'status': 'failed', 'error': 'Browser sandbox only on Modal.'})
        return

    def should_stop():
        execution = store.get_task(task_id)['execution'] or {}
        return execution.get('approval_decision') == 'stopped' or execution.get('status') == 'stopped'

    def on_step(text, jpeg_bytes=None):
        execution = store.get_task(task_id)['execution'] or {}
        n = len(execution.get('steps', [])) + 1
        shot = None
        if jpeg_bytes:
            store.put_shot(task_id, n, jpeg_bytes)
            url = f'/v1/tasks/{task_id}/shots/{n}.jpg'
            if application.state.config.cloudinary_url:
                import cloudinary
                import cloudinary.uploader
                credentials = urlsplit(application.state.config.cloudinary_url)
                cloudinary.config(cloud_name=credentials.hostname, api_key=unquote(credentials.username or ''),
                                  api_secret=unquote(credentials.password or ''), secure=True)
                url = cloudinary.uploader.upload(BytesIO(jpeg_bytes), resource_type='image')['secure_url']
            shot = {'n': n, 'url': url}
        patch_execution(task_id, step={'n': n, 'at': now(), 'text': text, 'shot': n if shot else None}, shot=shot)

    def wait_for_approval(summary, filled):
        if should_stop():
            return False
        patch_execution(task_id, {'status': 'awaiting_approval', 'approval_decision': None,
                                        'approval': {'summary': summary, 'filled': filled}})
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            execution = store.get_task(task_id)['execution'] or {}
            if execution.get('approval_decision') == 'stopped':
                return False
            if execution.get('approval_decision') == 'approved':
                patch_execution(task_id, {'status': 'submitting'})
                return True
            time.sleep(2)
        patch_execution(task_id, {'status': 'stopped', 'approval_decision': 'stopped', 'error': 'Approval timed out.'})
        return False

    def on_frame(jpeg):
        store.put_live_frame(task_id, jpeg)

    def on_usage(usage):
        store.patch_execution(task_id, {'usage': usage})

    def on_exa(calls):
        # Straight to the store, like on_usage: a new lookup is not a status change worth a push.
        store.patch_execution(task_id, {'exa': calls})

    def unread():
        execution = store.get_task(task_id)['execution'] or {}
        inbox = execution.get('inbox') or []
        return inbox, min(int(execution.get('inbox_read') or 0), len(inbox))

    def pending_messages():
        inbox, read = unread()
        if read >= len(inbox):
            return []
        store.patch_execution(task_id, {'inbox_read': len(inbox)})
        return [m.get('text', '') for m in inbox[read:]]

    def ask_user(question):
        store.patch_execution(task_id, {'question': {'text': question, 'at': now()}})
        push_task(application, task_id, render_execution_update)
        deadline = time.monotonic() + 300
        try:
            while time.monotonic() < deadline and not should_stop():
                inbox, read = unread()
                if read < len(inbox):
                    store.patch_execution(task_id, {'inbox_read': len(inbox)})
                    return ' / '.join(m.get('text', '') for m in inbox[read:])
                time.sleep(1.5)
            return None
        finally:
            store.patch_execution(task_id, {'question': None})

    try:
        if should_stop():
            return
        patch_execution(task_id, {'status': 'running'})
        base = dict(on_step=on_step, wait_for_approval=wait_for_approval, should_stop=should_stop)
        try:
            hooks = AgentHooks(**base, on_frame=on_frame, on_usage=on_usage, pending_messages=pending_messages, ask_user=ask_user,
                               on_exa=on_exa)
        except TypeError:  # an agent build without live view, usage or inbox hooks
            hooks = AgentHooks(**base)
        result = run_browser_agent(goal=goal, start_url=start_url, profile=profile, hooks=hooks)
        value = result if isinstance(result, dict) else vars(result)
        patch_execution(task_id, {'status': 'stopped' if should_stop() else value['status'],
                                       'result': value.get('result', ''), 'current_url': value.get('final_url'), 'error': value.get('error'),
                                       **{k: value[k] for k in ('usage', 'sources', 'filled', 'exa') if value.get(k) is not None}})
    except Exception:
        patch_execution(task_id, {'status': 'stopped' if should_stop() else 'failed', 'error': 'Browser session failed.'})


def spawn_thread(target, *args):
    threading.Thread(target=target, args=args, daemon=True).start()


PAGE = ('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<title>Vali {title}</title><body style="font:16px/1.5 system-ui;max-width:640px;margin:40px auto;padding:0 16px">'
        '<h1>Vali {title}</h1>{body}</body>')
PRIVACY_HTML = PAGE.format(title='privacy', body=(
    '<p>Vali is a student hackathon project that runs errands for people in Finland.</p>'
    '<p>Your personal details (name, address, ID numbers) stay in your browser extension or desktop app. '
    'The AI models only see placeholders such as {{name}}; real values are typed into a form at the last step.</p>'
    '<p>We store your errands, their results and screenshots so you can follow them. WhatsApp messages you send to Vali '
    'are processed to run the errand you asked for. We do not sell or share data, and we do not use it for ads.</p>'
    '<p>To delete your data, send "delete" to Vali on WhatsApp or remove the extension; errands are removed on request.</p>'))
TERMS_HTML = PAGE.format(title='terms', body=(
    '<p>Vali is a demo built for a hackathon. It prepares forms and bookings and always stops before the final '
    'button until you approve. You stay responsible for what you approve. No warranty.</p>'))

def create_app(config=None, store=None, exa=None, spawn_research_poller=None, spawn_browser_session=None, jev=None, whatsapp_api=None):
    config = config or Config()

    @asynccontextmanager
    async def lifespan(application):
        if application.state.store is None:
            application.state.store = make_store(config)
        yield
        if store is None:
            application.state.store.close()
        if exa is None:
            application.state.exa.close()
        if jev is None and application.state.jev:
            application.state.jev.close()

    application = FastAPI(title='Vali', lifespan=lifespan)
    application.state.config = config
    application.state.store = store
    application.state.exa = exa or ExaClient(config.exa_api_key)
    application.state.jev = jev or (JevClient(config.jev_api_key) if config.jev_api_key else None)
    application.state.limiter = SlidingWindow()
    application.state.spawn_research_poller = spawn_research_poller or (lambda tid: spawn_thread(research_poller_loop, tid, application))
    application.state.spawn_browser_session = spawn_browser_session or (lambda tid, goal, url, profile: spawn_thread(run_browser_session, tid, goal, url, profile, application))
    application.state.whatsapp_api = whatsapp_api or ChannelAPI(config)
    application.add_middleware(CORSMiddleware,
        allow_origins=[o.strip() for o in config.allowed_origins.split(',') if o.strip() and o.strip() != 'extension'],
        allow_origin_regex=r'^(chrome-extension://[a-z]+|https?://(localhost|127\.0\.0\.1)(:\d+)?)$',
        allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allow_headers=['Authorization', 'Content-Type'])

    @application.middleware('http')
    async def guards(request, call_next):
        try:
            check_origin(request.headers.get('origin'), config.allowed_origins)
            if oversized_request(request.url.path, request.headers.get('content-length')):
                raise HTTPException(413, 'Upload exceeds 10 MB')
            image_get = request.method == 'GET' and re.fullmatch(
                r'/v1/tasks/[^/]+/(?:live\.jpg|shots/[0-9]+\.jpg)', request.url.path)
            if not image_get:
                ip = request.client.host if request.client else 'unknown'
                application.state.limiter.check('ip:' + ip, application.state.limiter.ip_limit)
        except HTTPException as exc:
            return JSONResponse({'detail': exc.detail}, status_code=exc.status_code)
        return await call_next(request)

    @application.exception_handler(ExaError)
    async def exa_error(request, exc):
        return JSONResponse({'detail': str(exc), 'upstream_status': exc.status}, status_code=502)

    def owned(tid, user):
        task = application.state.store.get_task(tid)
        if not task or task['user_id'] != user['id']:
            raise HTTPException(404, 'Task not found')
        return task

    @application.get('/health')
    def health():
        return config.services()

    @application.get('/privacy', response_class=HTMLResponse)
    def privacy():
        return PRIVACY_HTML

    @application.get('/terms', response_class=HTMLResponse)
    def terms():
        return TERMS_HTML

    @application.post('/v1/users')
    def users():
        return application.state.store.create_user()

    @application.get('/v1/me')
    def me(user=Depends(authenticate)):
        number = user.get('wa_number')
        return dict(user_id=user['id'], whatsapp_linked=bool(number), whatsapp_last4=number[-4:] if number else None,
                    profile_synced=bool(json.loads(user['profile_json'])))

    @application.put('/v1/profile')
    def profile(body: ProfileBody, user=Depends(authenticate)):
        application.state.store.set_profile(user['id'], body.profile)
        return {'ok': True}

    @application.post('/v1/pair')
    def pair(user=Depends(authenticate)):
        return application.state.store.create_pair_code(user['id'])

    def create_task_for_user(body, user, source='extension', *, budget_checked=False):
        if not body.task.strip():
            raise HTTPException(422, 'Task must not be blank')
        check_task_budget(application, user, count_request=not budget_checked)
        state = application.state
        mode, kind = route(body.task, body.page, classify=state.jev.classify if state.jev else None)
        previous_run = None
        if body.previous_task_id:
            previous_run = owned(body.previous_task_id, user)['research'].get('run_id')
        research = dict(kind=kind, status='queued', run_id=None, progress=[], output=None, cost=None, stop_reason=None, error=None)
        task = state.store.create_task(user['id'], body.task, body.page, mode, research, source=source)
        try:
            if kind == 'search':
                response = state.exa.search(dict(query=build_query(body.task, body.page), type='auto', numResults=5,
                                                contents={'highlights': True}, outputSchema=FIND_SCHEMA, systemPrompt=SYSTEM_PROMPT))
                research.update(status='completed', output=map_find_output(response), cost=(response.get('costDollars') or {}).get('total'))
            elif kind == 'agent':
                run_request = build_run_request(body.task, body.page, effort=body.effort)
                if previous_run:
                    run_request['previousRunId'] = previous_run
                research = research_from_run(state.exa.create_run(run_request))
            else:
                watch, message = provision_watch(config, state.store, state.exa, user['id'], body.task, task['id'])
                if watch is None:
                    state.store.update_research(task['id'], {**research, 'status': 'failed', 'error': message})
                    raise HTTPException(409, message)
                research.update(status='completed', watch_id=watch['id'],
                    monitor_stubbed=not bool(watch.get('secret')),
                    output={'text': message, 'structured': {
                        'answer': message, 'status': 'info_only',
                        'key_facts': [], 'steps': [], 'actions': [], 'missing_info': []}, 'grounding': []})
            state.store.update_research(task['id'], research)
        except ExaError:
            state.store.update_research(task['id'], {**research, 'status': 'failed', 'error': 'Research service request failed.'})
            push_task(application, task['id'], render_result)
            raise
        if research['status'] in {'completed', 'failed'}:
            push_task(application, task['id'], render_result)
        if kind == 'agent' and research['status'] not in TERMINAL:
            state.spawn_research_poller(task['id'])
        return state.store.get_task(task['id'])

    @application.post('/v1/link/code')
    def link_code(request: Request, user=Depends(authenticate)):
        application.state.limiter.check('link-code:' + user['id'], 10)
        token = request.headers['authorization'].partition(' ')[2]
        return application.state.store.create_link_code(user['id'], token)

    @application.post('/v1/link')
    def link(body: LinkBody, request: Request):
        ip = request.client.host if request.client else 'unknown'
        application.state.limiter.check('link-redeem:' + ip, 10)
        token = application.state.store.redeem_link_code(body.code)
        if not token:
            raise HTTPException(404, 'Link code not found or expired')
        return JSONResponse({'token': token}, headers={'Cache-Control': 'no-store'})

    @application.post('/v1/voice')
    def voice_upload(audio: UploadFile = File(...), create: str | None = Form(None), user=Depends(authenticate)):
        from .uploads import AUDIO_TYPES, audio_mime, read_upload
        from vali_media.voice import transcribe, VoiceError
        check_task_budget(application, user)
        data, mime = read_upload(audio, AUDIO_TYPES, audio_mime(audio))
        if not config.elevenlabs_api_key:
            raise HTTPException(503, 'Voice transcription is not configured')
        try:
            text = transcribe(data, mime, api_key=config.elevenlabs_api_key).strip()
        except VoiceError:
            raise HTTPException(502, 'Voice transcription failed') from None
        if not text:
            raise HTTPException(400, 'No speech detected')
        if create == '1':
            if len(text) > 20000:
                raise HTTPException(422, 'Transcript exceeds task length limit')
            return {**create_task_for_user(TaskBody(task=text), user, budget_checked=True), 'text': text}
        return {'text': text}

    @application.post('/v1/letters')
    def letter_upload(file: UploadFile = File(...), note: str | None = Form(None, max_length=20000), user=Depends(authenticate)):
        from .uploads import LETTER_TYPES, read_upload, letter_summary
        from vali_media.letters import LetterError
        check_task_budget(application, user)
        data, mime = read_upload(file, LETTER_TYPES)
        if not config.anthropic_api_key:
            raise HTTPException(503, 'Letter reading is not configured')
        try:
            summary = letter_summary(data, mime, note)
        except LetterError:
            raise HTTPException(502, 'Letter reading failed privacy validation or provider request') from None
        page = {'title': 'Uploaded letter', 'url': '', 'text': summary, 'selection': summary}
        body = TaskBody(task=(note or '').strip() or 'Explain this letter and tell me what to do', page=page)
        return create_task_for_user(body, user, budget_checked=True)

    @application.post('/v1/tasks')
    def create_task(body: TaskBody, user=Depends(authenticate)):
        return create_task_for_user(body, user)

    @application.get('/v1/tasks')
    def list_tasks(limit: int = Query(30, ge=1, le=100), user=Depends(authenticate)):
        return {'tasks': application.state.store.list_tasks(user['id'], limit)}

    @application.get('/v1/tasks/{tid}')
    def get_task(tid: str, user=Depends(authenticate)):
        return owned(tid, user)

    @application.post('/v1/tasks/{tid}/cancel')
    def cancel(tid: str, user=Depends(authenticate)):
        task = owned(tid, user)
        research = task['research']
        if research['status'] not in TERMINAL:
            if research.get('run_id'):
                application.state.exa.cancel_run(research['run_id'])
            application.state.store.update_research(tid, {**research, 'status': 'cancelled'})
        return application.state.store.get_task(tid)

    def execute_for_user(tid, body, user, channel=None):
        task = owned(tid, user)
        if task['research']['status'] != 'completed':
            raise HTTPException(409, 'Research must be completed')
        if task['execution'] and task['execution']['status'] not in {'done', 'failed', 'stopped'}:
            raise HTTPException(409, 'Execution already active')
        structured = (task['research'].get('output') or {}).get('structured') or {}
        actions = structured.get('actions') or []
        index = body.action_index if body.action_index is not None else 0
        if body.action_index is not None and index >= len(actions):
            raise HTTPException(422, 'Action index out of range')
        action = actions[index] if index < len(actions) else {}
        start_url = body.start_url or action.get('url') or (task.get('page') or {}).get('url')
        if not start_url or not start_url.startswith(('https://', 'http://')):
            raise HTTPException(422, 'An HTTP start URL is required')
        goal = json.dumps({'task': task['task'], 'goal': body.goal, 'answer': structured.get('answer'),
                           'key_facts': structured.get('key_facts', []), 'action': action, 'research': structured}, ensure_ascii=False)
        execution = dict(channel=channel, status='starting', goal=goal, start_url=start_url, current_url=start_url,
                         steps=[], shots=[], approval=None, approval_decision=None, result=None, error=None)
        if not application.state.store.start_execution(tid, execution, task['execution']):
            raise HTTPException(409, 'Execution already changed')
        application.state.spawn_browser_session(tid, goal, start_url, body.profile if body.profile is not None else json.loads(user['profile_json']))
        return application.state.store.get_task(tid)

    @application.post('/v1/tasks/{tid}/execute')
    def execute(tid: str, body: ExecuteBody, user=Depends(authenticate)):
        return execute_for_user(tid, body, user)

    @application.post('/v1/tasks/{tid}/approve')
    def approve(tid: str, user=Depends(authenticate)):
        task = owned(tid, user)
        if not application.state.store.approve_execution(tid, task['execution']):
            raise HTTPException(409, 'Execution is not awaiting approval')
        return application.state.store.get_task(tid)

    def message_for_user(tid, body, user, source='extension'):
        task = owned(tid, user)
        if not task['execution'] or task['execution']['status'] not in ACTIVE_EXECUTION:
            raise HTTPException(409, 'No running execution')
        application.state.store.patch_execution(tid, message={'at': now(), 'text': body.text, 'source': source})
        return application.state.store.get_task(tid)

    @application.post('/v1/tasks/{tid}/messages')
    def message(tid: str, body: MessageBody, user=Depends(authenticate)):
        return message_for_user(tid, body, user)

    def stop_for_user(tid, user, notify=True):
        task = owned(tid, user)
        if not task['execution']:
            raise HTTPException(409, 'Execution has not started')
        application.state.store.patch_execution(tid, {'status': 'stopped', 'approval_decision': 'stopped'})
        if notify and task['execution'].get('status') != 'stopped':
            push_task(application, tid, render_execution_update)
        return application.state.store.get_task(tid)

    @application.post('/v1/tasks/{tid}/stop')
    def stop(tid: str, user=Depends(authenticate)):
        return stop_for_user(tid, user)

    @application.get('/v1/tasks/{tid}/shots/{n}.jpg')
    def shots(tid: str, n: int, t: str):
        user = application.state.store.user_by_token(t)
        if not user:
            raise HTTPException(401, 'Invalid token')
        owned(tid, user)
        jpeg = application.state.store.get_shot(tid, n)
        if jpeg is None:
            raise HTTPException(404, 'Screenshot not found')
        return Response(jpeg, media_type='image/jpeg', headers={'Cache-Control': 'private, no-store'})

    @application.get('/v1/tasks/{tid}/live.jpg')
    def live_frame(tid: str, t: str):
        user = application.state.store.user_by_token(t)
        if not user:
            raise HTTPException(401, 'Invalid token')
        owned(tid, user)
        jpeg = application.state.store.get_live_frame(tid)
        if jpeg is None:
            raise HTTPException(404, 'No live frame')
        return Response(jpeg, media_type='image/jpeg', headers={'Cache-Control': 'no-store'})

    @application.get('/v1/watches')
    def watches(user=Depends(authenticate)):
        return {'watches': application.state.store.list_watches(user['id'])}

    @application.post('/v1/watches/{wid}/seen')
    def see_watch(wid: str, user=Depends(authenticate)):
        if not application.state.store.see_watch_updates(user['id'], wid):
            raise HTTPException(404, 'Watch not found')
        return {'ok': True}

    @application.get('/v1/status')
    def status(user=Depends(authenticate)):
        return {'failures': application.state.store.recent_failures(user['id'])}

    @application.delete('/v1/watches/{wid}')
    def delete_watch(wid: str, force: bool = False, user=Depends(authenticate)):
        store = application.state.store
        watch = store.get_watch(wid)
        if not watch or watch['user_id'] != user['id']:
            raise HTTPException(404, 'Watch not found')
        if not watch['exa_monitor_id'] and store.sql('SELECT slot FROM watch_slots WHERE watch_id=?', (wid,)):
            expired = datetime.fromisoformat(watch['created_at']) <= datetime.now(timezone.utc) - timedelta(minutes=10)
            if not force and not expired:
                raise HTTPException(409, 'Live setup is uncertain. Check Exa before releasing this reserved watch with force=1.')
        try:
            delete_monitor(application.state.exa, watch)
        except ExaError:
            if watch.get('task_id'):
                store.record_failure(watch['task_id'], 'watch.delete', 'Could not remove recurring search. Please retry.')
            raise
        store.delete_watch(user['id'], wid)
        return {'ok': True}

    @application.get('/webhooks/whatsapp')
    def verify(request: Request):
        params = request.query_params
        if not config.whatsapp_verify_token or params.get('hub.mode') != 'subscribe' or not hmac.compare_digest(params.get('hub.verify_token', ''), config.whatsapp_verify_token):
            raise HTTPException(403, 'Verification failed')
        return PlainTextResponse(params.get('hub.challenge', ''))

    sender = ContextVar('whatsapp_sender')

    def find_sender(number):
        user = application.state.store.find_user_by_number(number)
        sender.set(user)
        return user

    def active_task(user):
        # The latest actionable task across both channels, even behind newer research.
        tasks = application.state.store.list_tasks(user['id'], 100)
        return next((task for task in tasks if
                     (task.get('execution') or {}).get('status') in {'starting', 'running', 'awaiting_approval', 'submitting'}),
                    next((task for task in tasks if task['research']['status'] == 'completed'
                          and not task.get('execution')), tasks[0] if tasks else None))

    def transcribe(data, mime):
        from vali_media.voice import transcribe
        return transcribe(data, mime or 'audio/ogg', api_key=config.elevenlabs_api_key)

    def read_letter(data, mime, caption):
        from vali_media.letters import read_letter
        return read_letter(data, mime or 'image/jpeg', caption)

    async def create_whatsapp_task(user, text, source):
        return await asyncio.to_thread(create_task_for_user, TaskBody(task=text), user, source)

    application.state.whatsapp_flow = WhatsAppFlow(
        api=application.state.whatsapp_api, find_user_by_number=find_sender,
        link_number=lambda code, number: application.state.store.link_number(code, number),
        create_task=create_whatsapp_task,
        get_active_task=active_task,
        message=lambda tid, text: message_for_user(tid, MessageBody(text=text), sender.get(), 'whatsapp'),
        execute=lambda tid, index: execute_for_user(tid, ExecuteBody(action_index=index), sender.get(), 'whatsapp'),
        approve=lambda tid: approve(tid, sender.get()), stop=lambda tid: stop_for_user(tid, sender.get(), notify=False),
        transcribe=transcribe if config.elevenlabs_api_key else None,
        read_letter=read_letter if config.anthropic_api_key else None)

    def process_messages(messages):
        # Sync background work gets a worker thread, keeping blocking providers off ASGI.
        async def process():
            for message in messages:
                if not message.from_number or not message.message_id:
                    continue
                if not application.state.store.claim_whatsapp_message(message.message_id):
                    continue
                try:
                    await application.state.whatsapp_flow.handle(message)
                except Exception as exc:
                    log_failure('message processing failed', exc, message_id=message.message_id)
                    # Never expose provider responses or private message contents.
                    try:
                        for body in render_error('Could not process this message. Please try again.'):
                            await application.state.whatsapp_api.send_text(message.from_number, body)
                    except Exception as exc:
                        log_failure('error reply failed', exc, message_id=message.message_id)
        asyncio.run(process())

    @application.post('/webhooks/whatsapp')
    async def whatsapp(request: Request, background_tasks: BackgroundTasks):
        raw = await request.body()
        if config.whatsapp_app_secret and not verify_signature(
                raw, request.headers.get('x-hub-signature-256', ''), config.whatsapp_app_secret):
            raise HTTPException(403, 'Invalid signature')
        try:
            payload = json.loads(raw)
        except ValueError:
            raise HTTPException(400, 'Invalid JSON')
        if not isinstance(payload, dict):
            raise HTTPException(400, 'Expected an object')
        parsed = parse_webhook(payload)
        for status in parsed.statuses:
            # Deliberately exclude recipient_id and provider details/URLs.
            whatsapp_logger.info('delivery status=%s message_id=%s errors=%s',
                                 status.status, status.message_id,
                                 [{'code': error.get('code'), 'title': error.get('title')}
                                  for error in status.errors])
        background_tasks.add_task(process_messages, parsed.messages)
        return {'ok': True}

    @application.post('/webhooks/exa')
    async def exa_webhook(request: Request):
        length = request.headers.get('content-length')
        if length is not None:
            try:
                size = int(length)
            except ValueError:
                raise HTTPException(400, 'Invalid Content-Length') from None
            if size > 256 * 1024:
                raise HTTPException(413, 'Delivery exceeds 256 KB')
        store = application.state.store
        watch = store.get_watch(request.query_params.get('w', ''))
        raw = await request.body()
        if not watch or not verify_delivery(raw, request.headers.get('exa-signature', ''), watch.get('secret')):
            raise HTTPException(403, 'Invalid signature')
        try:
            event_id, update = delivery_update(json.loads(raw), watch)
        except (ValueError, TypeError):
            raise HTTPException(400, 'Invalid delivery') from None
        if update:
            store.add_watch_update(watch, event_id, update)
        return {'ok': True}

    add_voice_routes(
        application, owned=owned, active=active_task, approve=approve, cancel=cancel,
        create=lambda text, user: create_task_for_user(TaskBody(task=text), user, 'voice'),
        stop=lambda tid, user: stop_for_user(tid, user),
        message=lambda tid, text, user: message_for_user(tid, MessageBody(text=text), user, 'voice'))
    return application


app = create_app()
