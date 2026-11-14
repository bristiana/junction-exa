"""Public API fixture transports; no tests use the network."""
from datetime import date, datetime

import httpx
import pytest

from vali_api.services.company import search_companies
from vali_api.services.holidays import public_holidays
from vali_api.services.places import search_places


@pytest.fixture
def service_map_transport():
    def respond(request):
        assert request.extensions['timeout']['read'] == 5.0
        if request.url.path.endswith('/search/'):
            assert request.url.params['q'] == 'health'
            assert request.url.params['municipality'] == 'helsinki'
            return httpx.Response(200, json={'results': [
                {'id': 60048, 'object_type': 'unit', 'municipality': 'helsinki'},
                {'id': 2, 'object_type': 'unit', 'municipality': 'espoo'},
                {'id': 3, 'object_type': 'service', 'municipality': 'helsinki'}]})
        assert request.url.path.endswith('/unit/60048/')
        return httpx.Response(200, json={'id': 60048, 'name': {'en': 'Health service'},
                                        'street_address': {'en': 'Test street'},
                                        'connections': [{'section_type': 'OPENING_HOURS', 'name': {'en': 'Fixture hours'}}]})
    return httpx.MockTransport(respond)


def test_places(service_map_transport):
    result = search_places('health', 'Helsinki', transport=service_map_transport)
    assert result['available']
    assert len(result['places']) == 1
    place = result['places'][0]
    assert place['street_address'] == {'en': 'Test street'}
    assert place['opening_hours'] == [{'en': 'Fixture hours'}]


def test_company():
    def respond(request):
        assert request.url.path == '/opendata-ytj-api/v3/companies'
        assert request.url.params['name'] == 'Example'
        return httpx.Response(200, json={'totalResults': 1, 'companies': [{'businessId': {'value': '1234567-8'},
                                                                                    'registeredEntries': []}]})
    result = search_companies('Example', transport=httpx.MockTransport(respond))
    assert result['available'] and result['total'] == 1
    assert result['source'].startswith('PRH')
    assert 'trustworthiness' in result['notice']


@pytest.mark.parametrize('client', [lambda t: search_companies('x', transport=t), lambda t: search_places('x', transport=t)])
@pytest.mark.parametrize('failure', ['timeout', 'status', 'json', 'shape', 'list'])
def test_graceful_failures(client, failure):
    def respond(request):
        if failure == 'timeout':
            raise httpx.ReadTimeout('fixture', request=request)
        if failure == 'status':
            return httpx.Response(503)
        if failure == 'json':
            return httpx.Response(200, text='invalid')
        return httpx.Response(200, json=[] if failure == 'list' else {})
    assert not client(httpx.MockTransport(respond))['available']


def test_missing_unit_details():
    def respond(request):
        if '/search/' in request.url.path:
            return httpx.Response(200, json={'results': [{'id': 1, 'object_type': 'unit', 'municipality': 'helsinki', 'name': {'en': 'Office'}}]})
        return httpx.Response(503)
    place = search_places('office', transport=httpx.MockTransport(respond))['places'][0]
    assert place['name'] == {'en': 'Office'} and not place['details_available']
    assert place['opening_hours'] == []



def test_holidays_reference_2026():
    # Bank of Finland calendar: https://www.suomenpankki.fi/en/money-and-payments/bank-holidays/
    result = public_holidays(2026)
    by_name = {day['name']: day['date'] for day in result['holidays']}
    assert by_name['Good Friday'] == '2026-04-03'
    assert by_name['Easter Sunday'] == '2026-04-05'
    assert by_name['Easter Monday'] == '2026-04-06'
    assert by_name['Ascension Day'] == '2026-05-14'
    assert by_name['Whit Sunday'] == '2026-05-24'
    assert by_name['Midsummer Day'] == '2026-06-20'
    assert by_name['All Saints’ Day'] == '2026-10-31'
    assert len(result['holidays']) == 13
    assert {'date': '2026-12-24', 'name': 'Christmas Eve'} in result['customary_closure_days']


@pytest.mark.parametrize('year', [2024, 2025, 2027, 2038, 2100])
def test_holiday_boundaries(year):
    result = public_holidays(year)
    dates = [date.fromisoformat(d['date']) for d in result['holidays']]
    assert dates == sorted(set(dates))
    assert all(d.year == year for d in dates)
    assert date.fromisoformat(next(d['date'] for d in result['holidays'] if d['name'] == 'Midsummer Day')).weekday() == 5


@pytest.mark.parametrize('year', [1582, 10000])
def test_holiday_year_range(year):
    with pytest.raises(ValueError):
        public_holidays(year)


@pytest.mark.parametrize('day, expected', [(25, 'Christmas Day'), (23, None)])
def test_places_route_holiday_status(day, expected, service_map_transport, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import vali_api.services as services
    import vali_api.services.holidays as holidays

    class Clock:
        @staticmethod
        def now(tz):
            assert str(tz) == 'Europe/Helsinki'
            return datetime(2026, 12, day, tzinfo=tz)

    monkeypatch.setattr(holidays, 'datetime', Clock)
    monkeypatch.setattr(services, 'search_places',
                        lambda q, city: search_places(q, city, transport=service_map_transport))
    app = FastAPI()
    app.include_router(services.create_router())
    with TestClient(app) as client:
        response = client.get('/v1/places', params={'q': 'health'})
    assert response.status_code == 200
    place = response.json()['places'][0]
    assert place['is_public_holiday'] is (expected is not None)
    assert place['public_holiday'] == expected
    assert place['holiday_date'] == f'2026-12-{day}'
    assert bool(place['holiday_notice']) is (expected is not None)
