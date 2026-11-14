# Talk to Vali (ElevenLabs agent)

The voice conversation runs on an ElevenLabs agent. The agent does errands only through webhook
tools that call this API. Code: `voice_agent.py` (routes, session tokens, tools),
`vali_media/voice.py` (`conversation_credentials`), `backend/scripts/elevenlabs_agent.py` (agent setup).

## Environment

| Variable | Used for |
|---|---|
| `ELEVENLABS_API_KEY` | session credentials (and speech-to-text) |
| `VALI_ELEVENLABS_AGENT_ID` | the agent the sessions start |
| `VALI_VOICE_TOOL_SECRET` | shared secret on every tool webhook; also signs the per-user session token |

All three must be set, or the session and tool endpoints return 503. `/health` reports `voice_agent`.

## Setup

1. Generate a long random value for `VALI_VOICE_TOOL_SECRET` and put it in `.env`.
2. With `ELEVENLABS_API_KEY` and `VALI_VOICE_TOOL_SECRET` exported (and optionally `VALI_PUBLIC_URL`,
   `ELEVENLABS_VOICE_ID`), run `backend/.venv/bin/python backend/scripts/elevenlabs_agent.py`.
   The script is idempotent. It stores the secret as an ElevenLabs workspace secret (the name includes a
   fingerprint, so a new value creates a new secret), creates or updates the 7 webhook tools, then
   creates or updates the agent named "Vali" with `platform_settings.auth.enable_auth` on.
3. Put the printed `VALI_ELEVENLABS_AGENT_ID` in `.env`, recreate the Modal secret
   (`modal secret create vali --from-dotenv .env --force`), and redeploy.

## Endpoints

| Method and path | Auth | Returns |
|---|---|---|
| `POST /v1/voice/session?connection=webrtc` (default) or `websocket` | Bearer | `{conversation_token}` (WebRTC) or `{signed_url}` (WebSocket), plus `connection_type`, `expires_in: 900`, `dynamic_variables: {secret__vali_session}`. `Cache-Control: no-store`. 10 per 10 min per user. 502 when ElevenLabs fails, 503 when not configured |
| `POST /v1/voice/tools/{name}` | `X-Vali-Tool-Secret` and `X-Vali-Session` headers | `{result: "<short speakable text>"}`. 401 bad secret or session, 404 unknown tool, 503 not configured |

The client starts the conversation with the ElevenLabs JS client (`@elevenlabs/client`) and passes the
returned dynamic variables:

```js
const s = await api('/v1/voice/session', {method: 'POST'});
await Conversation.startSession({conversationToken: s.conversation_token, connectionType: 'webrtc',
                                 dynamicVariables: s.dynamic_variables});
```

The credential must be used within 15 minutes. The session token is valid for 2 hours.

## Identity

Dynamic variables come from the client, so the tools never trust a plain user id. `secret__vali_session`
is `user_id.expiry.HMAC-SHA256(VALI_VOICE_TOOL_SECRET)`, issued only to the bearer of that user's token.
ElevenLabs sends it as the `X-Vali-Session` header. `secret__` variables are not shown to the LLM and are
redacted in conversation logs. Every tool resolves errands through the same `owned()` check as the REST API,
so an id belonging to someone else answers "I can't find that errand."

## Tools (JSON body `{id?, text?}`; without `id` the current errand is used, the same choice WhatsApp makes)

| Tool | Does |
|---|---|
| `create_errand(text)` | creates a task with `source: "voice"`; quick finds answer at once |
| `list_errands()` | the 5 latest errands, one line each, with ids for the agent |
| `errand_status(id)` | status line: researching, answer, waiting for OK, question, done, failed |
| `approval_summary(id)` | what will be submitted, placeholders spoken as "your name"; records that it was read back |
| `approve(id)` | approves only after `approval_summary` was read for this exact approval (`execution.voice_read_back`); a changed approval needs a new read back |
| `stop(id)` | stops the sandbox, or cancels research when nothing runs yet |
| `answer_question(id, text)` | sends the answer to the running sandbox's inbox (`source: "voice"`) |
