"""Helsinki service map v2; search and unit endpoints verified live.

https://api.hel.fi/servicemap/v2/ -- coverage depends on upstream contributors.
Opening hours may be absent; preserve source connections rather than infer them.
"""
from .http import request_json
from .holidays import today_holiday_status

BASE_URL = 'https://api.hel.fi/servicemap/v2'


def search_places(query, city='helsinki', *, transport=None):
    city = city.strip().lower()
    payload = request_json('GET', BASE_URL + '/search/', transport=transport,
                           params={'q': query, 'type': 'unit', 'municipality': city, 'page_size': 5})
    if payload is None or not isinstance(payload.get('results'), list):
        return {'available': False, 'places': [], 'source_url': BASE_URL}
    holiday_status = today_holiday_status()
    places = []
    for item in payload['results'][:5]:
        if not isinstance(item, dict) or item.get('object_type') != 'unit' or item.get('municipality') != city:
            continue
        unit_id = item.get('id')
        if not isinstance(unit_id, int):
            continue
        detail = request_json('GET', f'{BASE_URL}/unit/{unit_id}/', transport=transport)
        details_available = bool(detail and detail.get('id') == unit_id)
        unit = detail if details_available else item
        hours = [connection.get('name') for connection in (unit.get('connections') or [])
                 if isinstance(connection, dict) and connection.get('section_type') == 'OPENING_HOURS']
        places.append({key: unit.get(key) for key in (
            'id', 'name', 'street_address', 'address_zip', 'municipality', 'location',
            'opening_hours', 'connections', 'www', 'phone')}
            | {**holiday_status, 'opening_hours': unit.get('opening_hours') or hours,
               'source_url': f'{BASE_URL}/unit/{unit_id}/', 'details_available': details_available})
    return {'available': True, 'places': places, 'source_url': BASE_URL}
