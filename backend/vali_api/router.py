"""Errand routing: the optional classifier (Jev) first, keyword rules as the fallback."""
import re

KINDS = {'find': 'search', 'watch': 'monitor', 'check': 'agent', 'claim': 'agent', 'book': 'agent', 'write': 'agent'}
MIN_CONFIDENCE = 0.5
CLOSE_MARGIN = 0.15


def route(task, page=None, classify=None):
    keyword_mode = _keyword_mode(task)
    if classify:
        decided = classify(task, page)
        if decided and decided[0] in KINDS and decided[1] >= MIN_CONFIDENCE:
            # Legacy classifiers may still return only (mode, confidence).
            if len(decided) > 2 and decided[2] < CLOSE_MARGIN and keyword_mode:
                return keyword_mode, KINDS[keyword_mode]
            return decided[0], KINDS[decided[0]]
    mode = keyword_mode or 'check'
    return mode, KINDS[mode]


def _keyword_mode(task):
    """An explicit rule match; the default check route is not tie-break evidence."""
    text = task.lower()
    rules = [
        ('watch', ['watch', 'notify', 'tell me when', 'ilmoita']),
        ('find', ['find', 'cheapest', 'best', 'near', 'open now', 'compare', 'etsi']),
        ('claim', ['claim', 'refund', 'compensation', 'report', 'hae', 'korvaus']),
        ('book', ['book', 'reserve', 'varaa']),
        ('write', ['email', 'write', 'reply', 'draft']),
        ('check', ['check', 'legal', 'allowed', 'what does this mean', 'explain',
                   'does', 'do i', 'can i', 'how do i', 'what is', 'is it', 'is this',
                   'what do i need', 'when should i', 'requirements', 'eligible',
                   'eligibility', 'fee', 'fees', 'my account', 'my letter', 'my contract']),
        ('claim', ['apply']),
    ]
    for mode, words in rules:
        if any(re.search(r'(?<!\w)' + re.escape(w) + r'(?!\w)', text) for w in words):
            return mode
        if mode == 'claim' and re.search(r'\b(?:flight|train)\b.*\b(?:late|delayed|cancelled|canceled)\b', text):
            return 'claim'
        if mode == 'book' and re.search(r'\bbuy\b.*\btickets?\b', text):
            return 'book'
    return None
