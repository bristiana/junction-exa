"""Vali HTTP API and injectable research/browser workers."""
import asyncio
import copy
from datetime import datetime, timedelta, timezone
from contextvars import ContextVar
import hmac
import json
import logging
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

from . import activity
from .citations import cite, unchecked
from .companion import CompanionBody, companion_tip, make_cache
from .config import Config
from .exa import ExaClient, ExaError, TTLCache
from .monitors import provision_watch, delete_monitor, run_completed, trigger_monitor, verify_delivery, delivery_update, watch_criteria, with_watch
from .guard import (CODE_LOCKOUT, CODE_TRIES, PAIR_BUDGET, PAIR_BUDGET_SECONDS, RateLimited, SlidingWindow, authenticate,
                    check_code_tries, check_origin, check_task_budget, client_ip, public_start_url, resolve_host)
from .research import ANSWER_FIRST, FIND_RULES, FIND_SCHEMA, SYSTEM_PROMPT, build_query, build_run_request, guard_recipients, map_find_output, progress_from_events
from .jev import JevClient
from .llm import make_fast_json
from .questions import early_question, with_answer
from .router import route
from .services import create_router as services_router
from .stats import channel_of_origin, pick_channel, summarize
from .store import make_store, now
from .uploads import UploadLimit
from .voice_agent import add_voice_routes
from vali_wa.flow import WhatsAppFlow
from vali_wa.webhook import parse_webhook, verify_signature
from vali_wa.render import render_result, render_execution_update, render_error
from .wa_channel import ChannelAPI, push_task, push_watch_update, log_failure, logger as whatsapp_logger

logger = logging.getLogger('vali.api')
TERMINAL = {'completed', 'failed', 'cancelled'}
CARRIED = ('question', 'activity_head', 'cost_before', 'effort', 'known_details')  # research fields that outlive a run poll


KnownDetail = Literal['name', 'email', 'phone', 'address', 'postal_code', 'city', 'country', 'date_of_birth', 'nationality']


class TaskBody(BaseModel):
    task: str = Field(min_length=1, max_length=20000)
    page: dict | None = None
    effort: Literal['minimal', 'low', 'medium', 'high', 'xhigh', 'auto', 'ultra'] = 'low'
    previous_task_id: str | None = None
    channel: str | None = Field(default=None, max_length=20)
    # Names of the details saved on the device, never their values: the research writes {{name}} instead of asking.
    known_details: list[KnownDetail] = Field(default_factory=list, max_length=9)


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
                output=guard_recipients(run.get('output')), cost=(run.get('costDollars') or {}).get('total'),
                stop_reason=run.get('stopReason'), error=error.get('message') if isinstance(error, dict) else error)


QUOTE_TIMEOUT = timedelta(seconds=90)


def quoting(task, research):
    """Research whose answer is in, waiting for the quote check (status stays running until it is done)."""
    return {**research, 'status': 'running', 'quoting': 'pending',
            'activity': (research.get('activity') or []) + [activity.checking(task, research['output'])]}


REUSE_FOR = timedelta(minutes=30)
TIME_SENSITIVE = re.compile(r'\b(?:now|today|tonight|tomorrow|next|live|open|delay\w*|late|on time|currently|right away)\b', re.I)


def reused_research(task, research, answered_at):
    minutes = max(1, round((datetime.now(timezone.utc) - datetime.fromisoformat(answered_at)).total_seconds() / 60))
    return {**research, 'cost': 0, 'question': research.get('question'), 'reused_from': answered_at, 'activity': [
        activity.opening(task),
        activity.entry(task['created_at'], 'think', f'Same question answered {minutes} min ago: reusing that research'),
        activity.done(task, research['output'])]}


def quote_check_stalled(task):
    started = task['research'].get('quoting')
    if not started:
        return False
    since = task['updated_at'] if started == 'pending' else started
    return datetime.now(timezone.utc) - datetime.fromisoformat(since) > QUOTE_TIMEOUT


def check_quotes(application, task, research):
    """Claim the quote check, run it, and complete the task whatever happens: it never stays running."""
    store = application.state.store
    started = research['quoting']
    if started != 'pending' and datetime.now(timezone.utc) - datetime.fromisoformat(started) < QUOTE_TIMEOUT:
        return False  # another poller is checking; a stale claim is taken over
    claimed = {**research, 'quoting': now()}
    if not store.update_research(task['id'], claimed, expected=research):
        return False
    final = {k: v for k, v in copy.deepcopy(claimed).items() if k != 'quoting'}
    final['status'] = 'completed'
    try:
        final['cost'] = (final.get('cost') or 0) + cite(final['output'], application.state.exa, application.state.llm, task['task'])
    except Exception:
        logger.exception('quote check failed for %s', task['id'])
        unchecked(final['output'], task['task'])
    final['activity'] = final['activity'] + [activity.done(task, final['output'])]
    final['question'] = final.get('question') or missing_info_question(final['output'])
    if store.update_research(task['id'], final, expected=claimed):
        push_task(application, task['id'], render_result)
    return True


def poll_research_once(task_id, application=None):
    application = application or app
    store, exa = application.state.store, application.state.exa
    task = store.get_task(task_id)
    if not task or task['research']['status'] in TERMINAL:
        return True
    previous = task['research']
    if previous.get('quoting'):
        return check_quotes(application, task, previous)
    try:
        run = exa.get_run(previous['run_id'])
        research = {**research_from_run(run), **{k: previous[k] for k in CARRIED if k in previous}}
        research['progress'] = previous.get('progress', [])
        research['activity'] = previous.get('activity', [])
        if previous.get('cost_before'):
            research['cost'] = (research.get('cost') or 0) + previous['cost_before']
        if research['status'] not in {'failed', 'cancelled'}:
            try:
                events = exa.get_events(previous['run_id']).get('data', [])
                research['progress'] = progress_from_events(events) or research['progress']
                trail, head = activity.from_events(task, events), previous.get('activity_head')
                research['activity'] = head + trail[1:] if head else trail
            except ExaError:
                store.record_failure(task_id, 'research.events', 'Research progress is temporarily unavailable.')
    except ExaError as exc:
        if exc.status != 404:
            store.record_failure(task_id, 'research.poll', 'Research service is temporarily unavailable.')
            return False
        research = {**previous, 'status': 'failed', 'error': 'The run was not found.'}
    if research['status'] == 'completed' and research.get('output'):
        waiting = quoting(task, research)  # shown while the quotes are checked; the web page polls every second
        if not store.update_research(task_id, waiting, expected=previous):
            return False
        return check_quotes(application, task, waiting)
    if store.update_research(task_id, research, expected=previous) and research['status'] in {'completed', 'failed'}:
        push_task(application, task_id, render_result)
    return research['status'] in TERMINAL


def missing_info_question(output):
    """What the answer says is still missing becomes an optional question; the answer itself is already there."""
    missing = [m for m in ((output or {}).get('structured') or {}).get('missing_info') or [] if isinstance(m, str) and m.strip()]
    return {'text': missing[0].strip()[:300], 'options': [], 'answer': None} if missing else None


def find_research(state, task, text, known_details=()):
    """One Exa search+answer call; the quote check follows in the poller, off the request."""
    response = state.exa.search(dict(query=build_query(text, task['page'], known_details=known_details), type='auto', numResults=5,
                                     contents={'highlights': True}, outputSchema=FIND_SCHEMA, systemPrompt=SYSTEM_PROMPT + ANSWER_FIRST + FIND_RULES))
    found = dict(output=map_find_output(response), cost=(response.get('costDollars') or {}).get('total') or 0,
                 activity=activity.from_search(task, text, response))
    return quoting(task, found)


def refine_research(application, task, answer):
    """The user answered research.question: rerun with the answer, keeping the trail so far."""
    state, research = application.state, task['research']
    question = {**research['question'], 'answer': answer.strip()[:200]}
    text = with_answer(task['task'], question, answer)
    head = (research.get('activity') or []) + [
        activity.entry(task['created_at'], 'think', f'Got your answer: {question["answer"]}. Refining')]
    if research['kind'] == 'search':
        found = find_research(state, task, text, research.get('known_details') or ())
        refined = {**research, **found, 'question': question, 'activity': head + found['activity'][1:],
                   'cost': (research.get('cost') or 0) + found['cost']}
    elif research['kind'] == 'agent':
        if research['status'] not in TERMINAL and research.get('run_id'):
            try:
                state.exa.cancel_run(research['run_id'])
            except ExaError:
                pass
        run_request = build_run_request(text, task['page'], known_details=research.get('known_details') or ())
        if research['status'] == 'completed' and research.get('run_id'):
            run_request['previousRunId'] = research['run_id']
        refined = {**research_from_run(state.exa.create_run(run_request)), 'question': question, 'activity': head,
                   'known_details': research.get('known_details', []),
                   'activity_head': head, 'cost_before': research.get('cost') or 0}
    else:
        refined = {**research, 'question': question}
    if not state.store.update_research(task['id'], refined, expected=research):
        raise HTTPException(409, 'Research changed meanwhile; try again')
    if refined.get('quoting'):
        state.spawn_quote_check(task['id'])
    elif research['kind'] == 'agent' and research['status'] in TERMINAL:
        state.spawn_research_poller(task['id'])  # a running agent poller follows the new run by itself
    return state.store.get_task(task['id'])


def research_poller_loop(task_id, application=None):
    application = application or app
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        if poll_research_once(task_id, application):
            return
        time.sleep(1)
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

    def on_handoff(url, cookies):
        # Cookies go to their own table only; the task shows just that a hand-off is there.
        store.put_handoff(task_id, url, cookies)
        store.patch_execution(task_id, {'handoff_available': True})

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
                               on_exa=on_exa, on_handoff=on_handoff)
        except TypeError:  # an agent build without live view, usage or inbox hooks
            hooks = AgentHooks(**base)
        result = run_browser_agent(goal=goal, start_url=start_url, profile=profile, hooks=hooks)
        value = result if isinstance(result, dict) else vars(result)
        patch_execution(task_id, {'status': 'stopped' if should_stop() else value['status'],
                                       'result': value.get('result', ''), 'current_url': value.get('final_url'), 'error': value.get('error'),
                                       **{k: value[k] for k in ('usage', 'sources', 'filled', 'exa', 'private_view') if value.get(k) is not None}})
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

def create_app(config=None, store=None, exa=None, spawn_research_poller=None, spawn_browser_session=None, jev=None, whatsapp_api=None,
               llm=None, spawn_quote_check=None):
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
    application.state.llm = llm or make_fast_json(config.anthropic_api_key)
    application.state.companion_cache = make_cache()
    application.state.stats_cache = TTLCache(ttl=5, max_entries=1024)
    application.state.resolve_host = resolve_host
    application.state.limiter = SlidingWindow()
    application.state.spawn_research_poller = spawn_research_poller or (lambda tid: spawn_thread(research_poller_loop, tid, application))
    # The quote check of an errand whose answer is already in: on Modal a thread in the warm web container (no cold start).
    application.state.spawn_quote_check = spawn_quote_check or application.state.spawn_research_poller
    application.state.spawn_browser_session = spawn_browser_session or (lambda tid, goal, url, profile: spawn_thread(run_browser_session, tid, goal, url, profile, application))
    application.state.whatsapp_api = whatsapp_api or ChannelAPI(config)
    application.add_middleware(UploadLimit)
    application.add_middleware(CORSMiddleware,
        allow_origins=[o.strip() for o in config.allowed_origins.split(',') if o.strip() and o.strip() != 'extension'],
        allow_origin_regex=r'^(chrome-extension://[a-z]+|https?://(localhost|127\.0\.0\.1)(:\d+)?)$',
        allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allow_headers=['Authorization', 'Content-Type', 'X-Vali-Channel'])

    @application.middleware('http')
    async def guards(request, call_next):
        try:
            check_origin(request.headers.get('origin'), config.allowed_origins)
            if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                limiter, ip = application.state.limiter, client_ip(request)
                limiter.check('ip:' + ip, limiter.ip_limit, limiter.ip_seconds)
                if request.url.path == '/v1/users':
                    limiter.check('signup:' + ip, limiter.signup_limit, limiter.signup_seconds, what='new accounts')
        except RateLimited as exc:
            return await rate_limited(request, exc)
        except HTTPException as exc:
            return JSONResponse({'detail': exc.detail}, status_code=exc.status_code)
        return await call_next(request)

    @application.exception_handler(RateLimited)
    async def rate_limited(request, exc):
        return JSONResponse({'detail': exc.detail, 'retry_after': exc.retry_after}, status_code=429, headers=exc.headers)

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
                    profile_synced=False)  # profiles stay on the device; old clients read this

    @application.put('/v1/profile')
    def profile(body: ProfileBody, user=Depends(authenticate)):
        """A no-op for old clients: the profile is never stored; it travels only with an execute call."""
        return {'ok': True}

    @application.post('/v1/pair')
    def pair(user=Depends(authenticate)):
        return {**application.state.store.create_pair_code(user['id']), 'whatsapp': config.whatsapp_number}

    def create_task_for_user(body, user, source='extension', *, budget_checked=False):
        if not body.task.strip():
            raise HTTPException(422, 'Task must not be blank')
        check_task_budget(application, user, count_request=not budget_checked)
        state = application.state
        mode, kind = route(body.task, body.page, classify=state.jev.classify if state.jev else None)
        previous_run = None
        if body.previous_task_id:
            previous_run = owned(body.previous_task_id, user)['research'].get('run_id')
        research = dict(kind=kind, status='queued', run_id=None, progress=[], output=None, cost=None, stop_reason=None, error=None,
                        question=early_question(body.task, mode), effort=body.effort, known_details=sorted(set(body.known_details)))
        reusable = not (body.page or previous_run or kind == 'monitor' or TIME_SENSITIVE.search(body.task))
        reused = reusable and state.store.recent_research(
            user['id'], body.task, mode, body.effort, (datetime.now(timezone.utc) - REUSE_FOR).isoformat(),
            research['known_details'])
        task = state.store.create_task(user['id'], body.task, body.page, mode, research, source=source)
        if reused:  # the same question minutes ago: its cited research, at no cost and no wait
            research = reused_research(task, *reused)
            state.store.update_research(task['id'], research)
            push_task(application, task['id'], render_result)
            return state.store.get_task(task['id'])
        try:
            if kind == 'search':
                research.update(find_research(state, task, body.task, research['known_details']))
            elif kind == 'agent':
                run_request = build_run_request(body.task, body.page, effort=body.effort, known_details=research['known_details'])
                if previous_run:
                    run_request['previousRunId'] = previous_run
                research = {**research_from_run(state.exa.create_run(run_request)), 'activity': [activity.opening(task)],
                            'question': research['question'], 'effort': body.effort, 'known_details': research['known_details']}
            else:
                watch, message = provision_watch(config, state.store, state.exa, user['id'], body.task, task['id'])
                if watch is None:
                    state.store.update_research(task['id'], {**research, 'status': 'failed', 'error': message})
                    raise HTTPException(409, message)
                criteria, live = watch_criteria(body.task), bool(watch.get('secret'))
                research.update(status='completed', watch_id=watch['id'], activity=[activity.opening(task)],
                    monitor_stubbed=not live, output=with_watch({'text': '', 'structured': {
                        'answer': '', 'status': 'info_only',
                        'key_facts': [], 'steps': [], 'actions': [], 'missing_info': []}, 'grounding': []}, criteria, message, live))
                try:  # what is watched first, then what is true today; the watch reports what changes later
                    found = find_research(state, task, criteria)
                    research.update(found, output=with_watch(found['output'], criteria, message, live))
                except ExaError:
                    pass
            state.store.update_research(task['id'], research)
        except ExaError:
            state.store.update_research(task['id'], {**research, 'status': 'failed', 'error': 'Research service request failed.'})
            push_task(application, task['id'], render_result)
            raise
        if research['status'] in {'completed', 'failed'}:
            push_task(application, task['id'], render_result)
        if research.get('quoting'):
            state.spawn_quote_check(task['id'])
        elif research['status'] not in TERMINAL:
            state.spawn_research_poller(task['id'])
        return state.store.get_task(task['id'])

    @application.post('/v1/link/code')
    def link_code(request: Request, user=Depends(authenticate)):
        application.state.limiter.check('link-code:' + user['id'], 30, 600)
        token = request.headers['authorization'].partition(' ')[2]
        return application.state.store.create_link_code(user['id'], token)

    @application.post('/v1/link')
    def link(body: LinkBody, request: Request):
        limiter, ip = application.state.limiter, client_ip(request)
        limiter.check('link-redeem:' + ip, 30, 600)  # 30: judges share one venue address
        tries = f'link-fail:{ip}:{body.code[:3]}'  # lockout per address and code prefix, so one guesser cannot lock a room
        check_code_tries(limiter, tries)
        token = application.state.store.redeem_link_code(body.code)
        if not token:
            limiter.failed(tries)
            raise HTTPException(404, 'Link code not found or expired')
        return JSONResponse({'token': token}, headers={'Cache-Control': 'no-store'})

    @application.post('/v1/voice')
    def voice_upload(request: Request, audio: UploadFile = File(...), create: str | None = Form(None), user=Depends(authenticate)):
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
            channel = pick_channel(request.headers.get('x-vali-channel'), default='voice')
            return {**create_task_for_user(TaskBody(task=text), user, channel, budget_checked=True), 'text': text}
        return {'text': text}

    @application.post('/v1/letters')
    def letter_upload(request: Request, file: UploadFile = File(...), note: str | None = Form(None, max_length=20000),
                      user=Depends(authenticate)):
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
        return create_task_for_user(body, user, pick_channel(request.headers.get('x-vali-channel'), default='letter'),
                                    budget_checked=True)

    @application.post('/v1/tasks')
    def create_task(body: TaskBody, request: Request, user=Depends(authenticate)):
        return create_task_for_user(body, user, pick_channel(request.headers.get('x-vali-channel'), body.channel,
                                                             default=channel_of_origin(request.headers.get('origin'))))

    @application.post('/v1/companion')
    def companion(body: CompanionBody, user=Depends(authenticate)):
        application.state.limiter.check('companion:' + user['id'], 60, what='page tips')
        return companion_tip(application.state, body)

    @application.get('/v1/stats')
    def stats(user=Depends(authenticate)):
        cached = application.state.stats_cache.get(user['id'])
        if cached is None:  # the latest 1000 errands, recomputed at most every 5 s per user
            cached = summarize(application.state.store.list_tasks(user['id'], 1000))
            application.state.stats_cache.put(user['id'], cached)
        return cached

    @application.get('/v1/tasks')
    def list_tasks(limit: int = Query(30, ge=1, le=100), user=Depends(authenticate)):
        return {'tasks': application.state.store.list_tasks(user['id'], limit)}

    @application.get('/v1/tasks/{tid}')
    def get_task(tid: str, user=Depends(authenticate)):
        task = owned(tid, user)
        # A quote check runs in a thread of the web container; if that container died mid-check (deploy, scale-in),
        # the task would stay running forever. The next poll of the task starts a new check, which takes over.
        if quote_check_stalled(task):
            application.state.spawn_quote_check(tid)
        if (task['execution'] or {}).get('handoff_available') and not application.state.store.handoff_live(tid):
            task['execution']['handoff_available'] = False  # expired
        return task

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
        if not public_start_url(start_url, application.state.resolve_host):
            raise HTTPException(422, 'A public http(s) start URL is required')
        goal = json.dumps({'task': task['task'], 'goal': body.goal, 'answer': structured.get('answer'),
                           'key_facts': structured.get('key_facts', []), 'action': action, 'research': structured}, ensure_ascii=False)
        execution = dict(channel=channel, status='starting', goal=goal, start_url=start_url, current_url=start_url,
                         steps=[], shots=[], approval=None, approval_decision=None, result=None, error=None)
        if not application.state.store.start_execution(tid, execution, task['execution']):
            raise HTTPException(409, 'Execution already changed')
        application.state.spawn_browser_session(tid, goal, start_url, body.profile or {})
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
        executing = task['execution'] and task['execution']['status'] in ACTIVE_EXECUTION
        question = task['research'].get('question')
        if not executing and question and question.get('answer') is None:
            check_task_budget(application, user)  # the follow-up pass is research too
            return refine_research(application, task, body.text)
        if not executing:
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

    @application.post('/v1/tasks/{tid}/handoff')
    def handoff(tid: str, user=Depends(authenticate)):
        """Continue in my browser: the cloud browser's page and its site cookies, once, within 15 minutes.
        The user takes over (pays), so the cloud run stops."""
        execution = owned(tid, user)['execution'] or {}
        store = application.state.store
        found = execution.get('handoff_available') and store.take_handoff(tid)
        if execution.get('handoff_available'):
            stop = found and execution.get('status') in ACTIVE_EXECUTION
            store.patch_execution(tid, {'handoff_available': False} | ({'status': 'stopped', 'approval_decision': 'stopped'} if stop else {}))
        if not found:
            raise HTTPException(404, 'No hand-off available (expired or already used)')
        return JSONResponse({'url': found['url'], 'cookies': found['cookies']}, headers={'Cache-Control': 'no-store'})

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

    def request_check(watch):
        # Marked first, so even a fast delivery of this run replies; unmarked if the trigger fails.
        application.state.store.request_check(watch['id'])
        try:
            trigger_monitor(application.state.exa, watch)
        except ExaError:
            application.state.store.request_check(watch['id'], requested=False)
            raise

    @application.post('/v1/watches/{wid}/check')
    def check_watch(wid: str, user=Depends(authenticate)):
        watch = application.state.store.get_watch(wid)
        if not watch or watch['user_id'] != user['id']:
            raise HTTPException(404, 'Watch not found')
        if not watch['exa_monitor_id'] or not watch.get('secret'):
            raise HTTPException(409, 'This watch has no live Exa monitor to check.')
        request_check(watch)
        return {'ok': True, 'triggered': True}

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

    def check_latest_watch(user):
        """'check now' on WhatsApp: trigger the newest live watch; its errand language, or None without one."""
        store = application.state.store
        for row in store.sql('SELECT id FROM watches WHERE user_id=? AND exa_monitor_id IS NOT NULL '
                             'ORDER BY created_at DESC', (user['id'],)):
            watch = store.get_watch(row['id'])
            if watch and watch.get('secret'):
                request_check(watch)
                task = store.get_task(watch['task_id']) if watch.get('task_id') else None
                return (task or {}).get('lang') or 'en'
        return None

    async def create_whatsapp_task(user, text, source):
        return await asyncio.to_thread(create_task_for_user, TaskBody(task=text), user, source)

    def link_number(code, number):
        """A WhatsApp pairing code. Wrong ones are counted in the store, so every replica agrees: five from a number
        lock it out for 15 minutes, and too many from all numbers pause linking for everyone for an hour."""
        store = application.state.store
        mine = 'pair:' + number
        if not store.count_code_try(mine, CODE_TRIES, CODE_LOCKOUT):
            return False
        if not store.count_code_try('pair:all', PAIR_BUDGET, PAIR_BUDGET_SECONDS):
            store.refund_code_try(mine)  # a paused link is not this number's wrong code
            return 'paused'
        linked = store.link_number(code, number)
        if linked:
            store.refund_code_try(mine)
            store.refund_code_try('pair:all')
        return linked

    application.state.whatsapp_flow = WhatsAppFlow(
        api=application.state.whatsapp_api, find_user_by_number=find_sender,
        link_number=link_number,
        create_task=create_whatsapp_task,
        get_active_task=active_task,
        message=lambda tid, text: message_for_user(tid, MessageBody(text=text), sender.get(), 'whatsapp'),
        execute=lambda tid, index: execute_for_user(tid, ExecuteBody(action_index=index), sender.get(), 'whatsapp'),
        approve=lambda tid: approve(tid, sender.get()), stop=lambda tid: stop_for_user(tid, sender.get(), notify=False),
        transcribe=transcribe if config.elevenlabs_api_key else None,
        read_letter=read_letter if config.anthropic_api_key else None,
        check=lambda user: asyncio.to_thread(check_latest_watch, user))

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
        if not config.whatsapp_app_secret or not verify_signature(  # fail closed without a secret
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
    async def exa_webhook(request: Request, background_tasks: BackgroundTasks):
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
            payload = json.loads(raw)
            event_id, update = delivery_update(payload, watch)
        except (ValueError, TypeError):
            raise HTTPException(400, 'Invalid delivery') from None
        # Only a first-seen event reaches WhatsApp; Exa retries are deduplicated by the store.
        if update:
            if store.add_watch_update(watch, event_id, update):
                store.take_check(watch['id'])
                background_tasks.add_task(push_watch_update, application, watch, update)
        elif run_completed(payload) and store.take_check(watch['id']):
            background_tasks.add_task(push_watch_update, application, watch, None)  # asked for: nothing new
        return {'ok': True}

    add_voice_routes(
        application, owned=owned, active=active_task, approve=approve, cancel=cancel,
        create=lambda text, user: create_task_for_user(TaskBody(task=text), user, 'voice'),
        stop=lambda tid, user: stop_for_user(tid, user),
        message=lambda tid, text, user: message_for_user(tid, MessageBody(text=text), user, 'voice'))
    application.include_router(services_router(), dependencies=[Depends(authenticate)])
    mount_web(application)
    return application


def mount_web(application):
    """Serve web/ at / after every API route, so the page never shadows /v1 or /webhooks."""
    from pathlib import Path
    from fastapi.staticfiles import StaticFiles

    class FreshFiles(StaticFiles):
        # Modal ships files with mtime 0, so the ETag only tracks size: a same-size edit would stay cached.
        def is_not_modified(self, response_headers, request_headers):
            return False

        def file_response(self, *args, **kwargs):
            response = super().file_response(*args, **kwargs)
            response.headers['Cache-Control'] = 'no-store'
            return response

    here = Path(__file__).resolve().parent
    for web in (here.parent / 'web', here.parent.parent / 'web'):  # the Modal image, then a repo checkout
        if web.is_dir():
            application.mount('/', FreshFiles(directory=web, html=True), name='web')
            return


app = create_app()
