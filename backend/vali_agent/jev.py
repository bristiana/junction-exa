"""Jev (TypeSafe AI): fast typed decisions (~0.25 s). Used only to make the guard stricter, never looser.

API: POST https://api.typesafe.ai/v1/systemone {model, state, questions}; questions are
{name: {type: 'noul'|'score'|'choice', instructions, criteria?}}; answers carry `noul` (0..1),
`score`/`probabilities`. English state works best. Choice answers have a first-option bias, so
callers ask twice with reversed order and average.
"""
import os
import re
import httpx
from .untrusted import untrusted

JEV_URL = 'https://api.typesafe.ai/v1/systemone'


class Jev:
    def __init__(self, api_key=None, transport=None, timeout=4.0):
        self.api_key = api_key if api_key is not None else os.environ.get('JEV_API_KEY', '')
        self.calls = 0
        self._client = httpx.Client(transport=transport, timeout=timeout,
                                    headers={'Authorization': f'Bearer {self.api_key}'}) if self.api_key else None

    @property
    def enabled(self):
        return self._client is not None

    def ask(self, state, questions):
        """Returns the answers dict, or None on any failure (callers fall back to rules)."""
        if not self._client:
            return None
        for attempt in range(2):
            try:
                response = self._client.post(JEV_URL, json={'model': os.environ.get('JEV_MODEL', 'jev-latest'),
                                                            'state': state[:6000], 'questions': questions})
            except httpx.HTTPError:
                return None
            self.calls += 1
            if response.status_code in (429, 529) and attempt == 0:
                continue
            if not response.is_success:
                return None
            answers = (response.json() or {}).get('answers')
            return answers if isinstance(answers, dict) else None
        return None

    def yes(self, state, question):
        """Probability 0..1 that the answer is yes, or None."""
        answers = self.ask(state, {'q': {'type': 'noul', 'instructions': question}})
        value = (answers or {}).get('q', {}).get('noul')
        return float(value) if isinstance(value, (int, float)) else None

    def choose(self, state, instructions, options: dict[str, str]):
        """Picks one key of `options` ({key: description}); returns (key, probability) or (None, 0)."""
        if not options:
            return None, 0.0
        reversed_options = dict(reversed(list(options.items())))
        answers = self.ask(state, {'a': {'type': 'choice', 'instructions': instructions, 'criteria': options},
                                   'b': {'type': 'choice', 'instructions': instructions, 'criteria': reversed_options}})
        if not answers:
            return None, 0.0

        def probs(a):
            a = a or {}
            if isinstance(a.get('probabilities'), dict):
                return a['probabilities']
            return {a['choice']: a.get('confidence', 1.0)} if a.get('choice') else {}
        pa, pb = probs(answers.get('a')), probs(answers.get('b'))
        avg = {k: (float(pa.get(k) or 0) + float(pb.get(k) or 0)) / 2 for k in options}
        best = max(avg, key=avg.get)
        return best, avg[best]

    def close(self):
        if self._client is not None:
            self._client.close()


def final_submit_probability(jev, element_description, page_summary):
    """Second opinion for the submit guard. None when Jev is off or failed."""
    if not jev or not jev.enabled:
        return None
    state = (f'A browser agent fills a web form for a user and is about to click this element:\n{element_description[:800]}\n\n'
             f'Page:\n{page_summary[:3000]}')
    return jev.yes(untrusted(state), 'Would clicking this element make an irreversible commitment: submit the form, send a message, '
                          'confirm a booking or reservation, place an order or pay? (Moving to the next step of a form, '
                          'opening a menu, choosing a date or accepting cookies is not irreversible.)')


def find_element(jev, target, snapshot_text, limit=25):
    """Pick the snapshot ref that best matches `target` ("the 19:30 Suvi slot"). Returns (ref, probability) or (None, 0).

    Lines are pre-ranked by word overlap so Jev chooses among at most `limit` candidates.
    """
    if not jev or not jev.enabled or not target:
        return None, 0.0
    head, _, text = snapshot_text.partition('\nText: ')
    lines = [l for l in head.splitlines() if l.startswith('[e') and '] ' in l]
    words = {w for w in re.findall(r'\w+', target.lower()) if len(w) > 1}
    scored = sorted(enumerate(lines), key=lambda il: (-len(words & set(re.findall(r'\w+', il[1].lower()))), il[0]))
    options = {l.split(']')[0][1:]: l.split('] ', 1)[1][:200] for _, l in scored[:limit]}
    state = f'A web page that a browser agent is using. Visible text: {text[:1500]}'
    return jev.choose(untrusted(state), f'Which element is this: {target}?', options)
