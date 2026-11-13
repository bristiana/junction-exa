"""Deterministic errand routing before the optional classifier hook."""
import re


def route(task, page=None):
    text = task.lower()
    rules = [
        ('watch', 'monitor', ['watch', 'notify', 'tell me when', 'ilmoita']),
        ('find', 'search', ['find', 'cheapest', 'best', 'near', 'open now', 'compare', 'etsi']),
        ('claim', 'agent', ['claim', 'refund', 'compensation', 'apply', 'hae', 'korvaus']),
        ('book', 'agent', ['book', 'reserve', 'varaa']),
        ('write', 'agent', ['email', 'write', 'reply', 'draft']),
        ('check', 'agent', ['legal', 'allowed', 'what does this mean', 'explain']),
    ]
    for mode, kind, words in rules:
        if any(re.search(r'(?<!\w)' + re.escape(w) + r'(?!\w)', text) for w in words):
            return mode, kind
    if (page or {}).get('selection'):
        return 'check', 'agent'
    # Optional small classifier hook belongs here when no rule matches.
    return 'check', 'agent'
