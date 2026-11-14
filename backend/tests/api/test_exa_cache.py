import json
import logging

import httpx

from vali_api.exa import ExaClient, TTLCache, cache_key


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def make(clock=None, max_entries=256):
    calls = []

    def respond(request):
        calls.append(request.url.path)
        return httpx.Response(200, json={'id': len(calls), 'costDollars': {'total': 0.01}})

    cache = TTLCache(clock=clock or Clock(), max_entries=max_entries)
    return ExaClient('k', transport=httpx.MockTransport(respond), cache=cache), calls


def test_miss_then_hit():
    client, calls = make()
    first = client.search({'query': 'Kela'})
    second = client.search({'query': '  kela '})
    assert len(calls) == 1 and second['id'] == first['id']


def test_different_body_misses():
    client, calls = make()
    client.search({'query': 'a'})
    client.search({'query': 'b'})
    assert len(calls) == 2


def test_key_sorted_and_normalized():
    assert cache_key('/search', {'b': 1, 'query': 'A  B'}) == cache_key('/search', {'query': 'a b', 'b': 1})


def test_expiry():
    clock = Clock()
    client, calls = make(clock)
    client.search({'query': 'x'})
    clock.now = 599
    client.search({'query': 'x'})
    clock.now = 601
    client.search({'query': 'x'})
    assert len(calls) == 2


def test_size_bound():
    client, calls = make(max_entries=2)
    for q in 'abc':
        client.search({'query': q})
    assert len(client.cache) == 2
    client.search({'query': 'a'})
    assert len(calls) == 4


def test_cost_zero_on_hit():
    client, _ = make()
    assert client.search({'query': 'x'})['costDollars']['total'] == 0.01
    assert client.search({'query': 'x'})['costDollars']['total'] == 0


def test_create_run_not_cached():
    client, calls = make()
    client.create_run({'input': 'x'})
    client.create_run({'input': 'x'})
    assert calls == ['/agent/runs'] * 2 and len(client.cache) == 0


def test_log_has_mode_and_no_query(caplog):
    client, _ = make()
    with caplog.at_level(logging.INFO, logger='vali.research'):
        client.search({'query': 'secret thing'})
        client.search({'query': 'secret thing'})
    text = caplog.text
    assert 'cache=miss' in text and 'cache=hit' in text and 'mode=search' in text and 'secret' not in text
