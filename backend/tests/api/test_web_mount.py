"""The web page is served at / without shadowing any API route."""
import httpx
from fastapi.testclient import TestClient

from vali_api.app import create_app
from vali_api.config import Config
from vali_api.exa import ExaClient
from vali_api.store import SQLiteStore


def test_web_page_and_api_routes_coexist():
    store = SQLiteStore(':memory:')
    exa = ExaClient('fake-key', transport=httpx.MockTransport(lambda request: httpx.Response(404)))
    application = create_app(Config(sqlite_path=':memory:'), store, exa, lambda tid: None, lambda *args: None)
    with TestClient(application) as client:
        page = client.get('/')
        assert page.status_code == 200 and page.headers['content-type'].startswith('text/html')
        assert 'Hand Vali your first errand' in page.text
        assert client.get('/app.js').headers['content-type'].startswith('text/javascript')
        assert client.get('/health').json()['ok'] is True
        assert client.get('/v1/tasks').status_code == 401
        token = client.post('/v1/users').json()['token']
        listed = client.get('/v1/tasks', headers={'Authorization': 'Bearer ' + token})
        assert listed.headers['content-type'] == 'application/json' and listed.json() == {'tasks': []}
        assert client.get('/webhooks/whatsapp').status_code == 403
    store.close()
    exa.close()


def test_web_files_are_never_served_from_cache():
    """A deploy must reach the browser at once, even when a file keeps its size."""
    store = SQLiteStore(':memory:')
    exa = ExaClient('fake-key', transport=httpx.MockTransport(lambda request: httpx.Response(404)))
    application = create_app(Config(sqlite_path=':memory:'), store, exa, lambda tid: None, lambda *args: None)
    with TestClient(application) as client:
        first = client.get('/app.js')
        assert first.headers['cache-control'] == 'no-store'
        again = client.get('/app.js', headers={'If-None-Match': first.headers.get('etag', '*')})
        assert again.status_code == 200 and again.text == first.text
    store.close()
    exa.close()
