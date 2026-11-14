"""Offline fixtures for catalog, authenticated routes, and source-restricted research."""
import json
from urllib.parse import urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

from vali_api.app import create_app
from vali_api.config import Config
from vali_api.exa import ExaClient, TTLCache
from vali_api.services import CATALOG, FACTS_TTL_SECONDS, GROUPS, live_facts, official_source
from vali_api.store import SQLiteStore


@pytest.fixture
def research():
    calls = []
    def respond(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={'results': [
            {'url': 'https://migri.fi/en/studying-in-finland', 'title': 'Studies', 'highlights': ['Official quoted requirement.']},
            {'url': 'https://migri.fi.evil.test/fake', 'highlights': ['Reject this.']},
            {'url': 'https://unofficial.test/', 'highlights': ['Reject this too.']},
            {'url': 'https://migri.fi/en/other', 'highlights': None}]})
    exa = ExaClient('fixture', transport=httpx.MockTransport(respond))
    yield exa, calls
    exa.close()


@pytest.fixture
def api(research):
    exa, calls = research
    store = SQLiteStore(':memory:')
    app = create_app(Config(sqlite_path=':memory:'), store=store, exa=exa)
    with TestClient(app) as client:
        token = client.post('/v1/users').json()['token']
        client.headers['Authorization'] = 'Bearer ' + token
        yield client, calls
    store.close()


def test_catalog():
    assert len(CATALOG) == 26
    assert len({e['id'] for e in CATALOG}) == len(CATALOG)
    assert {e['group'] for e in CATALOG} == set(GROUPS)
    for entry in CATALOG:
        assert urlsplit(entry['official_url']).scheme == 'https'
        assert entry['organisation'] and entry['name']
        assert entry['login_needed'] in {'none', 'Finnish bank ID or mobile ID', 'organisation account'}
        assert entry['vali_help'] in {'answer', 'fill in the cloud browser', 'fill in your own tab', 'guide only'}
        assert set(entry['applies_to']['citizenship']) <= {'eu', 'non_eu'}
        assert set(entry['applies_to']['study']) <= {'degree', 'exchange'}
        assert isinstance(entry['unverified'], bool)
        assert '{context}' in entry['exa_query_template']
        assert not {'fee', 'amount', 'deadline', 'opening_hours'} & entry.keys()


@pytest.mark.parametrize('path', ['/v1/services', '/v1/services/residence-permit', '/v1/places?q=dvv', '/v1/company?name=example'])
def test_auth(api, path):
    client, _ = api
    del client.headers['Authorization']
    assert client.get(path).status_code == 401


def test_grouped_catalog_and_detail(api):
    client, calls = api
    groups = client.get('/v1/services').json()['groups']
    assert [g['id'] for g in groups] == list(GROUPS)
    assert sum(len(g['services']) for g in groups) == 26
    for _ in range(2):
        response = client.get('/v1/services/residence-permit')
        assert response.status_code == 200
        detail = response.json()
        assert detail['id'] == 'residence-permit'
        assert detail['live_facts']['facts'] == [{'url': 'https://migri.fi/en/studying-in-finland',
                                                  'title': 'Studies', 'quote': 'Official quoted requirement.'}]
    assert detail['live_facts']['cached'] is True
    assert len(calls) == 1
    assert calls[0]['includeDomains'] == ['migri.fi']
    assert calls[0]['contents'] == {'highlights': True}
    assert client.get('/v1/services/missing').status_code == 404
    assert len(calls) == 1


def test_six_hour_expiry(research):
    exa, calls = research
    clock = [0]
    cache = TTLCache(ttl=FACTS_TTL_SECONDS, clock=lambda: clock[0])
    live_facts(CATALOG[0], exa, cache)
    clock[0] = 21599
    assert live_facts(CATALOG[0], exa, cache)['cached']
    # Also advance the injected Exa client's shorter cache, using the same clock.
    exa.cache = TTLCache(clock=lambda: clock[0])
    clock[0] = 21600
    assert not live_facts(CATALOG[0], exa, cache)['cached']
    assert len(calls) == 2


@pytest.mark.parametrize('payload', [None, [], {'results': None}])
def test_malformed_research_not_cached(payload):
    class Exa:
        def search(self, body):
            return payload
    cache = TTLCache()
    assert not live_facts(CATALOG[0], Exa(), cache)['available']
    assert len(cache) == 0


def test_research_failure_not_cached():
    from vali_api.exa import ExaError
    class Exa:
        def search(self, body):
            raise ExaError(503, 'unavailable')
    cache = TTLCache()
    assert not live_facts(CATALOG[0], Exa(), cache)['available']
    assert len(cache) == 0


def test_public_routes_with_injected_clients(api, monkeypatch):
    import vali_api.services as services
    client, _ = api
    monkeypatch.setattr(services, 'search_places', lambda q, city: {'places': [q, city], 'available': True})
    monkeypatch.setattr(services, 'search_companies', lambda name: {'companies': [name], 'available': True})
    assert client.get('/v1/places', params={'q': 'DVV', 'city': 'Espoo'}).json()['places'] == ['DVV', 'Espoo']
    assert client.get('/v1/company', params={'name': 'HOAS'}).json()['companies'] == ['HOAS']


@pytest.mark.parametrize('path', ['/v1/places', '/v1/places?q=', '/v1/places?q=%20', '/v1/company', '/v1/company?name=%20'])
def test_query_validation(api, path):
    assert api[0].get(path).status_code == 422


@pytest.mark.parametrize('url', ['https://[broken', 'https://migri.fi.evil.test', 'http://migri.fi', None])
def test_reject_invalid_source_urls(url):
    assert not official_source(url, 'migri.fi')
