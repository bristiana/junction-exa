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


def test_demo_link_sees_emails_masked(api):
    client, application, store, calls, polls, browsers, user = api
    tid = client.post('/v1/tasks', json={'task': 'book a sauna for mia.virtanen@example.fi'}).json()['id']
    assert 'mia.virtanen@example.fi' in client.get(f'/v1/tasks/{tid}').text
    application.state.config.readonly_tokens = frozenset({token_hash(client.headers['Authorization'].split()[1])})
    seen = client.get(f'/v1/tasks/{tid}')
    assert seen.status_code == 200 and 'mia.virtanen@' not in seen.text and 'm•••@example.fi' in seen.json()['task']


def test_browser_runs_need_budget_and_large_bodies_are_refused(api):
    client, application, store, calls, polls, browsers, user = api
    tid = client.post('/v1/tasks', json={'task': 'find café in Helsinki'}).json()['id']
    application.state.config.daily_cap_usd = 0
    assert client.post(f'/v1/tasks/{tid}/execute', json={}).status_code == 429
    application.state.config.owner_ids = frozenset({user['user_id']})
    assert client.post(f'/v1/tasks/{tid}/execute', json={}).status_code == 200  # the presenter is never capped
    assert client.post('/v1/tasks', json={'task': 'x' * 1_100_000}).status_code == 413


def test_closed_for_judging_only_the_demo_account_writes(api):
    client, application, store, calls, polls, browsers, user = api
    config = application.state.config
    other = client.post('/v1/users').json()
    config.closed, config.owner_ids = True, frozenset({user['user_id']})
    for path in ('/v1/users', '/v1/pair'):
        assert client.post(path).status_code == 403
    assert client.post('/v1/auth/register', json={'email': 'a@example.com', 'password': 'longpassword1'}).status_code == 403
    assert client.post('/v1/tasks', json={'task': 'find café for mia@example.fi'}).status_code == 200  # the demo account
    assert 'mia@' not in client.get('/v1/tasks').text  # its emails are masked for whoever signs in
    client.headers['Authorization'] = 'Bearer ' + other['token']
    reply = client.post('/v1/tasks', json={'task': 'find café'})
    assert reply.status_code == 403 and 'account you were given' in reply.json()['detail']



def test_closed_demo_never_sends_a_real_form(api):
    """In the closed demo, Approve sends only on the test host; anywhere else Vali stops before the submit."""
    from test_api import poll_research_once
    client, application, store, *_ , user = api
    application.state.config.closed = True
    application.state.config.owner_ids = frozenset({store.user_by_token(client.headers['Authorization'].split()[1])['id']})
    application.state.config.submit_hosts = frozenset({'httpbin.org'})
    task = client.post('/v1/tasks', json={'task': 'claim refund'}).json()
    url = '/v1/tasks/' + task['id']
    poll_research_once(task['id'], application)
    client.post(url + '/execute', json={'action_index': 0, 'profile': {}})
    store.patch_execution(task['id'], {'status': 'awaiting_approval', 'current_url': 'https://lomakkeet.dvv.fi/form'})
    reply = client.post(url + '/approve'); assert reply.status_code == 200, reply.text
    stopped = reply.json()['execution']
    assert stopped['status'] == 'stopped' and 'Nothing reached lomakkeet.dvv.fi' in stopped['result']
    other = client.post('/v1/tasks', json={'task': 'claim another refund'}).json()['id']
    poll_research_once(other, application)
    client.post(f'/v1/tasks/{other}/execute', json={'action_index': 0, 'profile': {}})
    store.patch_execution(other, {'status': 'awaiting_approval', 'current_url': 'https://httpbin.org/forms/post'})
    again = client.post(f'/v1/tasks/{other}/approve'); assert again.status_code == 200, again.text
    assert again.json()['execution']['approval_decision'] == 'approved'
