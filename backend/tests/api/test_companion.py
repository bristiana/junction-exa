"""POST /v1/companion: a short sourced tip for the page the user is reading."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from vali_api.app import create_app
from vali_api.config import Config
from vali_api.exa import ExaClient
from vali_api.store import SQLiteStore

PAGE = {'url': 'https://Migri.fi/en/working-while-studying/?email=a%40b.fi#top', 'title': 'Working while studying',
        'headings': ['Working hours', 'Residence permit for studies 2025-2026']}
TIP = {'output': {'content': {'useful': True, 'tip': 'You may work 30 hours a week on average.', 'action_label': 'Check my permit',
                              'action_task': 'What do I need to extend my student residence permit?'},
                  'grounding': [{'field': 'tip', 'citations': [{'url': 'https://migri.fi/en/work'}]}]},
       'results': [{'url': 'https://blog.example.com/x', 'title': 'Blog', 'highlights': ['Not cited.']},
                   {'url': 'https://migri.fi/en/work', 'title': 'Working', 'highlights': ['## A student may work on average 30 hours per week.']}],
       'costDollars': {'total': 0.007}}


@pytest.fixture
def api():
    calls, reply = [], {'body': TIP}
    def respond(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json=reply['body'])
    store, exa = SQLiteStore(':memory:'), ExaClient('k', transport=httpx.MockTransport(respond))
    application = create_app(Config(sqlite_path=':memory:', anthropic_api_key=''), store, exa, lambda tid: None, lambda *a: None)
    with TestClient(application) as client:
        client.headers['Authorization'] = 'Bearer ' + client.post('/v1/users').json()['token']
        yield client, calls, reply
    store.close()


def test_tip_with_cited_sources_action_and_six_hour_cache(api):
    client, calls, _ = api
    first = client.post('/v1/companion', json=PAGE).json()
    assert first == {'cached': False, 'tip': {
        'text': 'You may work 30 hours a week on average.',
        'sources': [{'url': 'https://migri.fi/en/work', 'title': 'Working', 'domain': 'migri.fi',
                     'quote': 'A student may work on average 30 hours per week.'}],
        'action': {'label': 'Check my permit', 'task': 'What do I need to extend my student residence permit?'}}}
    query = calls[0]['query']
    assert 'https://migri.fi/en/working-while-studying' in query and 'email' not in query and '#top' not in query
    assert calls[0]['type'] == 'fast' and 'Working hours' in query
    again = client.post('/v1/companion', json={**PAGE, 'url': 'https://migri.fi/en/working-while-studying'}).json()
    assert again['cached'] is True and again['tip'] == first['tip'] and len(calls) == 1


def test_nothing_useful_is_null_and_also_cached(api):
    client, calls, reply = api
    reply['body'] = {'output': {'content': {'useful': False, 'tip': ''}}, 'results': []}
    assert client.post('/v1/companion', json=PAGE).json() == {'tip': None, 'cached': False}
    assert client.post('/v1/companion', json=PAGE).json() == {'tip': None, 'cached': True}
    assert len(calls) == 1


@pytest.mark.parametrize('extra', [
    {'fields': [{'id': 'email', 'value': 'x'}]},
    {'headings': ['Contact aino@example.com']},
    {'selection': 'my phone +358 40 123 4567'},
    {'title': 'hetu 131052-308T'},
    {'url': 'javascript:alert(1)'},
])
def test_personal_data_and_unknown_fields_are_rejected(api, extra):
    client, calls, _ = api
    assert client.post('/v1/companion', json={**PAGE, **extra}).status_code == 422
    assert not calls


def test_needs_auth(api):
    client, *_ = api
    del client.headers['Authorization']
    assert client.post('/v1/companion', json=PAGE).status_code == 401
