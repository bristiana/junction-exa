"""Recurring search provisioning and signed result delivery.

Contract: https://exa.ai/docs/monitors/quickstart
"""
import hashlib
import hmac
import re
import time
from urllib.parse import quote, urlsplit

from .citations import split_sentences
from .exa import ExaError
from .store import now


_WATCH_VERB = re.compile(r'^\s*(?:please\s+)?(?:keep\s+)?(?:watch(?:ing)?(?:\s+for)?|tell me when|notify me(?:\s+when|\s+about)?|'
                         r'remind me(?:\s+when|\s+about)?|let me know when|alert me(?:\s+when)?|wait for|ilmoita)\s+', re.I)
_TELL_ME = re.compile(r'[\s,]+and\s+(?:tell me|let me know)\s*[.!]?\s*$', re.I)


def watch_criteria(task):
    """What the watch looks for, echoed back to the user: the errand without its 'watch for' verb."""
    criteria = _WATCH_VERB.sub('', task.strip(), count=1).strip()
    criteria = _TELL_ME.sub('', re.sub(r'^to\s+', '', criteria, flags=re.I)).strip()  # 'remind me to X', 'wait for X and tell me'
    return criteria or task.strip()


def watch_confirmation(criteria, message, live, cadence='1d'):
    """What is watched, how often and where it looks: said before any research result."""
    if not live:
        return f'I saved a watch for {criteria}. {message}'
    often = {'1d': 'once a day', '1h': 'once an hour', '1w': 'once a week'}.get(cadence, 'regularly')
    return (f'I will watch for {criteria}. I will search the web for it {often} with Exa and tell you when new '
            'results appear.')


def with_watch(output, criteria, message, live=False):
    """The watch confirmation first, then today's answer; criteria and status after the cited fields (indices kept)."""
    structured = output['structured']
    lead = watch_confirmation(criteria, message, live)
    structured['answer'] = lead + ('\n' + structured['answer'] if structured.get('answer') else '')
    output['text'] = lead + ('\n' + output['text'] if output.get('text') else '')
    output['own'] = split_sentences(lead)  # Vali's own words: the quote check leaves them as written
    structured['key_facts'].append({'label': 'Watching for', 'value': criteria})
    structured['steps'].append({'title': 'Watch active', 'detail': message})
    return output


def create_monitor(config, query, *, exa, watch_id, cadence='1d'):
    if urlsplit(config.public_url).scheme != 'https':
        raise ValueError('VALI_PUBLIC_URL must be a public HTTPS URL')
    # No documented idempotency key exists for this paid resource. Retrying an
    # ambiguous create could leak subscriptions and bypass the three-slot cap.
    return exa.request('POST', '/monitors', retry=False, json={
        'search': {'query': query, 'numResults': 5},
        'trigger': {'type': 'interval', 'period': cadence},
        'metadata': {'watch_id': watch_id},
        'webhook': {'url': config.public_url.rstrip('/') + '/webhooks/exa?w=' + quote(watch_id),
                    'events': ['monitor.run.completed']}})


def provision_watch(config, store, exa, user_id, query, task_id):
    watch = store.create_watch(user_id, query, task_id=task_id)
    if urlsplit(config.public_url).scheme != 'https':
        return watch, 'Watch saved locally. Set VALI_PUBLIC_URL to a public HTTPS URL to enable live updates.'
    if not store.reserve_watch_slot(user_id, watch['id']):
        store.delete_watch(user_id, watch['id'])
        return None, 'You already have three active watches. Remove one before adding another.'
    try:
        result = create_monitor(config, query, exa=exa, watch_id=watch['id'])
    except ExaError as exc:
        if exc.status in {400, 401, 402, 403, 404, 405, 408, 422, 429}:
            store.release_watch_slot(watch['id'])
            store.record_failure(task_id, 'watch.create', 'Recurring searches are unavailable for this key or configuration.')
            return watch, 'Watch saved locally. Recurring searches are unavailable for this Exa key or configuration.'
        # Retain the slot on an ambiguous response: the remote resource may exist.
        store.record_failure(task_id, 'watch.create', 'Recurring search creation could not be confirmed.')
        return watch, 'Watch saved locally. Live setup could not be confirmed; its paid slot is reserved. Check Exa before removing this reserved watch.'
    monitor_id, secret = result.get('id'), result.get('webhookSecret')
    if not isinstance(monitor_id, str) or not monitor_id or not isinstance(secret, str) or not secret:
        if isinstance(monitor_id, str) and monitor_id:
            store.activate_watch(watch['id'], monitor_id, '')
            try:
                delete_monitor(exa, store.get_watch(watch['id']))
            except ExaError:
                store.record_failure(task_id, 'watch.delete', 'Could not remove recurring search. Please retry.')
            else:
                store.activate_watch(watch['id'], None, '')
                store.release_watch_slot(watch['id'])
            store.record_failure(task_id, 'watch.create', 'Recurring search returned incomplete setup details.')
            message = 'Recurring search setup failed because delivery credentials were missing.'
            task = store.get_task(task_id)
            if task:
                store.update_research(task_id, {**task['research'], 'status': 'failed', 'error': message})
            return None, message
        store.record_failure(task_id, 'watch.create', 'Recurring search returned incomplete setup details.')
        return store.get_watch(watch['id']), 'Watch saved locally. Live delivery setup is incomplete; its paid slot is reserved.'
    store.activate_watch(watch['id'], monitor_id, secret)
    return store.get_watch(watch['id']), 'Watch active. I will check daily and notify you of new results.'


def delete_monitor(exa, watch):
    if watch.get('exa_monitor_id'):
        try:
            exa.request('DELETE', '/monitors/' + quote(watch['exa_monitor_id'], safe=''))
        except ExaError as exc:
            if exc.status != 404:
                raise


def trigger_monitor(exa, watch):
    # A run now, on top of the schedule; its results arrive as a normal signed delivery. Paid, so never retried.
    return exa.request('POST', '/monitors/' + quote(watch['exa_monitor_id'], safe='') + '/trigger', retry=False)


def verify_delivery(raw, signature, secret):
    if not secret:
        return False
    try:
        parts = dict(part.strip().split('=', 1) for part in signature.split(','))
        timestamp = parts['t']
        if abs(time.time() - int(timestamp)) > 300:
            return False
        expected = hmac.new(secret.encode(), timestamp.encode() + b'.' + raw, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, parts['v1'])
    except (ValueError, KeyError, TypeError):
        return False


def delivery_update(payload, watch):
    if not isinstance(payload, dict):
        raise ValueError('Expected an object')
    data = payload.get('data')
    if not isinstance(data, dict) or data.get('monitorId') != watch['exa_monitor_id']:
        raise ValueError('Unexpected recurring search ID')
    event_id = payload.get('id')
    if not isinstance(event_id, str) or not event_id:
        raise ValueError('Missing event ID')
    if payload.get('type') != 'monitor.run.completed' or data.get('status') != 'completed':
        return event_id, None
    output = data.get('output') or {}
    if not isinstance(output, dict) or not isinstance(output.get('results', []), list):
        raise ValueError('Invalid output')
    results = [r for r in output.get('results', []) if isinstance(r, dict) and
               isinstance(r.get('url'), str) and urlsplit(r['url']).scheme in {'https', 'http'}]
    if not results:
        return event_id, None
    sources = [{'url': r['url'], 'title': str(r.get('title') or r['url'])[:300]} for r in results[:20]]
    content = output.get('content')
    summary = content if isinstance(content, str) and content.strip() else '; '.join(s['title'] for s in sources)
    return event_id, {'type': 'watch.updates', 'at': now(), 'text': 'new: ' + summary[:1000],
                      'sources': sources, 'results': results[:20]}
