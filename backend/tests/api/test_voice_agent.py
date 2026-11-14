"""Talk to Vali: session credentials and agent server tools, with ElevenLabs mocked."""
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

from test_api import api  # noqa: F401  (fixture)
from vali_api.voice_agent import SESSION_TTL, session_token, session_user_id
from vali_media import voice

SECRET = 'tool-secret-for-tests'


@pytest.fixture
def agent(api, monkeypatch):  # noqa: F811
    client, application, *_ = api
    config = application.state.config
    config.elevenlabs_api_key, config.elevenlabs_agent_id, config.voice_tool_secret = 'xi-key', 'agent_test', SECRET
    requests = []
    def respond(request):
        requests.append(request)
        if request.url.path.endswith('/token'):
            return httpx.Response(200, json={'token': 'webrtc-token', 'conversation_id': 'conv_1'})
        return httpx.Response(200, json={'signed_url': 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_test&conversation_signature=sig'})
    real = httpx.Client
    monkeypatch.setattr(voice.httpx, 'Client', lambda **kwargs: real(**{**kwargs, 'transport': httpx.MockTransport(respond)}))
    return api, requests


def tool(client, name, user_id, body=None, secret=SECRET, session=None):
    headers = {'X-Vali-Tool-Secret': secret, 'X-Vali-Session': session or session_token(user_id, SECRET)}
    return client.post(f'/v1/voice/tools/{name}', json=body, headers=headers)


def say(response):
    assert response.status_code == 200, response.text
    return response.json()['result']


def awaiting(store, tid):
    approval = {'summary': 'Claim form filled: EU261, 400 EUR', 'filled': [{'label': 'Full name', 'value': '{{name}}'}]}
    store.start_execution(tid, dict(status='awaiting_approval', approval=approval, approval_decision=None,
                                     steps=[], shots=[]), None)


@pytest.mark.parametrize('connection,field,path', [
    ('webrtc', 'conversation_token', '/v1/convai/conversation/token'),
    ('websocket', 'signed_url', '/v1/convai/conversation/get-signed-url'),
])
def test_session_returns_credentials_and_signed_user(agent, connection, field, path):
    (client, app, *_, user), requests = agent
    response = client.post('/v1/voice/session', params={'connection': connection})
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    data = response.json()
    assert data[field] and data['connection_type'] == connection and data['expires_in'] == 900
    assert session_user_id(data['dynamic_variables']['secret__vali_session'], SECRET) == user['user_id']
    assert requests[0].method == 'GET' and requests[0].url.path == path
    assert requests[0].url.params['agent_id'] == 'agent_test' and requests[0].headers['xi-api-key'] == 'xi-key'
    assert 'xi-key' not in response.text


def test_session_requires_auth_config_and_handles_provider_failure(agent, monkeypatch):
    (client, app, *_), requests = agent
    assert client.post('/v1/voice/session', headers={'Authorization': ''}).status_code == 401
    app.state.config.elevenlabs_agent_id = ''
    assert client.post('/v1/voice/session').status_code == 503
    app.state.config.elevenlabs_agent_id = 'agent_test'
    def fail(*args, **kwargs):
        raise voice.VoiceError('private provider detail', 401)
    monkeypatch.setattr(voice, 'conversation_credentials', fail)
    response = client.post('/v1/voice/session')
    assert response.status_code == 502 and 'private' not in response.text
    assert client.post('/v1/voice/session', params={'connection': 'sip'}).status_code == 422


def test_session_rate_limited(agent):
    (client, *_), _ = agent
    for _ in range(10):
        assert client.post('/v1/voice/session').status_code == 200
    assert client.post('/v1/voice/session').status_code == 429


def test_tool_secret_and_session_checks(agent):
    (client, app, store, *_, user), _ = agent
    uid = user['user_id']
    assert tool(client, 'list_errands', uid, secret='wrong').status_code == 401
    assert client.post('/v1/voice/tools/list_errands', headers={'X-Vali-Session': session_token(uid, SECRET)}).status_code == 401
    assert tool(client, 'list_errands', uid, session=session_token(uid, 'other-secret')).status_code == 401
    assert tool(client, 'list_errands', uid, session=session_token(uid, SECRET, now=0)).status_code == 401
    forged = session_token(uid, SECRET).replace(uid, 'u_someoneelse')
    assert tool(client, 'list_errands', uid, session=forged).status_code == 401
    assert tool(client, 'list_errands', 'u_missing').status_code == 401
    assert tool(client, 'list_errands', uid, session='garbage').status_code == 401
    assert tool(client, 'unknown', uid).status_code == 404
    app.state.config.voice_tool_secret = ''
    assert tool(client, 'list_errands', uid).status_code == 503


def test_session_token_expiry():
    token = session_token('u_1', SECRET, now=1000)
    assert session_user_id(token, SECRET, now=1000 + SESSION_TTL - 1) == 'u_1'
    assert session_user_id(token, SECRET, now=1000 + SESSION_TTL) is None


def test_create_list_and_status(agent):
    (client, app, store, *_, user), _ = agent
    uid = user['user_id']
    assert say(tool(client, 'list_errands', uid)) == 'You have no errands yet.'
    assert say(tool(client, 'create_errand', uid, {'text': ' '})) == 'Tell me what errand to run.'
    text = say(tool(client, 'create_errand', uid, {'text': 'find cheapest café'}))
    task = store.list_tasks(uid)[0]
    assert task['source'] == 'voice' and task['task'] == 'find cheapest café'
    assert text.startswith('An option.') and task['id'] in text
    research = say(tool(client, 'create_errand', uid, {'text': 'claim compensation for my delayed flight'}))
    assert research.startswith('On it.')
    listed = say(tool(client, 'list_errands', uid))
    assert listed.startswith('1. claim compensation') and 'Still researching' in listed and 'find cheapest café' in listed
    status = say(tool(client, 'errand_status', uid, {'id': task['id']}))
    assert 'Research done. An option.' in status


def test_approval_needs_read_back_first(agent):
    (client, app, store, *_, user), _ = agent
    uid = user['user_id']
    task = client.post('/v1/tasks', json={'task': 'find cheapest café'}).json()
    assert say(tool(client, 'approve', uid, {'id': task['id']})) == 'Nothing is waiting for your OK on that errand.'
    awaiting(store, task['id'])
    assert 'Not approved yet' in say(tool(client, 'approve', uid, {'id': task['id']}))
    assert store.get_task(task['id'])['execution']['approval_decision'] is None
    summary = say(tool(client, 'approval_summary', uid, {'id': task['id']}))
    assert 'EU261, 400 EUR' in summary and 'Full name: your name' in summary and '{{' not in summary
    assert say(tool(client, 'approve', uid)) == 'Approved. Vali is submitting it now.'  # current errand by default
    assert store.get_task(task['id'])['execution']['approval_decision'] == 'approved'


def test_changed_approval_needs_new_read_back(agent):
    (client, app, store, *_, user), _ = agent
    task = client.post('/v1/tasks', json={'task': 'find cheapest café'}).json()
    awaiting(store, task['id'])
    say(tool(client, 'approval_summary', user['user_id'], {'id': task['id']}))
    store.patch_execution(task['id'], {'approval': {'summary': 'Different amount', 'filled': []}})
    assert 'Not approved yet' in say(tool(client, 'approve', user['user_id'], {'id': task['id']}))


def test_stop_and_answer_question(agent):
    (client, app, store, calls, *_, user), _ = agent
    uid = user['user_id']
    running = client.post('/v1/tasks', json={'task': 'claim compensation for my delayed flight'}).json()
    assert running['research']['status'] == 'queued'
    assert say(tool(client, 'stop', uid, {'id': running['id']})).startswith('Stopped.')
    assert store.get_task(running['id'])['research']['status'] == 'cancelled'
    task = client.post('/v1/tasks', json={'task': 'find cheapest café'}).json()
    store.start_execution(task['id'], dict(status='running', steps=[], shots=[], approval=None, approval_decision=None,
                                           question={'text': 'Which date?', 'at': 'now'}), None)
    assert 'Which date?' in say(tool(client, 'errand_status', uid, {'id': task['id']}))
    assert say(tool(client, 'answer_question', uid, {'id': task['id'], 'text': 'Friday'})) == 'Got it, I passed that on.'
    inbox = store.get_task(task['id'])['execution']['inbox']
    assert inbox[-1]['text'] == 'Friday' and inbox[-1]['source'] == 'voice'
    assert say(tool(client, 'stop', uid, {'id': task['id']})).startswith('Stopped.')
    execution = store.get_task(task['id'])['execution']
    assert execution['status'] == 'stopped' and execution['approval_decision'] == 'stopped'


def test_tools_never_touch_another_users_task(agent):
    (client, app, store, *_, user), _ = agent
    task = client.post('/v1/tasks', json={'task': 'find cheapest café'}).json()
    awaiting(store, task['id'])
    say(tool(client, 'approval_summary', user['user_id'], {'id': task['id']}))
    before = store.get_task(task['id'])
    intruder = store.create_user()['user_id']
    for name, body in [('errand_status', {}), ('approval_summary', {}), ('approve', {}), ('stop', {}),
                       ('answer_question', {'text': 'yes'})]:
        assert say(tool(client, name, intruder, {'id': task['id'], **body})) == "I can't find that errand."
        # Without an id the intruder's own (empty) list is used, never someone else's errand.
        assert say(tool(client, name, intruder, body)) == "I can't find that errand."
    assert say(tool(client, 'list_errands', intruder)) == 'You have no errands yet.'
    assert store.get_task(task['id']) == before
    assert 'café' not in json.dumps([t['task'] for t in store.list_tasks(intruder)])


def load_script():
    path = Path(__file__).resolve().parents[2] / 'scripts' / 'elevenlabs_agent.py'
    spec = importlib.util.spec_from_file_location('elevenlabs_agent', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fake_elevenlabs(existing):
    """A tiny in-memory ElevenLabs: secrets, tools and agents, list/create/update."""
    log = []
    def respond(request):
        assert request.headers['xi-api-key'] == 'xi-key'
        path, body = request.url.path.removeprefix('/v1/convai'), json.loads(request.content or b'null')
        log.append((request.method, path, body))
        if request.method == 'GET':
            kind = path.strip('/')
            return httpx.Response(200, json={kind: existing[kind], 'has_more': False})
        if path == '/secrets':
            existing['secrets'].append({'secret_id': 'sec_1', 'name': body['name']})
            return httpx.Response(200, json={'type': 'stored', 'secret_id': 'sec_1', 'name': body['name']})
        if path == '/tools':
            tid = f"tool_{len(existing['tools'])}"
            existing['tools'].append({'id': tid, 'tool_config': body['tool_config']})
            return httpx.Response(200, json={'id': tid})
        if path == '/agents/create':
            existing['agents'].append({'agent_id': 'agent_new', 'name': body['name']})
            return httpx.Response(200, json={'agent_id': 'agent_new'})
        return httpx.Response(200, json={})
    return log, httpx.MockTransport(respond)


def test_agent_script_creates_then_updates():
    script = load_script()
    env = {'ELEVENLABS_API_KEY': 'xi-key', 'VALI_VOICE_TOOL_SECRET': SECRET, 'VALI_PUBLIC_URL': 'https://api.test/'}
    existing = {'secrets': [], 'tools': [], 'agents': []}
    log, transport = fake_elevenlabs(existing)
    assert script.setup(env, transport) == 'agent_new'
    posts = [entry for entry in log if entry[0] == 'POST']
    assert [p[1] for p in posts] == ['/secrets'] + ['/tools'] * 7 + ['/agents/create']
    configs = {p[2]['tool_config']['name']: p[2]['tool_config'] for p in posts if p[1] == '/tools'}
    assert set(configs) == {'create_errand', 'list_errands', 'errand_status', 'approval_summary', 'approve', 'stop', 'answer_question'}
    schema = configs['create_errand']['api_schema']
    assert schema['url'] == 'https://api.test/v1/voice/tools/create_errand' and schema['method'] == 'POST'
    assert schema['request_headers'] == {'X-Vali-Tool-Secret': {'secret_id': 'sec_1'},
                                         'X-Vali-Session': {'variable_name': 'secret__vali_session'}}
    assert schema['request_body_schema']['required'] == ['text']
    # ElevenLabs requires a body schema on every POST tool, so list_errands takes an optional limit.
    assert configs['list_errands']['api_schema']['request_body_schema']['required'] == []
    agent = posts[-1][2]
    assert agent['platform_settings']['auth']['enable_auth'] is True
    assert agent['conversation_config']['agent']['prompt']['tool_ids'] == [f'tool_{n}' for n in range(7)]
    assert SECRET not in json.dumps([entry for entry in log if entry[1] != '/secrets'])

    log.clear()
    assert script.setup(env, transport) == 'agent_new'
    assert [entry[0] for entry in log if entry[0] != 'GET'] == ['PATCH'] * 8
    assert log[-1][1] == '/agents/agent_new'


def test_agent_script_needs_env():
    with pytest.raises(SystemExit):
        load_script().setup({})


def test_spoken_text_drops_citation_markers():
    from vali_api.voice_agent import spoken
    assert spoken('Try Löyly [1][2] or Allas [5].') == 'Try Löyly or Allas.'
