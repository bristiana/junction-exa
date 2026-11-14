"""The API side of the sandbox: live frames, usage, mid-run messages and ask_user."""
import sys
import threading
import types

import httpx
import pytest
from fastapi.testclient import TestClient

from vali_agent.hooks import AgentHooks
from vali_api import app as module
from vali_api.app import create_app
from vali_api.config import Config
from vali_api.exa import ExaClient
from vali_api.store import SQLiteStore


@pytest.fixture
def api():
    def respond(request):
        if request.method == 'POST':
            return httpx.Response(200, json={'id': 'run_fake', 'status': 'queued'})
        if request.url.path.endswith('/events'):
            return httpx.Response(200, json={'data': [], 'hasMore': False})
        return httpx.Response(200, json={'id': 'run_fake', 'status': 'completed', 'output': {
            'text': 'Done', 'structured': {'answer': 'Done', 'key_facts': [], 'steps': [],
                                           'actions': [{'type': 'open_link', 'label': 'Book', 'url': 'https://example.com/book'}]},
            'grounding': []}, 'costDollars': {'total': 0.01}, 'stopReason': 'schema_satisfied'})
    store = SQLiteStore(':memory:')
    exa = ExaClient('fake-key', transport=httpx.MockTransport(respond))
    application = create_app(Config(sqlite_path=':memory:'), store, exa, lambda tid: None, lambda *args: None)
    with TestClient(application) as client:
        user = client.post('/v1/users').json()
        client.headers['Authorization'] = 'Bearer ' + user['token']
        yield client, application, store
    store.close()
    exa.close()


def started_task(client, application):
    tid = client.post('/v1/tasks', json={'task': 'book a sauna for 8 on Saturday'}).json()['id']
    module.poll_research_once(tid, application)
    assert client.post(f'/v1/tasks/{tid}/execute', json={}).status_code == 200
    return tid


def test_messages_need_a_running_execution(api):
    client, application, store = api
    tid = client.post('/v1/tasks', json={'task': 'book a sauna in Helsinki tonight'}).json()['id']  # nothing to ask
    assert client.post(f'/v1/tasks/{tid}/messages', json={'text': 'use 18:00'}).status_code == 409
    module.poll_research_once(tid, application)
    client.post(f'/v1/tasks/{tid}/execute', json={})
    assert client.post(f'/v1/tasks/{tid}/messages', json={'text': ''}).status_code == 422
    task = client.post(f'/v1/tasks/{tid}/messages', json={'text': 'use 18:00'}).json()
    assert task['execution']['inbox'][0]['text'] == 'use 18:00'


def test_live_frame_usage_inbox_and_question(api, monkeypatch):
    client, application, store = api
    tid = started_task(client, application)
    seen = {}

    def fake_agent(goal, start_url, profile, hooks):
        hooks.on_frame(b'frame-1')
        hooks.on_usage({'input_tokens': 1200, 'output_tokens': 80, 'cache_read_input_tokens': 900})
        hooks.on_exa([{'kind': 'search', 'query': 'TA Espoo properties', 'results': [], 'cost_usd': 0.007}])
        seen['exa_live'] = store.get_task(tid)['execution']['exa']
        assert hooks.pending_messages() == []
        client.post(f'/v1/tasks/{tid}/messages', json={'text': 'make it 8 people'})
        seen['messages'] = hooks.pending_messages()
        assert hooks.pending_messages() == []  # drained once

        def answer_later():
            while not (store.get_task(tid)['execution'] or {}).get('question'):
                pass
            client.post(f'/v1/tasks/{tid}/messages', json={'text': '19:30 is fine'})
        threading.Thread(target=answer_later, daemon=True).start()
        seen['answer'] = hooks.ask_user('18:00 is full. Is 19:30 OK?')
        seen['question_after'] = store.get_task(tid)['execution'].get('question')
        return {'status': 'done', 'result': 'Booked slot prepared', 'final_url': start_url,
                'usage': {'input_tokens': 1200, 'output_tokens': 80}, 'sources': [{'url': 'https://example.com/rules'}]}

    monkeypatch.setitem(sys.modules, 'vali_agent', types.SimpleNamespace(run_browser_agent=fake_agent, AgentHooks=AgentHooks))
    monkeypatch.setattr(module.time, 'sleep', lambda s: None)
    module.run_browser_session(tid, 'goal', 'https://example.com/book', {}, application)
    assert store.get_live_frame(tid) == b'frame-1'
    assert seen['messages'] == ['make it 8 people']
    assert seen['answer'] == '19:30 is fine'
    assert seen['question_after'] is None
    execution = store.get_task(tid)['execution']
    assert execution['status'] == 'done'
    assert execution['usage'] == {'input_tokens': 1200, 'output_tokens': 80}
    assert execution['sources'] == [{'url': 'https://example.com/rules'}]
    assert seen['exa_live'][0]['query'] == 'TA Espoo properties'  # visible while the run is still going
    assert execution['exa'] == seen['exa_live']
    assert client.get(f'/v1/tasks/{tid}/live.jpg', params={'t': client.headers['Authorization'][7:]}).status_code in (200, 404)


def test_ask_user_times_out(api, monkeypatch):
    client, application, store = api
    tid = started_task(client, application)
    clock = iter(range(0, 10000, 100))

    def fake_agent(goal, start_url, profile, hooks):
        assert hooks.ask_user('Which slot?') is None
        return {'status': 'failed', 'result': 'No answer', 'final_url': start_url}

    monkeypatch.setitem(sys.modules, 'vali_agent', types.SimpleNamespace(run_browser_agent=fake_agent, AgentHooks=AgentHooks))
    monkeypatch.setattr(module.time, 'sleep', lambda s: None)
    monkeypatch.setattr(module.time, 'monotonic', lambda: next(clock))
    module.run_browser_session(tid, 'goal', 'https://example.com/book', {}, application)
    assert store.get_task(tid)['execution']['status'] == 'failed'


COOKIES = [{'name': 'cart', 'value': 'CART-SECRET', 'domain': '.gilda.fi', 'path': '/', 'expires': -1,
            'httpOnly': True, 'secure': True, 'sameSite': 'Lax'}]


def handed_off(client, application, monkeypatch):
    tid = started_task(client, application)

    def fake_agent(goal, start_url, profile, hooks):
        hooks.on_handoff('https://www.gilda.fi/checkout', COOKIES)
        return {'status': 'failed', 'result': 'needs payment: finish by hand at https://www.gilda.fi/checkout',
                'final_url': 'https://www.gilda.fi/checkout'}

    monkeypatch.setitem(sys.modules, 'vali_agent', types.SimpleNamespace(run_browser_agent=fake_agent, AgentHooks=AgentHooks))
    module.run_browser_session(tid, 'goal', 'https://example.com/book', {}, application)
    return tid


def test_handoff_is_owner_only_and_one_time(api, monkeypatch):
    client, application, store = api
    tid = handed_off(client, application, monkeypatch)
    task = client.get(f'/v1/tasks/{tid}').json()
    assert task['execution']['handoff_available'] is True
    for seen in (task, client.get('/v1/tasks').json(), store.sql('SELECT execution_json FROM tasks')):
        assert 'CART-SECRET' not in repr(seen)  # the task never carries a cookie value
    stranger = client.post('/v1/users').json()['token']
    assert client.post(f'/v1/tasks/{tid}/handoff', headers={'Authorization': 'Bearer ' + stranger}).status_code == 404
    assert client.post(f'/v1/tasks/{tid}/handoff', headers={'Authorization': ''}).status_code == 401
    got = client.post(f'/v1/tasks/{tid}/handoff')
    assert got.status_code == 200 and got.headers['cache-control'] == 'no-store'
    assert got.json() == {'url': 'https://www.gilda.fi/checkout', 'cookies': COOKIES}
    assert client.post(f'/v1/tasks/{tid}/handoff').status_code == 404  # deleted after the first fetch
    assert client.get(f'/v1/tasks/{tid}').json()['execution']['handoff_available'] is False
    assert store.sql('SELECT * FROM handoffs') == []


def test_handoff_expires_after_15_minutes(api, monkeypatch):
    client, application, store = api
    tid = handed_off(client, application, monkeypatch)
    assert store.HANDOFF_SECONDS == 900
    store.sql("UPDATE handoffs SET expires_at='2000-01-01T00:00:00+00:00'")
    assert client.get(f'/v1/tasks/{tid}').json()['execution']['handoff_available'] is False
    assert client.post(f'/v1/tasks/{tid}/handoff').status_code == 404
    assert store.sql('SELECT * FROM handoffs') == []


def test_handoff_at_approval_stops_the_cloud_run(api):
    client, application, store = api
    tid = started_task(client, application)
    store.put_handoff(tid, 'https://www.gilda.fi/checkout', COOKIES)
    store.patch_execution(tid, {'status': 'awaiting_approval', 'handoff_available': True})
    assert client.post(f'/v1/tasks/{tid}/handoff').status_code == 200
    execution = client.get(f'/v1/tasks/{tid}').json()['execution']
    assert execution['status'] == 'stopped' and execution['approval_decision'] == 'stopped'
    assert execution['handoff_available'] is False
