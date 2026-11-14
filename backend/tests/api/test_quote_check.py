"""The quote check runs in the poller, is claimed once, and never leaves a task running."""
from datetime import datetime, timedelta, timezone

import httpx
from fastapi.testclient import TestClient

from vali_api.app import create_app, poll_research_once
from vali_api.config import Config
from vali_api.exa import ExaClient
from vali_api.store import SQLiteStore

SEARCH = {'output': {'content': {'answer': 'Sauna A is open.', 'options': []},
                     'grounding': [{'field': 'answer', 'citations': [{'url': 'https://sauna.fi'}]}]},
          'results': [{'url': 'https://sauna.fi'}], 'costDollars': {'total': 0.01}}


def make(llm=None):
    polls = []
    def respond(request):
        if request.url.path == '/contents':
            return httpx.Response(200, json={'results': [{'id': 'https://sauna.fi', 'text': 'Sauna A is open daily.'}]})
        return httpx.Response(200, json=SEARCH)
    store, exa = SQLiteStore(':memory:'), ExaClient('k', transport=httpx.MockTransport(respond))
    application = create_app(Config(sqlite_path=':memory:', anthropic_api_key=''), store, exa, polls.append, lambda *a: None, llm=llm)
    client = TestClient(application)
    client.__enter__()
    client.headers['Authorization'] = 'Bearer ' + client.post('/v1/users').json()['token']
    return client, application, store, polls


def test_find_answers_at_once_and_quotes_follow_in_the_poller():
    client, application, store, polls = make()
    task = client.post('/v1/tasks', json={'task': 'find a sauna in Helsinki'}).json()
    research = task['research']
    assert research['status'] == 'running' and research['quoting'] == 'pending' and polls == [task['id']]
    assert research['output']['structured']['answer'] == 'Sauna A is open.' and 'claims' not in research['output']
    assert research['activity'][-1]['text'] == 'Checking 1 cited pages for exact quotes'
    assert poll_research_once(task['id'], application) is True
    done = store.get_task(task['id'])['research']
    assert done['status'] == 'completed' and 'quoting' not in done and done['output']['claims']
    assert done['activity'][-1]['kind'] == 'done'


def test_a_failing_quote_check_still_completes_with_support_unknown():
    client, application, store, _ = make(llm=lambda *a: 1 / 0)
    task = client.post('/v1/tasks', json={'task': 'find a sauna in Helsinki'}).json()
    assert poll_research_once(task['id'], application) is True
    done = store.get_task(task['id'])['research']
    assert done['status'] == 'completed'
    assert done['output']['claims'] == [{'text': 'Sauna A is open.', 'sources': [], 'supported': None}]
    assert done['output']['sources'][0]['url'] == 'https://sauna.fi'


def test_a_claimed_check_is_left_alone_until_it_goes_stale():
    client, application, store, _ = make()
    task = client.post('/v1/tasks', json={'task': 'find a sauna in Helsinki'}).json()
    research = {**store.get_task(task['id'])['research'], 'quoting': datetime.now(timezone.utc).isoformat()}
    store.update_research(task['id'], research)
    assert poll_research_once(task['id'], application) is False
    assert store.get_task(task['id'])['research']['status'] == 'running'
    stale = {**research, 'quoting': (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()}
    store.update_research(task['id'], stale)
    assert poll_research_once(task['id'], application) is True
    assert store.get_task(task['id'])['research']['status'] == 'completed'


def test_the_same_question_reuses_recent_research_at_no_cost():
    client, application, store, polls = make()
    first = client.post('/v1/tasks', json={'task': 'find a sauna in Helsinki'}).json()
    poll_research_once(first['id'], application)
    again = client.post('/v1/tasks', json={'task': '  Find a SAUNA in   Helsinki '}).json()
    research = again['research']
    assert research['status'] == 'completed' and research['cost'] == 0 and research['reused_from']
    assert research['output']['claims'] == store.get_task(first['id'])['research']['output']['claims']
    assert [e['kind'] for e in research['activity']] == ['think', 'think', 'done'] and polls == [first['id']]
    other = client.post('/v1/tasks', json={'task': 'find a sauna in Helsinki', 'page': {'url': 'https://x.fi'}}).json()
    assert other['research']['status'] == 'running'  # page context is never reused
    for body in [{'task': 'find a sauna in Helsinki', 'effort': 'high'}, {'task': 'find a sauna in Helsinki open now'}]:
        assert client.post('/v1/tasks', json=body).json()['research']['status'] == 'running'  # other effort, live facts
    # Another account never gets this account's research or trail.
    client.headers['Authorization'] = 'Bearer ' + client.post('/v1/users').json()['token']
    stranger = client.post('/v1/tasks', json={'task': 'find a sauna in Helsinki'}).json()['research']
    assert stranger['status'] == 'running' and 'reused_from' not in stranger


def test_a_stalled_quote_check_restarts_on_the_next_poll():
    client, application, store, polls = make()
    task = client.post('/v1/tasks', json={'task': 'find a sauna in Helsinki'}).json()
    assert client.get('/v1/tasks/' + task['id']).status_code == 200 and polls == [task['id']]
    stale = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    store.sql('UPDATE tasks SET updated_at=? WHERE id=?', (stale, task['id']))
    client.get('/v1/tasks/' + task['id'])
    assert polls == [task['id'], task['id']]
