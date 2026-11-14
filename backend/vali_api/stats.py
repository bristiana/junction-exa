"""Per-user errand counts, Exa usage and spend, summed from stored tasks."""
from collections import Counter
from datetime import datetime, timezone

CHANNELS = ('web', 'extension', 'mac', 'voice', 'letter', 'whatsapp', 'imessage', 'api')


def pick_channel(header=None, body=None, default='extension'):
    """The X-Vali-Channel header wins over the body field; unknown values fall back to the default."""
    for value in (header, body):
        value = (value or '').strip().lower()
        if value in CHANNELS:
            return value
    return default


def channel_of_origin(origin):
    """An errand that names no channel: a browser extension page, a web page, or a plain API call (no Origin)."""
    origin = (origin or '').strip().lower()
    if origin.startswith(('chrome-extension://', 'moz-extension://', 'safari-web-extension://')):
        return 'extension'
    return 'web' if origin.startswith(('https://', 'http://')) else 'api'


def exa_usage(task):
    """Searches and pages read: from the live trail when present, else from the citations; plus browser lookups."""
    research = task.get('research') or {}
    trail = research.get('activity') or []
    if trail:
        searches = sum(e.get('kind') == 'search' for e in trail)
        pages = sum(e.get('kind') == 'read' for e in trail)
    else:
        grounding = (research.get('output') or {}).get('grounding') or []
        pages = len({c.get('url') for g in grounding for c in g.get('citations') or [] if c.get('url')})
        searches = int(research.get('kind') == 'search')
    for call in ((task.get('execution') or {}).get('exa') or []):
        searches += call.get('kind') == 'search'
        pages += call.get('kind') == 'read'
    return searches, pages


def task_cost(task):
    research_cost = float((task.get('research') or {}).get('cost') or 0)
    lookups = (task.get('execution') or {}).get('exa') or []
    return research_cost + sum(float(c.get('cost_usd') or 0) for c in lookups)


def summarize(tasks, today=None):
    today = today or datetime.now(timezone.utc).date().isoformat()
    usage = [exa_usage(t) for t in tasks]
    todays = [t for t in tasks if str(t.get('created_at', '')) >= today]
    return {
        'total': len(tasks),
        'by_status': dict(Counter((t.get('research') or {}).get('status', 'queued') for t in tasks)),
        'by_channel': dict(Counter(t.get('source') or 'extension' for t in tasks)),
        'exa': {'searches': sum(s for s, _ in usage), 'pages_read': sum(p for _, p in usage)},
        'cost_usd': round(sum(task_cost(t) for t in tasks), 4),
        'today': {'errands': len(todays), 'cost_usd': round(sum(task_cost(t) for t in todays), 4)},
    }
