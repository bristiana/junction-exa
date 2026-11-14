import base64
import json
from types import SimpleNamespace

import pytest

from vali_media import letters


def fake_client(monkeypatch, text, stop_reason="end_turn", extra_blocks=()):
    calls = []

    class Client:
        def __init__(self):
            self.messages = self

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(stop_reason=stop_reason, content=[
                *extra_blocks, SimpleNamespace(type="text", text=text),
            ])

    monkeypatch.setattr(letters.anthropic, "Anthropic", Client)
    return calls


def envelope(text="Sender: Kela\nDeadline: 20.11.2026, amount 123,45 EUR\nErrand: Reply before the deadline.", redactions=None):
    return json.dumps({"text": text, "redactions": redactions or {}})


def test_exact_vision_request(monkeypatch):
    calls = fake_client(monkeypatch, envelope(), extra_blocks=[SimpleNamespace(type="thinking")])
    output = letters.read_letter(b"synthetic-image", "image/jpeg", "Please explain")
    assert "20.11.2026" in output and "123,45 EUR" in output
    request = calls[0]
    assert request["model"] == "claude-opus-5-5"
    assert request["max_tokens"] == 4000
    assert request["output_config"] == {"effort": "low"}
    assert not {"thinking", "temperature", "top_p", "top_k"} & request.keys()
    assert len(request["messages"]) == 1
    assert request["messages"][0]["role"] == "user"
    image, prompt = request["messages"][0]["content"]
    assert image == {"type": "image", "source": {
        "type": "base64", "media_type": "image/jpeg",
        "data": base64.b64encode(b"synthetic-image").decode(),
    }}
    assert "Please explain" in prompt["text"]
    for placeholder in ["{{name}}", "{{address}}", "{{id_code}}", "{{reference}}"]:
        assert placeholder in prompt["text"]


def test_configured_model(monkeypatch):
    monkeypatch.setenv("VALI_MODEL", "test-model")
    calls = fake_client(monkeypatch, envelope())
    letters.read_letter(b"image", "image/png")
    assert calls[0]["model"] == "test-model"


@pytest.mark.parametrize("reason", ["refusal", "max_tokens", "pause_turn"])
def test_refusal_and_truncation_fail_closed(monkeypatch, reason):
    fake_client(monkeypatch, envelope(), stop_reason=reason)
    with pytest.raises(letters.LetterError):
        letters.read_letter(b"image", "image/jpeg")


def test_personal_values_replaced_locally(monkeypatch):
    # Entirely synthetic values, deliberately echoed by a misbehaving model.
    text = "Sample Person at Examplekatu 99, reference DEMO-REF.\nErrand: Sample Person should reply."
    fake_client(monkeypatch, envelope(text, {
        "Sample Person": "{{name}}", "Sample": "{{name}}",
        "Examplekatu 99": "{{address}}", "DEMO-REF": "{{reference}}",
    }))
    output = letters.read_letter(b"image", "image/jpeg")
    assert output == "{{name}} at {{address}}, reference {{reference}}.\nErrand: {{name}} should reply."


def test_identity_and_email_defense_in_depth(monkeypatch):
    fake_client(monkeypatch, envelope("Contact demo@example.invalid. Code 010101A000A.\nErrand: Reply."))
    output = letters.read_letter(b"image", "image/jpeg")
    assert "demo@example.invalid" not in output
    assert "010101A000A" not in output
    assert "{{sender_email}}" in output and "{{id_code}}" in output


def test_sender_contact_never_becomes_the_users_own_placeholder(monkeypatch):
    # A company landlord keeps its reply address; a private sender's address and any unmapped one get sender placeholders.
    text = ("Esimerkki Kodit Oy raises the rent. Contact vuokra@example.com, +358 40 000 0001 or "
            "private@example.invalid.\nErrand: Reply to vuokra@example.com.")
    fake_client(monkeypatch, json.dumps({"text": text, "redactions": {"private@example.invalid": "{{sender_email}}"},
                                         "public": ["vuokra@example.com", "private@example.invalid"]}))
    output = letters.read_letter(b"image", "image/png")
    assert "vuokra@example.com" in output and output.endswith("Errand: Reply to vuokra@example.com.")
    assert "private@example.invalid" not in output and "{{sender_email}}" in output
    assert "{{sender_phone}}" in output and "{{email}}" not in output and "{{phone}}" not in output



def public_output(monkeypatch, text, public, redactions=None):
    fake_client(monkeypatch, json.dumps({"text": text + "\nErrand: Reply.", "redactions": redactions or {}, "public": public}))
    return letters.read_letter(b"image", "image/png")


def test_public_entry_not_in_the_text_or_not_a_contact_is_dropped(monkeypatch):
    output = public_output(monkeypatch, "Write to info@example.com or Esimerkki Kodit Oy.",
                           ["other@example.com", "Esimerkki Kodit Oy", "Testikatu 12", "info@example.com"])
    assert "info@example.com" in output and "{{sender_email}}" not in output
    output = public_output(monkeypatch, "Write to info@example.com.", ["INFO@example.com is the address"])
    assert "info@example.com" not in output and "{{sender_email}}" in output


def test_public_is_capped_at_five(monkeypatch):
    emails = [f"office{n}@example.com" for n in range(7)]
    output = public_output(monkeypatch, "Contacts: " + ", ".join(emails) + ".", emails)
    assert [e in output for e in emails] == [True] * 5 + [False] * 2
    assert output.count("{{sender_email}}") == 2


def test_a_redacted_private_email_listed_as_public_stays_masked(monkeypatch):
    output = public_output(monkeypatch, "Your landlord Sample Person: sample@example.invalid, +358 40 000 0003.",
                           ["sample@example.invalid", "+358 40 000 0003"],
                           {"Sample Person": "{{sender_name}}", "sample@example.invalid": "{{sender_email}}",
                            "+358 40 000 0003": "{{name}}"})
    assert "sample@example.invalid" not in output and "+358 40 000 0003" not in output
    assert output.startswith("Your landlord {{sender_name}}: {{sender_email}}, {{name}}.")


def test_a_model_that_still_says_email_gets_the_sender_placeholder(monkeypatch):
    # The golden letter regression: the landlord's address came back as the user's {{email}} and the draft went to the user.
    fake_client(monkeypatch, envelope("Ask the landlord at landlord@example.invalid or {{email}}.\nErrand: Email {{ EMAIL }}.",
                                      {"landlord@example.invalid": "{{ Email }}", "+358 40 000 0002": "{{PHONE}}"}))
    output = letters.read_letter(b"image", "image/png")
    assert output == "Ask the landlord at {{sender_email}} or {{sender_email}}.\nErrand: Email {{sender_email}}."


@pytest.mark.parametrize("raw", [
    "unstructured response", '{}', '{"text": "Errand: Reply."}',
    envelope("No final errand"), envelope("Errand: Reply.", {"Sample": "unsafe"}),
    json.dumps({"text": "Errand: Reply.", "redactions": {}, "public": "vuokra@example.com"}),
])
def test_invalid_output_never_returned(monkeypatch, raw):
    fake_client(monkeypatch, raw)
    with pytest.raises(letters.LetterError):
        letters.read_letter(b"image", "image/jpeg")


def test_unsupported_mime_never_calls_provider(monkeypatch):
    calls = fake_client(monkeypatch, envelope())
    with pytest.raises(letters.LetterError):
        letters.read_letter(b"image", "application/pdf")
    assert calls == []


def test_provider_failure_does_not_expose_response(monkeypatch):
    def broken():
        raise RuntimeError("sensitive-provider-message")
    monkeypatch.setattr(letters.anthropic, "Anthropic", broken)
    with pytest.raises(letters.LetterError) as error:
        letters.read_letter(b"image", "image/jpeg")
    assert "sensitive-provider-message" not in str(error.value)
