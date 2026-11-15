# Vali

Vali is your valet for life in Finland, made for foreigners. Documents, money, transport, bookings, housing: message it on WhatsApp and it handles the errand. It reads the live web with Exa, answers for your situation (EU or not, student, Finnish ID or not) with the exact source links and the next errand to do, fills the real form in a cloud browser on Modal, and acts only when you tap Approve. Watches keep researching in the background and tell you only what is new.

The demo story: Bogdan, a master's student from Romania at Aalto, settling in (bank without a Finnish ID, EU registration, HSL student price, a cheaper flat) and at Junction this weekend (what to bring, a court, food, a sauna, a film). On 15 Nov Vali booked a real sauna for him from WhatsApp, after a Stop and a Continue, and the sauna confirmed it by email.

**Live:** https://bogdan-c-2206--vali-web.us-east.modal.run/

Built for the Exa "Internet Butler" challenge at Junction 2026, with Modal as the tech challenge. Submission texts, video script and slide outline: [docs/SUBMISSION.md](docs/SUBMISSION.md).

## At a glance

| | |
|---|---|
| Live app | https://bogdan-c-2206--vali-web.us-east.modal.run/ |
| Chrome extension | **Get the extension** on the live app (`/vali-extension.zip`) |
| Judges | Sign in with the demo account (email and password are in the submission notes, never in the repo). The `#demo=<token>` link opens the same account, view only. |
| Demo rules | The shared demo is closed: only the demo account writes, and **Approve** only really sends on the httpbin.org test form. Anywhere else Vali stops right before sending and says nothing reached the site. |
| Channels | WhatsApp, the web app, the Chrome extension (and a Mac app) on one shared task list |
| Built with | Exa (Agent runs, Search, Contents, Monitors, Fast search), Modal, Claude, Jev (TypeSafe AI), Aiven Postgres, WhatsApp Cloud API, ElevenLabs, Playwright |
| Tests | 154 Node tests (`npm test`) and 742 backend tests (`pytest tests/api tests/wa`) passing |

## What it does

- **Answers for your situation.** Vali asks once on WhatsApp (EU or not, student or not), or you set it in Details on the web. Answers then fit you, explain Finnish words, and end with **Next for you**: the most useful next errand, one tap away.
- **Cited answers.** One sentence, the key facts, the exact links, and on WhatsApp the page picture Exa found and any PDF form. Every sentence is checked against a quote from today's version of the page. Route questions get an HSL journey planner link with both ends filled in.
- **Bookings.** Tap **Book it**. Vali asks once for your name and email, fills the real form in a private cloud browser, sends a picture with **Approve** / **Stop**, and books only after Approve. Pay-on-site bookings are completed for real; paid tickets stop at the payment page and open in your own browser.
- **Stop and Continue.** Continue starts a fresh run told what the last one did and everything you already said, so it does not ask again. A question left unanswered pauses the run instead of going on with empty fields.
- **Watches.** "Watch ..." creates a daily Exa Monitor for things that change. Only new findings reach WhatsApp. "Check now" runs it right away.
- **Dashboard.** `#/dashboard` shows every errand, the activity feed and every search query. Click an errand to see the chat, everything Vali opened, and where it stands, with Continue, Approve or the options right there.
- **Errand page.** A short story: You asked (channel, context, details shared), Vali found (the cited answer and facts), Vali did (the browser steps in plain words), Now (the path Found, Filled, Your OK, Done, and the one thing that moves it on).
- **Sign-in.** Email and password, a WhatsApp code, or the demo link (it opens the sign-in page with **Open the demo account**).
- **Chrome extension.** Vali on the page you are on. Exa Fast search adds the fact you need as a tip on the page (for example when to apply on migri.fi). **Fill it here** fills the form on your own computer: Finnish compound labels, bilingual names, iframes and open shadow roots, placeholder dropdowns. It skips hidden spam-trap fields, blocks any submit the page starts during the fill, and never presses submit itself. Errands you start from the panel are routed by Jev like any other and stay in sync with WhatsApp and the web.
- **Mascot.** Vali sits in a corner of the web app and of every page (Chrome extension). The extension's side panel is a chat with Vali, with your errand history.

## Live eval (15 Nov, production, fake details)

Research answered 13 of 13 errands; 24 of 26 facts were confirmed on the source page (92%); median 25 s; $0.33 of Exa in total. Continue reached the approval step on 4 of 5 booking sites (Kulttuurisauna, Allas Sea Pool, play.fi padel, httpbin); Finnkino stops at its bot wall by design. Details: [docs/EVAL_CONTINUE.md](docs/EVAL_CONTINUE.md). Exa coverage: [docs/EXA_COVERAGE.md](docs/EXA_COVERAGE.md).

## Try it

- **WhatsApp:** open the live app, tap **WhatsApp**, and send the `link 123456` message it gives you. Then send an errand. Vali reacts 👀 when it is on it.
- **Web:** sign in (email and password, or the demo link), then type an errand or tap an example.
- **Chrome extension:** download it from **Get the extension** on the live app (or use `extension/` from this repo), unzip, open `chrome://extensions`, turn on Developer mode, **Load unpacked**, then sign in from its settings with the same account. The mascot appears on every page.
- **Errands to try:** "How can I open a bank account without a Finnish personal ID?", "I study my master's at Aalto. How do I get the HSL student discount?", and "Watch for new HOAS student apartments in Espoo under 700 euros a month". Open any "Filled form, not sent" errand on Home to see what Vali filled, the last picture from the cloud browser and the Exa trail.

## How Vali uses Exa

| Exa API | What for |
|---|---|
| Agent runs (`/agent/runs` + events) | Research an errand into a structured, cited answer with next steps, actions and the next errand, fitted to the person's situation. |
| Search (output schema, highlights, domain and location filters, moderation) | Quick finds. |
| Contents (at most a day old, live crawl fallback) | Re-read every cited page and check each sentence against a verbatim quote; the page picture for WhatsApp. |
| Monitors (+ signed webhook, trigger) | "Watch" errands, daily, and "check now". |
| Fast search | The extension's tip for the page you are on. |
| Search and Contents in the cloud browser | Facts a form needs, like an address or a fee, and the page's real booking or application links. |

## How it works

1. **Route.** The API picks a mode for the errand (find, check, claim, book, write, watch). Jev decides; keyword rules take over when Jev is unsure or not configured.
2. **Research.** Exa Search for quick finds, the Exa Agent for the rest, then Contents to check every sentence against a quote.
3. **Do it.** A browser sandbox on Modal: headless Chromium driven by Claude, one container per run. It looks things up with Exa while the form stays open and asks you when a choice is yours.
4. **Approve.** Anything that sends, pays, confirms or books waits for your Approve. Payments always hand off to you. Logins (Suomi.fi, bank ID), CAPTCHAs and bot walls stop the run with a reason and a link to finish yourself.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (API, task shape) and [docs/SANDBOX.md](docs/SANDBOX.md) (browser agent, guardrails, measured cost).

## Built on Modal

Modal does the heavy lifting:

- **One cloud browser per errand.** "Book it" spawns `browser_session` in its own Modal app (`backend/modal_sandbox.py`, app `vali-sandbox`): Playwright Chromium driven by Claude, 2 CPUs, 4 GB, 15-minute limit, one errand per container at a time. It writes steps, screenshots, live frames and the approval state to the shared Postgres, so WhatsApp and the web show the run as it happens.
- **Continue.** `POST /v1/tasks/{id}/continue` spawns a new run with the earlier steps, your answer and everything you said to earlier runs, so a stopped errand picks up where it stopped without asking again.
- **Research workers.** Each Exa Agent run is followed by its own `research_poller` function (15 minutes) that streams progress and runs the quote check.
- **API and web app.** One FastAPI container (`backend/modal_app.py`, app `vali`) kept warm with `min_containers=1` (up to 2 containers, 20 requests each), serving the API, the WhatsApp webhook and the web app.
- **Separate deploys.** The API and the sandbox deploy independently; the API spawns the sandbox by name.

## Channels, one task list

- **WhatsApp** (`backend/vali_wa/`). The main channel: Vali's name and picture, one-sentence answers with the page picture and PDFs, tap buttons (Book it, Next for you, Watch this, Approve / Stop, Continue), a one-time situation question, reactions instead of status messages (👀 🚀 ✍️ 👍 ✋ 🔁), and watch findings pushed to the chat.
- **Web** (`web/`). Sign-in, ask box, the errand story with numbered sources, the dashboard with errand threads, Details with your situation, and the mascot. A calm light design (Familjen Grotesk, frost, navy, one violet).
- **Chrome extension** (`extension/`). The mascot on every page, side panel on Alt+V, "Vali: take care of this" on a selection, and **Continue in my browser** for paid bookings. Both use the shared design system in `shared/`; `extension/shared/` is a copy made by `npm run sync-shared`, which also copies `shared/exa-uses.js` to `web/`.
- **Mac app** (`desktop/`, Electron). A desktop mascot, quick box and voice. Details in [desktop/README.md](desktop/README.md).

Devices link with a 6-digit code (`POST /v1/link/code`, `POST /v1/link`), so every channel shares one account.

## Privacy

- Personal details (name, email, phone, address) stay on your device, in the extension or the Mac app settings.
- The models (Exa and Claude) only see placeholders such as `{{name}}` and `{{email}}`. The sandbox types the real value at the last moment and masks it back to the placeholder in every page snapshot the model reads. Fields showing a real value are blurred in the live view and screenshots.
- Page text is redacted in the browser before it leaves: emails, phone numbers, Finnish personal identity codes, IBANs, card numbers, address lines.
- Saved details are never stored on the server. They travel only inside the execute call for that one sandbox run and are dropped when it ends (`PUT /v1/profile` is accepted for old clients and stores nothing). What you type in a chat (for example a name and email when Vali asks) is kept with that errand so Continue does not ask again.
- Your situation (EU or not, student, city, Finnish ID yes or no, bank yes or no) is stored per account, opt-in, with no name or contact details. A password is stored only as a scrypt hash.
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
