"""Create or update the "Vali" voice agent on ElevenLabs (idempotent; safe to re-run).

    ELEVENLABS_API_KEY=... VALI_VOICE_TOOL_SECRET=... backend/.venv/bin/python backend/scripts/elevenlabs_agent.py

Optional: VALI_PUBLIC_URL (API base the tools call, default the Modal URL), VALI_ELEVENLABS_AGENT_ID
(update that agent instead of looking it up by name), ELEVENLABS_VOICE_ID.
It stores the tool secret as an ElevenLabs workspace secret, upserts one webhook tool per Vali tool,
upserts the agent with signed-session auth on, and prints the agent id for VALI_ELEVENLABS_AGENT_ID.
"""
import hashlib
import os
import sys

import httpx

API_URL = 'https://api.elevenlabs.io/v1/convai'
DEFAULT_PUBLIC_URL = 'https://bogdan-c-2206--vali-web.us-east.modal.run'
DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'  # warm, unhurried British voice
AGENT_NAME = 'Vali'
SESSION_VARIABLE = 'secret__vali_session'  # signed per user by POST /v1/voice/session

FIRST_MESSAGE = "Hi, I'm Vali. What errand can I take off your hands?"
PROMPT = """You are Vali, a friendly and calm butler who runs errands for newcomers in Finland:
benefits, permits, taxes, bookings, letters and forms.

Voice and style
- Speak English. Say Finnish names the Finnish way (Kela, Migri, Vero, HSL, Helsinki, Espoo, Tampere).
- Keep every reply to one or two short spoken sentences. No lists, no markdown, no URLs read aloud.

How you work
- You run errands only through your tools. Never claim something happened unless a tool said so.
- create_errand starts a new errand from what the user wants, in their own words.
- list_errands and errand_status tell you what is going on. Research can take up to a minute; offer to check again.
- When Vali has a question for the user, ask it, then pass the answer with answer_question.
- stop halts an errand at once whenever the user says stop, cancel or wait.
- Tool results contain ids like (id t_123). Use them in tool calls; never read ids aloud.
- "your name", "your address" and similar mean the app fills that value in from the user's device.

Safety
- Never ask for, repeat or accept by voice: personal identity codes, passport or ID numbers,
  bank or card numbers, passwords, PINs or one-time codes. If the user starts saying one, stop them
  kindly and explain that Vali fills those in from the app on their device.
- Before approving anything, always call approval_summary, read back in plain words exactly what will be
  submitted, and ask "Shall I submit it?". Call approve only after a clear yes to that question.
  If the answer is unclear, do not approve.
"""

ERRAND_ID = {'type': 'string', 'description': 'Errand id from a previous tool result, like t_abc123. Omit for the current errand.'}
TOOLS = [
    ('create_errand', 'Start a new errand for the user.',
     {'text': {'type': 'string', 'description': "What the user wants done, in their words, e.g. 'renew my residence permit'."}}, ['text']),
    # ElevenLabs requires a body schema on POST tools, so this one takes an optional limit.
    ('list_errands', "List the user's latest errands with their status.",
     {'limit': {'type': 'integer', 'description': 'How many errands to list, default 5.'}}, []),
    ('errand_status', 'Get the status and answer of one errand.', {'id': ERRAND_ID}, []),
    ('approval_summary', 'Get what will be submitted for an errand waiting for approval. Read it back before approve.',
     {'id': ERRAND_ID}, []),
    ('approve', 'Submit an errand after the user heard the approval summary and clearly said yes.', {'id': ERRAND_ID}, []),
    ('stop', 'Stop an errand immediately.', {'id': ERRAND_ID}, []),
    ('answer_question', "Pass the user's answer to the question Vali asked about an errand.",
     {'id': ERRAND_ID, 'text': {'type': 'string', 'description': "The user's answer, without ID numbers or passwords."}}, ['text']),
]


def find_named(client, path, items_key, name, name_of):
    """First item with this exact name, following list pagination."""
    params = {'search': name, 'page_size': 100}
    while True:
        page = client.get(path, params=params).raise_for_status().json()
        match = next((item for item in page.get(items_key, []) if name_of(item) == name), None)
        if match or not page.get('next_cursor'):
            return match
        params['cursor'] = page['next_cursor']


def ensure_secret(client, value):
    # The name carries a fingerprint, so a rotated value gets a new secret instead of a stale one.
    name = 'vali_voice_tool_secret_' + hashlib.sha256(value.encode()).hexdigest()[:8]
    found = find_named(client, '/secrets', 'secrets', name, lambda item: item.get('name'))
    if found:
        return found['secret_id']
    return client.post('/secrets', json={'type': 'new', 'name': name, 'value': value}).raise_for_status().json()['secret_id']


def tool_config(name, description, properties, required, base_url, secret_id):
    api_schema = {'url': f'{base_url}/v1/voice/tools/{name}', 'method': 'POST',
                  'request_headers': {'X-Vali-Tool-Secret': {'secret_id': secret_id},
                                      'X-Vali-Session': {'variable_name': SESSION_VARIABLE}}}
    if properties:
        api_schema['request_body_schema'] = {'type': 'object', 'description': description,
                                             'properties': properties, 'required': required}
    return {'type': 'webhook', 'name': name, 'description': description,
            'api_schema': api_schema, 'response_timeout_secs': 30}


def ensure_tool(client, config):
    found = find_named(client, '/tools', 'tools', config['name'], lambda item: (item.get('tool_config') or {}).get('name'))
    if found:
        client.patch(f"/tools/{found['id']}", json={'tool_config': config}).raise_for_status()
        return found['id']
    return client.post('/tools', json={'tool_config': config}).raise_for_status().json()['id']


def agent_body(tool_ids, voice_id):
    return {'name': AGENT_NAME, 'tags': ['vali'],
            'conversation_config': {
                'agent': {'first_message': FIRST_MESSAGE, 'language': 'en',
                          'prompt': {'prompt': PROMPT, 'tool_ids': tool_ids}},
                'tts': {'voice_id': voice_id}},
            # Private agent: sessions start only from a signed URL or conversation token from our API.
            'platform_settings': {'auth': {'enable_auth': True}}}


def ensure_agent(client, body, agent_id=''):
    if not agent_id:
        found = find_named(client, '/agents', 'agents', AGENT_NAME, lambda item: item.get('name'))
        agent_id = found['agent_id'] if found else ''
    if agent_id:
        client.patch(f'/agents/{agent_id}', json=body).raise_for_status()
        return agent_id
    return client.post('/agents/create', json=body).raise_for_status().json()['agent_id']


def setup(env, transport=None):
    key, secret = env.get('ELEVENLABS_API_KEY', ''), env.get('VALI_VOICE_TOOL_SECRET', '')
    if not key or not secret:
        raise SystemExit('Set ELEVENLABS_API_KEY and VALI_VOICE_TOOL_SECRET first.')
    base_url = (env.get('VALI_PUBLIC_URL') or DEFAULT_PUBLIC_URL).rstrip('/')
    with httpx.Client(base_url=API_URL, headers={'xi-api-key': key}, timeout=30, transport=transport) as client:
        secret_id = ensure_secret(client, secret)
        tool_ids = [ensure_tool(client, tool_config(*spec, base_url, secret_id)) for spec in TOOLS]
        body = agent_body(tool_ids, env.get('ELEVENLABS_VOICE_ID') or DEFAULT_VOICE_ID)
        return ensure_agent(client, body, env.get('VALI_ELEVENLABS_AGENT_ID', ''))


def validation_errors(response):
    """Field paths and messages of a 422, never echoed input values (the secret is request data)."""
    try:
        detail = response.json().get('detail')
        return '; '.join(f"{'.'.join(map(str, item.get('loc', [])))}: {item.get('msg')}" for item in detail)
    except Exception:
        return ''


def main():
    try:
        agent_id = setup(os.environ)
    except httpx.HTTPStatusError as exc:
        sys.exit(f'ElevenLabs rejected {exc.request.method} {exc.request.url.path}: '
                 f'HTTP {exc.response.status_code} {validation_errors(exc.response)}')
    print(f'VALI_ELEVENLABS_AGENT_ID={agent_id}')


if __name__ == '__main__':
    main()
