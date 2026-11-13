import json

import httpx

from hoida_api.jev import JEV_URL, MODES, JevClient
from hoida_api.router import route


def client(handler):
    return JevClient('test-key', transport=httpx.MockTransport(handler))


def answer(a, b):
    return {'model': 'jev-test', 'answers': {
        'mode_a': {'type': 'choice', 'choice': max(a, key=a.get), 'probabilities': a},
        'mode_b': {'type': 'choice', 'choice': max(b, key=b.get), 'probabilities': b}}}


def test_classify_sends_both_orders_and_averages():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=answer({'claim': 0.9, 'check': 0.1}, {'claim': 0.7, 'write': 0.3}))

    assert client(handler).classify('My flight was 4 hours late', {'title': 'Finnair', 'url': 'https://finnair.com'}) == ('claim', 0.8)
    request = seen[0]
    body = json.loads(request.content)
    assert str(request.url) == JEV_URL
    assert request.headers['authorization'] == 'Bearer test-key'
    assert list(body['questions']['mode_a']['criteria']) == list(MODES)
    assert list(body['questions']['mode_b']['criteria']) == list(reversed(MODES))
    assert 'My flight was 4 hours late' in body['state'] and 'Finnair' in body['state']


def test_classify_returns_none_when_jev_fails():
    assert client(lambda request: httpx.Response(500, text='down')).classify('anything') is None
    assert client(lambda request: httpx.Response(200, json={'nope': 1})).classify('anything') is None

    def broken(request):
        raise httpx.ConnectError('offline')
    assert client(broken).classify('anything') is None


def test_route_prefers_a_confident_classifier_and_falls_back_to_keywords():
    assert route('My flight was 4 hours late, what can I get?', {}, classify=lambda t, p: ('claim', 0.9)) == ('claim', 'agent')
    assert route('Find a cafe', {}, classify=lambda t, p: ('watch', 0.3)) == ('find', 'search')
    assert route('Find a cafe', {}, classify=lambda t, p: None) == ('find', 'search')
    assert route('Find a cafe', {}, classify=lambda t, p: ('dance', 0.99)) == ('find', 'search')
