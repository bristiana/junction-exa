"""Answering Vali's questions: every reply lands where it moves the errand on, in every run state."""
import json
import sys
import types

import pytest

from vali_api.app import poll_research_once, run_browser_session
from test_api import api, wa, pair_whatsapp  # noqa: F401  (fixtures)


def book(client, application, text='book a sauna tomorrow'):
    """A completed book errand; without a city its research.question 'Which city?' is open."""
    task = client.post('/v1/tasks', json={'task': text}).json()
    poll_research_once(task['id'], application)
    task = client.get('/v1/tasks/' + task['id']).json()
    assert task['research']['status'] == 'completed'
    assert ('Espoo' in text) == (task['research']['question'] is None)
    return task['id']


def runs(calls):
    return [c for c in calls if c[0] == 'POST' and c[1] == '/agent/runs']


def test_research_answer_before_any_run_reruns_research(api):
    client, application, store, calls, polls, browsers, user = api
    tid = book(client, application)
    before = len(runs(calls))
    reply = client.post(f'/v1/tasks/{tid}/messages', json={'text': 'Espoo'})
    assert reply.status_code == 200
    task = reply.json()
    assert task['research']['question']['answer'] == 'Espoo' and task['execution'] is None
    assert len(runs(calls)) == before + 1 and 'The user answered "Which city?": Espoo' in runs(calls)[-1][2]['query']


@pytest.mark.parametrize('status', ['stopped', 'failed'])
def test_research_answer_on_a_stopped_run_reruns_and_reaches_continue(api, status):
    client, application, store, calls, polls, browsers, user = api
    tid = book(client, application)
    assert client.post(f'/v1/tasks/{tid}/execute', json={}).status_code == 200
    store.patch_execution(tid, {'status': status})
    reply = client.post(f'/v1/tasks/{tid}/messages', json={'text': 'Espoo'})
    assert reply.status_code == 200
    task = reply.json()
    assert task['research']['question']['answer'] == 'Espoo'
    assert task['execution']['status'] == status and task['execution']['inbox'][-1]['text'] == 'Espoo'
    poll_research_once(tid, application)
    assert client.post(f'/v1/tasks/{tid}/continue', json={}).status_code == 200
    assert json.loads(browsers[-1][1])['resume']['user_said'] == ['Espoo']


def test_research_answer_after_a_done_run_reruns_research(api):
    client, application, store, calls, polls, browsers, user = api
    tid = book(client, application)
    client.post(f'/v1/tasks/{tid}/execute', json={})
    store.patch_execution(tid, {'status': 'done'})
    task = client.post(f'/v1/tasks/{tid}/messages', json={'text': 'Espoo'}).json()
    assert task['research']['question']['answer'] == 'Espoo' and task['execution']['status'] == 'done'
    # Nothing left to answer on a done run: the 409 says what to do instead.
    again = client.post(f'/v1/tasks/{tid}/messages', json={'text': 'and Tampere?'})
    assert again.status_code == 409 and 'new errand' in again.json()['detail']


def test_answer_while_running_reaches_the_form_and_closes_the_card_question(api):
    client, application, store, calls, polls, browsers, user = api
    tid = book(client, application)
    client.post(f'/v1/tasks/{tid}/execute', json={})
    store.patch_execution(tid, {'status': 'running'})
    before = len(runs(calls))
    task = client.post(f'/v1/tasks/{tid}/messages', json={'text': 'Espoo'}).json()
    assert task['execution']['inbox'][-1]['text'] == 'Espoo'
    assert task['research']['question']['answer'] == 'Espoo'  # no longer shown as open
    assert len(runs(calls)) == before  # the running form has it; no research rerun under it


def test_execution_question_while_running_goes_to_the_inbox_only(api):
    client, application, store, calls, polls, browsers, user = api
    tid = book(client, application, 'book a sauna in Espoo tomorrow')
    client.post(f'/v1/tasks/{tid}/execute', json={})
    store.patch_execution(tid, {'status': 'running', 'question': {'text': 'Which slot?'}})
    task = client.post(f'/v1/tasks/{tid}/messages', json={'text': '19:30'}).json()
    assert task['execution']['inbox'][-1]['text'] == '19:30' and task['execution']['status'] == 'running'


def test_reply_to_a_stopped_run_is_kept_for_continue_not_409(api):
    client, application, store, calls, polls, browsers, user = api
    tid = book(client, application, 'book a sauna in Espoo tomorrow')
    client.post(f'/v1/tasks/{tid}/execute', json={})
    client.post(f'/v1/tasks/{tid}/stop')
    reply = client.post(f'/v1/tasks/{tid}/messages', json={'text': 'use the 19:30 slot'})
    assert reply.status_code == 200 and reply.json()['execution']['status'] == 'stopped'
    assert len(browsers) == 1  # a plain stop is not restarted by a message
    assert client.post(f'/v1/tasks/{tid}/continue', json={}).status_code == 200
    assert json.loads(browsers[-1][1])['resume']['user_said'] == ['use the 19:30 slot']


def test_continue_with_and_without_answer(api):
    client, application, store, calls, polls, browsers, user = api
    tid = book(client, application, 'book a sauna in Espoo tomorrow')
    client.post(f'/v1/tasks/{tid}/execute', json={})
    client.post(f'/v1/tasks/{tid}/stop')
    task = client.post(f'/v1/tasks/{tid}/continue', json={}).json()
    assert task['execution']['status'] == 'starting' and json.loads(browsers[-1][1])['resume']['answer'] is None
    client.post(f'/v1/tasks/{tid}/stop')
    task = client.post(f'/v1/tasks/{tid}/continue', json={'answer': '19:30'}).json()
    assert task['execution']['runs'] == 3 and json.loads(browsers[-1][1])['resume']['answer'] == '19:30'


def unanswered_run(monkeypatch, application, tid):
    """Run the browser session with an agent whose question times out, like the real ask_user."""
    from vali_agent.hooks import AgentHooks
    clock = iter(range(0, 100000, 400))
    monkeypatch.setattr('vali_api.app.time', types.SimpleNamespace(monotonic=lambda: next(clock), sleep=lambda s: None))

    def agent(**kwargs):
        hooks = kwargs['hooks']
        hooks.on_step('Asked you: Which slot?', None)
        assert hooks.ask_user('Which slot?') is None and hooks.should_stop()
        return {'status': 'stopped', 'result': 'Stopped by the user'}
    monkeypatch.setitem(sys.modules, 'vali_agent', types.SimpleNamespace(run_browser_agent=agent, AgentHooks=AgentHooks))
    run_browser_session(tid, 'goal', 'https://example.com', {}, application)


def test_unanswered_question_pauses_and_the_late_answer_continues(api, monkeypatch):
    client, application, store, calls, polls, browsers, user = api
    tid = book(client, application)  # the research question stays open too
    client.post(f'/v1/tasks/{tid}/execute', json={})
    unanswered_run(monkeypatch, application, tid)
    execution = store.get_task(tid)['execution']
    assert execution['status'] == 'stopped' and execution['result'].startswith('Paused:')  # not "Stopped by the user"
    task = client.post(f'/v1/tasks/{tid}/messages', json={'text': '19:30'}).json()
    assert task['execution']['status'] == 'starting' and task['execution']['runs'] == 2
    resume = json.loads(browsers[-1][1])['resume']
    assert resume['question'] == 'Which slot?' and resume['answer'] == '19:30'
