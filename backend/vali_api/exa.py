"""Small synchronous Exa client with injectable HTTP transport."""
import copy
import json
import random
import re
import threading
import time
from collections import OrderedDict

import httpx

from .research import log_research_call

CACHE_TTL_SECONDS = 600
CACHE_MAX_ENTRIES = 256


def _normalize_query(value):
    return re.sub(r'\s+', ' ', value).strip().lower()


def _normalize(value, key=None):
    if isinstance(value, dict):
        return {k: _normalize(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize(v, key) for v in value]
    if isinstance(value, str) and key in ('query', 'q', 'text'):
        return _normalize_query(value)
    return value


def cache_key(path, body):
    return path + '|' + json.dumps(_normalize(body), sort_keys=True, separators=(',', ':'), default=str)


class TTLCache:
    """Bounded in-memory TTL cache; the oldest entry is evicted first."""

    def __init__(self, ttl=CACHE_TTL_SECONDS, max_entries=CACHE_MAX_ENTRIES, clock=time.monotonic):
        self.ttl, self.max_entries, self.clock = ttl, max_entries, clock
        self._items = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            if self.clock() - item[0] >= self.ttl:
                del self._items[key]
                return None
            return copy.deepcopy(item[1])

    def put(self, key, value):
        with self._lock:
            self._items.pop(key, None)
            self._items[key] = (self.clock(), copy.deepcopy(value))
            while len(self._items) > self.max_entries:
                self._items.popitem(last=False)

    def __len__(self):
        return len(self._items)


def zero_cost(response):
    """A cache hit costs nothing; callers read costDollars.total."""
    if isinstance(response, dict) and 'costDollars' in response:
        response['costDollars'] = {'total': 0}
    return response


class ExaError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = self.status_code = status


class ExaClient:
    def __init__(self, api_key, transport=None, cache=None):
        self.cache = cache if cache is not None else TTLCache()
        self.client = httpx.Client(base_url='https://api.exa.ai', headers={'x-api-key': api_key}, transport=transport, timeout=60)

    def request(self, method, path, *, retry=True, **kwargs):
        attempts = 3 if retry else 1
        for attempt in range(attempts):
            try:
                response = self.client.request(method, path, **kwargs)
            except httpx.RequestError as exc:
                if attempt + 1 == attempts:
                    raise ExaError(502, 'Research service unavailable') from exc
            else:
                if response.is_success:
                    if not response.content:
                        return {}
                    try:
                        return response.json()
                    except ValueError as exc:
                        raise ExaError(502, 'Research service returned invalid JSON') from exc
                if response.status_code != 429 and response.status_code < 500:
                    raise ExaError(response.status_code, 'Research service request failed')
                if attempt + 1 == attempts:
                    raise ExaError(response.status_code, 'Research service request failed')
            time.sleep(0.25 * 2 ** attempt + random.uniform(0, 0.25))

    def cached_post(self, path, body, mode):
        started, key = time.monotonic(), cache_key(path, body)
        hit = self.cache.get(key)
        if hit is not None:
            log_research_call(mode, time.monotonic() - started, True)
            return zero_cost(hit)
        response = self.request('POST', path, json=body)
        self.cache.put(key, response)
        log_research_call(mode, time.monotonic() - started, False)
        return response

    def create_run(self, body):
        started = time.monotonic()
        response = self.request('POST', '/agent/runs', retry=False, json=body)
        log_research_call('agent', time.monotonic() - started, False)
        return response

    def get_run(self, run_id):
        return self.request('GET', f'/agent/runs/{run_id}')

    def get_events(self, run_id):
        return self.request('GET', f'/agent/runs/{run_id}/events', params={'limit': 100})

    def cancel_run(self, run_id):
        return self.request('POST', f'/agent/runs/{run_id}/cancel')

    def search(self, body):
        return self.cached_post('/search', body, 'search')

    def contents(self, urls):
        return self.cached_post('/contents', {'urls': urls, 'text': {'maxCharacters': 30000}}, 'contents')

    def close(self):
        self.client.close()
