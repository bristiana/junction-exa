"""Student service catalog and source-quoted live facts."""
import json
from pathlib import Path
from threading import Lock
from time import monotonic
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Query, Request

from ..exa import ExaError, TTLCache
from .company import search_companies
from .places import search_places

GROUPS = ('before_arrival', 'first_week', 'first_month', 'ongoing')
CATALOG = json.loads(Path(__file__).with_name('catalog.json').read_text())
FACTS_TTL_SECONDS = 6 * 60 * 60
FAILURE_TTL_SECONDS = 60


class FactsCache:
    """Per-application caches and one lock per catalog service."""

    def __init__(self, clock=monotonic):
        self.successes = TTLCache(ttl=FACTS_TTL_SECONDS, clock=clock)
        self.failures = TTLCache(ttl=FAILURE_TTL_SECONDS, clock=clock)
        self.locks = {entry['id']: Lock() for entry in CATALOG}

    def get(self, key):
        return self.successes.get(key) or self.failures.get(key)

    def put(self, key, value):
        cache = self.successes if value['available'] else self.failures
        cache.put(key, value)


def official_source(url, domain):
    if not isinstance(url, str):
        return False
    try:
        parsed = urlsplit(url)
        hostname = parsed.hostname or ''
    except ValueError:
        return False
    return parsed.scheme == 'https' and (hostname == domain or hostname.endswith('.' + domain))


def live_facts(entry, exa, cache):
    """Serialize misses for a service; unrelated services can search concurrently."""
    with cache.locks[entry['id']]:
        return cached_facts(entry, exa, cache)


def cached_facts(entry, exa, cache):
    key = 'services:' + entry['id']
    cached = cache.get(key)
    if cached is not None:
        return {**cached, 'cached': True}
    domain = urlsplit(entry['official_url']).hostname
    try:
        response = exa.search({'query': entry['exa_query_template'].format(context=''),
                               'includeDomains': [domain], 'numResults': 5,
                               'contents': {'highlights': True}})
    except ExaError:
        response = None
    results = response.get('results') if isinstance(response, dict) else None
    if not isinstance(results, list):
        value = {'available': False, 'facts': [], 'cached': False, 'cache_ttl_seconds': FAILURE_TTL_SECONDS}
        cache.put(key, value)
        return value
    facts = []
    for result in results:
        if not isinstance(result, dict) or not official_source(result.get('url'), domain):
            continue
        highlights = result.get('highlights')
        if not isinstance(highlights, list):
            continue
        for quote in highlights:
            if isinstance(quote, str) and quote.strip():
                facts.append({'url': result['url'], 'title': result.get('title') or entry['name'], 'quote': quote})
    value = {'available': True, 'facts': facts, 'cached': False, 'cache_ttl_seconds': FACTS_TTL_SECONDS}
    cache.put(key, value)
    return value


def create_router():
    """Each application gets bounded fact caches and per-service locks."""
    router = APIRouter()
    cache = FactsCache()

    @router.get('/v1/services')
    def services():
        return {'groups': [{'id': group, 'services': [entry for entry in CATALOG if entry['group'] == group]}
                           for group in GROUPS]}

    @router.get('/v1/services/{service_id}')
    def service(service_id: str, request: Request):
        entry = next((entry for entry in CATALOG if entry['id'] == service_id), None)
        if entry is None:
            raise HTTPException(404, 'Service not found')
        return {**entry, 'live_facts': live_facts(entry, request.app.state.exa, cache)}

    @router.get('/v1/places')
    def places(q: str = Query(min_length=1, max_length=200, pattern=r'\S'),
               city: str = Query(default='helsinki', min_length=1, max_length=80, pattern=r'\S')):
        return search_places(q.strip(), city)

    @router.get('/v1/company')
    def company(name: str = Query(min_length=1, max_length=200, pattern=r'\S')):
        return search_companies(name.strip())

    return router
