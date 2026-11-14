"""Ask early: research.question while research runs, and the answer feeding a follow-up pass."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from vali_api.app import create_app, poll_research_once
from vali_api.config import Config
from vali_api.exa import ExaClient
from vali_api.questions import early_question, missing, with_answer
from vali_api.store import SQLiteStore


@pytest.mark.parametrize('task,mode,gaps', [
    ('book a public sauna in Helsinki for a group', 'book', ['group', 'when']),
    ('book a table for 6 in Helsinki friday night', 'book', []),
    ('book a sauna', 'book', ['city', 'when']),
    ('find a dentist in Tampere', 'find', []),
    ('find a cheap gym', 'find', ['city']),
    ('plan a party for 15 people in Espoo', 'find', []),
    ('is a 10% rent increase legal in Finland', 'check', []),
])
def test_missing_details(task, mode, gaps):
    assert missing(task, mode) == gaps


def test_question_shape_and_profile_city():
    assert early_question('book a sauna tomorrow', 'book') == {
        'text': 'Which city?', 'options': ['Helsinki', 'Espoo', 'Tampere', 'Turku'], 'answer': None}
    assert early_question('book a sauna tomorrow', 'book', {'city': 'Oulu'}) is None
    assert with_answer(' book a sauna ', {'text': 'When?'}, ' Today ') == 'book a sauna\n\nThe user answered "When?": Today'


@pytest.fixture
def api():
    calls, polls, state = [], [], {'run': 0, 'status': 'running'}
    def respond(request):
        body = json.loads(request.content) if request.content else None
        calls.append((request.method, request.url.path, body))
        path = request.url.path
        if path == '/search':
            return httpx.Response(200, json={'output': {'content': {'answer': 'Sauna A.', 'options': []}}, 'costDollars': {'total': 0.01}})
        if path.endswith('/cancel'):
            return httpx.Response(200, json={'status': 'cancelled'})
        if path == '/agent/runs':
            state['run'] += 1
            return httpx.Response(200, json={'id': f"run_{state['run']}", 'status': 'queued'})
        if path.endswith('/events'):
            return httpx.Response(200, json={'data': [{'event': 'agent_run.search_trace', 'createdAt': '2030-01-01T00:00:00Z',
                                                       'data': {'text': 'Searching ' + path.split('/')[3]}}]})
        if path == '/contents':
            return httpx.Response(200, json={'results': []})
        output = {'text': 'x', 'structured': {'answer': 'Done.'}, 'grounding': []}
        return httpx.Response(200, json={'id': path.split('/')[3], 'status': state['status'], 'costDollars': {'total': 0.02},
                                         'output': output if state['status'] == 'completed' else None})
    store, exa = SQLiteStore(':memory:'), ExaClient('k', transport=httpx.MockTransport(respond))
    def spawn_poller(tid):
        if store.get_task(tid)['research']['kind'] == 'search':
            poll_research_once(tid, application)
        else:
            polls.append(tid)
    application = create_app(Config(sqlite_path=':memory:', anthropic_api_key=''), store, exa, spawn_poller, lambda *a: None)
    with TestClient(application) as client:
        client.headers['Authorization'] = 'Bearer ' + client.post('/v1/users').json()['token']
        yield client, application, calls, polls, state
    store.close()


def test_question_shows_while_running_and_the_answer_restarts_the_run(api):
    client, application, calls, polls, state = api
    task = client.post('/v1/tasks', json={'task': 'book a public sauna in Helsinki for a group'}).json()
    assert task['research']['question']['text'] == 'How many people?' and task['research']['status'] == 'queued'
    poll_research_once(task['id'], application)
    assert client.get('/v1/tasks/' + task['id']).json()['research']['question']['answer'] is None
    refined = client.post(f"/v1/tasks/{task['id']}/messages", json={'text': '6-10'}).json()['research']
    assert ('POST', '/agent/runs/run_1/cancel', None) in calls
    run = [c for c in calls if c[1] == '/agent/runs'][-1][2]
    assert 'The user answered "How many people?": 6-10' in run['query'] and 'previousRunId' not in run
    assert refined['run_id'] == 'run_2' and refined['question']['answer'] == '6-10'
    assert refined['activity'][-1]['text'] == 'Got your answer: 6-10. Refining'
    assert polls == [task['id']]  # the running poller follows run_2
    state['status'] = 'completed'
    assert poll_research_once(task['id'], application) is True
    done = client.get('/v1/tasks/' + task['id']).json()['research']
    kinds = [(e['kind'], e['text']) for e in done['activity']]
    assert ('search', 'run_1') in kinds and ('search', 'run_2') in kinds and kinds[-1][0] == 'done'
    assert done['status'] == 'completed' and done['cost'] == 0.04  # the cancelled run's cost still counts
    assert client.post(f"/v1/tasks/{task['id']}/messages", json={'text': 'again'}).status_code == 409


def test_answer_after_completion_continues_from_the_finished_run(api):
    client, application, calls, polls, state = api
    state['status'] = 'completed'
    task = client.post('/v1/tasks', json={'task': 'book a sauna in Helsinki'}).json()
    assert poll_research_once(task['id'], application) is True
    client.post(f"/v1/tasks/{task['id']}/messages", json={'text': 'Tomorrow'})
    run = [c for c in calls if c[1] == '/agent/runs'][-1][2]
    assert run['previousRunId'] == 'run_1' and polls == [task['id'], task['id']]
    assert poll_research_once(task['id'], application) is True
    assert client.get('/v1/tasks/' + task['id']).json()['research']['cost'] == 0.04


def test_find_answer_reruns_the_search(api):
    client, application, calls, *_ = api
    task = client.post('/v1/tasks', json={'task': 'find a cheap gym'}).json()
    assert task['research']['question']['text'] == 'Which city?' and task['research']['status'] == 'completed'
    refined = client.post(f"/v1/tasks/{task['id']}/messages", json={'text': 'Tampere'}).json()['research']
    searches = [c[2] for c in calls if c[1] == '/search']
    assert len(searches) == 2 and 'The user answered "Which city?": Tampere' in searches[1]['query']
    assert refined['question']['answer'] == 'Tampere' and refined['cost'] == 0.02
