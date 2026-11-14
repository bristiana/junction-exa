# Vali media helpers

Import `upload_screenshot`, `thumbnail_url`, `transcribe`, `speak` and
`read_letter` from `hoida_media`. These synchronous helpers have no application,
store or deployment dependencies. Call them in a worker when serving async
requests. Voice functions accept a keyword-only `transport` for offline tests.

Configuration:

- `CLOUDINARY_URL`: absent means uploads return `None`; retain JPEG bytes in the
  caller's store and populate `execution.shots` with its fallback URL. Uploads
  return within a ten-second wait budget, log one safe line on failure, and use
  a bounded pool of daemon workers. A timed-out SDK call may finish later.
- `ELEVENLABS_API_KEY`: absent means `transcribe` returns `""` and `speak`
  returns `None`. `VoiceError.status_code` holds the provider status when
  available and is `None` for connection failures.
- `ELEVENLABS_STT_MODEL`: read at import; defaults to `scribe_v2`.
- `ELEVENLABS_TTS_MODEL`: read at import; defaults to `eleven_multilingual_v2`.
- `ELEVENLABS_VOICE_ID`: optional default voice, overridable by `speak`'s
  `voice_id`; otherwise uses the public documentation's example voice.
- `ANTHROPIC_API_KEY`: used by the official SDK for letter reading.
  `HOIDA_MODEL` defaults to `claude-opus-5-5`.

## API verification

Public ElevenLabs reference pages were read during implementation:

- https://elevenlabs.io/docs/api-reference/speech-to-text/convert confirms
  `POST /v1/speech-to-text`, `xi-api-key`, multipart `file`, required `model_id`,
  optional `language_code` and the synchronous JSON `text` field. Its example
  uses `scribe_v2`; the API has **no server default** for this required field.
  Vali selects that documented model as a configurable conservative default.
  Encoded audio is sent unmodified; format support is documented generically.
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert confirms
  `POST /v1/text-to-speech/{voice_id}`, `xi-api-key`, JSON `text` and `model_id`,
  default model `eleven_multilingual_v2`, and binary audio output with default
  `mp3_44100_128` (also explicitly selected by Vali).

No account/model entitlement, actual Ogg/Opus decoding, provider latency or live
response was tested. All tests use synthetic data and mocked network calls.

## Letter privacy boundary

The original photo and optional caption are sent to Claude as explicitly
requested. The model returns an internal JSON envelope with explanation and a
map of private values to placeholders. The helper returns only the explanation,
applies that map locally, additionally redacts recognizable identity/email/
phone/account formats, and rejects refusal, truncation or malformed output.
Provider failures and responses are never logged.

This is defense in depth, **not a proof of zero personal-data leakage**: a name,
address or reference missed by vision can also be missed by its redaction map.
An absolute guarantee for arbitrary photographs needs an independently trusted
redaction/review boundary before the result enters research. The helper alone
cannot establish that guarantee.
