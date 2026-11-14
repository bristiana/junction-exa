"""Links that open already filled in: a route question gets the HSL journey planner (or Google Maps) with both ends set.

HSL's planner computes the route only when each end carries coordinates ("Label::lat,lon"); with a bare name it
fills the fields but shows nothing, so places Vali knows go to HSL and any other from/to pair goes to Google Maps,
which finds places by name. Both formats were checked on the live sites.
"""
import re
from urllib.parse import quote, urlencode

# Places newcomers ask about, with the coordinates HSL needs. Longest names first so "Helsinki Airport" wins over "Helsinki".
PLACES = {
    'helsinki airport': ('Helsinki-Vantaa Airport', 60.3172, 24.9633),
    'helsinki-vantaa airport': ('Helsinki-Vantaa Airport', 60.3172, 24.9633),
    'airport': ('Helsinki-Vantaa Airport', 60.3172, 24.9633),
    'lentoasema': ('Helsinki-Vantaa Airport', 60.3172, 24.9633),
    'dipoli': ('Dipoli, Espoo', 60.1848, 24.8326),
    'otaniemi': ('Otaniemi, Espoo', 60.1848, 24.8326),
    'aalto university': ('Aalto-yliopisto (M), Espoo', 60.1845, 24.8237),
    'helsinki central station': ('Helsinki Central Station', 60.1719, 24.9414),
    'central station': ('Helsinki Central Station', 60.1719, 24.9414),
    'rautatientori': ('Helsinki Central Station', 60.1719, 24.9414),
    'kamppi': ('Kamppi, Helsinki', 60.1690, 24.9320),
    'pasila': ('Pasila station, Helsinki', 60.1987, 24.9334),
    'hakaniemi': ('Hakaniemi, Helsinki', 60.1790, 24.9510),
    'kulttuurisauna': ('Kulttuurisauna, Helsinki', 60.1797, 24.9583),
    'allas sea pool': ('Allas Sea Pool, Helsinki', 60.1663, 24.9550),
    'allas': ('Allas Sea Pool, Helsinki', 60.1663, 24.9550),
    'löyly': ('Löyly, Helsinki', 60.1522, 24.9356),
    'tapiola': ('Tapiola, Espoo', 60.1752, 24.8051),
    'leppävaara': ('Leppävaara, Espoo', 60.2190, 24.8130),
    'espoon keskus': ('Espoon keskus, Espoo', 60.2054, 24.6558),
    'espoo centre': ('Espoon keskus, Espoo', 60.2054, 24.6558),
    'tikkurila': ('Tikkurila station, Vantaa', 60.2925, 25.0440),
}
ROUTE = re.compile(r'\b(get (?:there|to|from)|how (?:do|can) i (?:go|get|travel)|route|directions|public transport|'
                   r'by (?:bus|metro|train|tram)|hsl|journey|commute)\b', re.I)
FROM_TO = re.compile(r'\bfrom\s+(?:the\s+)?(.{3,60}?)\s+to\s+(?:the\s+)?(.{3,60}?)(?=\s+(?:by|with|on|at|in|via|using)\b|[?.!,]|$)', re.I)
_PLACE_RE = re.compile(r'\b(' + '|'.join(re.escape(k) for k in sorted(PLACES, key=len, reverse=True)) + r')\b', re.I)


def hsl_url(origin, destination):
    end = lambda p: quote(f'{p[0]}::{p[1]},{p[2]}', safe='')
    return f'https://reittiopas.hsl.fi/reitti/{end(origin)}/{end(destination)}?locale=en'


def maps_url(origin, destination):
    return 'https://www.google.com/maps/dir/?' + urlencode(
        {'api': 1, 'origin': origin, 'destination': destination, 'travelmode': 'transit'}, quote_via=quote)


def known_places(text):
    """Known places in the order the errand names them, without repeats of the same spot."""
    found = []
    for match in _PLACE_RE.finditer(text or ''):
        place = PLACES[match.group(1).lower()]
        if not found or found[-1][1:] != place[1:]:
            found.append(place)
    return found


def route_link(text):
    """{'label', 'url'} for a route question with both ends, else None."""
    text = text or ''
    if not ROUTE.search(text):
        return None
    pair = FROM_TO.search(text)
    places = known_places(pair.group(0) if pair else text)
    if len(places) >= 2 and places[0][1:] != places[1][1:]:
        return {'label': 'Route in HSL', 'url': hsl_url(places[0], places[1])}
    if pair:
        return {'label': 'Directions', 'url': maps_url(pair.group(1).strip(), pair.group(2).strip())}
    return None


def prefill_links(task_text, output):
    """Put the filled-in route link first among the actions (kept to 4); other outputs pass through unchanged."""
    structured = (output or {}).get('structured')
    link = route_link(task_text)
    if not link or not isinstance(structured, dict):
        return output
    actions = [a for a in structured.get('actions') or [] if isinstance(a, dict) and a.get('url') != link['url']]
    structured['actions'] = [{'type': 'open_link', 'label': link['label'], 'url': link['url'], 'body': '', 'prefilled': True}] + actions[:3]
    # Grounding points at actions[i]; shift it so each citation stays on its own action.
    for entry in output.get('grounding') or []:
        field = entry.get('field') or ''
        m = re.match(r'^actions\[(\d+)\](.*)$', field)
        if m:
            entry['field'] = f'actions[{int(m.group(1)) + 1}]{m.group(2)}'
    return output
