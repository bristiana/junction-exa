"""Talk to Vali: ElevenLabs agent sessions and the server tools the agent calls.

The tool webhooks carry two headers: the shared VALI_VOICE_TOOL_SECRET (an ElevenLabs
workspace secret) and a per-user session token that this API signed and handed to the
client as the `secret__vali_session` dynamic variable. Client-chosen variables are not
trusted, so a tool call can only act for the user whose token it carries.
"""
import hashlib
import hmac
import json
import re
import time
from types import SimpleNamespace
from typing import Literal

from fastapi import Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .exa import ExaError
from .guard import authenticate

SESSION_VARIABLE = 'secret__vali_session'
SECRET_HEADER = 'x-vali-tool-secret'
SESSION_HEADER = 'x-vali-session'
SESSION_TTL = 2 * 3600  # covers a long conversation; the start credential itself lasts 15 min
CREDENTIAL_TTL = 900
SPOKEN_LIMIT = 600


class ToolBody(BaseModel):
    id: str | None = Field(None, max_length=100)
    text: str | None = Field(None, max_length=2000)


def _signature(uid, expires, secret):
    message = f'vali-voice-session:{uid}.{expires}'.encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def session_token(uid, secret, now=None):
    expires = int(now if now is not None else time.time()) + SESSION_TTL
    return f'{uid}.{expires}.{_signature(uid, expires, secret)}'


def session_user_id(token, secret, now=None):
    uid, _, rest = (token or '').partition('.')
    expires, _, signature = rest.partition('.')
    if not uid or not expires.isdigit() or not signature:
        return None
    if not hmac.compare_digest(signature, _signature(uid, int(expires), secret)):
        return None
    return uid if int(expires) > (now if now is not None else time.time()) else None


def spoken(text, limit=SPOKEN_LIMIT):
    """Placeholders become plain words; long text is cut at a sentence end."""
    text = re.sub(r'\{\{(\w+)\}\}', lambda m: 'your ' + m[1].replace('_', ' '), str(text or ''))
    text = re.sub(r'\s*(\[\d+\])+', '', text)  # citation markers like [1][2] are not for reading aloud
    text = ' '.join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind('. '), cut.rfind('? '), cut.rfind('! '))
    return cut[:end + 1] if end > limit // 2 else cut.rstrip() + '...'


def answer_of(task):
    structured = ((task['research'].get('output') or {}).get('structured')) or {}
    return structured.get('answer') or ''


EXECUTION_LINES = {
    'starting': 'Starting on the website.', 'running': 'Working on the website.',
    'awaiting_approval': 'Waiting for your OK before submitting.', 'submitting': 'Submitting now.',
    'stopped': 'Stopped.',
}


def status_line(task):
    execution = task.get('execution') or {}
    research = task['research']
    if execution.get('question'):
        return 'Vali has a question: ' + execution['question'].get('text', '')
    if execution.get('status') == 'done':
        return 'Done. ' + (execution.get('result') or '')
    if execution.get('status') == 'failed':
        return 'It did not work: ' + (execution.get('error') or 'unknown reason')
    if execution.get('status') in EXECUTION_LINES:
        return EXECUTION_LINES[execution['status']]
    if research['status'] in {'queued', 'running'}:
        return 'Still researching.'
    if research['status'] == 'failed':
        return 'Research failed: ' + (research.get('error') or 'unknown reason')
    if research['status'] == 'cancelled':
        return 'Cancelled.'
    return 'Research done. ' + answer_of(task)


def errand_line(task):
    return f"{spoken(task['task'], 80)} - {spoken(status_line(task), 160)} (id {task['id']})"


def approval_digest(approval):
    return hashlib.sha256(json.dumps(approval, sort_keys=True).encode()).hexdigest()[:16]


def approval_text(approval):
    filled = '; '.join(f"{item.get('label', 'field')}: {item.get('value', '')}"
                       for item in (approval.get('filled') or []))
    return (approval.get('summary') or 'Ready to submit.') + (' Filled in: ' + filled + '.' if filled else '')


def create_errand(errands, user, body):
    if not (body.text or '').strip():
        return 'Tell me what errand to run.'
    task = errands.create(body.text.strip(), user)
    if task['research']['status'] == 'completed':
        return f"{answer_of(task)} (id {task['id']})"
    return f"On it. I am researching that now; ask me for the status in a minute. (id {task['id']})"


def list_errands(errands, user, body):
    tasks = errands.recent(user)
    if not tasks:
        return 'You have no errands yet.'
    return ' '.join(f'{n}. {errand_line(task)}.' for n, task in enumerate(tasks, 1))


def errand_status(errands, user, body):
    return errand_line(errands.pick(body, user))


def approval_summary(errands, user, body):
    task = errands.pick(body, user)
    execution = task.get('execution') or {}
    if execution.get('status') != 'awaiting_approval' or not execution.get('approval'):
        return 'Nothing is waiting for your OK on that errand. ' + status_line(task)
    errands.mark_read_back(task['id'], approval_digest(execution['approval']))
    return 'Read this back before approving: ' + approval_text(execution['approval'])


def approve(errands, user, body):
    task = errands.pick(body, user)
    execution = task.get('execution') or {}
    if execution.get('status') != 'awaiting_approval' or not execution.get('approval'):
        return 'Nothing is waiting for your OK on that errand.'
    if execution.get('voice_read_back') != approval_digest(execution['approval']):
        return 'Not approved yet. Call approval_summary and read it back to the user first.'
    errands.approve(task['id'], user)
    return 'Approved. Vali is submitting it now.'


def stop(errands, user, body):
    task = errands.pick(body, user)
    if task.get('execution'):
        errands.stop(task['id'], user)
    else:
        errands.cancel(task['id'], user)
    return 'Stopped. Nothing more will be submitted for that errand.'


def answer_question(errands, user, body):
    if not (body.text or '').strip():
        return 'What should I tell Vali?'
    task = errands.pick(body, user)
    errands.message(task['id'], body.text.strip(), user)
    return 'Got it, I passed that on.'


TOOLS = {f.__name__: f for f in (create_errand, list_errands, errand_status, approval_summary,
                                 approve, stop, answer_question)}


def make_errands(application, *, create, owned, active, approve, stop, cancel, message):
    """Bind the app's user-scoped task operations; every lookup goes through owned()."""
    def store():
        return application.state.store

    def pick(body, user):
        if body.id:
            return owned(body.id, user)
        task = active(user)
        if not task:
            raise HTTPException(404, 'No errand')
        return task

    def mark_read_back(tid, digest):
        store().patch_execution(tid, {'voice_read_back': digest})

    return SimpleNamespace(create=create, recent=lambda user: store().list_tasks(user['id'], 5), pick=pick,
                           approve=approve, stop=stop, cancel=cancel, message=message,
                           mark_read_back=mark_read_back)


def tool_reply(handler, errands, user, body):
    try:
        text = handler(errands, user, body)
    except HTTPException as exc:
        text = "I can't find that errand." if exc.status_code == 404 else str(exc.detail)
    except ExaError:
        text = 'The research service failed. Please try again in a moment.'
    return {'result': spoken(text)}


def add_voice_routes(application, **operations):
    config = application.state.config
    errands = make_errands(application, **operations)

    def require_agent():
        if not config.voice_agent_ready():
            raise HTTPException(503, 'Voice agent is not configured')

    def tool_user(request: Request):
        require_agent()
        secret = request.headers.get(SECRET_HEADER, '')
        if not hmac.compare_digest(secret.encode(), config.voice_tool_secret.encode()):
            raise HTTPException(401, 'Invalid tool secret')
        uid = session_user_id(request.headers.get(SESSION_HEADER), config.voice_tool_secret)
        user = application.state.store.get_user(uid) if uid else None
        if not user:
            raise HTTPException(401, 'Invalid voice session')
        return user

    @application.post('/v1/voice/session')
    def voice_session(connection: Literal['webrtc', 'websocket'] = Query('webrtc'), user=Depends(authenticate)):
        from vali_media import voice
        require_agent()
        application.state.limiter.check('voice-session:' + user['id'], 10)
        try:
            credentials = voice.conversation_credentials(
                config.elevenlabs_agent_id, api_key=config.elevenlabs_api_key, connection=connection)
        except voice.VoiceError:
            raise HTTPException(502, 'Voice session could not be started') from None
        token = session_token(user['id'], config.voice_tool_secret)
        return JSONResponse({**credentials, 'connection_type': connection, 'expires_in': CREDENTIAL_TTL,
                             'dynamic_variables': {SESSION_VARIABLE: token}},
                            headers={'Cache-Control': 'no-store'})

    @application.post('/v1/voice/tools/{name}')
    def voice_tool(name: str, body: ToolBody | None = None, user=Depends(tool_user)):
        if name not in TOOLS:
            raise HTTPException(404, 'Unknown tool')
        return tool_reply(TOOLS[name], errands, user, body or ToolBody())
