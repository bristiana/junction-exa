# Vali architecture

Vali takes an errand off your hands. You hand it off from the Mac app or the Chrome extension; both share one task list. WhatsApp is parked (see below).

1. **Research** (Exa Agent): finds what matters on the live web, returns a structured answer with field-level citations and prepared actions.
2. **Do it** (Modal sandbox): a headless Chromium in its own Modal container, driven by Claude, opens the real site and fills the form or booking. It stops before the final submit.
3. **Approve**: you see screenshots and the filled values in the Mac app or the extension, and say yes. Only then does the sandbox submit.

```
Mac app (Electron) ─┐                       ┌─ Exa Agent API (research)
                    ├─ Vali API (Modal app vali, FastAPI) ─┤
Chrome extension ───┘     │  Postgres (Aiven)  └─ browser sandbox (Modal app vali-sandbox, Playwright + Claude)
                          │  ElevenLabs: speech-to-text, voice agent
WhatsApp (parked) ────────┘  screenshots (Cloudinary, optional)
```

WhatsApp is parked. Meta blocks sending from unverified business portfolios (error 131031), so Vali can receive messages but not reply. The code stays in `backend/vali_wa/`. The plan for a replacement chat channel is in `docs/IMESSAGE.md`.

## Repository layout

| Path | What |
|---|---|
| `desktop/` | Mac app (Electron): mascot, quick box, voice, letters, all errands at a glance. See `desktop/README.md`. |
| `extension/` | Chrome MV3 extension (side panel). Works directly against Exa when no backend is set ("direct mode"). |
| `shared/` | Shared design system (`tokens.css`, `components.css`, `preview.html`). `extension/shared/` is a copy made by `npm run sync-shared`. |
| `backend/vali_api/` | FastAPI app, store, Exa research, routing, uploads, voice agent routes, WhatsApp webhook. |
| `backend/vali_media/`, `backend/vali_wa/` | Speech-to-text and letter reading; the parked WhatsApp channel. |
| `backend/scripts/elevenlabs_agent.py` | Sets up the ElevenLabs voice agent and its webhook tools. See `backend/vali_api/VOICE.md`. |
| `backend/vali_agent/` | The browser agent: Playwright wrapper + Claude tool loop. No Modal import, runs locally too. |
| `backend/modal_app.py` | Modal app `vali` (the API): image, secret `vali`, web endpoint, `research_poller`. |
| `backend/modal_sandbox.py` | Modal app `vali-sandbox` (the browser): `browser_session`. The API starts it by name and falls back to its own copy if it is not deployed. |
| `backend/tests/` | pytest, all offline (fake Exa, fake LLM, local HTML fixtures). |

## Environment (`.env`, never committed; on Modal: `modal secret create vali --from-dotenv .env`)

| Variable | Used for | Required |
|---|---|---|
| `EXA_API_KEY` | research | yes |
| `ANTHROPIC_API_KEY` | browser agent | yes for "do it" |
| `VALI_MODEL` | Claude model for the browser agent, default `claude-opus-5-5` | no |
| `JEV_API_KEY` | errand routing with Jev; without it keyword rules route | no |
| `DATABASE_URL` | Postgres (Aiven). Without it: SQLite at `VALI_SQLITE_PATH` (default `vali.db`) | no |
| `CLOUDINARY_URL` | screenshot hosting. Without it: screenshots served by the API from the store | no |
| `ELEVENLABS_API_KEY` | speech to text for `/v1/voice`; voice agent sessions | no |
| `VALI_ELEVENLABS_AGENT_ID` | the ElevenLabs agent that `/v1/voice/session` starts | no |
| `VALI_VOICE_TOOL_SECRET` | secret on the voice tool webhooks; also signs the per-user session token | no |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp Cloud API (parked) | no |
| `VALI_PUBLIC_URL` | public base URL of the API (links in messages and tool webhooks) | no |
| `VALI_ALLOWED_ORIGINS`, `VALI_DAILY_CAP_USD` | extra CORS origins; daily research spend cap per account (default 2.0) | no |

The voice agent needs all three of `ELEVENLABS_API_KEY`, `VALI_ELEVENLABS_AGENT_ID` and `VALI_VOICE_TOOL_SECRET`; otherwise its endpoints return 503.

## Identity and shared context

No accounts. The Mac app or the extension calls `POST /v1/users` once and keeps `{user_id, token}`. Authenticated calls send `Authorization: Bearer <token>`. Device linking also lets a second device exchange a one-use code for that same token without creating another user.
WhatsApp (parked) is linked by a pairing code: the extension calls `POST /v1/pair`, shows a 6-digit code, the user sends `link 123456` to the Vali WhatsApp number. From then on that number acts as that user: tasks started on either side appear on both.

Personal details (name, email, address, ...) live on the device. In the Mac app the profile is encrypted locally with Electron safeStorage and only sent with "Let Vali do it". The LLMs only ever see placeholders like `{{name}}`; real values are substituted inside the sandbox at typing time and masked back to placeholders in every page snapshot the LLM sees. The server never stores a profile: it travels only inside the execute call and is held in memory for that one sandbox run. `PUT /v1/profile` is a no-op kept for old clients, and profiles saved before this change were cleared once.

All `VALI_*` settings also accept the legacy `HOIDA_*` name when the new name is unset. An explicitly empty new value takes precedence. This includes `VALI_EFFORT` and `VALI_PRICES`.

## API (JSON except multipart uploads, base `VALI_PUBLIC_URL`)

| Method and path | Body | Returns |
|---|---|---|
| `GET /health` | | `{ok, exa, anthropic, jev, db, cloudinary, whatsapp, elevenlabs, voice_agent}` booleans for configured services |
| `GET /privacy`, `GET /terms` | | HTML pages |
| `POST /v1/users` | | `{user_id, token}` |
| `GET /v1/me` | | `{user_id, whatsapp_linked, whatsapp_last4, profile_synced}` |
| `PUT /v1/profile` | `{profile: {...}}` (accepted, never stored) | `{ok}` |
| `POST /v1/pair` | | `{code, expires_at}` (6 digits, 10 min) |
| `POST /v1/tasks` | `{task, page?, effort?, previous_task_id?}` | Task |
| `POST /v1/voice` | Bearer auth; multipart `audio` (webm/ogg/m4a/caf/wav, max 10 MiB), `create?` (`"1"` creates task) | `{text}` or Task plus `text`; 400 empty/no speech, 413 oversized, 415 unsupported, 503 unconfigured |
| `POST /v1/letters` | Bearer auth; multipart `file` (jpeg/png/webp/heic/pdf, max 10 MiB), `note?` | Task with note (default `Explain this letter and tell me what to do`) and redacted summary in `page: {title: "Uploaded letter", url: "", text, selection}`; 400 unreadable PDF/HEIC, 413 oversized, 415 unsupported, 503 unconfigured |
| `POST /v1/link/code` | Bearer auth; no body | `{code: "123456", expires_in: 600}`; replaces that user's previous device code |
| `POST /v1/link` | No auth; `{code: "123456"}` (string preserves leading zeros) | `{token}` (same bearer token); one use, 404 unknown/expired/spent, 429 rate limit |
| `GET /v1/tasks?limit=30` | | `{tasks: [Task]}` newest first, both sources |
| `GET /v1/tasks/{id}` | | Task |
| `POST /v1/tasks/{id}/cancel` | | Task |
| `POST /v1/voice/session` | Bearer auth; `?connection=webrtc` (default) or `websocket` | `{conversation_token}` or `{signed_url}`, `dynamic_variables`; 503 unconfigured |
| `POST /v1/voice/tools/{name}` | `X-Vali-Tool-Secret` and `X-Vali-Session` headers; `{id?, text?}` | `{result}` short speakable text. Called by the ElevenLabs agent, not by clients. See `backend/vali_api/VOICE.md` |
| `POST /v1/tasks/{id}/messages` | `{text}` | Task (answer to a question from the sandbox) |
| `POST /v1/tasks/{id}/execute` | `{action_index?, start_url?, goal?, profile?}` | Task (execution starts) |
| `POST /v1/tasks/{id}/approve` | | Task |
| `POST /v1/tasks/{id}/stop` | | Task |
| `GET /v1/tasks/{id}/shots/{n}.jpg?t=<token>` | | JPEG (only when Cloudinary is not configured) |
| `GET /v1/tasks/{id}/live.jpg?t=<token>` | | latest live frame of the running sandbox (JPEG, `Cache-Control: no-store`), 404 when none. The sandbox writes it with `store.put_live_frame(task_id, jpeg)` about twice a second; clients refresh it while `execution.status` is `running` or `awaiting_approval` |
| `GET /webhooks/whatsapp` | Meta verification (`hub.mode`, `hub.verify_token`, `hub.challenge`) | challenge |
| `POST /webhooks/whatsapp` | Meta webhook, signature checked with `WHATSAPP_APP_SECRET` | `{ok}` |

`page` is what the extension captured: `{url, title, selection, text, fields: [{id, label, type, required, options?}]}`. Page text is redacted in the extension before it is sent.

Uploads share the task creation user rate limit and daily spend cap, including transcript-only voice requests. Provider failures return 502. PDFs require extractable text (up to 100 pages and 100000 characters); scanned PDFs are rejected. HEIC and images over 5 MB or 4096 px are re-encoded to JPEG before vision. Uploads are capped at 10 MiB (about 11 MiB for the whole request). Only the redacted summary is stored as letter context; filenames are not stored. Device codes are stored hashed in `device_link_codes` on both database engines; the bearer token is encrypted under a salted scrypt-derived code key for the ten-minute handoff. Issuance and redemption each allow 10 requests per ten minutes per user/IP respectively, in addition to the existing IP guard. Limits remain process-local, as for task creation. Link responses carry `Cache-Control: no-store`.

### Task

```json
{
  "id": "t_…", "user_id": "u_…", "source": "extension | whatsapp | voice | monitor",
  "task": "My flight AY123 was 4 hours late…",
  "created_at": "ISO", "updated_at": "ISO",
  "page": {"url": "…", "title": "…", "fields": [ … ]} ,
  "research": {
    "status": "queued | running | completed | failed | cancelled",
    "run_id": "agent_run_…",
    "progress": [{"kind": "search | source", "text": "…", "url": "…"}],
    "output": {"text": "…", "structured": { … see schema … }, "grounding": [{"field": "steps[0].detail", "citations": [{"url": "…", "title": "…"}], "confidence": "high"}]},
    "cost": 0.04, "stop_reason": "schema_satisfied", "error": null
  },
  "execution": null
}
```

### Modes and research kinds

`POST /v1/tasks` first routes the errand (`backend/vali_api/router.py`): Jev (TypeSafe AI, a typed decision model, ~0.3 s) picks the mode, with each choice asked twice in reversed order; keyword rules take over when Jev is not configured, fails or is unsure. The task gets `"mode": "find | check | claim | book | watch | write"` and `research.kind`:

| kind | Exa call | Used for | Latency |
|---|---|---|---|
| `search` | `POST /search` with `type: "auto"`, `contents.highlights`, `outputSchema` (find schema, max 10 properties, 2 levels) | find and compare | ~3 s, answered inline in the POST response |
| `agent` | `POST /agent/runs` with the full schema, polled by `research_poller` | check, claim, book, write | 10-90 s |
| `monitor` | `POST /monitors` with webhook `VALI_PUBLIC_URL/webhooks/exa` | watch | recurring |

Both search and agent outputs carry the same `grounding` shape (`[{field, citations: [{url, title}], confidence}]`), so the clients render them the same way. The find schema returns `{answer, options: [{name, detail, price, url}], next_step}`; it is mapped into the common structured shape (`answer`, `key_facts`, `actions` with one `open_link` per option) before it is stored.

Extra endpoints for watches: `GET /v1/watches`, `DELETE /v1/watches/{id}`, `POST /webhooks/exa` (Exa Monitors delivery; new items become a task update with `source: "monitor"` and a WhatsApp/extension notification).

`research.output.structured` follows the schema in `extension/lib/task.js` (`answer`, `status`, `key_facts`, `steps`, `actions`, `missing_info`, `form_fill`). The Python port lives in `backend/vali_api/research.py` and must stay identical (same system prompt, same schema).

`execution` once "do it" starts:

```json
{
  "status": "starting | running | awaiting_approval | submitting | done | failed | stopped",
  "goal": "…", "start_url": "https://…", "current_url": "https://…",
  "steps": [{"n": 1, "at": "ISO", "text": "Opened finnair.com/claims", "shot": 1}],
  "shots": [{"n": 1, "url": "https://res.cloudinary.com/… or /v1/tasks/{id}/shots/1.jpg"}],
  "approval": {"summary": "Claim form filled: EU261, €400, booking {{booking_reference}}", "filled": [{"label": "Full name", "value": "{{name}}"}]},
  "result": "Claim submitted, reference FC-12345", "error": null
}
```

The store keeps `research` and `execution` in separate columns so the research poller and the sandbox never overwrite each other.

## Mac app and voice

The Mac app (`desktop/`) talks to the same API as the extension. Alt+Space opens the quick box, and holding Alt+Shift+Space records an errand that goes to `POST /v1/voice` with `create=1`. A dropped photo or PDF goes to `POST /v1/letters`. Alt+Shift+A attaches the current selection. Alt+Shift+V starts a spoken conversation: the app calls `POST /v1/voice/session` and joins the ElevenLabs agent, which works through the tool webhooks. The mascot shows every errand at a glance with Approve, Stop and Answer. Linking with the extension uses `POST /v1/link/code` and `POST /v1/link`. `npm run dist` in `desktop/` builds an unsigned dmg.

## Browser agent interface (`backend/vali_agent`)

```python
def run_browser_agent(
    goal: str,                 # what to do, written by the API from the research output and the chosen action
    start_url: str,
    profile: dict[str, str],   # real personal values, used only for {{placeholder}} substitution
    hooks: AgentHooks,         # on_step(text, jpeg_bytes|None) ; wait_for_approval(summary, filled) -> bool ; should_stop() -> bool
    llm: LLM | None = None,    # defaults to Claude (VALI_MODEL); tests pass a scripted fake
    max_steps: int = 30,
    headless: bool = True,
) -> AgentResult               # status: "done" | "failed" | "stopped" ; result text ; final_url
```

Guardrail: a click on anything that looks like a final submit (submit, send, pay, confirm, book, lähetä, maksa, vahvista, varaa, tilaa) is refused until `request_approval` returned true. Logins, CAPTCHAs and payment pages end the run with status `failed` and a reason, so the user can finish by hand from `final_url`.
