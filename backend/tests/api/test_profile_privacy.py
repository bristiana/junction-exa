"""S1: the profile only travels with an execute call; it is never stored."""
from test_api import api  # noqa: F401  (fixture)
import json

from vali_api.store import SQLiteStore


def test_stored_profiles_are_cleared_once(tmp_path):
    import sqlite3
    path = str(tmp_path / 'vali.db')
    old = sqlite3.connect(path)  # a database from before the change: profiles stored, no migrations table
    old.execute('CREATE TABLE users(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, '
                'profile_json TEXT NOT NULL, wa_number TEXT UNIQUE)')
    old.execute("""INSERT INTO users VALUES('u_1','h','x','{"name": "Aino Virtanen"}',NULL)""")
    old.commit()
    old.close()
    store = SQLiteStore(path)
    assert store.get_user('u_1')['profile_json'] == '{}'
    store.sql('UPDATE users SET profile_json=? WHERE id=?', (json.dumps({'city': 'Oulu'}), 'u_1'))
    store.close()
    store = SQLiteStore(path)  # later starts skip the wipe
    assert store.get_user('u_1')['profile_json'] == '{"city": "Oulu"}'
    store.close()


def test_execute_uses_only_the_profile_it_carries(api):
    client, application, store, calls, polls, browsers, user = api
    client.put('/v1/profile', json={'profile': {'name': 'Aino Virtanen'}})
    task = client.post('/v1/tasks', json={'task': 'find café in Helsinki'}).json()
    assert client.post(f"/v1/tasks/{task['id']}/execute", json={}).status_code == 200
    assert browsers[-1][3] == {}
    store.patch_execution(task['id'], {'status': 'done'})
    client.post(f"/v1/tasks/{task['id']}/execute", json={'profile': {'name': 'Aino Virtanen'}})
    assert browsers[-1][3] == {'name': 'Aino Virtanen'}
    assert 'Aino' not in json.dumps(store.get_task(task['id'])) and 'Aino' not in json.dumps(store.get_user(user['user_id']))


def test_errands_carry_only_the_names_of_saved_details(api):
    client, application, store, calls, polls, browsers, user = api
    kinds = set()
    for text in ['find café in Helsinki', 'Register my new address with DVV and fill the form']:
        task = client.post('/v1/tasks', json={'task': text, 'known_details': ['email', 'name', 'email']}).json()
        kinds.add(task['research']['kind'])
        query = [body for method, path, body in calls if method == 'POST' and body and 'query' in body][-1]['query']
        assert 'The user has saved these details (use placeholders, the values stay on their device): name, email.' in query
        assert task['research']['known_details'] == ['email', 'name']
    assert kinds == {'search', 'agent'}  # both research paths get the hint
    for bad in [['Test Person'], ['test@example.com'], ['language'], ['name'] * 10, 'name']:
        assert client.post('/v1/tasks', json={'task': 'find café', 'known_details': bad}).status_code == 422
