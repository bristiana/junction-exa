"""POST /v1/check with Exa mocked: verdicts, verbatim quotes, the 6 h cache, cost and time budgets."""
import json
import threading
from datetime import date

import httpx
from fastapi.testclient import TestClient

from vali_api import company_check
from vali_api.app import create_app
from vali_api.citations import verbatim
from vali_api.company_check import CheckBody, check_company
from vali_api.config import Config
from vali_api.exa import ExaClient, TTLCache
from vali_api.store import SQLiteStore

TODAY = date(2026, 11, 14)
# Exa returns highlights (excerpts of the page), not full text, for contents={'highlights': True}
YTJ = {'url': 'https://tietopalvelu.ytj.fi/yritys/1234567-8', 'title': 'Kotikoti Oy - YTJ',
       'highlights': ['Kotikoti Oy', 'Business ID 1234567-8. Registered 12.03.2009 in the Trade Register.',
                      'Website: kotikoti.fi']}
HOME = {'url': 'https://www.kotikoti.fi/', 'title': 'Kotikoti Oy | Rental homes in Helsinki',
        'highlights': ['Kotikoti Oy rents homes in Helsinki and Espoo. Founded in 2009, we manage 400 apartments.']}
SCAM = {'url': 'https://www.poliisi.fi/tiedote/vuokrahuijaus', 'title': 'Poliisi varoittaa vuokrahuijauksesta',
        'highlights': ['Poliisi varoittaa: Kotikoti Oy -nimellä on tehty vuokrahuijauksia Facebookissa. '
                       'Älä maksa takuuvuokraa etukäteen.']}


def responder(company=(), risk=(), cost=0.007, fail=None, calls=None, delay=None):
    def respond(request):
        body = json.loads(request.content)
        kind = 'company' if body.get('category') == 'company' else 'risk'
        if calls is not None:
            calls.append(body)
        if delay and kind in delay:
            delay[kind].wait(5)
        if fail == kind:
            return httpx.Response(400, json={'error': 'bad'})
        results = list(company if kind == 'company' else risk)
        return httpx.Response(200, json={'results': results, 'costDollars': {'total': cost}})
    return respond


def exa_with(**kwargs):
    return ExaClient('k', transport=httpx.MockTransport(responder(**kwargs)), cache=TTLCache())


def run(name='Kotikoti Oy', domain=None, city='Helsinki', **kwargs):
    result, complete = check_company(exa_with(**kwargs), CheckBody(name=name, domain=domain, city=city), today=TODAY)
    return result, complete


def all_quotes_verbatim(result, pages):
    texts = {p['url']: '\n'.join(p['highlights']) for p in pages}
    return all(verbatim(f['source']['quote'], texts[f['source']['url']]) for f in result['findings'])


def test_registered_old_company_on_its_own_domain_is_ok():
    result, complete = run(domain='kotikoti.fi', company=[HOME], risk=[YTJ])
    assert complete and result['verdict'] == 'ok'
    texts = [f['text'] for f in result['findings']]
    assert any('Business ID 1234567-8' in t for t in texts)
    assert any('2009' in t and '17 years' in t for t in texts)
    assert any(t.startswith('kotikoti.fi is a site') for t in texts)
    assert all_quotes_verbatim(result, [HOME, YTJ])
    assert set(result) == {'verdict', 'findings'}
    assert set(result['findings'][0]) == {'text', 'source'}
    assert set(result['findings'][0]['source']) == {'url', 'title', 'domain', 'quote'}


def test_scam_warning_means_caution_even_when_registered():
    result, _ = run(company=[HOME], risk=[YTJ, SCAM])
    assert result['verdict'] == 'caution'
    warning = next(f for f in result['findings'] if f['text'].startswith('A page warns about scams'))
    assert warning['source']['domain'] == 'poliisi.fi' and 'vuokrahuijauksia' in warning['source']['quote']
    assert all_quotes_verbatim(result, [HOME, YTJ, SCAM])


def test_a_lookalike_domain_means_caution():
    result, _ = run(domain='kotikoti-vuokra.com', company=[HOME], risk=[YTJ])
    assert result['verdict'] == 'caution'
    assert any('at kotikoti.fi, not at kotikoti-vuokra.com' in f['text'] for f in result['findings'])


def test_a_domain_listed_in_the_register_matches():
    result, _ = run(domain='https://kotikoti.fi/vuokraa', company=[], risk=[YTJ])
    assert result['verdict'] == 'ok'
    assert any('register entry lists the website kotikoti.fi' in f['text'] for f in result['findings'])


def test_nothing_found_is_unknown():
    result, complete = run(name='Nonexistent Vuokra Oy', company=[HOME], risk=[YTJ])
    assert complete and result == {'verdict': 'unknown', 'findings': []}


def test_a_name_only_in_the_title_never_becomes_a_quote():
    bare = {**YTJ, 'highlights': []}
    result, _ = run(company=[], risk=[bare])
    assert result['verdict'] == 'unknown' and result['findings'] == []


def test_a_founding_year_needs_the_company_named_on_the_page():
    other = {**HOME, 'title': 'Another landlord', 'highlights': ['Vuokratalo Oy was founded in 2025.']}
    result, _ = run(company=[other], risk=[])
    assert result['findings'] == []


def test_a_brand_new_company_means_caution():
    young = {**HOME, 'highlights': ['Kotikoti Oy was founded in 2026 to rent homes.']}
    result, _ = run(company=[young], risk=[YTJ])
    assert result['verdict'] == 'caution' and any('less than a year' in f['text'] for f in result['findings'])


def test_one_failed_search_still_answers_but_is_not_complete():
    result, complete = run(company=[HOME], risk=[YTJ], fail='risk')
    assert not complete and result['verdict'] == 'unknown'
    assert any('2009' in f['text'] for f in result['findings'])


def test_search_bodies_follow_exa_guidance():
    calls = []
    run(company=[], risk=[], calls=calls)
    assert len(calls) == 2
    company, risk = (next(c for c in calls if (c.get('category') == 'company') == want) for want in (True, False))
    assert 'Kotikoti Oy' in company['query'] and 'Helsinki' in company['query']
    for body in calls:
        assert body['contents'] == {'highlights': True}  # one content mode, bare highlights
        assert body['type'] == 'auto' and body['objective'] and body['numResults'] == 4
        assert not {'text', 'highlights', 'summary'} & set(body)


def test_cost_per_call_stays_under_two_cents():
    # Exa list prices: $0.005 per search (1-25 results) + $0.001 per page of highlights
    searches = company_check.searches(CheckBody(name='Kotikoti Oy'))
    estimate = sum(0.005 + b['numResults'] * 0.001 for b in searches)
    assert estimate < 0.02


def test_a_slow_search_is_cut_at_the_deadline(monkeypatch):
    monkeypatch.setattr(company_check, 'DEADLINE_SECONDS', 0.2)
    gate = threading.Event()
    exa = exa_with(company=[HOME], risk=[YTJ], delay={'risk': gate})
    try:
        responses, _ = company_check.run_searches(exa, company_check.searches(CheckBody(name='Kotikoti Oy')), deadline=0.2)
    finally:
        gate.set()
    assert responses[0] is not None and responses[1] is None


def make_client(**kwargs):
    calls = []
    exa = ExaClient('k', transport=httpx.MockTransport(responder(calls=calls, **kwargs)), cache=TTLCache())
    application = create_app(Config(sqlite_path=':memory:', anthropic_api_key=''), SQLiteStore(':memory:'), exa,
                             lambda *a: None, lambda *a: None)
    client = TestClient(application)
    client.__enter__()
    client.headers['Authorization'] = 'Bearer ' + client.post('/v1/users').json()['token']
    return client, application, calls


def test_endpoint_needs_a_token():
    client, _, _ = make_client(company=[HOME], risk=[YTJ])
    del client.headers['Authorization']
    assert client.post('/v1/check', json={'name': 'Kotikoti Oy'}).status_code == 401


def test_endpoint_answers_and_caches_for_six_hours():
    client, application, calls = make_client(company=[HOME], risk=[YTJ])
    first = client.post('/v1/check', json={'name': 'Kotikoti Oy', 'domain': 'kotikoti.fi', 'city': 'Helsinki'})
    assert first.status_code == 200 and first.json()['verdict'] == 'ok'
    application.state.exa.cache = TTLCache()  # only the endpoint's own cache can answer now
    again = client.post('/v1/check', json={'name': 'kotikoti  oy', 'domain': 'www.kotikoti.fi', 'city': 'helsinki'})
    assert again.json() == first.json() and len(calls) == 2
    assert application.state.company_check_cache.ttl == 6 * 3600


def test_endpoint_rejects_a_blank_name():
    client, _, _ = make_client()
    assert client.post('/v1/check', json={'name': ''}).status_code == 422


TRUSTPILOT = {'url': 'https://www.trustpilot.com/review/kotikoti.fi', 'title': 'Kotikoti Reviews',
              'highlights': ['Kotikoti Oy are scammers, they kept my whole deposit.']}
OWN_NOTICE = {'url': 'https://www.kotikoti.fi/uutiset/huijausvaroitus', 'title': 'Kotikoti Oy: huijausvaroitus',
              'highlights': ['Kotikoti Oy varoittaa: huijarit tarjoavat asuntoja Kotikoti Oy:n nimissä.']}


def test_a_tenant_review_calling_it_a_scam_is_a_review_not_a_warning():
    result, _ = run(company=[HOME], risk=[YTJ, TRUSTPILOT])
    assert result['verdict'] == 'ok'
    review = next(f for f in result['findings'] if f['source']['domain'] == 'trustpilot.com')
    assert review['text'].startswith('A tenant review') and 'scammers' in review['source']['quote']


def test_reviews_alone_mean_caution():
    result, _ = run(company=[], risk=[TRUSTPILOT])
    assert result['verdict'] == 'caution'


def test_the_company_warning_about_impostors_is_not_a_warning_against_it():
    result, _ = run(domain='kotikoti.fi', company=[HOME], risk=[YTJ, OWN_NOTICE])
    assert result['verdict'] == 'ok'
    assert not any(f['source']['url'] == OWN_NOTICE['url'] and 'warns' in f['text'] for f in result['findings'])


def test_a_business_id_printed_only_in_the_register_address_counts():
    odata = {'url': 'https://odata.fi/fi/yritys/1234567-8', 'title': 'Kotikoti Oy',
             'highlights': ['# Kotikoti Oy 00100 HELSINKI ## Toiminta Kotikoti Oy rents homes.']}
    result, _ = run(company=[], risk=[odata])
    assert result['verdict'] == 'ok'
    assert result['findings'][0]['text'] == 'Listed in a Finnish company register (odata.fi) with Business ID 1234567-8.'
