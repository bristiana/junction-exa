"""Errand routing: the optional classifier (Jev) first, keyword rules as the fallback."""
import re

KINDS = {'find': 'search', 'watch': 'monitor', 'check': 'agent', 'claim': 'agent', 'book': 'agent', 'write': 'agent'}
MIN_CONFIDENCE = 0.5


def route(task, page=None, classify=None):
    if classify:
        decided = classify(task, page)
        if decided and decided[0] in KINDS and decided[1] >= MIN_CONFIDENCE:
            return decided[0], KINDS[decided[0]]
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
    return 'check', 'agent'
