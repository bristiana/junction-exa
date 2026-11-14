"""Optional HSL v2 routing; schema reviewed, live routing untested (key required).

https://digitransit.fi/en/developers/apis/1-routing-api/itinerary-planning/
"""
import math
import os

from .http import request_json

URL = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1'
QUERY = '''query($fromLat: Float!, $fromLon: Float!, $toLat: Float!, $toLon: Float!) {
  planConnection(
    origin: {location: {coordinate: {latitude: $fromLat, longitude: $fromLon}}}
    destination: {location: {coordinate: {latitude: $toLat, longitude: $toLon}}}
    first: 3
  ) { edges { node { start end legs { mode distance duration } } } }
}'''


def plan_route(from_lat, from_lon, to_lat, to_lon, *, transport=None):
    key = os.getenv('VALI_DIGITRANSIT_KEY', '')
    if not key:
        return {'enabled': False, 'available': False, 'itineraries': []}
    for value, bound in ((from_lat, 90), (to_lat, 90), (from_lon, 180), (to_lon, 180)):
        if not isinstance(value, (float, int)) or not math.isfinite(value) or abs(value) > bound:
            raise ValueError('Invalid coordinates')
    payload = request_json('POST', URL, transport=transport,
                           headers={'digitransit-subscription-key': key},
                           json={'query': QUERY, 'variables': dict(fromLat=from_lat, fromLon=from_lon,
                                                                 toLat=to_lat, toLon=to_lon)})
    data = (payload or {}).get('data')
    plan = data.get('planConnection') if isinstance(data, dict) else None
    edges = plan.get('edges') if isinstance(plan, dict) else None
    valid = not (payload or {}).get('errors') and isinstance(edges, list)
    return {'enabled': True, 'available': valid,
            'itineraries': [edge['node'] for edge in edges if isinstance(edge, dict) and isinstance(edge.get('node'), dict)] if valid else []}
