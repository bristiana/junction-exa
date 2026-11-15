"""The shared demo link is view only; an account runs at most two cloud browsers; wrong passwords lock per email."""
from test_api import api  # noqa: F401  (fixture)
from vali_api.store import token_hash


def test_demo_token_reads_but_cannot_write(api):
    client, application, store, calls, polls, browsers, user = api
    tid = client.post('/v1/tasks', json={'task': 'find café in Helsinki'}).json()['id']
    application.state.config.readonly_tokens = frozenset({token_hash(client.headers['Authorization'].split()[1])})
    assert client.get(f'/v1/tasks/{tid}').status_code == 200
    for method, path, body in [('post', '/v1/tasks', {'task': 'x'}), ('post', f'/v1/tasks/{tid}/stop', None),
                               ('put', '/v1/situation', {'citizenship': 'EU'}),
                               ('post', '/v1/auth/register', {'email': 'a@example.com', 'password': 'longpassword1'})]:
        reply = getattr(client, method)(path, json=body)
        assert reply.status_code == 403 and 'view only' in reply.json()['detail'], path
    assert client.post('/v1/users').status_code == 200  # a visitor can still make their own account


def test_an_account_runs_at_most_two_browsers(api):
    client, application, store, calls, polls, browsers, user = api
    ids = [client.post('/v1/tasks', json={'task': f'find café number {n} in Helsinki'}).json()['id'] for n in range(3)]
    assert [client.post(f'/v1/tasks/{tid}/execute', json={}).status_code for tid in ids] == [200, 200, 429]
    client.post(f'/v1/tasks/{ids[0]}/stop')
    assert client.post(f'/v1/tasks/{ids[2]}/execute', json={}).status_code == 200


def test_wrong_passwords_lock_that_email(api):
    client, application, store, calls, polls, browsers, user = api
    assert client.post('/v1/auth/register', json={'email': 'mia@example.fi', 'password': 'correct horse 1'}).status_code == 200
    codes = [client.post('/v1/auth/login', json={'email': 'mia@example.fi', 'password': 'wrong password!'}).status_code for _ in range(6)]
    assert codes == [401] * 5 + [429]
    assert client.post('/v1/auth/login', json={'email': 'other@example.fi', 'password': 'wrong password!'}).status_code == 401
