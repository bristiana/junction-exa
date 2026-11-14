"""The live research trail: what Vali searched, read and did, in seconds since the errand started."""
import re
from datetime import datetime, timezone

from .citations import cited_pages, domain_of

MAX_ENTRIES = 80
PERSONAL_PATTERNS = [
    (re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}'), '{{email}}'),
    (re.compile(r'\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b'), '{{account}}'),
    (re.compile(r'\b\d{6}[-+AaBbCcDdEeFfUuVvWwXxY]\d{3}[0-9A-Ya-y]\b'), '{{id_code}}'),
    (re.compile(r'(?<![\w/])(?:\+|0)(?:[ ()-]*\d){8,}(?![\w/])'), '{{phone}}'),  # + or 0, then 8+ digits: not a date or year range
]


def scrub(text):
    """Mask anything shaped like personal data; the user's saved details never reach the server."""
    text = str(text or '')
    for pattern, placeholder in PERSONAL_PATTERNS:
        text = pattern.sub(placeholder, text)
    return text


def _parse(at):
    if isinstance(at, datetime):
        return at
    try:
        return datetime.fromisoformat(str(at).replace('Z', '+00:00'))
    except ValueError:
        return datetime.now(timezone.utc)


def seconds_since(started, at=None):
    at = _parse(at) if at else datetime.now(timezone.utc)
    return max(0.0, round((at - _parse(started)).total_seconds(), 1))


def entry(started, kind, text, url=None, at=None):
    item = {'t': seconds_since(started, at), 'kind': kind, 'text': scrub(text)[:200]}
    if url:
        item['url'] = scrub(url)[:500]
    return item


def opening(task):
    return entry(task['created_at'], 'think', f"Planning a {task['mode']} errand", at=task['created_at'])


def from_events(task, events):
    """The opening line plus one entry per Exa agent search and page, deduplicated, in event order."""
    started, trail, seen = task['created_at'], [opening(task)], set()
    for event in events or []:
        if not isinstance(event, dict) or not isinstance(event.get('data'), dict):
            continue
        name, data, at = str(event.get('event') or ''), event['data'], event.get('createdAt')
        source = data.get('source') if isinstance(data.get('source'), dict) else {}
        if name.endswith('search_trace') and data.get('text'):
            item = entry(started, 'search', re.sub(r'^Searching\s+(?:for\s+)?', '', str(data['text'])), at=at)
        elif name.endswith('source.added') and source.get('url'):
            item = entry(started, 'read', domain_of(source['url']), source['url'], at=at)
        elif name.endswith('completed'):
            item = entry(started, 'think', 'Research finished, writing up the answer', at=at)
        else:
            continue
        key = (item['kind'], item['text'], item.get('url'))
        if key not in seen:
            seen.add(key)
            trail.append(item)
    return trail[:MAX_ENTRIES]


def from_search(task, query, response):
    """The trail of a single Exa search+answer call: the search, then each page it read."""
    started = task['created_at']
    trail = [opening(task), entry(started, 'search', query)]
    for result in (response or {}).get('results') or []:
        if result.get('url'):
            trail.append(entry(started, 'read', domain_of(result['url']), result['url']))
    return trail[:MAX_ENTRIES]


def checking(task, output):
    return entry(task['created_at'], 'think', f'Checking {len(cited_pages(output))} cited pages for exact quotes')


def done(task, output):
    claims, sources = (output or {}).get('claims') or [], (output or {}).get('sources') or []
    claims = [c for c in claims if not c.get('own')]  # "I prepared a draft" is Vali's own line, not a claim to quote
    backed = sum(1 for c in claims if c.get('supported'))
    return entry(task['created_at'], 'done', f'Answer ready: {backed} of {len(claims)} sentences quoted from {len(sources)} sources')
