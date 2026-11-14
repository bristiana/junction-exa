# Vali

Vali is your valet for life in Finland, for foreigners who just arrived. Documents, money, transport, bookings, housing: message it on WhatsApp and it handles the errand. It reads the live web with Exa, answers with the exact source links, fills the real form in a cloud browser, and acts only when you tap Approve. Watches keep researching in the background and tell you only what is new.

**Live:** https://bogdan-c-2206--vali-web.us-east.modal.run/

Built for the Exa "Internet Butler" challenge at Junction 2026. Submission texts, video script and slide outline: [docs/SUBMISSION.md](docs/SUBMISSION.md).

## What it does

- **Cited answers.** "Can I open a bank account without a Finnish ID?" gets an answer in about 30 seconds from the Danske Bank, Nordea and DVV pages, each sentence checked against a quote.
- **Bookings.** Tap **Book it**. Vali asks once for your name or email (or asks before using saved details), fills the real form, sends a screenshot with **Approve** / **Stop**, and books only after Approve. Pay-on-site bookings (Kulttuurisauna) are completed for real. Paid ones (cinema at Gilda) stop at the payment page, and **Continue in my browser** opens the same cart in your own Chrome so you pay yourself.
- **Watches.** "Watch ..." creates a daily Exa Monitor. Only new findings reach WhatsApp. "Check now" runs it right away.
- **Dashboard.** `#/dashboard` shows every errand by channel, Exa searches, pages read, quotes checked, Exa cost, the activity feed and every search query.
- **Mascot.** Vali sits in a corner of the web app and of every page (Chrome extension). Click it and ask anything about the page.

## Try it

- **WhatsApp:** open the live app, tap **WhatsApp**, and send the `link 123456` message it gives you. Then send an errand. Vali reacts 👀 when it is on it.
- **Web:** type an errand in the live app, or tap an example.
- **Chrome extension:** `chrome://extensions`, Developer mode, "Load unpacked", pick `extension/`. The mascot appears on every page.

## How Vali uses Exa

| Exa API | What for |
|---|---|
| Agent runs (`/agent/runs` + events) | Research an errand into a structured, cited answer with next steps and actions. |
| Search (output schema + highlights) | Quick finds. |
| Contents | Re-read every cited page and check each sentence against a verbatim quote. |
| Monitors (+ signed webhook, trigger) | "Watch" errands, daily, and "check now". |
| Fast search | The extension's tip for the page you are on. |
| Search and Contents in the cloud browser | Facts a form needs, like an address or a fee. |

## How it works

1. **Route.** The API picks a mode for the errand (find, check, claim, book, write, watch). Jev decides; keyword rules take over when Jev is unsure or not configured.
2. **Research.** Exa Search for quick finds, the Exa Agent for the rest, then Contents to check every sentence against a quote.
3. **Do it.** A browser sandbox on Modal: headless Chromium driven by Claude, one container per run. It looks things up with Exa while the form stays open and asks you when a choice is yours.
4. **Approve.** Anything that sends, pays, confirms or books waits for your Approve. Payments always hand off to you. Logins (Suomi.fi, bank ID), CAPTCHAs and bot walls stop the run with a reason and a link to finish yourself.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (API, task shape) and [docs/SANDBOX.md](docs/SANDBOX.md) (browser agent, guardrails, measured cost).

## Channels, one task list

- **WhatsApp** (`backend/vali_wa/`). The main channel: Vali's name and picture, tap buttons for actions, Approve / Stop on bookings, reactions instead of status messages (👀 🚀 ✍️ 👍 ✋), and watch findings pushed to the chat.
- **Web** (`web/`). Ask box, errands, answers with numbered sources, the dashboard, and the mascot.
- **Chrome extension** (`extension/`). The mascot on every page, side panel on Alt+V, "Vali: take care of this" on a selection, and **Continue in my browser** for paid bookings. Both use the shared design system in `shared/`; `extension/shared/` is a copy made by `npm run sync-shared`, which also copies `shared/exa-uses.js` to `web/`.
- **Mac app** (`desktop/`, Electron). A desktop mascot, quick box and voice. Details in [desktop/README.md](desktop/README.md).

Devices link with a 6-digit code (`POST /v1/link/code`, `POST /v1/link`), so every channel shares one account.

## Privacy

- Personal details (name, email, phone, address) stay on your device, in the extension or the Mac app settings.
- The models (Exa and Claude) only see placeholders such as `{{name}}` and `{{email}}`. The sandbox types the real value at the last moment and masks it back to the placeholder in every page snapshot the model reads. Fields showing a real value are blurred in the live view and screenshots.
- Page text is redacted in the browser before it leaves: emails, phone numbers, Finnish personal identity codes, IBANs, card numbers, address lines.
- Personal details are never stored on the server. They travel only inside the execute call for that one sandbox run and are dropped when it ends (`PUT /v1/profile` is accepted for old clients and stores nothing).
- Page text is treated as data, never as instructions. A page that tries to steer the agent ends the run as "suspicious page".

## Partners and where they are used

| Partner | Where |
|---|---|
| Exa | Search with structured output for "find" errands (`vali_api/research.py`). Agent runs for research with citations. Contents for the quote check. Monitors for watches. Search and Contents as tools inside the browser sandbox (`vali_agent/`). |
| Modal | The API (`backend/modal_app.py`, app `vali`) with research pollers, and the browser sandbox as its own app (`backend/modal_sandbox.py`, app `vali-sandbox`, 2 CPU, 4 GB, one container per run). |
| Aiven | Postgres for users, the shared task list, WhatsApp pairing and watches (`DATABASE_URL`). Locally the store falls back to SQLite. |
| Jev | Errand routing (`vali_api/router.py`, `vali_api/jev.py`) and, in the sandbox, finding the element to click when the page re-rendered, plus a stricter second opinion on the submit guard (`vali_agent/jev.py`). |
| ElevenLabs | Speech-to-text for voice errands (`vali_media/voice.py`) and the Talk to Vali voice agent (`backend/vali_api/VOICE.md`). |
| Claude | Drives the browser sandbox (`claude-opus-5-5`, effort low, prompt caching) and reads photos of letters (`vali_media/letters.py`). |
| Codex | Used to build: Codex workers wrote and checked code alongside Claude Code. |

Cloudinary support exists for screenshots (`vali_media/screenshots.py`) but is not configured on the deployed API; the API serves screenshots itself. "Watch" errands create a daily Exa Monitor with a signed webhook (max 3 per user).

## Repo layout

| Path | What |
|---|---|
| `extension/` | Chrome MV3 extension: side panel, mascot, page redaction, API client. Works directly against Exa when no server is set. |
| `desktop/` | Mac app (Electron). Copies the extension panel and mascot into `vendor/` at start. See [desktop/README.md](desktop/README.md). |
| `shared/` | Shared design system (tokens and components). |
| `backend/vali_api/` | FastAPI app: routes, store, Exa research, routing, limits, uploads, voice agent, WhatsApp webhook. |
| `backend/vali_agent/` | Browser agent: Playwright wrapper, Claude tool loop, privacy, submit guard, live view. No Modal import, runs locally too. |
| `backend/vali_wa/` | WhatsApp Cloud API channel: webhook parsing, flow, message rendering. |
| `backend/vali_media/` | Screenshots, voice notes, letter reading. |
| `backend/modal_app.py`, `backend/modal_sandbox.py` | Modal apps `vali` and `vali-sandbox`. |
| `backend/modal_smoke.py` | Ephemeral Modal runs of the sandbox on fixtures or real sites. |
| `backend/tests/` | pytest, all offline (fake Exa, fake models, local HTML fixtures). |
| `scripts/golden.py` | Live checks against the deployed API. |
| `scripts/harness/run.py` | Phrase-suite harness: scores any phrase on the live API (`--suite video|judges|newcomers|all`, `--grade`), writes `latest.md`. |
| `scripts/mock-backend.mjs` | Mock API with canned answers, no keys. |
| `test/` | Node tests for the extension. |
| `docs/` | Brief, architecture, sandbox, errand test set, demo sites, demo script. |

## Local setup

Copy `.env.example` to `.env` and fill in the keys. `.env` is never committed. Only `EXA_API_KEY` is required for research and `ANTHROPIC_API_KEY` for "do it"; the rest are optional.

Backend:

```sh
python3.13 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/python -m playwright install chromium
backend/.venv/bin/python -m pytest backend/tests -q
```

Run the API locally (SQLite at `VALI_SQLITE_PATH`, default `vali.db`):

```sh
cd backend && .venv/bin/uvicorn vali_api.app:app --env-file ../.env --port 8000
```

Run the browser agent locally with a visible browser and approval in the terminal:

```sh
cd backend && .venv/bin/python -m vali_agent --url https://httpbin.org/forms/post --goal "Fill the order form with {{name}}" --headful
```

Extension:

```sh
npm test
```

Then open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick `extension/`. In the panel settings the default server is the deployed API; you can point it at `http://localhost:8000` or the mock.

Mock backend (no keys, canned answers, fake WhatsApp messages):

```sh
npm run mock    # http://127.0.0.1:8787
curl -X POST http://127.0.0.1:8787/mock/demo    # seeds every task state in the panel
```

Desktop:

```sh
cd desktop
npm install
npm start
npm test
```

## Deploy

```sh
modal secret create vali --from-dotenv .env
modal deploy backend/modal_sandbox.py   # app vali-sandbox, the browser
modal deploy backend/modal_app.py       # app vali, the API
```

The API is served at `https://bogdan-c-2206--vali-web.us-east.modal.run`. It starts browser runs on `vali-sandbox` by name and falls back to its own copy when the sandbox app is not deployed. Redeploy the sandbox after any change in `backend/vali_agent/`. `GET /health` lists which services are configured.

## Golden checks

`scripts/golden.py` runs three errands in parallel against the deployed API and prints PASS or FAIL, time and cost for each:

- **find**: "Find a sauna in Helsinki open tonight for 6 people" must route to find and end with citations.
- **claim**: "My Finnair flight HEL-BCN was 4 hours late, what can I get?" must route to claim and end with an answer.
- **execute**: the httpbin test order form (an echo service) is filled with test data, must reach approval with a live frame, is approved only when the page is on httpbin.org, and must end done.

```sh
curl -s -X POST https://bogdan-c-2206--vali-web.us-east.modal.run/v1/users   # gives {user_id, token}
GOLDEN_TOKEN=... backend/.venv/bin/python scripts/golden.py
backend/.venv/bin/python scripts/golden.py --token-file /path/to/token --only find,claim
```

The exit code is 1 if any errand fails. The token is never printed.

## Verified on real sites

With test data, always stopped before the final button: the Löylykontti sauna booking for 8 (stops before "Accept terms and pay") and the City of Helsinki "Report a problem" form (stops before "Send"). Typical run: 50-60 seconds and $0.20-0.40 of Claude. Details in [docs/SANDBOX_REPORT.md](docs/SANDBOX_REPORT.md).
