"""The shared demo link is view only; an account runs at most two cloud browsers; wrong passwords lock per email."""
import pytest
from test_api import api, pair_whatsapp, wa  # noqa: F401  (fixtures)
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


# Rule 1: every write route refuses the shared demo token, except the routes below that are public by design.
WRITE_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}
PUBLIC_WRITES = {
    ('POST', '/v1/users'): 'a visitor on the demo link can still make their own account',
    ('POST', '/v1/auth/login'): 'the demo link page tells viewers to sign in with the demo account',
    ('POST', '/webhooks/whatsapp'): 'Meta calls it, signed with the app secret, never with a bearer token',
    ('POST', '/webhooks/exa'): 'Exa calls it server to server, never with a bearer token',
    ('POST', '/v1/voice/tools/{name}'): 'ElevenLabs calls it with the tool secret and a voice session, never with a bearer token',
}


def write_routes():
    from vali_api.app import create_app
    from vali_api.config import Config
    from vali_api.store import SQLiteStore
    application = create_app(Config(sqlite_path=':memory:'), SQLiteStore(':memory:'), None, lambda tid: None)
    return sorted({(method, route.path) for route in application.routes
                   for method in (getattr(route, 'methods', None) or ()) if method in WRITE_METHODS})


WRITE_ROUTES = write_routes()


def test_public_write_exemptions_are_real_routes():
    assert set(PUBLIC_WRITES) <= set(WRITE_ROUTES), set(PUBLIC_WRITES) - set(WRITE_ROUTES)


@pytest.mark.parametrize('method,path', [r for r in WRITE_ROUTES if r not in PUBLIC_WRITES], ids=' '.join)
def test_demo_token_cannot_write(api, method, path):
    client, application, store, *_ = api
    tid = client.post('/v1/tasks', json={'task': 'find café in Helsinki'}).json()['id']
    application.state.config.readonly_tokens = frozenset({token_hash(client.headers['Authorization'].split()[1])})
    url = path.replace('{tid}', tid).replace('{wid}', 'w_any').replace('{name}', 'any')
    reply = client.request(method, url, json={})
    assert reply.status_code == 403 and 'view only' in reply.json()['detail'], (method, path, reply.status_code, reply.text[:200])


# Rule 2: in the closed demo, Approve sends only when the page's host is a submit host or a subdomain of it.
def awaiting_approval(api, current_url, start_url=None, closed=True):
    from test_api import poll_research_once
    client, application, store, *_ = api
    config = application.state.config
    config.closed, config.submit_hosts = closed, frozenset({'httpbin.org'})
    config.owner_ids = frozenset({store.user_by_token(client.headers['Authorization'].split()[1])['id']})
    tid = client.post('/v1/tasks', json={'task': 'claim refund'}).json()['id']
    poll_research_once(tid, application)
    client.post(f'/v1/tasks/{tid}/execute', json={'action_index': 0, 'profile': {}})
    store.patch_execution(tid, {'status': 'awaiting_approval', 'current_url': current_url, 'start_url': start_url or current_url})
    return tid


@pytest.mark.parametrize('current_url,start_url,sends', [
    ('https://httpbin.org/forms/post', None, True),
    ('https://www.httpbin.org/forms/post', None, True),
    ('https://HTTPBIN.ORG/forms/post', None, True),
    ('https://httpbin.org./forms/post', None, True),  # the root-dot spelling of the same host
    ('https://evilhttpbin.org/forms/post', None, False),  # ends in httpbin.org without a dot boundary
    ('https://httpbin.org.evil.example/forms/post', None, False),
    ('https://httpbin.org@evil.example/forms/post', None, False),  # userinfo is not the host
    ('https://lomakkeet.dvv.fi/form', 'https://httpbin.org/forms/post', False),  # the page it is on now wins
    ('https://httpbin.org/forms/post', 'https://lomakkeet.dvv.fi/form', True),
])
def test_closed_demo_sends_only_on_the_test_host(api, current_url, start_url, sends):
    client, application, store, *_ = api
    tid = awaiting_approval(api, current_url, start_url)
    reply = client.post(f'/v1/tasks/{tid}/approve')
    assert reply.status_code == 200, reply.text
    execution = reply.json()['execution']
    if sends:
        assert execution['approval_decision'] == 'approved', execution
    else:
        assert execution['status'] == 'stopped' and execution['approval_decision'] == 'stopped', execution
        assert 'Nothing reached' in execution['result']


def test_continue_after_the_demo_stop_meets_the_same_guard(api):
    client, application, store, *_ = api
    tid = awaiting_approval(api, 'https://lomakkeet.dvv.fi/form')
    assert client.post(f'/v1/tasks/{tid}/approve').json()['execution']['status'] == 'stopped'
    resumed = client.post(f'/v1/tasks/{tid}/continue', json={})
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()['execution']['approval_decision'] is None  # a new run starts unapproved
    store.patch_execution(tid, {'status': 'awaiting_approval', 'current_url': 'https://lomakkeet.dvv.fi/form'})
    again = client.post(f'/v1/tasks/{tid}/approve').json()['execution']
    assert again['status'] == 'stopped' and again['approval_decision'] == 'stopped'


@pytest.mark.parametrize('how', ['text', 'button'])
def test_whatsapp_approve_meets_the_same_guard(wa, how):
    api, graph, deliver = wa
    store = api[2]
    pair_whatsapp(api, deliver)
    tid = awaiting_approval(api, 'https://lomakkeet.dvv.fi/form')
    if how == 'text':
        deliver('yes', mid='approve')
    else:
        deliver(mid='button', type='interactive', interactive={'button_reply': {'id': f'approve:{tid}', 'title': 'Approve'}})
    execution = store.get_task(tid)['execution']
    assert execution['status'] == 'stopped' and execution['approval_decision'] == 'stopped', execution
    assert 'Nothing reached lomakkeet.dvv.fi' in execution['result']


def test_me_says_demo_only_in_the_closed_demo(api):
    client, application, *_ = api
    assert client.get('/v1/me').json()['demo'] is False
    application.state.config.closed = True
    assert client.get('/v1/me').json()['demo'] is True
