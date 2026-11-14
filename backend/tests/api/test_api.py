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

from vali_api.app import create_app, poll_research_once, research_from_run
from vali_api.monitors import create_monitor
from vali_api.config import Config
from vali_api.exa import ExaClient, ExaError
from vali_api.research import SYSTEM_PROMPT, output_schema, build_query, build_run_request, FIND_SCHEMA, progress_from_events
from vali_api.router import route
from vali_api.store import SQLiteStore
from vali_wa.api import GraphAPIClient
import asyncio


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
    assert store.link_number(code, '+358401234567')
    assert client.get('/v1/me').json()['whatsapp_last4'] == '4567'
    assert not store.link_number(code, '+358401234567')
    code = client.post('/v1/pair').json()['code']
    store.sql('UPDATE pair_codes SET expires_at=? WHERE code=?', ('2000-01-01T00:00:00+00:00', code))
    assert not store.link_number(code, '+358401234567')
    assert not store.link_number('000000', '+358401234567')


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


def test_a_drafted_reply_is_never_addressed_to_the_user():
    run = {'status': 'completed', 'output': {'structured': {'actions': [
        {'type': 'email', 'to': '{{email}}', 'subject': 'Rent increase', 'body': 'Hello, {{name}}'},
        {'type': 'phone_call', 'to': '{{ Phone }}'},
        {'type': 'email', 'to': 'vuokra@example.com'}, {'type': 'email', 'to': None}]}}}
    actions = research_from_run(run)['output']['structured']['actions']
    assert [a['to'] for a in actions] == ['{{recipient_email}}', '{{recipient_phone}}', 'vuokra@example.com', None]
    assert actions[0]['body'] == 'Hello, {{name}}'
    assert 'never put one in an action\'s "to"' in SYSTEM_PROMPT and '{{sender_email}}' in SYSTEM_PROMPT


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


def test_image_gets_do_not_consume_ip_limit(api):
    client, application, store, *_, user = api
    task = client.post('/v1/tasks', json={'task': 'find café'}).json()
    store.put_shot(task['id'], 1, b'shot-jpeg')
    store.put_live_frame(task['id'], b'live-jpeg')
    limiter = application.state.limiter
    limiter.events.clear()
    limiter.ip_limit = 2
    urls = [f"/v1/tasks/{task['id']}/live.jpg", f"/v1/tasks/{task['id']}/shots/1.jpg"]
    for _ in range(5):
        for url in urls:
            assert client.get(url, params={'t': user['token']}).status_code == 200
    assert not limiter.events
    assert client.get('/health').status_code == 200
    assert client.get('/health').status_code == 200
    assert client.get('/health').status_code == 429
    for url in urls:
        assert client.get(url, params={'t': user['token']}).status_code == 200
        assert client.get(url, params={'t': 'wrong'}).status_code == 401


def test_general_ip_limit_is_1200_per_ten_minutes(api, monkeypatch):
    from types import SimpleNamespace
    from vali_api import guard

    client, application, *_ = api
    limiter = application.state.limiter
    assert (limiter.ip_limit, limiter.seconds, limiter.user_limit) == (1200, 600, 30)
    current = [1000.0]
    monkeypatch.setattr(guard, 'time', SimpleNamespace(monotonic=lambda: current[0]))
    limiter.events.clear()
    for _ in range(1200):
        assert client.get('/health').status_code == 200
    assert client.get('/health').status_code == 429
    current[0] += 599
    assert client.get('/health').status_code == 429
    current[0] += 1
    assert client.get('/health').status_code == 200


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
    assert client.post('/webhooks/exa', json={}).status_code == 403
    with pytest.raises(ValueError):
        create_monitor(Config(public_url=''), 'watch', exa=application.state.exa, watch_id='w_test')
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
    payload = {'entry': [{'changes': [{'value': {'messages': [{'from': '+358401234567', 'id': 'pair-message', 'type': 'text', 'text': {'body': 'link ' + code}}]}}]}]}
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
    async def send():
        async with GraphAPIClient('fake-phone-id', 'fake-token', transport=httpx.MockTransport(outbound)) as graph:
            await graph.send_text('+358401234567', 'Test')
    asyncio.run(send())


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
    module = importlib.import_module('vali_api.app')
    client, application, store, *_ = api
    task = client.post('/v1/tasks', json={'task': 'find café'}).json()
    tid = task['id']
    graph = FakeWhatsApp()
    application.state.whatsapp_api = graph
    store.sql('UPDATE users SET wa_number=? WHERE id=?', ('358401234567', task['user_id']))
    store.sql('UPDATE tasks SET source=? WHERE id=?', ('whatsapp', tid))
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
    monkeypatch.setitem(sys.modules, 'vali_agent', types.SimpleNamespace(run_browser_agent=fake_agent, AgentHooks=FakeHooks))
    monkeypatch.setattr(module.time, 'sleep', approve_on_sleep)
    module.run_browser_session(tid, 'goal', 'https://example.com', {}, application)
    execution = store.get_task(tid)['execution']
    assert execution['status'] == 'done'
    assert execution['steps'][0]['shot'] == 1
    assert execution['shots'][0]['url'].endswith('/shots/1.jpg')
    assert store.get_shot(tid, 1) == b'fake-jpeg'
    assert len(graph.sent) == 2
    assert 'Reply *yes*' in graph.sent[0][1] and graph.sent[1][1] == 'Finished'


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
    from vali_api.app import create_app
    from vali_api.config import Config
    from vali_api.store import SQLiteStore
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


class FakeWhatsApp:
    def __init__(self):
        self.sent, self.read, self.media = [], [], []
        self.fail_send = False

    async def send_text(self, to, body, reply_to=None):
        if self.fail_send:
            raise RuntimeError('fake send failure')
        self.sent.append((to, body, reply_to))

    async def mark_read(self, mid):
        self.read.append(mid)

    async def get_media_url(self, mid):
        self.media.append(mid)
        return 'https://media.example/audio'

    async def download_media(self, url):
        return b'fake audio'


@pytest.fixture
def wa(api):
    client, application, store, *_, user = api
    graph = FakeWhatsApp()
    application.state.whatsapp_api = graph
    application.state.whatsapp_flow.api = graph
    def deliver(text='', mid='message-1', number='358401234567', **media):
        message = {'from': number, 'id': mid, 'type': 'text', 'text': {'body': text}, **media}
        return client.post('/webhooks/whatsapp', json={'entry': [{'changes': [{'value': {'messages': [message]}}]}]})
    return api, graph, deliver


def pair_whatsapp(api, deliver):
    code = api[0].post('/v1/pair').json()['code']
    assert deliver('link ' + code, mid='pair').status_code == 200


def test_whatsapp_unknown_pairing_and_shared_tasks(wa):
    api, graph, deliver = wa
    client, application, store, _, polls, _, user = api
    assert deliver('claim refund', mid='unknown').status_code == 200
    assert 'link 123456' in graph.sent[-1][1]
    assert client.get('/v1/tasks').json()['tasks'] == []
    pair_whatsapp(api, deliver)
    assert client.get('/v1/me').json()['whatsapp_linked']
    assert deliver('claim refund').status_code == 200
    task = client.get('/v1/tasks').json()['tasks'][0]
    assert task['user_id'] == user['user_id'] and task['source'] == 'whatsapp'
    assert polls == [task['id']]
    assert deliver('claim refund').status_code == 200
    assert len(client.get('/v1/tasks').json()['tasks']) == 1
    assert graph.read.count('message-1') == 1
    before = len(graph.sent)
    assert poll_research_once(task['id'], application)
    assert len(graph.sent) == before + 1
    assert 'Done' in graph.sent[-1][1] and 'Reply 1' in graph.sent[-1][1]
    poll_research_once(task['id'], application)
    assert len(graph.sent) == before + 1


def test_whatsapp_inline_search_budget_and_watch(wa):
    api, graph, deliver = wa
    client, application, store, calls, polls, *_ = api
    pair_whatsapp(api, deliver)
    deliver('find café')
    task = client.get('/v1/tasks').json()['tasks'][0]
    assert task['mode'] == 'find' and task['source'] == 'whatsapp'
    assert not polls and calls[-1][1] == '/search'
    assert any('An option.' in body for _, body, _ in graph.sent)
    deliver('watch for flats', mid='watch')
    assert len(client.get('/v1/watches').json()['watches']) == 1
    application.state.config.daily_cap_usd = 0.01
    deliver('claim refund', mid='over-budget')
    assert len(client.get('/v1/tasks').json()['tasks']) == 2


def test_whatsapp_commands_use_shared_execution(wa):
    api, graph, deliver = wa
    client, application, store, _, _, browsers, _ = api
    pair_whatsapp(api, deliver)
    # An extension task can be selected from WhatsApp; newer unfinished research is skipped.
    task = client.post('/v1/tasks', json={'task': 'find café'}).json()
    client.post('/v1/tasks', json={'task': 'claim refund'})
    deliver('1')
    assert len(browsers) == 1 and browsers[0][0] == task['id']
    assert 'https://example.com/form' == browsers[0][2]
    assert json.loads(browsers[0][1])['action']['label'] == 'Option'
    store.patch_execution(task['id'], {'status': 'awaiting_approval'})
    deliver('yes', mid='approve')
    assert store.get_task(task['id'])['execution']['approval_decision'] == 'approved'
    deliver('yes', mid='approve-again')
    assert client.post(f"/v1/tasks/{task['id']}/approve").status_code == 409
    deliver('stop', mid='stop')
    execution = store.get_task(task['id'])['execution']
    assert execution['status'] == 'stopped' and execution['approval_decision'] == 'stopped'
    assert 'Stopped' in graph.sent[-1][1]
    assert client.post(f"/v1/tasks/{task['id']}/approve").status_code == 409


def test_whatsapp_voice_and_unavailable_media(wa):
    api, graph, deliver = wa
    client, application, *_ = api
    pair_whatsapp(api, deliver)
    application.state.whatsapp_flow.transcribe = None
    deliver(mid='unavailable', type='audio', audio={'id': 'audio', 'mime_type': 'audio/ogg'})
    assert 'not available' in graph.sent[-1][1] and not graph.media
    seen = []
    def transcribe(data, mime):
        seen.append((data, mime))
        return 'find café from transcript'
    application.state.whatsapp_flow.transcribe = transcribe
    deliver(mid='voice', type='audio', audio={'id': 'audio', 'mime_type': 'audio/ogg'})
    assert seen == [(b'fake audio', 'audio/ogg')] and graph.media == ['audio']
    task = client.get('/v1/tasks').json()['tasks'][0]
    assert task['task'] == 'find café from transcript' and task['source'] == 'whatsapp'


def test_whatsapp_failed_push_does_not_break_poller(wa):
    api, graph, deliver = wa
    client, application, store, *_ = api
    pair_whatsapp(api, deliver)
    deliver('claim refund')
    task = client.get('/v1/tasks').json()['tasks'][0]
    graph.fail_send = True
    assert poll_research_once(task['id'], application)
    assert store.get_task(task['id'])['research']['status'] == 'completed'


def test_whatsapp_dedupe_across_store_connections(tmp_path):
    path = str(tmp_path / 'shared.db')
    first, second = SQLiteStore(path), SQLiteStore(path)
    try:
        assert first.claim_whatsapp_message('redelivered')
        assert not second.claim_whatsapp_message('redelivered')
    finally:
        first.close()
        second.close()


def test_whatsapp_response_is_sent_before_processing(wa):
    api, graph, _ = wa
    _, application, *_ = api
    events = []
    async def handle(message):
        events.append('processing')
    application.state.whatsapp_flow.handle = handle
    raw = json.dumps({'entry': [{'changes': [{'value': {'messages': [
        {'from': '358401234567', 'id': 'background', 'type': 'text', 'text': {'body': 'hello'}}]}}]}]}).encode()
    async def request():
        sent = False
        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {'type': 'http.request', 'body': raw, 'more_body': False}
            await asyncio.sleep(10)
            return {'type': 'http.disconnect'}
        async def send(message):
            if message['type'] == 'http.response.start':
                assert message['status'] == 200
            if message['type'] == 'http.response.body' and not message.get('more_body'):
                events.append('response')
        await application({'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.4'},
                           'http_version': '1.1', 'method': 'POST', 'scheme': 'http',
                           'path': '/webhooks/whatsapp', 'raw_path': b'/webhooks/whatsapp',
                           'query_string': b'', 'headers': [(b'content-type', b'application/json')],
                           'client': ('127.0.0.1', 1234), 'server': ('testserver', 80)}, receive, send)
    asyncio.run(request())
    assert events == ['response', 'processing']


@pytest.mark.parametrize('status', ['failed', 'stopped'])
def test_whatsapp_browser_terminal_push(wa, monkeypatch, status):
    import sys
    import types
    from vali_api.app import run_browser_session
    api, graph, deliver = wa
    client, application, store, *_ = api
    pair_whatsapp(api, deliver)
    # Execution from WhatsApp opts an extension task into notifications too.
    task = client.post('/v1/tasks', json={'task': 'find café'}).json()
    deliver('1')
    graph.sent.clear()
    def agent(**kwargs):
        return {'status': status, 'error': 'Fake failure', 'result': '', 'final_url': 'https://example.com'}
    monkeypatch.setitem(sys.modules, 'vali_agent', types.SimpleNamespace(
        run_browser_agent=agent, AgentHooks=lambda **kwargs: kwargs))
    run_browser_session(task['id'], 'goal', 'https://example.com', {}, application)
    assert len(graph.sent) == 1
    assert ('could not finish' if status == 'failed' else 'Stopped') in graph.sent[0][1]
    assert store.get_task(task['id'])['execution']['status'] == status


def test_whatsapp_failed_research_push(wa):
    api, graph, deliver = wa
    client, application, store, *_ = api
    pair_whatsapp(api, deliver)
    deliver('claim refund')
    task = client.get('/v1/tasks').json()['tasks'][0]
    graph.sent.clear()
    failed_exa = ExaClient('fake', httpx.MockTransport(lambda request: httpx.Response(404, json={})))
    application.state.exa = failed_exa
    try:
        assert poll_research_once(task['id'], application)
        assert len(graph.sent) == 1 and 'Research failed' in graph.sent[0][1]
        assert poll_research_once(task['id'], application)
        assert len(graph.sent) == 1
    finally:
        failed_exa.close()


def test_atomic_approval_rejects_stale_state(tmp_path):
    path = str(tmp_path / 'approval.db')
    first, second = SQLiteStore(path), SQLiteStore(path)
    try:
        user = first.create_user()
        task = first.create_task(user['user_id'], 'test', None, 'check', {'status': 'completed'})
        waiting = {'status': 'awaiting_approval', 'approval_decision': None}
        first.update_execution(task['id'], waiting)
        assert first.approve_execution(task['id'], waiting)
        assert not second.approve_execution(task['id'], waiting)
        second.patch_execution(task['id'], {'status': 'stopped', 'approval_decision': 'stopped'})
        assert not first.approve_execution(task['id'], waiting)
        assert first.get_task(task['id'])['execution']['approval_decision'] == 'stopped'
    finally:
        first.close()
        second.close()


@pytest.mark.parametrize('answer', ['use 19:30', 'yes', '2', 'hello'])
def test_whatsapp_running_messages_use_shared_inbox(wa, answer):
    api, graph, deliver = wa
    client, application, store, *_, user = api
    pair_whatsapp(api, deliver)
    deliver('book a sauna', mid='new')
    tid = store.list_tasks(user['user_id'])[0]['id']
    poll_research_once(tid, application)
    deliver('1', mid='execute')
    store.patch_execution(tid, {'status': 'running', 'question': {'text': 'Which slot?'}})
    deliver(answer, mid='answer')
    tasks = store.list_tasks(user['user_id'])
    assert len(tasks) == 1
    assert tasks[0]['execution']['inbox'] == [
        {'at': tasks[0]['execution']['inbox'][0]['at'], 'text': answer, 'source': 'whatsapp'}]
    client.post(f'/v1/tasks/{tid}/messages', json={'text': 'extension answer'})
    assert store.get_task(tid)['execution']['inbox'][-1]['source'] == 'extension'


@pytest.mark.parametrize('reply,decision', [('da', 'approved'), ('approve', 'approved'), ('nu', 'stopped')])
def test_whatsapp_approval_aliases(wa, reply, decision):
    api, graph, deliver = wa
    client, application, store, *_, user = api
    pair_whatsapp(api, deliver)
    deliver('book a sauna', mid='new')
    tid = store.list_tasks(user['user_id'])[0]['id']
    poll_research_once(tid, application)
    deliver('1', mid='execute')
    store.patch_execution(tid, {'status': 'awaiting_approval'})
    deliver(reply, mid='decision')
    assert store.get_task(tid)['execution']['approval_decision'] == decision


def test_whatsapp_question_once_and_live_approval(wa):
    from vali_api.wa_channel import push_task
    from vali_wa.render import render_execution_update
    api, graph, deliver = wa
    client, application, store, *_, user = api
    pair_whatsapp(api, deliver)
    deliver('book a sauna', mid='new')
    tid = store.list_tasks(user['user_id'])[0]['id']
    poll_research_once(tid, application)
    deliver('1', mid='execute')
    store.patch_execution(tid, {'status': 'running', 'question': {'text': 'Which slot?', 'at': 'now'}})
    push_task(application, tid, render_execution_update)
    push_task(application, tid, render_execution_update)
    assert [body for _, body, _ in graph.sent].count('Which slot?') == 1
    calls = []
    async def upload(data, mime):
        calls.append(('upload', data, mime))
        return 'uploaded'
    async def image(to, *, media_id, caption):
        calls.append(('image', media_id, caption))
    async def buttons(to, body, buttons):
        calls.append(('buttons', buttons))
    graph.upload_media, graph.send_image, graph.send_buttons = upload, image, buttons
    store.put_live_frame(tid, b'live jpeg')
    store.patch_execution(tid, {'question': None, 'status': 'awaiting_approval', 'approval': {'summary': 'Book sauna'}})
    push_task(application, tid, render_execution_update)
    assert calls[0] == ('upload', b'live jpeg', 'image/jpeg')
    assert calls[1][0:2] == ('image', 'uploaded')
    assert 'Book sauna' in calls[1][2]
    assert calls[2] == ('buttons', [(f'approve:{tid}', 'Approve'), (f'stop:{tid}', 'Stop')])
    deliver(mid='stale', type='interactive', interactive={'button_reply': {'id': 'approve:old', 'title': 'Approve'}})
    assert store.get_task(tid)['execution']['status'] == 'awaiting_approval'
    deliver(mid='button', type='interactive', interactive={'button_reply': {'id': f'approve:{tid}', 'title': 'Approve'}})
    assert store.get_task(tid)['execution']['approval_decision'] == 'approved'


def test_whatsapp_failures_logged_without_private_data(wa, caplog):
    from vali_wa.api import GraphAPIError
    api, graph, deliver = wa
    pair_whatsapp(api, deliver)
    async def broken(*args, **kwargs):
        raise GraphAPIError(429, 42)
    graph.send_text = broken
    with caplog.at_level('WARNING', logger='vali.whatsapp'):
        assert deliver('private errand', mid='failed-message').status_code == 200
    logs = '\n'.join(r.message for r in caplog.records if r.name == 'vali.whatsapp')
    assert 'failed-message' in logs and 'status_code=429 code=42' in logs
    assert 'private errand' not in logs and '358401234567' not in logs


def test_whatsapp_existing_elevenlabs_voice_wiring(wa, monkeypatch):
    import vali_media.voice as voice
    api, graph, deliver = wa
    client, application, store, *_, user = api
    pair_whatsapp(api, deliver)
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'test-stt-key')
    def provider(request):
        assert request.url.path == '/v1/speech-to-text'
        assert request.headers['xi-api-key'] == 'test-stt-key'
        assert b'fake audio' in request.content and b'scribe_v' in request.content
        return httpx.Response(200, json={'text': 'find a sauna'})
    original = voice.transcribe
    def transcribe(data, mime, **kwargs):
        return original(data, mime, **kwargs, transport=httpx.MockTransport(provider))
    monkeypatch.setattr(voice, 'transcribe', transcribe)
    # Recreate to exercise the real app adapter, rather than a fake transcript callback.
    application.state.config.elevenlabs_api_key = 'test-stt-key'
    adapter = create_app(application.state.config, store, application.state.exa,
                         lambda tid: None, lambda *args: None, whatsapp_api=graph)
    application.state.whatsapp_flow.transcribe = adapter.state.whatsapp_flow.transcribe
    deliver(mid='voice-provider', type='audio', audio={'id': 'audio', 'mime_type': 'audio/ogg'})
    assert graph.media == ['audio']
    assert store.list_tasks(user['user_id'])[0]['task'] == 'find a sauna'


def test_whatsapp_agent_question_is_pushed_and_answered(wa, monkeypatch):
    import sys
    import types
    from vali_agent.hooks import AgentHooks
    from vali_api.app import run_browser_session
    api, graph, deliver = wa
    client, application, store, *_, user = api
    pair_whatsapp(api, deliver)
    deliver('book a sauna', mid='new')
    tid = store.list_tasks(user['user_id'])[0]['id']
    poll_research_once(tid, application)
    deliver('1', mid='execute')
    send = graph.send_text
    async def answer_when_sent(to, body, reply_to=None):
        await send(to, body, reply_to)
        if body == 'Which slot?':
            deliver('19:30', mid='question-answer')
    graph.send_text = answer_when_sent
    def agent(**kwargs):
        assert kwargs['hooks'].ask_user('Which slot?') == '19:30'
        assert kwargs['hooks'].pending_messages() == []
        return {'status': 'done', 'result': 'Done'}
    monkeypatch.setitem(sys.modules, 'vali_agent', types.SimpleNamespace(run_browser_agent=agent, AgentHooks=AgentHooks))
    run_browser_session(tid, 'goal', 'https://example.com', {}, application)
    assert store.get_task(tid)['execution']['question'] is None
    assert [body for _, body, _ in graph.sent].count('Which slot?') == 1


def test_whatsapp_image_failure_falls_back_to_text_and_buttons(wa, caplog):
    from vali_api.wa_channel import push_task
    from vali_wa.api import GraphAPIError
    from vali_wa.render import render_execution_update
    api, graph, deliver = wa
    client, application, store, *_, user = api
    pair_whatsapp(api, deliver)
    deliver('book a sauna', mid='new')
    tid = store.list_tasks(user['user_id'])[0]['id']
    poll_research_once(tid, application)
    deliver('1', mid='execute')
    store.patch_execution(tid, {'status': 'awaiting_approval'})
    store.put_live_frame(tid, b'jpeg')
    async def fail(*args, **kwargs):
        raise GraphAPIError(500, 7)
    graph.upload_media = graph.send_image = graph.send_buttons = fail
    with caplog.at_level('WARNING', logger='vali.whatsapp'):
        push_task(application, tid, render_execution_update)
    assert 'Reply *yes*' in graph.sent[-1][1]
    assert 'approval image failed' in caplog.text and 'approval buttons failed' in caplog.text
    assert f'task_id={tid}' in caplog.text and 'status_code=500 code=7' in caplog.text
    graph.send_text = fail
    with caplog.at_level('WARNING', logger='vali.whatsapp'):
        push_task(application, tid, render_execution_update)
    assert 'task notification failed' in caplog.text


def test_whatsapp_delivery_status_logging(wa, caplog):
    api, graph, _ = wa
    payload = {'entry': [{'changes': [{'value': {'statuses': [
        {'id': 'outgoing-failed', 'status': 'failed', 'recipient_id': '358401234567',
         'errors': [{'code': 131047, 'title': 'Re-engagement message',
                     'error_data': {'details': 'private-details'}, 'href': 'private-url'}]},
        {'id': 'outgoing-read', 'status': 'read', 'recipient_id': '358401234567'}]}}]}]}
    with caplog.at_level('INFO', logger='vali.whatsapp'):
        assert api[0].post('/webhooks/whatsapp', json=payload).status_code == 200
    assert 'status=failed message_id=outgoing-failed' in caplog.text
    assert '131047' in caplog.text and 'Re-engagement message' in caplog.text
    assert 'status=read message_id=outgoing-read' in caplog.text
    assert all(secret not in caplog.text for secret in ['358401234567', 'private-details', 'private-url'])
    assert not graph.sent and not graph.read


@pytest.mark.parametrize('answer', ['use 19:30', 'yes', 'ok', 'da', '1'])
@pytest.mark.parametrize('question', [None, {'text': 'Which time?', 'at': 'now'}])
def test_whatsapp_running_answers_share_messages_inbox(wa, answer, question):
    api, graph, deliver = wa
    client, application, store, *_ = api
    pair_whatsapp(api, deliver)
    deliver('find café')
    task = client.get('/v1/tasks').json()['tasks'][0]
    tid = task['id']
    deliver('1', mid='execute')
    store.patch_execution(tid, {'status': 'running', 'question': question})
    before = len(client.get('/v1/tasks').json()['tasks'])
    deliver(answer, mid='answer')
    assert len(client.get('/v1/tasks').json()['tasks']) == before
    inbox = store.get_task(tid)['execution']['inbox']
    assert inbox[-1]['text'] == answer and inbox[-1]['source'] == 'whatsapp'
    assert client.post(f'/v1/tasks/{tid}/messages', json={'text': 'extension reply'}).status_code == 200
    inbox = store.get_task(tid)['execution']['inbox']
    assert inbox[-1]['text'] == 'extension reply' and inbox[-1]['source'] == 'extension'


@pytest.mark.parametrize('action', ['approve', 'stop'])
def test_whatsapp_task_scoped_buttons_and_stale_rejection(wa, action):
    api, graph, deliver = wa
    client, application, store, *_ = api
    pair_whatsapp(api, deliver)
    deliver('find café')
    tid = client.get('/v1/tasks').json()['tasks'][0]['id']
    deliver('1', mid='execute')
    store.patch_execution(tid, {'status': 'awaiting_approval'})
    deliver(mid='stale', type='interactive', interactive={
        'type': 'button_reply', 'button_reply': {'id': f'{action}:different-task', 'title': action}})
    assert store.get_task(tid)['execution']['status'] == 'awaiting_approval'
    assert 'no longer active' in graph.sent[-1][1]
    deliver(mid='button', type='interactive', interactive={
        'type': 'button_reply', 'button_reply': {'id': f'{action}:{tid}', 'title': action}})
    assert store.get_task(tid)['execution']['approval_decision'] == ('approved' if action == 'approve' else 'stopped')


@pytest.mark.parametrize('reply', ['da', 'yes', 'ok', 'approve', 'stop', 'nu', 'no', 'cancel'])
def test_whatsapp_approval_text_fallback(wa, reply):
    api, graph, deliver = wa
    client, application, store, *_ = api
    pair_whatsapp(api, deliver)
    deliver('find café')
    tid = client.get('/v1/tasks').json()['tasks'][0]['id']
    deliver('1', mid='execute')
    store.patch_execution(tid, {'status': 'awaiting_approval'})
    deliver(reply, mid='decision')
    assert store.get_task(tid)['execution']['approval_decision'] == (
        'approved' if reply in {'da', 'yes', 'ok', 'approve'} else 'stopped')


def test_whatsapp_processing_failures_are_private_and_do_not_abort_batch(wa, caplog):
    from vali_wa.api import GraphAPIError
    api, graph, deliver = wa
    client, application, *_ = api
    seen = []
    async def handle(message):
        seen.append(message.message_id)
        if message.message_id == 'bad-message':
            raise GraphAPIError(403, 190)
    async def fail_reply(*args, **kwargs):
        raise RuntimeError('private-message private-token 358401234567')
    application.state.whatsapp_flow.handle = handle
    graph.send_text = fail_reply
    messages = [{'id': mid, 'from': '358401234567', 'type': 'text',
                 'text': {'body': 'private-message'}} for mid in ['bad-message', 'next-message']]
    with caplog.at_level('WARNING', logger='vali.whatsapp'):
        assert client.post('/webhooks/whatsapp', json={
            'entry': [{'changes': [{'value': {'messages': messages}}]}]}).status_code == 200
    assert seen == ['bad-message', 'next-message']
    assert 'message_id=bad-message' in caplog.text
    assert 'status_code=403 code=190' in caplog.text and 'error reply failed' in caplog.text
    assert all(secret not in caplog.text for secret in ['private-message', 'private-token', '358401234567'])


def test_whatsapp_voice_graph_to_elevenlabs_to_task(wa, monkeypatch):
    from vali_media import voice
    api, graph, deliver = wa
    client, application, *_ = api
    # The existing media helper reads the same environment key as Config.
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'fake-elevenlabs')
    application.state.config.elevenlabs_api_key = 'fake-elevenlabs'
    requests = []
    def respond(request):
        requests.append(request)
        if request.url.path == '/v21.0/audio-id':
            return httpx.Response(200, json={'url': 'https://media.example/voice'})
        if request.url.host == 'media.example':
            return httpx.Response(200, content=b'original-ogg-bytes')
        if request.url.host == 'api.elevenlabs.io':
            assert request.url.path == '/v1/speech-to-text'
            assert request.headers['xi-api-key'] == application.state.config.elevenlabs_api_key
            assert b'original-ogg-bytes' in request.content and b'scribe_' in request.content
            assert b'audio/ogg; codecs=opus' in request.content
            return httpx.Response(200, json={'text': 'find café from voice'})
        return httpx.Response(200, json={'messages': [{'id': 'out'}]})
    real_client = httpx.Client
    monkeypatch.setattr(voice.httpx, 'Client', lambda **kwargs: real_client(
        **{**kwargs, 'transport': httpx.MockTransport(respond)}))
    pair_whatsapp(api, deliver)
    async def send_voice():
        async with GraphAPIClient('phone-test', 'fake-graph', transport=httpx.MockTransport(respond)) as graph_api:
            voice_app = create_app(Config(elevenlabs_api_key='fake-elevenlabs'), api[2],
                                   application.state.exa, lambda tid: None, lambda *args: None,
                                   whatsapp_api=graph_api)
            with TestClient(voice_app) as voice_client:
                response = voice_client.post('/webhooks/whatsapp', json={'entry': [{'changes': [{'value': {
                    'messages': [{'from': '358401234567', 'id': 'voice-e2e', 'type': 'audio',
                                  'audio': {'id': 'audio-id', 'mime_type': 'audio/ogg; codecs=opus'}}]}}]}]})
                assert response.status_code == 200
    asyncio.run(send_voice())
    task = client.get('/v1/tasks').json()['tasks'][0]
    assert task['task'] == 'find café from voice' and task['source'] == 'whatsapp'
    assert len([r for r in requests if r.method == 'GET']) == 2


def test_whatsapp_agent_question_is_delivered_and_answered(wa, monkeypatch):
    import sys
    import types
    from vali_api import app as module
    api, graph, deliver = wa
    client, application, store, *_ = api
    pair_whatsapp(api, deliver)
    deliver('find café')
    tid = client.get('/v1/tasks').json()['tasks'][0]['id']
    deliver('1', mid='execute')
    def fake_agent(goal, start_url, profile, hooks):
        assert hooks.ask_user('Is the later time OK?') == 'no'
        assert hooks.pending_messages() == []
        return {'status': 'done', 'result': 'Answer received', 'final_url': start_url}
    def answer(seconds):
        assert any(body == 'Is the later time OK?' for _, body, _ in graph.sent)
        deliver('no', mid='question-answer')
    monkeypatch.setitem(sys.modules, 'vali_agent', types.SimpleNamespace(
        run_browser_agent=fake_agent, AgentHooks=lambda **kwargs: types.SimpleNamespace(**kwargs)))
    monkeypatch.setattr(module.time, 'sleep', answer)
    module.run_browser_session(tid, 'goal', 'https://example.com/form', {}, application)
    execution = store.get_task(tid)['execution']
    assert execution['status'] == 'done' and execution['question'] is None
    assert sum(body == 'Is the later time OK?' for _, body, _ in graph.sent) == 1


def test_privacy_and_terms_pages_are_public():
    from fastapi.testclient import TestClient
    from vali_api.app import create_app
    from vali_api.config import Config
    client = TestClient(create_app(config=Config(sqlite_path=':memory:')))
    for path in ('/privacy', '/terms'):
        response = client.get(path)
        assert response.status_code == 200 and 'Vali' in response.text
