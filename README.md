# Vali

Vali is an errand butler for newcomers and international students in Finland.
You hand it an errand. Exa researches it on the live web and every fact comes with its source.
When the errand ends in a form or a booking, a cloud browser fills the real site and stops before the final button until you approve.

Built for the Exa "Internet Butler" challenge at Junction 2026. Exa judges on use of Exa, usefulness to real people, clarity of sources, originality and a working demo on live queries (20% each). The 3-minute demo script is in [docs/DEMO.md](docs/DEMO.md).

## How it works

1. **Route.** The API picks a mode for the errand (find, check, claim, book, write, watch). Jev decides; keyword rules take over when Jev is unsure or not configured.
2. **Research.** "Find" errands use Exa Search with structured output and answer in about 3 seconds. Other errands use the Exa Agent (`/agent/runs`), which returns a structured answer with field-level citations, the next steps and prepared actions (email draft, link, form values). This takes 10-90 seconds.
3. **Do it.** "Let Vali do it" starts a browser sandbox on Modal: headless Chromium, driven by Claude, one container per run. It can look things up with Exa Search and Contents while the form stays open. It shows a live view, asks you when a choice is yours, and fills the form.
4. **Approve.** Anything that sends, pays, confirms or books is blocked until you approve. Logins (Suomi.fi, bank ID), CAPTCHAs, bot walls and card pages stop the run with a one-line reason and a link to finish by hand.

## What's new

- **Exa lookups while filling a form.** When a form asks for an address, a fee, an opening time or which option applies, the browser agent searches Exa instead of guessing. Each lookup is saved on the errand (profile values masked first) and listed under "While filling the form" in "How Vali found this", next to the research queries and sources.
- **Exa cache.** Read-only Exa calls are cached for 10 minutes (256 entries). A cache hit costs nothing. Each call logs mode, time and hit or miss, never the query.
- **Questions are answered, not acted on.** "How do I book a dentist and what is the fee?" now routes to check. Vali only books, claims or writes when you ask it to.
- **Safer last step.** Submit, order and purchase buttons always need your approval. A typed newline never submits a form. A login wall is passed only through a real guest control. Autocomplete fields and dropdowns work on real sites.
- **Mac app.** A first-run welcome card (three ways to give an errand, a sample errand, link with the extension). Live captions and a state chip while you talk to Vali. The mascot bubble says whether an errand needs an approval, an answer or a hand-off. Visual polish across the quick box, the list and settings.
- **Extension.** One primary button per view, an amber edge on errands that need you, a status line under each errand, and Approve in the errand detail.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (API, task shape) and [docs/SANDBOX.md](docs/SANDBOX.md) (browser agent, guardrails, measured cost).

## Two surfaces, one task list

- **Mac app** (`desktop/`, Electron). A mascot that stays on screen. Alt+Space opens a quick box. Hold Alt+Shift+Space to say an errand, or press Alt+Shift+V to talk with Vali. Drop a photo or PDF of a letter on the mascot. Select text anywhere and press Alt+Shift+A to ask about it. Hover the mascot to see all errands at a glance, with Approve, Stop and Answer. The profile is encrypted on the Mac. `npm run dist` builds a dmg. Details in [desktop/README.md](desktop/README.md).
- **Chrome extension** (`extension/`). Side panel on Alt+V, or right-click a selection or page: "Vali: take care of this". It sends the page context with the errand (URL, title, selected text, redacted page text, form fields). The mascot peeks in on pages with a form. Both apps use the shared design system in `shared/`; `extension/shared/` is a copy made by `npm run sync-shared`.
- **WhatsApp** (`backend/vali_wa/`) is parked. Meta blocks sending from unverified business portfolios (error 131031), so Vali can receive messages but not reply. The code stays. The iMessage plan is in [docs/IMESSAGE.md](docs/IMESSAGE.md).

Devices link with a 6-digit code (`POST /v1/link/code`, `POST /v1/link`), so the Mac app and the extension share one account.

## Privacy

- Personal details (name, email, phone, address) stay on your device, in the extension or the Mac app settings.
- The models (Exa and Claude) only see placeholders such as `{{name}}` and `{{email}}`. The sandbox types the real value at the last moment and masks it back to the placeholder in every page snapshot the model reads. Fields showing a real value are blurred in the live view and screenshots.
- Page text is redacted in the browser before it leaves: emails, phone numbers, Finnish personal identity codes, IBANs, card numbers, address lines.
- Syncing details to the server, so errands without a device profile can fill forms, is opt-in (`PUT /v1/profile`).
- Page text is treated as data, never as instructions. A page that tries to steer the agent ends the run as "suspicious page".

## Partners and where they are used

| Partner | Where |
|---|---|
| Exa | Search with structured output for "find" errands (`vali_api/research.py`). Agent runs for research with citations. Search and Contents as tools inside the browser sandbox (`vali_agent/`). |
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
| `backend/vali_wa/` | WhatsApp Cloud API channel (parked): webhook parsing, flow, message rendering. |
| `backend/vali_media/` | Screenshots, voice notes, letter reading. |
| `backend/modal_app.py`, `backend/modal_sandbox.py` | Modal apps `vali` and `vali-sandbox`. |
| `backend/modal_smoke.py` | Ephemeral Modal runs of the sandbox on fixtures or real sites. |
| `backend/tests/` | pytest, all offline (fake Exa, fake models, local HTML fixtures). |
| `scripts/golden.py` | Live checks against the deployed API. |
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
