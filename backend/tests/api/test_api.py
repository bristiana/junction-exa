"""Offline API integration tests against an injected Exa transport."""
import hashlib
import hmac
import json
import re
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from hoida_api.app import create_app, poll_research_once, create_monitor
from hoida_api.config import Config
from hoida_api.exa import ExaClient, ExaError
from hoida_api.research import SYSTEM_PROMPT, output_schema, build_query, build_run_request, FIND_SCHEMA, progress_from_events
from hoida_api.router import route
from hoida_api.store import SQLiteStore
from hoida_api.whatsapp import handle_whatsapp_message, send_whatsapp_message


@pytest.fixture
def api():
    calls, polls, browsers = [], [], []
    def respond(request):
        body = json.loads(request.content) if request.content else None
        calls.append((request.method, request.url.path, body))
        if request.url.path == '/search':
            return httpx.Response(200, json={'output': {'content': {'answer': 'An option.', 'options': [
                {'name': 'Option', 'detail': 'Available', 'price': '€5', 'url': 'https://example.com/form'}], 'next_step': 'Open it'},
                'grounding': [{'field': 'options[0].price', 'citations': [{'url': 'https://example.com', 'title': 'Source'}], 'confidence': 'high'}]}, 'costDollars': {'total': 0.01}})
        if request.url.path.endswith('/cancel'):
            return httpx.Response(200, json={'status': 'cancelled'})
        if request.method == 'POST':
            return httpx.Response(200, json={'id': 'run_fake', 'status': 'queued'})
        if request.url.path.endswith('/events'):
            return httpx.Response(200, json={'data': [{'event': 'source.found', 'data': {'url': 'https://example.com'}}], 'hasMore': False})
        return httpx.Response(200, json={'id': 'run_fake', 'status': 'completed', 'output': {
            'text': 'Done', 'structured': {'answer': 'Done', 'key_facts': [], 'steps': [], 'actions': [{'type': 'open_link', 'label': 'Apply', 'url': 'https://example.com/form', 'body': 'Draft {{name}}'}]},
            'grounding': [{'field': 'answer', 'citations': [{'url': 'https://example.com', 'title': 'Source'}]}]}, 'costDollars': {'total': 0.04}, 'stopReason': 'schema_satisfied'})
    store = SQLiteStore(':memory:')
    exa = ExaClient('fake-key', transport=httpx.MockTransport(respond))
    application = create_app(Config(sqlite_path=':memory:'), store, exa, polls.append, lambda *args: browsers.append(args))
    with TestClient(application) as client:
        user = client.post('/v1/users').json()
        client.headers['Authorization'] = 'Bearer ' + user['token']
        yield client, application, store, calls, polls, browsers, user
    store.close()
    exa.close()


def test_identity_profile_and_auth(api):
    client, app, store, *_, user = api
    assert client.get('/health').json()['ok']
    assert store.get_user(user['user_id'])['token_hash'] == hashlib.sha256(user['token'].encode()).hexdigest()
    assert user['token'] not in json.dumps(store.get_user(user['user_id']))
    assert client.get('/v1/me').json()['profile_synced'] is False
    assert client.put('/v1/profile', json={'profile': {'email': 'test@example.com'}}).json() == {'ok': True}
    assert client.get('/v1/me').json()['profile_synced'] is True
    assert client.put('/v1/profile', json={'profile': {}}).status_code == 200
    del client.headers['Authorization']
    for path in ['/v1/me', '/v1/tasks']:
        assert client.get(path).status_code == 401
    assert client.post('/v1/tasks', json={'task': 'find a café'}).status_code == 401


def test_pairing(api):
    client, _, store, *rest = api
    code = client.post('/v1/pair').json()['code']
    assert len(code) == 6
    assert 'linked' in handle_whatsapp_message(store, '+358401234567', 'link ' + code, None)
    assert client.get('/v1/me').json()['whatsapp_last4'] == '4567'
    assert 'invalid' in handle_whatsapp_message(store, '+358401234567', 'link ' + code, None)
    code = client.post('/v1/pair').json()['code']
    store.sql('UPDATE pair_codes SET expires_at=? WHERE code=?', ('2000-01-01T00:00:00+00:00', code))
    assert 'expired' in handle_whatsapp_message(store, '+358401234567', 'link ' + code, None)
    assert 'invalid' in handle_whatsapp_message(store, '+358401234567', 'link 000000', None)


def test_search_and_isolation(api):
    client, _, store, calls, polls, _, user = api
    task = client.post('/v1/tasks', json={'task': 'find cheapest café'}).json()
    research = task['research']
    assert task['mode'] == 'find' and research['status'] == 'completed'
    assert research['output']['structured']['actions'][0]['type'] == 'open_link'
    assert research['output']['grounding'][0]['field'] == 'actions[0]'
    assert research['cost'] == 0.01 and not polls
    assert calls[0][2]['contents'] == {'highlights': True}
    assert client.get('/v1/tasks').json()['tasks'][0]['id'] == task['id']
    store.put_shot(task['id'], 1, b'fake-jpeg')
    url = f"/v1/tasks/{task['id']}/shots/1.jpg"
    assert client.get(url, params={'t': user['token']}).content == b'fake-jpeg'
    assert client.get(url, params={'t': 'wrong'}).status_code == 401
    other = client.post('/v1/users').json()
    client.headers['Authorization'] = 'Bearer ' + other['token']
    assert client.get('/v1/tasks/' + task['id']).status_code == 404
    assert client.get(url, params={'t': other['token']}).status_code == 404


def test_agent_poll_cancel_and_separate_columns(api):
    client, application, store, calls, polls, *_ = api
    task = client.post('/v1/tasks', json={'task': 'claim compensation'}).json()
    assert polls == [task['id']] and task['research']['status'] == 'queued'
    store.update_execution(task['id'], {'status': 'starting'})
    assert poll_research_once(task['id'], application) is True
    result = store.get_task(task['id'])
    assert result['research']['status'] == 'completed'
    assert result['research']['cost'] == 0.04
    assert result['research']['output']['grounding'][0]['field'] == 'answer'
    assert result['execution']['status'] == 'starting'
    second = client.post('/v1/tasks', json={'task': 'apply', 'previous_task_id': task['id']}).json()
    assert calls[-1][2]['previousRunId'] == 'run_fake'
    assert client.post(f"/v1/tasks/{second['id']}/cancel").json()['research']['status'] == 'cancelled'
    assert poll_research_once(second['id'], application)
    assert calls[-1][1].endswith('/cancel')
    old = second['research']
    store.update_research(second['id'], {**old, 'status': 'completed'}, expected=old)
    assert store.get_task(second['id'])['research']['status'] == 'cancelled'


def test_execute_approve_stop(api):
    client, application, store, _, _, browsers, _ = api
    task = client.post('/v1/tasks', json={'task': 'claim refund'}).json()
    url = '/v1/tasks/' + task['id']
    assert client.post(url + '/execute', json={}).status_code == 409
    poll_research_once(task['id'], application)
    response = client.post(url + '/execute', json={'action_index': 0, 'profile': {'email': 'test@example.com'}})
    assert response.status_code == 200
    tid, goal, start_url, profile = browsers[0]
    assert tid == task['id'] and start_url == 'https://example.com/form'
    assert 'Draft {{name}}' in goal and 'Done' in goal
    assert profile == {'email': 'test@example.com'}
    assert client.post(url + '/execute', json={}).status_code == 409
    store.patch_execution(tid, {'status': 'awaiting_approval'})
    approved = client.post(url + '/approve').json()['execution']
    assert approved['approval_decision'] == 'approved' and approved['status'] == 'awaiting_approval'
    assert client.post(url + '/stop').json()['execution']['approval_decision'] == 'stopped'


def test_rate_limits_and_cap(api):
    client, application, store, *_, user = api
    application.state.limiter.user_limit = 1
    assert client.post('/v1/tasks', json={'task': 'find café'}).status_code == 200
    assert client.post('/v1/tasks', json={'task': 'find café'}).status_code == 429
    application.state.limiter.events.clear()
    application.state.config.daily_cap_usd = 0.01
    assert client.post('/v1/tasks', json={'task': 'find café'}).status_code == 429
    application.state.limiter.ip_limit = 1
    application.state.limiter.events.clear()
    assert client.get('/health').status_code == 200
    assert client.get('/health').status_code == 429


@pytest.mark.parametrize('text,expected', [
    ('tell me when it changes', ('watch', 'monitor')), ('ilmoita uusista', ('watch', 'monitor')),
    ('etsi kahvila', ('find', 'search')), ('best near me', ('find', 'search')),
    ('find a sauna I can book online', ('find', 'search')),
    ('hae korvaus', ('claim', 'agent')), ('claim refund', ('claim', 'agent')),
    ('varaa sauna', ('book', 'agent')), ('book a table', ('book', 'agent')),
    ('write a reply', ('write', 'agent')), ('is this legal', ('check', 'agent')),
    ('anything', ('check', 'agent'))])
def test_router(text, expected):
    assert route(text, {}) == expected
    assert route('this clause', {'selection': 'selected'}) == ('check', 'agent')


def test_port_matches_javascript():
    path = Path(__file__).resolve().parents[3] / 'extension/lib/task.js'
    source = path.read_text()
    tokens = ', '.join('{{' + key + '}}' for key in ['name', 'email', 'phone', 'address', 'postal_code', 'city', 'country', 'date_of_birth', 'nationality'])
    prompt = re.search(r'export const SYSTEM_PROMPT = `([\s\S]*?)`;', source).group(1).replace('${TOKENS}', tokens)
    assert SYSTEM_PROMPT == prompt
    # Compare every nested property and description using the actual JS implementation.
    assert shutil.which('node'), 'Node is required to verify the extension contract'
    script = "import fs from 'node:fs'; const m=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(process.argv[1],'utf8')).toString('base64')); console.log(JSON.stringify({yes:m.outputSchema({hasForm:true}),no:m.outputSchema({hasForm:false}),query:m.buildQuery('  test  ',{url:'https://example.com',title:'Title',selection:' hello   world ',fields:[{id:'x',label:'Field',type:'select',required:true,options:['a','b']}]},{language:'Finnish',city:'Espoo',country:'Finland',email:'test@example.com'})}));"
    reference = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script, str(path)], text=True))
    assert output_schema(True) == reference['yes']
    assert output_schema(False) == reference['no']
    assert set(output_schema(True)['properties']) == set(reference['yes']['properties'])
    assert build_query('  test  ', {'url': 'https://example.com', 'title': 'Title', 'selection': ' hello   world ', 'fields': [{'id': 'x', 'label': 'Field', 'type': 'select', 'required': True, 'options': ['a', 'b']}]}, {'language': 'Finnish', 'city': 'Espoo', 'country': 'Finland', 'email': 'test@example.com'}) == reference['query']
    assert build_run_request('test')['effort'] == 'low'
    def count(schema):
        props = schema.get('properties', {})
        return len(props) + sum(count(v) for v in props.values()) + count(schema['items']) if 'items' in schema else len(props) + sum(count(v) for v in props.values())
    assert count(FIND_SCHEMA) == 7


def test_defensive_progress():
    events = [None, {'event': 'new.unknown', 'data': 'bad'}, {'event': 'source.found', 'data': {'source': {'url': 'https://example.com', 'title': 'Source'}}},
              {'event': 'tool.called', 'data': {'arguments': {'query': 'lookup'}}}]
    result = progress_from_events(events + events)
    assert [x['kind'] for x in result] == ['source', 'search']


def test_watch_stub_and_origin(api):
    client, application, *_ = api
    task = client.post('/v1/tasks', json={'task': 'watch for flats'}).json()
    assert task['research']['monitor_stubbed'] is True
    watches = client.get('/v1/watches').json()['watches']
    assert len(watches) == 1
    assert client.delete('/v1/watches/' + watches[0]['id']).status_code == 200
    assert client.post('/webhooks/exa', json={}).status_code == 501
    with pytest.raises(NotImplementedError):
        create_monitor(Config(public_url=''), 'watch')
    application.state.config.allowed_origins = 'extension,http://localhost:3000'
    assert client.get('/health', headers={'Origin': 'https://example.com'}).status_code == 403
    assert client.get('/health', headers={'Origin': 'chrome-extension://abcdef'}).status_code == 200


def test_webhooks_and_send_shape(api):
    client, application, store, *_ = api
    config = application.state.config
    config.whatsapp_verify_token = 'fake-verification'
    assert client.get('/webhooks/whatsapp', params={'hub.mode': 'subscribe', 'hub.verify_token': 'fake-verification', 'hub.challenge': '123'}).text == '123'
    assert client.get('/webhooks/whatsapp').status_code == 403
    config.whatsapp_app_secret = 'fake-app-secret'
    code = client.post('/v1/pair').json()['code']
    payload = {'entry': [{'changes': [{'value': {'messages': [{'from': '+358401234567', 'text': {'body': 'link ' + code}}]}}]}]}
    raw = json.dumps(payload).encode()
    assert client.post('/webhooks/whatsapp', content=raw).status_code == 403
    signature = 'sha256=' + hmac.new(config.whatsapp_app_secret.encode(), raw, hashlib.sha256).hexdigest()
    assert client.post('/webhooks/whatsapp', content=raw, headers={'X-Hub-Signature-256': signature}).json() == {'ok': True}
    assert client.get('/v1/me').json()['whatsapp_linked'] is True
    config.whatsapp_phone_number_id = 'fake-phone-id'
    config.whatsapp_token = 'fake-token'
    def outbound(request):
        assert str(request.url) == 'https://graph.facebook.com/v21.0/fake-phone-id/messages'
        assert request.headers['authorization'] == 'Bearer fake-token'
        assert json.loads(request.content) == {'messaging_product': 'whatsapp', 'to': '+358401234567', 'type': 'text', 'text': {'body': 'Test'}}
        return httpx.Response(200, json={'messages': [{'id': 'fake-message'}]})
    send_whatsapp_message(config, '+358401234567', 'Test', transport=httpx.MockTransport(outbound))


def test_exa_errors():
    exa = ExaClient('fake', transport=httpx.MockTransport(lambda request: httpx.Response(429, json={})))
    with pytest.raises(ExaError) as caught:
        exa.search({})
    assert caught.value.status == 429
    exa.close()


def test_running_events_and_upstream_failure(api):
    client, application, store, *_ = api
    task = client.post('/v1/tasks', json={'task': 'claim refund'}).json()
    def running(request):
        if request.url.path.endswith('/events'):
            return httpx.Response(200, json={'data': [{'event': 'search.started', 'data': {'query': 'rules'}}, {'event': 'unknown', 'data': 123}], 'hasMore': True, 'nextCursor': 'unused'})
        return httpx.Response(200, json={'id': 'run_fake', 'status': 'running'})
    application.state.exa = ExaClient('fake', httpx.MockTransport(running))
    assert poll_research_once(task['id'], application) is False
    assert store.get_task(task['id'])['research']['progress'] == [{'kind': 'search', 'text': 'rules'}]
    application.state.exa.close()
    application.state.exa = ExaClient('fake', httpx.MockTransport(lambda r: httpx.Response(404, json={})))
    assert poll_research_once(task['id'], application)
    assert store.get_task(task['id'])['research']['status'] == 'failed'
    assert client.post('/v1/tasks', json={'task': 'find café'}).status_code == 502
    assert client.get('/v1/tasks').json()['tasks'][0]['research']['status'] == 'failed'
    application.state.exa.close()


def test_browser_hooks_offline(api, monkeypatch):
    import importlib
    import sys
    import types
    from dataclasses import dataclass
    module = importlib.import_module('hoida_api.app')
    client, application, store, *_ = api
    task = client.post('/v1/tasks', json={'task': 'find café'}).json()
    tid = task['id']
    assert client.post(f'/v1/tasks/{tid}/execute', json={}).status_code == 200
    @dataclass
    class FakeHooks:
        on_step: object
        wait_for_approval: object
        should_stop: object
    def fake_agent(goal, start_url, profile, hooks):
        assert not hooks.should_stop()
        hooks.on_step('Opened form', b'fake-jpeg')
        assert hooks.wait_for_approval('Review form', [{'label': 'Email', 'value': '{{email}}'}])
        assert store.get_task(tid)['execution']['status'] == 'submitting'
        return {'status': 'done', 'result': 'Finished', 'final_url': start_url}
    def approve_on_sleep(seconds):
        assert seconds == 2
        assert client.post(f'/v1/tasks/{tid}/approve').status_code == 200
    monkeypatch.setitem(sys.modules, 'hoida_agent', types.SimpleNamespace(run_browser_agent=fake_agent, AgentHooks=FakeHooks))
    monkeypatch.setattr(module.time, 'sleep', approve_on_sleep)
    module.run_browser_session(tid, 'goal', 'https://example.com', {}, application)
    execution = store.get_task(tid)['execution']
    assert execution['status'] == 'done'
    assert execution['steps'][0]['shot'] == 1
    assert execution['shots'][0]['url'].endswith('/shots/1.jpg')
    assert store.get_shot(tid, 1) == b'fake-jpeg'


def test_stop_cannot_be_overwritten(api):
    client, _, store, *_ = api
    task = client.post('/v1/tasks', json={'task': 'find café'}).json()
    tid = task['id']
    client.post(f'/v1/tasks/{tid}/execute', json={})
    store.patch_execution(tid, {'status': 'awaiting_approval'})
    assert client.post(f'/v1/tasks/{tid}/stop').status_code == 200
    assert client.post(f'/v1/tasks/{tid}/approve').status_code == 409
    store.patch_execution(tid, {'status': 'awaiting_approval', 'approval_decision': None})
    assert store.get_task(tid)['execution']['approval_decision'] == 'stopped'
    assert store.get_task(tid)['execution']['status'] == 'stopped'


def test_spend_aggregation_boundaries(api):
    _, _, store, *_, user = api
    assert store.daily_spend(user['user_id']) == 0
    for _ in range(10):
        store.create_task(user['user_id'], 'test', {}, 'find', {'status': 'completed', 'cost': 0.2})
    assert store.daily_spend(user['user_id']) == 2.0
    other = store.create_user()
    store.create_task(other['user_id'], 'test', {}, 'find', {'status': 'completed', 'cost': 5})
    assert store.daily_spend(user['user_id']) == 2.0
    store.sql('UPDATE tasks SET created_at=? WHERE user_id=?', ('2000-01-01T00:00:00+00:00', user['user_id']))
    assert store.daily_spend(user['user_id']) == 0


def test_live_frame_is_served_to_the_owner_only(tmp_path):
    from fastapi.testclient import TestClient
    from hoida_api.app import create_app
    from hoida_api.config import Config
    from hoida_api.store import SQLiteStore
    store = SQLiteStore(':memory:')
    application = create_app(config=Config(), store=store)
    with TestClient(application) as client:
        owner, other = client.post('/v1/users').json(), client.post('/v1/users').json()
        task = store.create_task(owner['user_id'], 'Book a sauna', None, 'book', {'status': 'completed'})
        assert client.get(f"/v1/tasks/{task['id']}/live.jpg", params={'t': owner['token']}).status_code == 404
        store.put_live_frame(task['id'], b'\xff\xd8frame1')
        store.put_live_frame(task['id'], b'\xff\xd8frame2')
        r = client.get(f"/v1/tasks/{task['id']}/live.jpg", params={'t': owner['token']})
        assert r.status_code == 200 and r.content == b'\xff\xd8frame2' and r.headers['cache-control'] == 'no-store'
        assert client.get(f"/v1/tasks/{task['id']}/live.jpg", params={'t': other['token']}).status_code == 404
