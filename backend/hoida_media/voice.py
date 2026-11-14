"""ElevenLabs REST helpers. No key means voice is disabled, without a request."""

import os
from urllib.parse import quote

import httpx

STT_MODEL_ID = os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v2")
TTS_MODEL_ID = os.environ.get("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2")
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
API_URL = "https://api.elevenlabs.io/v1"


class VoiceError(RuntimeError):
    """Safe provider failure; status_code is None for transport failures."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _post(path: str, key: str, transport: httpx.BaseTransport | None, **kwargs) -> httpx.Response:
    try:
        with httpx.Client(transport=transport, timeout=30.0) as client:
            response = client.post(
                f"{API_URL}/{path}", headers={"xi-api-key": key}, **kwargs,
            )
            response.raise_for_status()
            return response
    except httpx.HTTPStatusError as exc:
        raise VoiceError("Vali voice request rejected", exc.response.status_code) from None
    except httpx.RequestError:
        raise VoiceError("Vali voice connection failed") from None


def transcribe(
    audio_bytes: bytes, mime_type: str, language_hint: str | None = None,
    *, transport: httpx.BaseTransport | None = None,
) -> str:
    """Transcribe original bytes, including Ogg/Opus, without transcoding."""
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        return ""
    data = {"model_id": STT_MODEL_ID}
    if language_hint:
        data["language_code"] = language_hint
    extensions = {"audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav"}
    filename = "voice." + extensions.get(mime_type.split(";")[0].strip(), "bin")
    response = _post(
        "speech-to-text", key, transport, data=data,
        files={"file": (filename, audio_bytes, mime_type)},
    )
    try:
        payload = response.json()
        text = payload["text"]
        if not isinstance(text, str):
            raise ValueError
        return text
    except (ValueError, KeyError, TypeError):
        raise VoiceError("Vali voice response has no transcript", response.status_code) from None


def speak(
    text: str, voice_id: str | None = None,
    *, transport: httpx.BaseTransport | None = None,
) -> bytes | None:
    """Generate an MP3 reply; voice can also be set with ELEVENLABS_VOICE_ID."""
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        return None
    voice = voice_id or os.environ.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE_ID
    response = _post(
        f"text-to-speech/{quote(voice, safe='')}", key, transport,
        params={"output_format": "mp3_44100_128"},
        json={"text": text, "model_id": TTS_MODEL_ID},
    )
    return response.content
