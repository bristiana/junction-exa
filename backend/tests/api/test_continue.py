"""POST /v1/tasks/{tid}/continue: start a stopped run again, told what it already did."""
import json

from test_api import api  # noqa: F401  (fixture)


def started(client, store):
    task = client.post('/v1/tasks', json={'task': 'find café in Helsinki'}).json()
    tid = task['id']
    assert client.post(f'/v1/tasks/{tid}/execute', json={}).status_code == 200
    return tid


def test_continue_needs_a_finished_run(api):
    client, application, store, calls, polls, browsers, user = api
    task = client.post('/v1/tasks', json={'task': 'find café in Helsinki'}).json()
    assert client.post(f"/v1/tasks/{task['id']}/continue", json={}).status_code == 409  # nothing ran yet
    tid = started(client, store)
    assert client.post(f'/v1/tasks/{tid}/continue', json={}).status_code == 409  # still live


def test_continue_replays_with_the_resume_note_and_answer(api):
    client, application, store, calls, polls, browsers, user = api
    tid = started(client, store)
    store.patch_execution(tid, step={'text': 'Opened the booking page'})
    store.patch_execution(tid, step={'text': 'Asked you: Which email should I book under?'})
    assert client.post(f'/v1/tasks/{tid}/stop').status_code == 200
    reply = client.post(f'/v1/tasks/{tid}/continue', json={'answer': 'use the test email', 'profile': {'email': 'test@example.com'}})
    assert reply.status_code == 200
    execution = reply.json()['execution']
    assert execution['status'] == 'starting' and execution['resumed_from'] == 2 and execution['runs'] == 2
    goal = json.loads(browsers[-1][1])
    assert goal['resume']['earlier_steps'] == ['Opened the booking page', 'Asked you: Which email should I book under?']
    assert goal['resume']['question'] == 'Which email should I book under?'
    assert goal['resume']['answer'] == 'use the test email'
    assert 'Continue from where the earlier run stopped' in goal['resume']['note']
    assert browsers[-1][3] == {'email': 'test@example.com'}
    assert 'test@example.com' not in json.dumps(store.get_task(tid))


def test_continue_is_owner_only(api):
    client, application, store, calls, polls, browsers, user = api
    tid = started(client, store)
    client.post(f'/v1/tasks/{tid}/stop')
    other = client.post('/v1/users').json()
    client.headers['Authorization'] = 'Bearer ' + other['token']
    assert client.post(f'/v1/tasks/{tid}/continue', json={}).status_code == 404
