"""Offline contracts from the 2026-11-14 live stress test.

The fixture retains all 40 original phrases, with reasons for unscored modes.
These tests cover deterministic routing, request instructions and admission;
they cannot establish generated-answer quality or the truth of cited facts.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

from vali_api import guard
from vali_api.guard import SlidingWindow, check_task_budget
from vali_api.research import build_run_request
from vali_api.router import KINDS, route


ERRANDS = json.loads(
    (Path(__file__).resolve().parents[1] / 'fixtures/stress40.json').read_text()
)


def routing_case(errand):
    marks = []
    if errand.get('known_failure'):
        marks.append(pytest.mark.xfail(
            strict=True, reason='stress40: ' + errand['known_failure'],
        ))
    return pytest.param(errand, id=errand['id'], marks=marks)


@pytest.mark.parametrize('errand', [
    routing_case(errand) for errand in ERRANDS if 'mode' in errand
])
def test_stress40_keyword_fallback(errand):
    # A live classifier would hide fallback regressions and require a network.
    expected = errand['mode']
    assert route(errand['text'], classify=lambda task, page: None) == (
        expected, KINDS[expected],
    )


@pytest.mark.xfail(
    strict=True,
    reason='stress40: deadline question accepts watch classification without answering the deadline',
)
def test_deadline_question_overrides_live_watch_classification():
    # Reproduce the observed classifier decision rather than call the provider.
    assert route(ERRANDS[39]['text'], classify=lambda task, page: ('watch', 0.9, 0.5)) == (
        'check', 'agent',
    )


@pytest.fixture
def task_budget(monkeypatch):
    # Freeze time on the guard module only; no sleeping or external resources.
    monkeypatch.setattr(guard, 'time', SimpleNamespace(monotonic=lambda: 1000.0))
    limiter = SlidingWindow()
    application = SimpleNamespace(state=SimpleNamespace(
        limiter=limiter,
        store=SimpleNamespace(daily_spend=lambda user_id=None: 0.0),
        config=SimpleNamespace(daily_cap_usd=1.0, global_daily_cap_usd=60.0),
    ))
    return application, {'id': 'stress40-account'}


def admit_burst(application, user):
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(check_task_budget, application, user) for _ in range(10)]
        # Observe every exception: a rejected submission must fail the test.
        results = [future.exception() for future in futures]
    assert results == [None] * 10


def test_one_account_allows_ten_task_burst(task_budget):
    admit_burst(*task_budget)


def test_one_account_allows_ten_task_burst_after_recent_activity(task_budget):
    application, user = task_budget
    for _ in range(27):
        check_task_budget(application, user)
    admit_burst(application, user)


@pytest.mark.parametrize('errand', [
    pytest.param(errand, id=errand['id']) for errand in ERRANDS if 'language' in errand
])
def test_non_english_errand_requests_its_own_language_without_profile(errand):
    request = build_run_request(errand['text'])
    assert errand['text'] in request['query']
    instructions = request['query'] + '\n' + request['systemPrompt']
    # Accept either an explicit detected language or a generic same-input-language
    # directive. "English unless the user's language says otherwise" leaves the
    # source of that language unclear when no profile preference was supplied.
    explicit_language = re.search(
        rf'\b(?:answer|respond|reply|write)\s+in\s*:?\s*{errand["language"]}\b',
        instructions, re.I,
    )
    input_language = re.search(
        r'\b(?:same language as|language of)\s+(?:the\s+)?'
        r"(?:user(?:'s)?\s+)?(?:errand|task|input|request|message)\b",
        instructions, re.I,
    )
    assert explicit_language or input_language, instructions


@pytest.mark.parametrize('errand', [
    pytest.param(errand, id=errand['id']) for errand in ERRANDS if 'language' in errand
])
def test_explicit_language_preference_reaches_request(errand):
    request = build_run_request(errand['text'], profile={'language': errand['language']})
    assert f'Answer in: {errand["language"]}.' in request['query']
