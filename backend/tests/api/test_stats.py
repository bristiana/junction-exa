"""Task channels and GET /v1/stats."""
import httpx
from fastapi.testclient import TestClient

from vali_api.app import create_app
from vali_api.config import Config
from vali_api.exa import ExaClient
from vali_api.stats import exa_usage, pick_channel, summarize
from vali_api.store import SQLiteStore


def test_pick_channel_prefers_header_and_ignores_unknown_values():
    assert pick_channel('Web', 'mac') == 'web'
    assert pick_channel(None, 'mac') == 'mac'
    assert pick_channel('fax', None) == 'extension'
    assert pick_channel(None, None, default='letter') == 'letter'


def test_summarize_counts_status_channel_usage_cost_and_today():
    tasks = [
        {'source': 'web', 'created_at': '2026-11-14T08:00:00+00:00', 'research': {
            'status': 'completed', 'cost': 0.025, 'activity': [{'kind': 'search'}, {'kind': 'read'}, {'kind': 'read'}, {'kind': 'think'}]},
         'execution': {'exa': [{'kind': 'search', 'cost_usd': 0.005}, {'kind': 'read', 'cost_usd': 0.001}]}},
        {'source': 'web', 'created_at': '2026-11-14T09:00:00+00:00', 'research': {'status': 'running', 'cost': None}},
        {'source': 'whatsapp', 'created_at': '2026-11-13T09:00:00+00:00', 'research': {
            'status': 'completed', 'kind': 'search', 'cost': 0.007, 'output': {'grounding': [
                {'citations': [{'url': 'https://a.fi'}, {'url': 'https://b.fi'}]}, {'citations': [{'url': 'https://a.fi'}]}]}}},
    ]
    assert exa_usage(tasks[2]) == (1, 2)
    assert summarize(tasks, today='2026-11-14') == {
        'total': 3, 'by_status': {'completed': 2, 'running': 1}, 'by_channel': {'web': 2, 'whatsapp': 1},
        'exa': {'searches': 3, 'pages_read': 5}, 'cost_usd': 0.038, 'today': {'errands': 2, 'cost_usd': 0.031}}


def test_channel_is_stored_and_stats_are_per_user():
    def respond(request):
        return httpx.Response(200, json={'id': 'run_1', 'status': 'queued', 'results': [], 'costDollars': {'total': 0.01},
                                         'output': {'content': {'answer': 'A.', 'options': []}}})
    store, exa = SQLiteStore(':memory:'), ExaClient('k', transport=httpx.MockTransport(respond))
    application = create_app(Config(sqlite_path=':memory:', anthropic_api_key=''), store, exa, lambda tid: None, lambda *a: None)
    with TestClient(application) as client:
        client.headers['Authorization'] = 'Bearer ' + client.post('/v1/users').json()['token']
        assert client.post('/v1/tasks', json={'task': 'find a café'}).json()['channel'] == 'extension'
        assert client.post('/v1/tasks', json={'task': 'find a café', 'channel': 'mac'}).json()['channel'] == 'mac'
        task = client.post('/v1/tasks', json={'task': 'find a café', 'channel': 'mac'}, headers={'X-Vali-Channel': 'web'}).json()
        assert task['channel'] == task['source'] == 'web'
        stats = client.get('/v1/stats').json()
        assert stats['total'] == 3 and stats['by_channel'] == {'extension': 1, 'mac': 1, 'web': 1}
        assert stats['today']['errands'] == 3 and stats['exa']['searches'] == 3
        client.headers['Authorization'] = 'Bearer ' + client.post('/v1/users').json()['token']
        assert client.get('/v1/stats').json()['total'] == 0
        del client.headers['Authorization']
        assert client.get('/v1/stats').status_code == 401
    store.close()
