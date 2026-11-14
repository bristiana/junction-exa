import asyncio
import json
import secrets

import httpx
import pytest

from vali_wa.api import GraphAPIClient, GraphAPIError, GraphAPITransportError
from vali_wa.flow import WhatsAppFlow
from vali_wa.render import render_help, render_linked, render_link_failed, render_result
from vali_wa.webhook import IncomingMessage


NUMBER = "+358401234567"


def run(coroutine):
    return asyncio.run(coroutine)


def test_api_exact_bodies_and_authenticated_media():
    requests = []
    token = secrets.token_hex(16)

    def handler(request):
        requests.append(request)
        assert request.headers["Authorization"] == f"Bearer {token}"
        if request.url.path == "/v21.0/media_test":
            return httpx.Response(200, json={"url": "https://media.example/audio"})
        if request.url.host == "media.example":
            return httpx.Response(200, content=b"audio bytes")
        return httpx.Response(200, json={"messages": [{"id": "out_test"}]})

    async def scenario():
        async with GraphAPIClient("phone_test", token, transport=httpx.MockTransport(handler)) as api:
            await api.send_text(NUMBER, "Hello", reply_to="in_test")
            await api.send_image(NUMBER, "https://media.example/shot.jpg", "Ready for review")
            await api.send_buttons(NUMBER, "Submit?", [("yes", "Approve"), ("stop", "Stop")])
            await api.mark_read("in_test")
            assert await api.download_media(await api.get_media_url("media_test")) == b"audio bytes"
            with pytest.raises(ValueError):
                await api.send_buttons(NUMBER, "Too many", [(str(n), str(n)) for n in range(4)])
            with pytest.raises(ValueError):
                await api.send_text(NUMBER, "x" * 4097)

    run(scenario())
    assert [json.loads(r.content) for r in requests[:4]] == [
        {"messaging_product": "whatsapp", "to": NUMBER, "type": "text", "text": {"body": "Hello"}, "context": {"message_id": "in_test"}},
        {"messaging_product": "whatsapp", "to": NUMBER, "type": "image", "image": {"link": "https://media.example/shot.jpg", "caption": "Ready for review"}},
        {"messaging_product": "whatsapp", "to": NUMBER, "type": "interactive", "interactive": {
            "type": "button", "body": {"text": "Submit?"}, "action": {"buttons": [
                {"type": "reply", "reply": {"id": "yes", "title": "Approve"}},
                {"type": "reply", "reply": {"id": "stop", "title": "Stop"}}]}}},
        {"messaging_product": "whatsapp", "status": "read", "message_id": "in_test"}]
    assert all(str(r.url) == "https://graph.facebook.com/v21.0/phone_test/messages" for r in requests[:4])


@pytest.mark.parametrize("statuses,expected_calls,error", [
    ([500, 200], 2, None), ([503, 502], 2, 502), ([400], 1, 400), ([429], 1, 429)])
def test_retry_policy(statuses, expected_calls, error):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(statuses[len(calls) - 1], json={"error": {"code": 42}})

    async def scenario():
        async with GraphAPIClient("phone_test", secrets.token_hex(16), transport=httpx.MockTransport(handler)) as api:
            if error:
                with pytest.raises(GraphAPIError) as caught:
                    await api.mark_read("m_test")
                assert (caught.value.status_code, caught.value.code) == (error, 42)
            else:
                await api.mark_read("m_test")
    run(scenario())
    assert len(calls) == expected_calls


def test_transport_error_has_no_credentials():
    token = secrets.token_hex(16)

    def handler(request):
        raise httpx.ConnectError(token, request=request)

    async def scenario():
        async with GraphAPIClient("phone_test", token, transport=httpx.MockTransport(handler)) as api:
            with pytest.raises(GraphAPITransportError) as caught:
                await api.mark_read("m_test")
            assert token not in str(caught.value)
            assert caught.value.status_code == 0
    run(scenario())


def flow_scenario(task, message, *, known=True, linked=True, transcribe=None, read_letter=None,
                  mutation_result=None, reactions=None):
    calls, requests = [], []
    reactions = [] if reactions is None else reactions

    def handler(request):
        requests.append(request)
        if request.method == "GET":
            if request.url.host == "media.example":
                return httpx.Response(200, content=b"media bytes")
            return httpx.Response(200, json={"url": "https://media.example/file"})
        return httpx.Response(200, json={"messages": [{"id": "out_test"}]})

    def find(number):
        calls.append(("find", number))
        return "u_test" if known else None

    def link(code, number):
        calls.append(("link", code, number))
        return "u_test" if linked else None

    def create(user_id, text, source):
        calls.append(("create", user_id, text, source))
        return task

    async def active(user_id):
        calls.append(("active", user_id))
        return task

    def operation(name):
        def callback(*args):
            calls.append((name, *args))
            return mutation_result
        return callback

    async def scenario():
        async with GraphAPIClient("phone_test", secrets.token_hex(16), transport=httpx.MockTransport(handler)) as api:
            flow = WhatsAppFlow(api=api, find_user_by_number=find, link_number=link,
                create_task=create, get_active_task=active, execute=operation("execute"),
                approve=operation("approve"), stop=operation("stop"),
                transcribe=transcribe, read_letter=read_letter)
            sent = await flow.handle(message)
            assert json.loads(requests[0].content) == {
                "messaging_product": "whatsapp", "status": "read", "message_id": message.message_id}
            payloads = [json.loads(r.content) for r in requests[1:] if r.method == "POST"]
            reactions.extend(p["reaction"]["emoji"] for p in payloads if p.get("type") == "reaction")
            payloads = [p for p in payloads if p.get("type") != "reaction"]
            assert sent == payloads
            assert all(payload == {"messaging_product": "whatsapp", "to": NUMBER, "type": "text",
                "text": {"body": payload["text"]["body"]}, "context": {"message_id": message.message_id}}
                for payload in payloads)
            return [payload["text"]["body"] for payload in sent]

    return run(scenario()), calls, requests


def msg(text):
    return IncomingMessage(NUMBER, "in_test", "text", text=text)


def test_pairing_and_unknown(task):
    bodies, calls, _ = flow_scenario(task, msg("hello"), known=False)
    assert bodies == render_help()
    assert calls == [("find", NUMBER)]
    for linked, expected in [(True, render_linked()), (False, render_link_failed())]:
        bodies, calls, _ = flow_scenario(task, msg("linkki 123 456"), known=False, linked=linked)
        assert bodies == expected
        assert calls == [("link", "123456", NUMBER)]


def test_create_choose_and_status(task):
    bodies, calls, _ = flow_scenario(task, msg("Help with my delayed flight"))
    assert bodies == ["On it. I'll send the answer here in about half a minute."]
    assert calls[-1] == ("create", "u_test", "Help with my delayed flight", "whatsapp")
    _, calls, _ = flow_scenario(task, msg("2"))
    assert calls[-1] == ("execute", "t_claim", 1)
    bodies, calls, _ = flow_scenario(task, msg("9"))
    assert "not available" in bodies[0]
    assert not any(c[0] == "execute" for c in calls)
    bodies, _, _ = flow_scenario(task, msg("status"))
    assert bodies == render_result(task)
    bodies, _, _ = flow_scenario(None, msg("status"))
    assert "No active errand" in bodies[0]


def test_approve_stop_and_execution_gates(task):
    bodies, calls, _ = flow_scenario(task, msg("yes"))
    assert "no submission" in bodies[0]
    assert not any(c[0] == "approve" for c in calls)
    task["execution"] = {"status": "awaiting_approval"}
    _, calls, _ = flow_scenario(task, IncomingMessage(NUMBER, "in_test", "interactive", text="Approve", reply_id="yes"))
    assert calls[-1] == ("approve", "t_claim")
    _, calls, _ = flow_scenario(task, msg("ei"))
    assert calls[-1] == ("stop", "t_claim")
    bodies, calls, _ = flow_scenario(task, msg("1"))
    assert "already in progress" in bodies[0]
    assert not any(c[0] == "execute" for c in calls)
    task["execution"] = {"status": "running", "steps": [{"text": "Opening form"}]}
    bodies, _, _ = flow_scenario(task, msg("tila"))
    assert bodies == ["Working on it: Opening form"]
    task["execution"] = {"status": "done"}
    bodies, calls, _ = flow_scenario(task, msg("stop"))
    assert "no running execution" in bodies[0]


def test_audio_and_photo(task):
    media_calls = []

    async def transcribe(data, mime):
        media_calls.append((data, mime))
        return "yes"

    def read_letter(data, mime, caption):
        media_calls.append((data, mime, caption))
        return "Explain my Finnish letter"

    audio = IncomingMessage(NUMBER, "in_test", "audio", media_id="audio_test", mime_type="audio/ogg")
    image = IncomingMessage(NUMBER, "in_test", "image", media_id="image_test", mime_type="image/jpeg", caption="Please explain")
    for message, kwargs, text in [(audio, {"transcribe": transcribe}, "yes"),
                                   (image, {"read_letter": read_letter}, "Explain my Finnish letter")]:
        _, calls, requests = flow_scenario(task, message, **kwargs)
        assert calls[-1] == ("create", "u_test", text, "whatsapp")
        assert len([r for r in requests if r.method == "GET"]) == 2
    assert media_calls == [(b"media bytes", "audio/ogg"), (b"media bytes", "image/jpeg", "Please explain")]
    for message, expected in [(audio, "not available"), (image, "describe the letter in text")]:
        bodies, _, requests = flow_scenario(task, message)
        assert expected in bodies[0]
        assert not any(r.method == "GET" for r in requests)
    bodies, _, _ = flow_scenario(task, audio, transcribe=lambda *_: "")
    assert "could not read" in bodies[0]
    bodies, calls, requests = flow_scenario(task, audio, known=False, transcribe=transcribe)
    assert bodies == render_help()
    assert len(requests) == 2


def test_help_unsupported_and_split_flow(task):
    assert flow_scenario(task, msg("apua"))[0] == render_help()
    assert "Please send" in flow_scenario(task, IncomingMessage(NUMBER, "in_test"))[0][0]
    task["research"]["output"]["structured"]["key_facts"][0]["value"] = "a" * 9000
    bodies, _, _ = flow_scenario(task, msg("status"))
    assert len(bodies) >= 3 and all(len(body) <= 4096 for body in bodies)


def test_mutations_render_returned_task(task):
    updated = {**task, "execution": {"status": "running", "steps": [{"text": "Opening claim"}]}}
    bodies, _, _ = flow_scenario(task, msg("1"), mutation_result=updated)
    assert bodies == ["Working on it: Opening claim"]
    task["execution"] = {"status": "awaiting_approval"}
    updated = {**task, "execution": {"status": "submitting"}}
    bodies, _, _ = flow_scenario(task, msg("yes"), mutation_result=updated)
    assert bodies == ["Submitting your approved errand."]
    updated = {**task, "execution": {"status": "stopped"}}
    bodies, _, _ = flow_scenario(task, msg("stop"), mutation_result=updated)
    assert bodies == ["Stopped. Vali will not submit this errand."]


def test_upload_and_send_image_by_id():
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={'id': 'media-upload'} if request.url.path.endswith('/media') else {'messages': []})
    async def scenario():
        async with GraphAPIClient('phone', 'test-token', transport=httpx.MockTransport(handler)) as api:
            mid = await api.upload_media(b'jpeg-bytes')
            await api.send_image(NUMBER, media_id=mid, caption='Ready')
    run(scenario())
    assert requests[0].url.path == '/v21.0/phone/media'
    assert requests[0].headers['content-type'].startswith('multipart/form-data')
    assert b'jpeg-bytes' in requests[0].content
    assert json.loads(requests[1].content)['image'] == {'id': 'media-upload', 'caption': 'Ready'}


def test_channel_receipt_failure_logs_safely(caplog):
    from vali_api.wa_channel import ChannelAPI
    from vali_api.config import Config
    api = ChannelAPI(Config(whatsapp_token='test', whatsapp_phone_number_id='phone'))
    async def fail(*args, **kwargs):
        raise GraphAPIError(400, 99)
    api._call = fail
    with caplog.at_level('WARNING', logger='vali.whatsapp'):
        assert run(api.mark_read('receipt-id')) is None
    assert 'message_id=receipt-id' in caplog.text
    assert 'status_code=400 code=99' in caplog.text


def test_reactions_mark_what_vali_did(task):
    seen = []
    flow_scenario(task, msg("Book me a sauna on Friday"), reactions=seen)
    flow_scenario(task, msg("link 123456"), reactions=seen)
    flow_scenario(task, msg("help"), reactions=seen)
    assert seen == ["👀", "🤝"]


def test_choice_button_starts_the_action(task):
    task["execution"] = None
    reply = IncomingMessage(NUMBER, "in_test", "interactive", text="Open it", reply_id=f"choose:{task['id']}:1")
    bodies, calls, _ = flow_scenario(task, reply)
    assert ("execute", task["id"], 0) in calls
    stale = IncomingMessage(NUMBER, "in_test", "interactive", text="Open it", reply_id="choose:other:1")
    assert "no longer active" in flow_scenario(task, stale)[0][0]
