"""Offline worker notifications, including Graph upload and safe failure logs."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest

from vali_api.wa_channel import ChannelAPI, push_task
from vali_wa.api import GraphAPIClient, GraphAPIError
from vali_wa.render import render_execution_update


@pytest.fixture
def notification():
    task = {'id': 't-test', 'user_id': 'u-test', 'source': 'whatsapp',
            'execution': {'status': 'running'}}
    store = Mock()
    store.get_task.return_value = task
    store.get_user.return_value = {'wa_number': '358401234567'}
    store.get_live_frame.return_value = b'live-frame-jpeg'
    def patch(tid, values):
        task['execution'].update(values)
    store.patch_execution.side_effect = patch
    api = SimpleNamespace(send_text=AsyncMock(), send_document=AsyncMock(), upload_media=AsyncMock(return_value='uploaded-id'),
                          send_image=AsyncMock(), send_buttons=AsyncMock())
    app = SimpleNamespace(state=SimpleNamespace(store=store, whatsapp_api=api))
    return app, task, api


def test_question_sent_once_even_when_timestamp_changes(notification):
    app, task, api = notification
    task['execution']['question'] = {'text': 'Which time?', 'at': 'first'}
    push_task(app, task['id'], render_execution_update)
    push_task(app, task['id'], render_execution_update)
    task['execution']['question']['at'] = 'second'
    push_task(app, task['id'], render_execution_update)
    assert api.send_text.await_count == 1
    assert api.send_text.await_args.args[1] == 'Which time?'
    task['execution']['question'] = {'text': 'How many people?', 'at': 'third'}
    push_task(app, task['id'], render_execution_update)
    assert api.send_text.await_count == 2


def test_question_send_failure_is_logged_and_retryable(notification, caplog):
    app, task, api = notification
    task['execution']['question'] = {'text': 'private-question', 'at': 'first'}
    api.send_text.side_effect = GraphAPIError(429, 130429)
    push_task(app, task['id'], render_execution_update)
    assert 'wa_question_sent' not in task['execution']
    assert 'task_id=t-test' in caplog.text and 'status_code=429 code=130429' in caplog.text
    assert 'private-question' not in caplog.text and '358401234567' not in caplog.text
    api.send_text.side_effect = None
    push_task(app, task['id'], render_execution_update)
    assert task['execution']['wa_question_sent'] == 'private-question'


def test_approval_uploads_live_frame_and_sends_caption_and_buttons(notification):
    app, task, api = notification
    task['execution'].update(status='awaiting_approval', approval={'summary': 'Form prepared'})
    push_task(app, task['id'], render_execution_update)
    api.upload_media.assert_awaited_once_with(b'live-frame-jpeg', 'image/jpeg')
    api.send_image.assert_awaited_once_with('358401234567', media_id='uploaded-id',
                                          caption='\n'.join(render_execution_update(task)))
    api.send_buttons.assert_awaited_once_with('358401234567', 'Submit this errand?',
        [('approve:t-test', 'Approve'), ('stop:t-test', 'Stop')])
    api.send_text.assert_not_awaited()
    app.state.store.get_live_frame.assert_called_once_with(task['id'])


@pytest.mark.parametrize('failure', ['no_frame', 'upload', 'image', 'buttons'])
def test_approval_media_and_buttons_failures_preserve_text_fallback(notification, caplog, failure):
    app, task, api = notification
    task['execution']['status'] = 'awaiting_approval'
    if failure == 'no_frame':
        app.state.store.get_live_frame.return_value = None
    else:
        getattr(api, {'upload': 'upload_media', 'image': 'send_image', 'buttons': 'send_buttons'}[failure]).side_effect = GraphAPIError(400, 100)
    push_task(app, task['id'], render_execution_update)
    if failure != 'buttons':
        assert 'Reply *yes*' in api.send_text.await_args.args[1]
        api.send_buttons.assert_awaited_once()
    else:
        assert 'Reply *yes*' in api.send_image.await_args.kwargs['caption']
    if failure != 'no_frame':
        assert 'status_code=400 code=100' in caplog.text and 'task_id=t-test' in caplog.text


def test_long_approval_caption_keeps_all_text(notification):
    app, task, api = notification
    task['execution'].update(status='awaiting_approval', approval={'summary': 'x' * 6000})
    push_task(app, task['id'], render_execution_update)
    caption = api.send_image.await_args.kwargs['caption']
    assert len(caption) == 1024
    assert caption + ''.join(c.args[1] for c in api.send_text.await_args_list) == '\n'.join(render_execution_update(task))


def test_channel_read_receipt_failure_is_private(monkeypatch, caplog):
    config = SimpleNamespace(whatsapp_token='private-token', whatsapp_phone_number_id='phone-test')
    channel = ChannelAPI(config)
    async def fail(*args, **kwargs):
        raise GraphAPIError(403, 190)
    monkeypatch.setattr(channel, '_call', fail)
    assert asyncio.run(channel.mark_read('incoming-id')) is None
    assert 'message_id=incoming-id' in caplog.text and 'status_code=403 code=190' in caplog.text
    assert 'private-token' not in caplog.text


def test_graph_upload_and_image_id_payload():
    requests = []
    def respond(request):
        requests.append(request)
        if request.url.path.endswith('/media'):
            assert request.headers['content-type'].startswith('multipart/form-data; boundary=')
            assert b'live-jpeg' in request.content and b'image/jpeg' in request.content
            assert b'messaging_product' in request.content and b'whatsapp' in request.content
            return httpx.Response(200, json={'id': 'media-result'})
        return httpx.Response(200, json={'messages': [{'id': 'sent'}]})
    async def scenario():
        async with GraphAPIClient('phone-test', 'fake-token', transport=httpx.MockTransport(respond)) as api:
            media_id = await api.upload_media(b'live-jpeg')
            await api.send_image('358401234567', media_id=media_id, caption='Review form')
    asyncio.run(scenario())
    assert requests[0].url.path == '/v21.0/phone-test/media'
    assert json.loads(requests[1].content)['image'] == {'id': 'media-result', 'caption': 'Review form'}


def test_answer_actions_arrive_as_buttons(notification):
    from vali_wa.render import render_result
    app, task, api = notification
    task['execution'] = None
    task['research'] = {'status': 'completed', 'output': {'structured': {
        'answer': 'Kulttuurisauna takes bookings online.', 'actions': [
            {'type': 'open_link', 'label': 'Open the booking calendar', 'url': 'https://kulttuurisauna.fi/'},
            {'type': 'reminder', 'label': 'Remind me'}]}}}
    push_task(app, task['id'], render_result)
    api.send_buttons.assert_awaited_once_with('358401234567', '*Kulttuurisauna takes bookings online.*',
        [('choose:t-test:1', 'Open the booking ca…'), ('choose:t-test:2', 'Remind me')])
    api.send_text.assert_not_awaited()


def test_answer_buttons_failure_falls_back_to_numbers(notification):
    from vali_wa.render import render_result
    app, task, api = notification
    task['execution'] = None
    task['research'] = {'status': 'completed', 'output': {'structured': {
        'answer': 'Done.', 'actions': [{'type': 'open_link', 'label': 'Open it', 'url': 'https://x.example/'}]}}}
    api.send_buttons.side_effect = GraphAPIError(400, 100)
    push_task(app, task['id'], render_result)
    assert 'Reply 1 to Open it' in api.send_text.await_args.args[1]


def test_a_booking_offers_book_it(notification):
    from vali_wa.render import result_buttons
    task = {'id': 't1', 'task': 'Book me a sauna on Friday', 'research': {'output': {'structured': {'actions': [
        {'type': 'open_link', 'label': 'Open booking calendar', 'url': 'https://kulttuurisauna.fi/'}, {'label': 'Remind me'}]}}}}
    assert result_buttons(task) == [('choose:t1:1', 'Book it'), ('choose:t1:2', 'Remind me')]


def test_info_answers_offer_a_watch():
    from vali_wa.render import result_buttons
    task = {'id': 't2', 'mode': 'check', 'task': 'Kela housing supplement for students', 'research': {'output': {'structured': {
        'actions': [{'label': 'Open OmaKela', 'url': 'https://kela.fi'}, {'label': 'Read the rules'}, {'label': 'Call Kela'}]}}}}
    assert result_buttons(task)[-1] == ('watch:t2', 'Watch this') and len(result_buttons(task)) == 3


def test_answer_brings_the_page_picture_and_pdfs(notification):
    from vali_wa.render import render_result
    app, task, api = notification
    task['execution'] = None
    task['mode'] = 'check'
    task['research'] = {'status': 'completed', 'output': {'sources': [
        {'n': 1, 'url': 'https://kulttuurisauna.fi/', 'image': 'https://kulttuurisauna.fi/photo.jpeg'},
        {'n': 2, 'url': 'https://www.kela.fi/documents/ot2e.pdf', 'title': 'Form OT 2e'}],
        'structured': {'answer': 'Done.', 'actions': [{'label': 'Open it', 'url': 'https://x.example/'}]}}}
    push_task(app, task['id'], render_result)
    assert api.send_buttons.await_args.kwargs == {'image': 'https://kulttuurisauna.fi/photo.jpeg'}
    api.send_document.assert_awaited_once_with('358401234567', 'https://www.kela.fi/documents/ot2e.pdf', 'Form OT 2e.pdf')


def test_watch_only_for_things_that_change():
    from vali_wa.render import result_buttons
    base = {'id': 't3', 'mode': 'check', 'research': {'output': {'structured': {'actions': [{'label': 'Open', 'url': 'https://x.example/'}]}}}}
    assert ('watch:t3', 'Watch this') not in result_buttons({**base, 'task': 'How do I open a bank account without a Finnish ID?'})
    assert ('watch:t3', 'Watch this') in result_buttons({**base, 'task': 'Kela benefits for students'})
