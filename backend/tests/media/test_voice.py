import json
from email import policy
from email.parser import BytesParser

import httpx
import pytest

from hoida_media import voice


def test_missing_key_skips_network():
    def unexpected(request):
        pytest.fail("request without key")
    transport = httpx.MockTransport(unexpected)
    assert voice.transcribe(b"ogg", "audio/ogg", transport=transport) == ""
    assert voice.speak("Test", transport=transport) is None


@pytest.mark.parametrize("language_hint", [None, "fi"])
def test_transcription_multipart(monkeypatch, language_hint):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")

    def handler(request):
        assert request.method == "POST"
        assert str(request.url) == "https://api.elevenlabs.io/v1/speech-to-text"
        assert request.headers["xi-api-key"] == "test-key"
        message = BytesParser(policy=policy.default).parsebytes(
            b"Content-Type: " + request.headers["content-type"].encode() + b"\r\n\r\n" + request.content,
        )
        fields = {part.get_param("name", header="content-disposition"): part for part in message.iter_parts()}
        assert fields["model_id"].get_content().strip() == voice.STT_MODEL_ID
        assert fields["file"].get_content_type() == "audio/ogg"
        assert fields["file"].get_filename() == "voice.ogg"
        assert fields["file"].get_payload(decode=True) == b"original-ogg-opus-bytes"
        if language_hint:
            assert fields["language_code"].get_content().strip() == language_hint
        else:
            assert "language_code" not in fields
        return httpx.Response(200, json={"text": "Find a sauna."})

    assert voice.transcribe(
        b"original-ogg-opus-bytes", "audio/ogg", language_hint,
        transport=httpx.MockTransport(handler),
    ) == "Find a sauna."


def test_speak_request(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")

    def handler(request):
        assert request.method == "POST"
        assert request.url.path == "/v1/text-to-speech/test-voice"
        assert request.url.params["output_format"] == "mp3_44100_128"
        assert request.headers["xi-api-key"] == "test-key"
        assert json.loads(request.content) == {"text": "Ready.", "model_id": voice.TTS_MODEL_ID}
        return httpx.Response(200, content=b"synthetic-mp3", headers={"content-type": "audio/mpeg"})

    assert voice.speak("Ready.", "test-voice", transport=httpx.MockTransport(handler)) == b"synthetic-mp3"


def test_speak_env_voice(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "env-voice")

    def handler(request):
        assert request.url.path.endswith("/env-voice")
        return httpx.Response(200, content=b"mp3")

    assert voice.speak("Ready.", transport=httpx.MockTransport(handler)) == b"mp3"


@pytest.mark.parametrize("function,args", [
    (voice.transcribe, (b"ogg", "audio/ogg")), (voice.speak, ("Test",)),
])
def test_http_failure_is_typed_and_safe(monkeypatch, function, args):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    transport = httpx.MockTransport(lambda request: httpx.Response(429, json={"detail": "private"}))
    with pytest.raises(voice.VoiceError) as error:
        function(*args, transport=transport)
    assert error.value.status_code == 429
    assert "private" not in str(error.value)
    assert "test-key" not in str(error.value)


def test_network_failure(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")

    def handler(request):
        raise httpx.ReadTimeout("private", request=request)

    with pytest.raises(voice.VoiceError) as error:
        voice.transcribe(b"ogg", "audio/ogg", transport=httpx.MockTransport(handler))
    assert error.value.status_code is None
    assert "private" not in str(error.value)


@pytest.mark.parametrize("payload", [{}, {"text": 12}, [], {"text": None}])
def test_invalid_transcript(monkeypatch, payload):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    with pytest.raises(voice.VoiceError) as error:
        voice.transcribe(b"ogg", "audio/ogg", transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=payload),
        ))
    assert error.value.status_code == 200
