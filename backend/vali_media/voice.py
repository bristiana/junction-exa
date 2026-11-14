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


def _request(method: str, path: str, key: str, transport: httpx.BaseTransport | None, **kwargs) -> httpx.Response:
    try:
        with httpx.Client(transport=transport, timeout=30.0) as client:
            response = client.request(
                method, f"{API_URL}/{path}", headers={"xi-api-key": key}, **kwargs,
            )
            response.raise_for_status()
            return response
    except httpx.HTTPStatusError as exc:
        raise VoiceError("Vali voice request rejected", exc.response.status_code) from None
    except httpx.RequestError:
        raise VoiceError("Vali voice connection failed") from None


def _post(path: str, key: str, transport: httpx.BaseTransport | None, **kwargs) -> httpx.Response:
    return _request("POST", path, key, transport, **kwargs)


# connection type -> (endpoint, response field, field the JS client takes)
CONVERSATION_CREDENTIALS = {
    "webrtc": ("convai/conversation/token", "token", "conversation_token"),
    "websocket": ("convai/conversation/get-signed-url", "signed_url", "signed_url"),
}


def conversation_credentials(
    agent_id: str, *, api_key: str, connection: str = "webrtc",
    transport: httpx.BaseTransport | None = None,
) -> dict:
    """Short-lived start credentials for a private agent (WebRTC token or WebSocket signed URL)."""
    path, field, name = CONVERSATION_CREDENTIALS[connection]
    response = _request("GET", path, api_key, transport, params={"agent_id": agent_id})
    try:
        value = response.json()[field]
        if not isinstance(value, str) or not value:
            raise ValueError
    except (ValueError, KeyError, TypeError):
        raise VoiceError("Vali voice session response is invalid", response.status_code) from None
    return {name: value}


# Container names ElevenLabs recognises; Safari and macOS record .m4a or .caf.
AUDIO_EXTENSIONS = {
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav",
    "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
    "audio/x-caf": "caf", "audio/caf": "caf",
}


def audio_filename(mime_type: str) -> str:
    return "voice." + AUDIO_EXTENSIONS.get(mime_type.split(";")[0].strip().lower(), "bin")


def transcribe(
    audio_bytes: bytes, mime_type: str, language_hint: str | None = None,
    *, api_key: str, transport: httpx.BaseTransport | None = None,
) -> str:
    """Transcribe original bytes, including Ogg/Opus, without transcoding."""
    if not api_key:
        return ""
    data = {"model_id": STT_MODEL_ID}
    if language_hint:
        data["language_code"] = language_hint
    filename = audio_filename(mime_type)
    response = _post(
        "speech-to-text", api_key, transport, data=data,
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
