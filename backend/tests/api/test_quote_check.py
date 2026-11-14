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
