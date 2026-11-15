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


def waiting_for_approval(wa):
    api, graph, deliver = wa
    client, application, store, *_, user = api
    pair_whatsapp(api, deliver)
    deliver('book a sauna in Espoo tomorrow', mid='new')
    tid = store.list_tasks(user['user_id'])[0]['id']
    poll_research_once(tid, application)
    deliver('1', mid='execute')
    store.patch_execution(tid, {'status': 'awaiting_approval', 'approval': {'summary': 'Book sauna'}})
    return tid


@pytest.mark.parametrize('text', ['Fill in the form at https://httpbin.org/forms/post',
                                  'Where can I buy a cheap bike in Espoo this week?'])
def test_whatsapp_new_errand_while_one_waits_for_approval(wa, text):
    api, graph, deliver = wa
    store, user = api[2], api[-1]
    tid = waiting_for_approval(wa)
    deliver(text, mid='second')
    tasks = store.list_tasks(user['user_id'])
    assert len(tasks) == 2 and tasks[0]['task'] == text
    assert not store.get_task(tid)['execution'].get('inbox')
    assert 'approve' in graph.sent[-1][1]  # the earlier one is still there to approve or stop
    deliver('approve', mid='ok')
    assert store.get_task(tid)['execution']['approval_decision'] == 'approved'


def test_whatsapp_short_reply_while_waiting_says_how_to_go_on(wa):
    api, graph, deliver = wa
    store, user = api[2], api[-1]
    tid = waiting_for_approval(wa)
    deliver('make it 15:00', mid='short')
    assert len(store.list_tasks(user['user_id'])) == 1
    assert store.get_task(tid)['execution']['inbox'][-1]['text'] == 'make it 15:00'  # kept for a Continue
    assert 'new errand' in graph.sent[-1][1]


def test_whatsapp_a_dead_approval_no_longer_swallows_texts(wa):
    api, graph, deliver = wa
    store, user = api[2], api[-1]
    tid = waiting_for_approval(wa)
    store.sql('UPDATE tasks SET updated_at=? WHERE id=?', ('2026-01-01T00:00:00+00:00', tid))
    deliver('cheap bike', mid='later')
    tasks = store.list_tasks(user['user_id'])
    assert len(tasks) == 2 and tasks[0]['task'] == 'cheap bike'


def test_demo_stop_before_sending_keeps_its_message(api, monkeypatch):
    from vali_agent.hooks import AgentHooks
    client, application, store, calls, polls, browsers, user = api
    tid = book(client, application, 'book a sauna in Espoo tomorrow')
    client.post(f'/v1/tasks/{tid}/execute', json={})
    demo = 'This is the demo, so Vali stopped right before sending. Nothing reached varaamo.hel.fi.'

    def agent(**kwargs):
        hooks = kwargs['hooks']
        # What POST /approve does in closed demo mode while the agent waits for approval.
        store.patch_execution(tid, {'status': 'stopped', 'approval_decision': 'stopped', 'result': demo})
        assert hooks.wait_for_approval('Book sauna', []) is False
        return {'status': 'stopped', 'result': 'Stopped by the user'}
    monkeypatch.setitem(sys.modules, 'vali_agent', types.SimpleNamespace(run_browser_agent=agent, AgentHooks=AgentHooks))
    run_browser_session(tid, 'goal', 'https://example.com', {}, application)
    execution = store.get_task(tid)['execution']
    assert execution['status'] == 'stopped' and execution['result'] == demo


def test_whatsapp_late_answer_to_a_paused_run_continues_it(wa, monkeypatch):
    api, graph, deliver = wa
    client, application, store, calls, polls, browsers, user = api
    pair_whatsapp(api, deliver)
    deliver('book a sauna in Espoo tomorrow', mid='new')
    tid = store.list_tasks(user['user_id'])[0]['id']
    poll_research_once(tid, application)
    deliver('1', mid='execute')
    unanswered_run(monkeypatch, application, tid)
    deliver('Where can I buy a cheap bike in Espoo this week?', mid='newer')  # a new errand; it does not hide the paused one
    assert len(store.list_tasks(user['user_id'])) == 2
    deliver('19:30', mid='late')
    execution = store.get_task(tid)['execution']
    assert execution['status'] == 'starting' and execution['runs'] == 2
    assert json.loads(browsers[-1][1])['resume']['answer'] == '19:30'


def test_whatsapp_approve_in_the_closed_demo_says_the_demo_stop_once(wa):
    api, graph, deliver = wa
    client, application, store, *_, user = api
    tid = waiting_for_approval(wa)
    config = application.state.config
    config.closed, config.submit_hosts = True, frozenset({'httpbin.org'})
    config.owner_ids = frozenset({user['user_id']})
    store.patch_execution(tid, {'current_url': 'https://varaamo.hel.fi/book'})
    graph.sent.clear()
    deliver('yes', mid='approve')
    demo = 'This is the demo, so Vali stopped right before sending. Nothing reached varaamo.hel.fi.'
    assert store.get_task(tid)['execution']['result'] == demo
    texts = [str(sent) for sent in graph.sent]
    assert sum(demo in text for text in texts) == 1, texts
    assert not any('Nothing was sent' in text for text in texts), texts
