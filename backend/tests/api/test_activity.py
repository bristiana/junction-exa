"""The live research trail on research.activity."""
import httpx
from fastapi.testclient import TestClient

from vali_api import activity
from vali_api.app import create_app, poll_research_once
from vali_api.config import Config
from vali_api.exa import ExaClient
from vali_api.store import SQLiteStore

TASK = {'created_at': '2026-11-14T10:00:00+00:00', 'mode': 'check'}
EVENTS = [
    {'event': 'agent_run.created', 'createdAt': '2026-11-14T10:00:01Z', 'data': {'status': 'queued'}},
    {'event': 'agent_run.search_trace', 'createdAt': '2026-11-14T10:00:02.25Z', 'data': {'text': 'Searching DVV move notice'}},
    {'event': 'agent_run.source.added', 'createdAt': '2026-11-14T10:00:03Z', 'data': {'source': {'url': 'https://www.dvv.fi/en/move', 'title': 'DVV'}}},
    {'event': 'agent_run.source.added', 'createdAt': '2026-11-14T10:00:04Z', 'data': {'source': {'url': 'https://www.dvv.fi/en/move'}}},
    {'event': 'agent_run.search_trace', 'createdAt': '2026-11-14T10:00:05Z', 'data': {'text': 'Searching Aino Virtanen aino@example.com +358 40 123 4567'}},
    {'event': 'agent_run.completed', 'createdAt': '2026-11-14T10:00:20Z', 'data': {}},
    'junk', {'event': 'agent_run.search_trace', 'data': None}]


def test_events_become_a_timed_deduplicated_masked_trail():
    trail = activity.from_events(TASK, EVENTS, {'name': 'Aino Virtanen', 'city': 'Helsinki'})
    assert trail == [
        {'t': 0.0, 'kind': 'think', 'text': 'Planning a check errand'},
        {'t': 2.2, 'kind': 'search', 'text': 'DVV move notice'},
        {'t': 3.0, 'kind': 'read', 'text': 'dvv.fi', 'url': 'https://www.dvv.fi/en/move'},
        {'t': 5.0, 'kind': 'search', 'text': '{{name}} {{email}} {{phone}}'},
        {'t': 20.0, 'kind': 'think', 'text': 'Research finished, writing up the answer'}]


def test_scrub_masks_profile_values_and_personal_shapes():
    text = 'Call 040 123 4567, IBAN FI21 1234 5600 0007 85, hetu 131052-308T, in Helsinki on 12.11.2026'
    assert activity.scrub(text, {'city': 'Helsinki'}) == 'Call {{phone}}, IBAN {{account}}, hetu {{id_code}}, in Helsinki on 12.11.2026'


def test_search_trail_lists_the_query_and_each_page():
    trail = activity.from_search(TASK, 'find a sauna', {'results': [{'url': 'https://loylyhelsinki.fi/en'}, {'title': 'no url'}]})
    assert [(e['kind'], e['text']) for e in trail] == [('think', 'Planning a check errand'), ('search', 'find a sauna'),
                                                       ('read', 'loylyhelsinki.fi')]


def test_agent_activity_is_stored_while_running_and_ends_with_done():
    state = {'status': 'running'}
    def respond(request):
        path = request.url.path
        if path == '/agent/runs' and request.method == 'POST':
            return httpx.Response(200, json={'id': 'run_1', 'status': 'queued'})
        if path.endswith('/events'):
            return httpx.Response(200, json={'data': EVENTS[1:3]})
        if path == '/contents':
            return httpx.Response(200, json={'results': [{'id': 'https://www.dvv.fi/en/move', 'text': 'Notify DVV within one week of moving.'}]})
        output = {'text': 'x', 'structured': {'answer': 'Notify DVV within one week of moving.'},
                  'grounding': [{'field': 'structured.answer', 'citations': [{'url': 'https://www.dvv.fi/en/move', 'title': 'DVV'}]}]}
        return httpx.Response(200, json={'id': 'run_1', 'status': state['status'], 'output': output if state['status'] == 'completed' else None})
    store, exa = SQLiteStore(':memory:'), ExaClient('k', transport=httpx.MockTransport(respond))
    application = create_app(Config(sqlite_path=':memory:', anthropic_api_key=''), store, exa, lambda tid: None, lambda *a: None)
    with TestClient(application) as client:
        client.headers['Authorization'] = 'Bearer ' + client.post('/v1/users').json()['token']
        task = client.post('/v1/tasks', json={'task': 'how do I register my move?'}).json()
        assert [e['kind'] for e in task['research']['activity']] == ['think']
        assert poll_research_once(task['id'], application) is False
        running = client.get('/v1/tasks/' + task['id']).json()['research']
        assert [e['kind'] for e in running['activity']] == ['think', 'search', 'read']
        state['status'] = 'completed'
        assert poll_research_once(task['id'], application) is True
        done = client.get('/v1/tasks/' + task['id']).json()['research']
        assert [e['kind'] for e in done['activity']][-2:] == ['think', 'done']
        assert done['activity'][-1]['text'] == 'Answer ready: 1 of 1 sentences quoted from 1 sources'
        assert done['output']['claims'][0]['supported'] is True
    store.close()
