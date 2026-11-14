"""Errand classification with Jev (TypeSafe AI), a fast typed decision model."""
import httpx

JEV_URL = 'https://api.typesafe.ai/v1/systemone'
MODES = {
    'find': 'Find and compare options: places, products, services, prices, opening hours',
    'check': 'Check or explain a document, rule, letter or clause; whether something is legal or correct',
    'claim': 'Claim money or apply for something: compensation, refund, benefit, application form',
    'book': 'Book or reserve a slot, table, appointment, court or ticket',
    'watch': 'Keep watching and notify when something new appears or changes',
    'write': 'Write a message, complaint or email to someone',
}
QUESTION = 'Which kind of errand is this?'


def describe(task, page):
    page = page or {}
    parts = ['A newcomer or student in Finland hands this errand to an assistant: ' + task.strip()[:1500]]
    if page.get('title') or page.get('url'):
        parts.append(f"They are on the page \"{(page.get('title') or '')[:200]}\" ({(page.get('url') or '')[:200]}).")
    if page.get('selection'):
        parts.append('They selected this text: ' + page['selection'][:800])
    return ' '.join(parts)


class JevClient:
    def __init__(self, api_key, transport=None, timeout=3.0):
        self.client = httpx.Client(headers={'Authorization': 'Bearer ' + api_key}, transport=transport, timeout=timeout)

    def classify(self, task, page=None):
        """Return (mode, confidence) or None when Jev is unavailable or answers oddly."""
        # Each choice is asked twice with the options reversed to cancel Jev's first-option bias.
        reversed_modes = dict(reversed(list(MODES.items())))
        body = {'model': 'jev-latest', 'state': describe(task, page), 'questions': {
            'mode_a': {'type': 'choice', 'instructions': QUESTION, 'criteria': MODES},
            'mode_b': {'type': 'choice', 'instructions': QUESTION, 'criteria': reversed_modes}}}
        try:
            response = self.client.post(JEV_URL, json=body)
            answers = response.json().get('answers') if response.is_success else None
        except (httpx.HTTPError, ValueError):
            return None
        if not isinstance(answers, dict):
            return None
        scores = {mode: 0.0 for mode in MODES}
        for key in ('mode_a', 'mode_b'):
            probabilities = (answers.get(key) or {}).get('probabilities') or {}
            for mode in MODES:
                value = probabilities.get(mode)
                scores[mode] += value / 2 if isinstance(value, (int, float)) else 0.0
        mode = max(scores, key=scores.get)
        return (mode, round(scores[mode], 2)) if scores[mode] > 0 else None

    def close(self):
        self.client.close()
