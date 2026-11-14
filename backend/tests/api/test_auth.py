"""Email and password sign-in: register on the current account, sign in from another browser."""
from test_api import api  # noqa: F401  (fixture)


def test_register_then_login_opens_the_same_account(api):
    client, application, store, calls, polls, browsers, user = api
    assert client.post('/v1/auth/register', json={'email': 'Test@Example.com', 'password': 'longenough1'}).json() == {'email': 'test@example.com'}
    signed = client.post('/v1/auth/login', json={'email': 'test@example.com', 'password': 'longenough1'}, headers={'Authorization': ''})
    assert signed.status_code == 200
    me = client.get('/v1/me', headers={'Authorization': 'Bearer ' + signed.json()['token']}).json()
    assert me['user_id'] == user['user_id'] and me['email'] == 'test@example.com'
    assert client.get('/v1/me').status_code == 200  # the first browser stays signed in


def test_wrong_password_and_taken_email(api):
    client, application, store, calls, polls, browsers, user = api
    client.post('/v1/auth/register', json={'email': 'a@b.fi', 'password': 'longenough1'})
    assert client.post('/v1/auth/login', json={'email': 'a@b.fi', 'password': 'wrongpass1'}).status_code == 401
    other = store.create_user()
    taken = client.post('/v1/auth/register', json={'email': 'a@b.fi', 'password': 'longenough2'}, headers={'Authorization': 'Bearer ' + other['token']})
    assert taken.status_code == 409
    assert client.post('/v1/auth/register', json={'email': 'a@b.fi', 'password': 'short'}).status_code == 422
