import json
from pathlib import Path

import pytest

from vali_api.router import KINDS, route


ERRANDS = json.loads(
    (Path(__file__).resolve().parents[3] / 'scripts/evals/errands.json').read_text()
)['errands']


@pytest.mark.parametrize('errand', ERRANDS, ids=lambda errand: errand['id'])
def test_eval_errands_keyword_fallback(errand):
    mode, kind = route(errand['text'], errand.get('page'), classify=lambda task, page: None)
    assert mode in errand['mode']
    assert kind == KINDS[mode]


@pytest.mark.parametrize('text', [
    'Does this include tax?', 'Do I need identification?', 'Can I use this abroad?',
    'How do I open an account?', 'What is the deposit?', 'Is it correct?',
    'Is this right?', 'What does this mean?', 'What do I need to register?',
    'Explain the requirements', 'Am I eligible?', 'Check eligibility',
    'The annual fee', 'Are there extra fees?', 'Help with my account',
    'Help with my letter', 'Help with my contract',
])
def test_question_keywords_break_close_ties(text):
    assert route(text, classify=lambda task, page: ('find', 0.55, 0.1)) == ('check', 'agent')


@pytest.mark.parametrize('text,expected', [
    ('Compare laptops', ('find', 'search')),
    ('Claim a refund', ('claim', 'agent')),
    ('Book an appointment', ('book', 'agent')),
    ('Write a message', ('write', 'agent')),
    ('Notify me about changes', ('watch', 'monitor')),
])
def test_action_keywords_break_close_ties(text, expected):
    assert route(text, classify=lambda task, page: ('check', 0.55, 0.1)) == expected


@pytest.mark.parametrize('margin,expected', [
    (0.0, 'check'), (0.149, 'check'), (0.15, 'find'), (0.6, 'find'),
])
def test_margin_threshold(margin, expected):
    assert route('What do I need to register?', classify=lambda task, page: ('find', 0.55, margin)) == (expected, KINDS[expected])


@pytest.mark.parametrize('text,page', [
    ('Help me with this', None),
    ('Help me with this', {'selection': 'some selected text'}),
    ('A feedback page', None),
    ('The office mascot', None),
])
def test_default_check_is_not_a_clear_keyword_match(text, page):
    assert route(text, page, classify=lambda task, page: ('find', 0.55, 0.1)) == ('find', 'search')


@pytest.mark.parametrize('text,expected', [
    ('Find a venue I can book online', ('find', 'search')),
    ('Write an email asking if I am eligible', ('write', 'agent')),
    ('Claim compensation: what fee applies?', ('claim', 'agent')),
    ('Book a table: can I sit outside?', ('book', 'agent')),
])
def test_question_words_preserve_explicit_actions(text, expected):
    assert route(text, classify=lambda task, page: None) == expected
