import hashlib
import hmac
import pytest

from vali_wa.parse import parse_command
from vali_wa.webhook import parse_webhook, verify_challenge, verify_signature


def test_webhook(webhook_payload):
    parsed = parse_webhook(webhook_payload)
    assert [m.kind for m in parsed.messages] == ["text", "audio", "image", "interactive"]
    text, audio, image, button = parsed.messages
    assert (text.from_number, text.message_id, text.text, text.timestamp) == (
        "+358401234567", "m_text", "Help with my flight", "1794614400")
    assert (audio.media_id, audio.mime_type) == ("audio_test", "audio/ogg; codecs=opus")
    assert (image.media_id, image.mime_type, image.caption) == ("image_test", "image/jpeg", "Explain this letter")
    assert (button.reply_id, button.text) == ("yes", "Approve")
    status = parsed.statuses[0]
    assert (status.message_id, status.status, status.recipient_id, status.timestamp) == (
        "m_out", "delivered", "+358401234567", "1794614404")


def test_multiple_entries_list_reply_and_other(webhook_payload):
    value = webhook_payload["entry"][0]["changes"][0]["value"]
    value["messages"] = [{"from": "+358401234567", "id": "list", "type": "interactive",
        "interactive": {"type": "list_reply", "list_reply": {"id": "2", "title": "Draft"}}},
        {"id": "other", "type": "document"}]
    webhook_payload["entry"].append({"changes": [{"value": {"statuses": [{"id": "failed", "status": "failed", "errors": [{"code": 1}]}]}}]})
    parsed = parse_webhook(webhook_payload)
    assert parsed.messages[0].reply_id == "2"
    assert parsed.messages[1].kind == "other"
    assert parsed.statuses[1].errors == [{"code": 1}]
    assert parse_webhook({}).messages == []
    assert parse_webhook({"entry": [{"changes": [{"value": {"statuses": [{"id": "s", "status": "read"}]}}]}]}).messages == []


def test_signature_and_handshake():
    body = b'{"entry": []}'
    # Ephemeral test key, never an application credential.
    key = __import__("secrets").token_hex(16)
    signature = "sha256=" + hmac.new(key.encode(), body, hashlib.sha256).hexdigest()
    assert verify_signature(body, signature, key)
    for header in ["", "sha1=invalid", signature + "x", "sha256=ä"]:
        assert not verify_signature(body, header, key)
    assert not verify_signature(body + b" ", signature, key)
    assert not verify_signature(body, signature, "")
    params = {"hub.mode": "subscribe", "hub.verify_token": key, "hub.challenge": "1234"}
    assert verify_challenge(params, key) == "1234"
    assert verify_challenge(params, key + "x") is None
    assert verify_challenge({**params, "hub.mode": "other"}, key) is None
    assert verify_challenge({}, "") is None


@pytest.mark.parametrize("text,kind", [
    *[(text, "approve") for text in ["yes", "OK!", "Approve.", "KYLLÄ", "joo", "👍", "👍🏽", "(yes)", "“kyllä”", "👍️"]],
    *[(text, "stop") for text in ["stop", "No!", "cancel", "EI.", "lopeta"]],
    *[(text, "status") for text in ["status", "Tila!", "?", "?!", "???"]],
    *[(text, "help") for text in ["help", "Apua!", "hi", "hello", "Moi.", "hei"]],
    *[(text, "check") for text in ["check now", "Check now!", "check", "Tarkista."]],
    *[(text, "new_errand") for text in ["hello help with rent", "yes please book", "10", "0", "link 12345", "link 1234567", "moi etsi sauna", "check my rent"]],
])
def test_commands(text, kind):
    assert parse_command(text).kind == kind


@pytest.mark.parametrize("text", ["link 123456", "LINK 123 456!", "linkki 1 2 3 4 5 6.", " linkki  123456 "])
def test_link(text):
    assert parse_command(text).code == "123456"


@pytest.mark.parametrize("n", range(1, 10))
def test_choose(n):
    command = parse_command(f"{n}!")
    assert (command.kind, command.n) == ("choose", n)
