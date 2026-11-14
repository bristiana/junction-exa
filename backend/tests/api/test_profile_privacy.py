"""S1: the profile only travels with an execute call; it is never stored."""
from test_api import api  # noqa: F401  (fixture)
import json

from vali_api.store import SQLiteStore


def test_stored_profiles_are_cleared_at_startup(tmp_path):
    path = str(tmp_path / 'vali.db')
    store = SQLiteStore(path)
    uid = store.create_user()['user_id']
    store.sql('UPDATE users SET profile_json=? WHERE id=?', (json.dumps({'name': 'Aino Virtanen'}), uid))
    store.close()
    store = SQLiteStore(path)
    assert store.get_user(uid)['profile_json'] == '{}'
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
