"""Recurring searches, signed deliveries, user isolation and provider retries."""
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi.testclient import TestClient

from vali_api.app import create_app, poll_research_once
from vali_api.config import Config
from vali_api.exa import ExaClient, ExaError
from vali_api.store import SQLiteStore


@pytest.fixture
def watched():
    calls = []
    behavior = {'create': 201, 'delete': 200}

    def respond(request):
        calls.append(request)
        if request.method == 'POST':
            return httpx.Response(behavior['create'], json={'id': 'remote_' + str(len(calls)), 'webhookSecret': behavior.get('secret', 'signing-secret')})
        if request.method == 'DELETE':
            return httpx.Response(behavior['delete'], json={})
        return httpx.Response(503, json={})

    store = SQLiteStore(':memory:')
    exa = ExaClient('fake', transport=httpx.MockTransport(respond))
    app = create_app(Config(public_url='https://vali.example', sqlite_path=':memory:'), store, exa,
                     spawn_research_poller=lambda tid: None)
    with TestClient(app) as client:
        identity = client.post('/v1/users').json()
        client.headers['Authorization'] = 'Bearer ' + identity['token']
        yield client, store, calls, behavior, app, identity
    exa.close()
    store.close()


def monitor_calls(calls):
    """Calls to the paid monitor API; a watch errand also runs one search for today's answer."""
    return [c for c in calls if c.url.path.startswith('/monitors')]


def create(client):
    response = client.post('/v1/tasks', json={'task': 'watch for flats in Helsinki'})
    assert response.status_code == 200, response.text
    return response.json()


def delivery(watch, *, event='event_1', results=None):
    return {'id': event, 'type': 'monitor.run.completed', 'data': {
        'id': 'run_1', 'monitorId': watch['exa_monitor_id'], 'status': 'completed',
        'output': {'content': 'A flat is available.', 'results': results if results is not None else [
            {'title': 'Flat', 'url': 'https://example.com/flat'}]}}}


def send(client, watch, payload, *, secret='signing-secret', timestamp=None):
    raw = json.dumps(payload).encode()
    timestamp = str(int(time.time()) if timestamp is None else timestamp)
    signature = hmac.new(secret.encode(), timestamp.encode() + b'.' + raw, hashlib.sha256).hexdigest()
    return client.post('/webhooks/exa?w=' + watch['id'], content=raw,
                       headers={'Exa-Signature': f't={timestamp},v1={signature}'})


def test_create_signed_update_seen_and_delete(watched):
    client, store, calls, *_ = watched
    task = create(client)
    assert task['research']['monitor_stubbed'] is False
    answer = task['research']['output']['structured']['answer']  # what is watched, how often and where, first
    assert answer.startswith('I will watch for ') and 'once a day with Exa' in answer.split('\n')[0]
    watch = client.get('/v1/watches').json()['watches'][0]
    body = json.loads(calls[0].content)
    assert calls[0].url.path == '/monitors'
    assert body['search'] == {'query': task['task'], 'numResults': 5}
    assert body['trigger'] == {'type': 'interval', 'period': '1d'}
    assert body['webhook']['url'] == 'https://vali.example/webhooks/exa?w=' + watch['id']
    assert body['webhook']['events'] == ['monitor.run.completed']
    assert watch['unseen_count'] == 0
    assert 'secret' not in watch and 'signing-secret' not in json.dumps(task)
    assert send(client, watch, delivery(watch)).status_code == 200
    # Exa delivery retries must not duplicate notifications or task entries.
    assert send(client, watch, delivery(watch)).status_code == 200
    watch = client.get('/v1/watches').json()['watches'][0]
    assert watch['unseen_count'] == 1
    assert watch['updates'][0]['seen'] is False
    assert watch['updates'][0]['type'] == 'watch.updates'
    updated = client.get('/v1/tasks/' + task['id']).json()
    assert updated['research']['output']['text'].count('new:') == 1
    assert updated['research']['updates'][0]['sources'][0]['url'] == 'https://example.com/flat'
    assert client.post('/v1/watches/' + watch['id'] + '/seen').status_code == 200
    assert client.get('/v1/watches').json()['watches'][0]['unseen_count'] == 0
    assert client.delete('/v1/watches/' + watch['id']).status_code == 200
    assert calls[-1].method == 'DELETE' and calls[-1].url.path == '/monitors/' + watch['exa_monitor_id']
    assert send(client, watch, delivery(watch)).status_code == 403
    assert client.get('/v1/watches').json()['watches'] == []


@pytest.mark.parametrize('invalid', ['secret', 'old', 'future', 'missing', 'wrong_id', 'malformed', 'array'])
def test_reject_invalid_deliveries(watched, invalid):
    client, *_ = watched
    create(client)
    watch = client.get('/v1/watches').json()['watches'][0]
    payload, kwargs, expected = delivery(watch), {}, 403
    if invalid == 'secret':
        kwargs['secret'] = 'wrong'
    elif invalid == 'old':
        kwargs['timestamp'] = int(time.time()) - 600
    elif invalid == 'future':
        kwargs['timestamp'] = int(time.time()) + 600
    elif invalid == 'missing':
        assert client.post('/webhooks/exa?w=' + watch['id'], json=payload).status_code == 403
        return
    elif invalid == 'wrong_id':
        payload['data']['monitorId'] = 'someone_else'
        expected = 400
    elif invalid == 'malformed':
        response = client.post('/webhooks/exa?w=' + watch['id'], json=payload, headers={'Exa-Signature': 'bad'})
        assert response.status_code == 403
        return
    elif invalid == 'array':
        payload, expected = [], 400
    assert send(client, watch, payload, **kwargs).status_code == expected
    assert client.get('/v1/watches').json()['watches'][0]['unseen_count'] == 0


def test_empty_results_do_not_notify(watched):
    client, *_ = watched
    create(client)
    watch = client.get('/v1/watches').json()['watches'][0]
    assert send(client, watch, delivery(watch, results=[])).status_code == 200
    assert client.get('/v1/watches').json()['watches'][0]['updates'] == []


def test_cap_delete_failure_and_user_isolation(watched, monkeypatch):
    monkeypatch.setattr('vali_api.exa.time.sleep', lambda delay: None)
    client, store, calls, behavior, app, identity = watched
    for _ in range(3):
        create(client)
    assert client.post('/v1/tasks', json={'task': 'watch for flights'}).status_code == 409
    assert len(monitor_calls(calls)) == 3
    watch = client.get('/v1/watches').json()['watches'][0]
    other = client.post('/v1/users').json()
    token = client.headers['Authorization']
    client.headers['Authorization'] = 'Bearer ' + other['token']
    assert client.get('/v1/watches').json()['watches'] == []
    assert client.delete('/v1/watches/' + watch['id']).status_code == 404
    assert client.post('/v1/watches/' + watch['id'] + '/seen').status_code == 404
    assert client.get('/v1/status').json()['failures'] == []
    create(client)  # Separate user has their own cap.
    client.headers['Authorization'] = token
    behavior['delete'] = 503
    assert client.delete('/v1/watches/' + watch['id']).status_code == 502
    assert len(client.get('/v1/watches').json()['watches']) == 3
    assert client.get('/v1/status').json()['failures'][0]['stage'] == 'watch.delete'
    behavior['delete'] = 404
    assert client.delete('/v1/watches/' + watch['id']).status_code == 200
    create(client)
    del client.headers['Authorization']
    assert client.get('/v1/status').status_code == 401


@pytest.mark.parametrize('code', [401, 402, 403, 404, 408, 429])
def test_unavailable_key_falls_back_locally(watched, code):
    client, store, calls, behavior, *_ = watched
    behavior['create'] = code
    for _ in range(4):
        task = create(client)
        assert task['research']['monitor_stubbed'] is True
        assert 'locally' in task['research']['output']['text']
    assert store.sql('SELECT * FROM watch_slots') == []


def test_ambiguous_create_reserves_paid_slot(watched):
    client, store, calls, behavior, *_ = watched
    behavior['create'] = 503
    for _ in range(3):
        task = create(client)
        assert 'reserved' in task['research']['output']['text']
    assert len(monitor_calls(calls)) == 3  # Never replay a paid create after ambiguous failure.
    watch = client.get('/v1/watches').json()['watches'][0]
    assert client.delete('/v1/watches/' + watch['id']).status_code == 409
    assert len(store.sql('SELECT * FROM watch_slots')) == 3
    assert client.post('/v1/tasks', json={'task': 'watch for flats'}).status_code == 409


def test_sql_slot_cap_across_connections(tmp_path):
    path = str(tmp_path / 'watch.db')
    one, two = SQLiteStore(path), SQLiteStore(path)
    try:
        def reserve(index):
            return (one if index % 2 else two).reserve_watch_slot('user', 'watch_' + str(index))
        with ThreadPoolExecutor(max_workers=8) as pool:
            assert sum(pool.map(reserve, range(12))) == 3
    finally:
        one.close()
        two.close()


@pytest.mark.parametrize('error', [429, 500, 503, 'timeout'])
def test_retry_backoff_and_recovery(error, monkeypatch):
    calls, sleeps = [], []
    monkeypatch.setattr('vali_api.exa.time.sleep', sleeps.append)
    monkeypatch.setattr('vali_api.exa.random.uniform', lambda low, high: 0.1)
    def respond(request):
        calls.append(request)
        if len(calls) < 3:
            if error == 'timeout':
                raise httpx.ReadTimeout('private upstream detail', request=request)
            return httpx.Response(error, json={})
        return httpx.Response(200, json={'results': []})
    exa = ExaClient('fake', transport=httpx.MockTransport(respond))
    try:
        assert exa.search({'query': 'flats'}) == {'results': []}
    finally:
        exa.close()
    assert len(calls) == 3
    assert sleeps == [0.35, 0.6]


@pytest.mark.parametrize('code,expected', [(400, 1), (403, 1), (429, 3), (500, 3)])
def test_retry_exhaustion_and_nonretryable(code, expected, monkeypatch):
    monkeypatch.setattr('vali_api.exa.time.sleep', lambda delay: None)
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(code, json={'error': 'private upstream detail'})
    exa = ExaClient('fake', transport=httpx.MockTransport(respond))
    try:
        with pytest.raises(ExaError) as caught:
            exa.get_run('run')
        assert caught.value.status == code
        assert 'private' not in str(caught.value)
        assert len(calls) == expected
    finally:
        exa.close()


def test_recent_failures_from_tasks_and_poll(watched, monkeypatch):
    monkeypatch.setattr('vali_api.exa.time.sleep', lambda delay: None)
    client, store, calls, behavior, app, identity = watched
    task = store.create_task(identity['user_id'], 'claim', {}, 'claim', {'status': 'running', 'run_id': 'run'})
    assert poll_research_once(task['id'], app) is False
    store.update_execution(task['id'], {'status': 'failed', 'error': 'Browser session failed.'})
    store.update_research(task['id'], {'status': 'failed', 'error': 'Research timed out.'})
    failures = client.get('/v1/status').json()['failures']
    assert {r['stage'] for r in failures} == {'research.poll', 'execution', 'research'}
    assert all(r['task_id'] == task['id'] for r in failures)


@pytest.mark.parametrize('error', [429, 503, 'timeout'])
def test_paid_run_create_is_never_retried(error, monkeypatch):
    calls, sleeps = [], []
    monkeypatch.setattr('vali_api.exa.time.sleep', sleeps.append)

    def respond(request):
        calls.append(request)
        if error == 'timeout':
            raise httpx.ReadTimeout('private detail', request=request)
        return httpx.Response(error, json={})

    exa = ExaClient('fake', transport=httpx.MockTransport(respond))
    try:
        with pytest.raises(ExaError):
            exa.create_run({'query': 'flats'})
        assert len(calls) == 1
        assert sleeps == []
    finally:
        exa.close()


@pytest.mark.parametrize('operation', ['get_run', 'get_events', 'cancel_run', 'contents', 'delete'])
def test_safe_requests_keep_retries(operation, monkeypatch):
    calls = []
    monkeypatch.setattr('vali_api.exa.time.sleep', lambda delay: None)

    def respond(request):
        calls.append(request)
        return httpx.Response(503 if len(calls) < 3 else 200, json={})

    exa = ExaClient('fake', transport=httpx.MockTransport(respond))
    try:
        if operation == 'delete':
            exa.request('DELETE', '/monitors/remote')
        else:
            getattr(exa, operation)(['https://example.com'] if operation == 'contents' else 'run')
        assert len(calls) == 3
    finally:
        exa.close()


@pytest.mark.parametrize('release', ['force', 'expired'])
def test_release_unconfirmed_watch(watched, release):
    client, store, calls, behavior, app, identity = watched
    behavior['create'] = 503
    create(client)
    watch = client.get('/v1/watches').json()['watches'][0]
    url = '/v1/watches/' + watch['id']
    assert client.delete(url).status_code == 409
    other = client.post('/v1/users').json()
    assert client.delete(url + '?force=1', headers={'Authorization': 'Bearer ' + other['token']}).status_code == 404
    if release == 'expired':
        at = (datetime.now(timezone.utc) - timedelta(minutes=10, seconds=1)).isoformat()
        store.sql('UPDATE watches SET created_at=? WHERE id=?', (at, watch['id']))
    else:
        url += '?force=1'
    assert client.delete(url).status_code == 200
    assert store.get_watch(watch['id']) is None
    assert store.sql('SELECT * FROM watch_slots') == []
    assert len(monitor_calls(calls)) == 1


def test_oversized_delivery_rejected_without_reading_body(watched, monkeypatch):
    from starlette.requests import Request
    client, *_ = watched

    async def unexpected_body(self):
        pytest.fail('Oversized delivery body must not be read')

    monkeypatch.setattr(Request, 'body', unexpected_body)
    assert client.post('/webhooks/exa', content=b'', headers={'Content-Length': str(256 * 1024 + 1)}).status_code == 413


def test_delivery_size_boundary(watched):
    client, *_ = watched
    assert client.post('/webhooks/exa', content=b' ' * (256 * 1024)).status_code == 403


@pytest.mark.parametrize('stage', ['research.poll', 'research.events'])
def test_poll_failures_recorded_once(watched, monkeypatch, stage):
    client, store, calls, behavior, app, identity = watched
    task = store.create_task(identity['user_id'], 'claim', {}, 'claim', {'status': 'running', 'run_id': 'run'})

    def get_run(run_id):
        if stage == 'research.poll':
            raise ExaError(503, 'private upstream detail')
        return {'id': run_id, 'status': 'running'}

    def get_events(run_id):
        raise ExaError(503, 'private upstream detail')

    monkeypatch.setattr(app.state.exa, 'get_run', get_run)
    monkeypatch.setattr(app.state.exa, 'get_events', get_events)
    for _ in range(4):
        assert poll_research_once(task['id'], app) is False
    failures = store.recent_failures(identity['user_id'])
    assert len(failures) == 1
    assert failures[0]['stage'] == stage
    assert 'private' not in failures[0]['error']


def test_terminal_failures_are_fixed_and_deduplicated(watched):
    client, store, calls, behavior, app, identity = watched
    task = store.create_task(identity['user_id'], 'claim', {}, 'claim', {'status': 'running'})
    for _ in range(4):
        store.update_execution(task['id'], {'status': 'failed', 'error': 'private browser detail'})
        store.patch_execution(task['id'], {'usage': {'steps': 1}})
        store.update_research(task['id'], {'status': 'failed', 'error': 'private upstream detail'})
    failures = store.recent_failures(identity['user_id'])
    assert {f['stage']: f['error'] for f in failures} == {
        'research': 'Research failed.', 'execution': 'Execution failed.'}
    assert len(failures) == 2


def test_failure_retention_on_insert(watched):
    client, store, calls, behavior, app, identity = watched
    task = store.create_task(identity['user_id'], 'claim', {}, 'claim', {'status': 'running'})
    old = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
    recent = (datetime.now(timezone.utc) - timedelta(days=6)).isoformat()
    store.sql('INSERT INTO failures VALUES(?,?,?,?,?)', ('old', task['id'], 'research.poll', 'Old failure.', old))
    store.sql('INSERT INTO failures VALUES(?,?,?,?,?)', ('recent', task['id'], 'execution', 'Execution failed.', recent))
    store.record_failure(task['id'], 'research.poll', 'private upstream detail')
    failures = store.recent_failures(identity['user_id'])
    assert len(failures) == 2
    assert all(f['at'] != old for f in failures)
    assert any(f['at'] == recent for f in failures)
    assert next(f for f in failures if f['stage'] == 'research.poll')['error'] == 'Research service is temporarily unavailable.'


def test_failure_deduplication_across_connections(tmp_path):
    path = str(tmp_path / 'failures.db')
    one, two = SQLiteStore(path), SQLiteStore(path)
    try:
        def record(index):
            (one if index % 2 else two).record_failure('task', 'execution', 'private detail')
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(record, range(20)))
        assert len(one.sql('SELECT * FROM failures')) == 1
    finally:
        one.close()
        two.close()


@pytest.mark.parametrize('secret', [None, ''])
@pytest.mark.parametrize('delete_status', [200, 404, 503])
def test_missing_secret_cleans_up_and_fails(watched, monkeypatch, secret, delete_status):
    monkeypatch.setattr('vali_api.exa.time.sleep', lambda delay: None)
    client, store, calls, behavior, app, identity = watched
    behavior.update(secret=secret, delete=delete_status)
    response = client.post('/v1/tasks', json={'task': 'watch for flats'})
    assert response.status_code == 409
    task = store.list_tasks(identity['user_id'])[0]
    assert task['research']['status'] == 'failed'
    assert calls[0].method == 'POST'
    assert all(r.method == 'DELETE' and r.url.path == '/monitors/remote_1' for r in calls[1:])
    assert len(calls) == (4 if delete_status == 503 else 2)
    watch = store.get_watch(client.get('/v1/watches').json()['watches'][0]['id'])
    if delete_status == 503:
        assert watch['exa_monitor_id'] == 'remote_1'
        assert len(store.sql('SELECT * FROM watch_slots')) == 1
        behavior['delete'] = 200
        assert client.delete('/v1/watches/' + watch['id']).status_code == 200
    else:
        assert watch['exa_monitor_id'] is None
        assert store.sql('SELECT * FROM watch_slots') == []


def link_whatsapp(store, identity, number='358401234567'):
    store.sql('UPDATE users SET wa_number=? WHERE id=?', (number, identity['user_id']))
    return number


def fake_whatsapp(app, error=None):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    app.state.whatsapp_api = SimpleNamespace(send_text=AsyncMock(side_effect=error))
    return app.state.whatsapp_api.send_text


def test_new_update_is_pushed_to_whatsapp_once(watched):
    client, store, calls, behavior, app, identity = watched
    number, send_text = link_whatsapp(store, identity), fake_whatsapp(app)
    create(client)
    watch = client.get('/v1/watches').json()['watches'][0]
    results = [{'title': f'Flat {n}', 'url': f'https://example.com/flat{n}'} for n in range(3)]
    payload = delivery(watch, results=results)
    payload['data']['output']['content'] = 'A two-room flat is listed for 780 eur. It is near the metro. Viewing on Friday.'
    assert send(client, watch, payload).status_code == 200
    assert send(client, watch, payload).status_code == 200  # an Exa retry: same event, no second message
    send_text.assert_awaited_once_with(number, '*New on your watch:* flats in Helsinki\n'
        'A two-room flat is listed for 780 eur. It is near the metro.\n'
        'https://example.com/flat0\nhttps://example.com/flat1')
    assert send(client, watch, delivery(watch, event='event_2')).status_code == 200
    assert send_text.await_count == 2


def test_update_push_uses_errand_language(watched):
    client, store, calls, behavior, app, identity = watched
    link_whatsapp(store, identity)
    send_text = fake_whatsapp(app)
    task = create(client)
    store.sql('UPDATE tasks SET lang=? WHERE id=?', ('fi', task['id']))
    watch = client.get('/v1/watches').json()['watches'][0]
    assert send(client, watch, delivery(watch)).status_code == 200
    assert send_text.await_args.args[1].startswith('*Uutta seurannassasi:* flats in Helsinki\nA flat is available.')


def test_no_push_without_linked_number_and_send_failure_still_200(watched, caplog):
    client, store, calls, behavior, app, identity = watched
    send_text = fake_whatsapp(app)
    create(client)
    watch = client.get('/v1/watches').json()['watches'][0]
    assert send(client, watch, delivery(watch)).status_code == 200
    send_text.assert_not_awaited()
    link_whatsapp(store, identity)
    send_text = fake_whatsapp(app, error=RuntimeError('graph down'))
    assert send(client, watch, delivery(watch, event='event_2')).status_code == 200
    send_text.assert_awaited_once()
    assert 'watch notification failed' in caplog.text and '358401234567' not in caplog.text
    assert client.get('/v1/watches').json()['watches'][0]['unseen_count'] == 2


def test_check_now_triggers_monitor_owner_only(watched):
    client, store, calls, behavior, app, identity = watched
    create(client)
    watch = client.get('/v1/watches').json()['watches'][0]
    response = client.post('/v1/watches/' + watch['id'] + '/check')
    assert response.status_code == 200 and response.json() == {'ok': True, 'triggered': True}
    assert (calls[-1].method, calls[-1].url.path) == ('POST', '/monitors/' + watch['exa_monitor_id'] + '/trigger')
    other = client.post('/v1/users').json()
    assert client.post('/v1/watches/' + watch['id'] + '/check',
                       headers={'Authorization': 'Bearer ' + other['token']}).status_code == 404
    assert client.post('/v1/watches/w_missing/check').status_code == 404
    before = len(calls)
    behavior['create'] = 503  # a paid run: one attempt, never retried
    assert client.post('/v1/watches/' + watch['id'] + '/check').status_code == 502
    assert len(calls) == before + 1
    store.activate_watch(watch['id'], None, '')
    response = client.post('/v1/watches/' + watch['id'] + '/check')
    assert response.status_code == 409 and 'no live Exa monitor' in response.json()['detail']
    assert len(calls) == before + 1


def test_whatsapp_check_now_triggers_newest_live_watch(watched):
    import asyncio
    from vali_wa.webhook import IncomingMessage
    client, store, calls, behavior, app, identity = watched
    number = link_whatsapp(store, identity)
    flow = app.state.whatsapp_flow

    def reply(text):
        return [p['text']['body'] for p in asyncio.run(flow.handle(IncomingMessage(number, 'm_' + text, 'text', text=text)))]
    assert reply('check now') == ['Vali: You have no live watch to check. Send me something to watch first.']
    create(client)
    task = create(client)
    store.sql('UPDATE tasks SET lang=? WHERE id=?', ('fi', task['id']))
    newest = client.get('/v1/watches').json()['watches'][0]
    assert reply('Check now') == ['Tarkistan nyt Exalla. Viestitän tänne, kun se on valmis.']
    assert calls[-1].url.path == '/monitors/' + newest['exa_monitor_id'] + '/trigger'
    store.sql('UPDATE tasks SET lang=? WHERE id=?', ('en', task['id']))
    assert reply('tarkista') == ["Checking now with Exa. I'll message you here when it finishes."]
