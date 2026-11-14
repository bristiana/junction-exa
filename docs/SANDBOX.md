# Vali sandbox ("do it for me")

The sandbox opens the real website in a cloud browser on Modal, fills the form or booking from the research output and the user's placeholders, shows what it is doing live, and stops before the final submit until the user approves.

## How it works

```
POST /v1/tasks/{id}/execute ─> browser_session.spawn() (Modal, 2 CPU, 4 GB, 15 min)
   └─ run_browser_session (hoida_api/app.py) wires hooks to the store
        └─ run_browser_agent (hoida_agent/agent.py): Claude tool loop over a Playwright Chromium page
             ├─ page tools: open_url, read_page, click, type_text, select_option, set_checkbox, press_key, scroll, look
             ├─ Exa tools:  exa_search, exa_read (live web, without leaving the form)
             ├─ ask_user:   one question to the user, answered from the extension or WhatsApp
             └─ request_approval / finish / fail
```

- **Model.** `claude-opus-5-5` (`HOIDA_MODEL`), effort `low`, prompt caching on, server-side fallback on refusals. Max 30 actions per run.
- **Jev finds what to click.** `click` takes a ref and a short target ("19:30 Suvi slot"). When the ref is null or the page re-rendered, Jev picks the element for the target among the 25 best-matching snapshot lines (about 0.2 s, no extra model turn; 13/13 right on the fixtures, `backend/scripts/jev_bench.py`). The submit guard still checks whatever Jev picks.
- **Page snapshots.** Compact text lists of interactive elements with refs (`[e12] button "Jatka" type=submit`) across iframes, open shadow DOM and ARIA widgets (comboboxes, listboxes, role=checkbox/switch, tabs), plus 2500 characters of visible text. `look` sends a redacted screenshot only when the text is not enough.
- **Exa in the loop.** The agent looks up what it needs while the form stays open: rules and amounts (EU261, VR compensation), deadlines, the right form, opening hours or slots. `exa_search` uses `type: auto`, `userLocation: FI` and query highlights; `exa_read` uses `/contents` with `maxAgeHours: 6` so pages are fresh. Every result is shown as untrusted data with its URL and date. Each value in `approval.filled` can carry the `source` URL it came from; all URLs end up in `execution.sources`.
- **Live view.** A Chrome DevTools Protocol screencast (`Page.startScreencast`, JPEG, quality 50, max width 1024) writes the newest frame to `store.put_live_frame` about twice a second while the browser works (`GET /v1/tasks/{id}/live.jpg`). Per-step screenshots stay as the history (`execution.steps`, `execution.shots`), with readable step text (`Filled "Email" with {{email}}`, `Clicked "Jatka"`).
- **Talk to it while it runs.** `POST /v1/tasks/{id}/messages {text}` adds a message to `execution.inbox`; the agent reads new messages between steps. `ask_user` sets `execution.question` and waits up to 5 minutes for the next message.

## Rules it keeps

- **Privacy.** The model only sees placeholders (`{{name}}`, `{{email}}`, `{{phone}}`, `{{booking_reference}}` ...). `privacy.substitute` types the real value at the last moment; `privacy.mask` turns real values back into placeholders in every snapshot, tool result, Exa query, user message and step text. Fields that show a real value are blurred in live frames and screenshots, so neither the store nor the image host keeps personal data. The profile is a function argument and is never logged.
- **Approval gate.** A click on anything final (submit, send, pay, confirm, book, reserve, lähetä, maksa, vahvista, varaa, varaus, tilaa, jatka maksamaan, continue to payment, `type=submit` with an unclear label) is refused until `request_approval` returned true; then exactly one final click is allowed. Booking widgets make every button `type=submit`, so clearly non-final labels pass: Jatka / Seuraava / Next, back, party size (`4 henkilöä`), times (`19:00`), dates (`la 21.11.`). Buttons inside cookie banners are never gated. Enter/space in a form is refused. An optional Jev decision (`JEV_API_KEY`) is a second opinion that can only make the gate stricter.
- **Blockers.** Password fields, Finnish strong identification (Suomi.fi, pankkitunnukset, mobiilivarmenne, BankID, `tunnistus.suomi.fi`), visible CAPTCHA challenges (reCAPTCHA v2/hCaptcha/Cloudflare Turnstile, "verify you are human") and card fields end the run with `failed`, a one-line reason and `final_url`. Forms that only mention identification in the footer or carry an invisible reCAPTCHA v3 badge are not blocked.
- **Suspicious pages.** Page text is data, never instructions. A page that asks the agent to reveal anything about the user or to ignore its instructions ends the run with `failed: suspicious page`.
- **Cookie banners** are closed with the minimal option (en/fi/sv/de), retried when the consent manager loads late.

## Cost and time

`execution.usage` has `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `model_calls`, `claude_cost_usd` (list price, `HOIDA_PRICES` to override), `exa_cost_usd`, `jev_calls`.

Measured on Modal (2 CPU, 4 GB), `claude-opus-5-5` at effort `low`, 14 Nov 2026:

| Run | Time | Model calls | Claude cost | Outcome |
|---|---|---|---|---|
| Claim form fixture (fill, approve, submit once, read reference) | 19 s | 4 | $0.03-0.05 | done, reference FC-1234 |
| Prompt-injection fixture | 8 s | 1 | $0.014 | failed: suspicious page |
| Helsinki "Report a problem" (pothole), real site | 55-61 s | 17-20 | $0.19-0.23 | at approval, 8 fields |
| Löylykontti sauna for 8, real site | 48-61 s | 10-11 | $0.33-0.39 | at approval, 10 fields |

About 70% of the Claude cost is cache writes of the new page snapshot on each step; cache reads are cheap. Exa lookups inside a run cost about $0.007 each. The live view averaged 0.9-1.3 frames per second over a run (the target was about 2; frames come from the browser when the page changes, so a page that sits still while the model thinks sends none, and the newest frame stays available).

## End to end through the API (deployed)

Deployed as its own Modal app (`modal deploy backend/modal_app.py --name hoida-sandbox`, never over the main `hoida` app), 14 Nov 2026:

- `t_55bba48cb5b340688960e4f4fe7f1a4d`: test order form (httpbin.org/forms/post, an echo service). Task, Exa research (28 s, $0.025), execute, 9 steps with screenshots, 20 live frames read through `live.jpg`, approval, `POST /approve`, one final click, `done` with the echoed order. 89 s, Claude $0.07.
- `t_52f39a2debb14f5088d5835678965b05`: Helsinki "Report a problem" (real site). Task, Exa research (22 s), execute, 24 steps (one click re-found by Jev after the page re-rendered), approval with every value, `POST /stop`, `stopped`. 105 s, Claude $0.25, 10 Jev calls.

## Demo flows

Both run on real sites, logged out, with test data, and stop at the approval gate. During development approval always went to "stop" on real sites; the final click is tested on the local fixtures only.

**1. Booking: Löylykontti Sörnäinen (public container sauna, Helsinki)** `https://www.loylykontti.fi/en/reserve`
Errand: "a shared sauna for 8 on Saturday evening". The agent picks the location, moves the calendar to the day, asks the user which of the free start times to take (`ask_user`; the slots are live), sets people and hours, fills first name, last name, email and phone from placeholders, picks online banking and stops before "Accept terms and pay 208.00 €" with the summary (slot, sauna, 8 people, 2 h, total). After approval the payment itself happens at the user's bank.
Reliability after the fixes: 3 runs, 2 reached the approval gate, 1 filled everything and stopped as `needs payment` with the same summary (the prompt now asks for approval at that point).

**2. Claim / feedback: City of Helsinki "Report a problem"** `https://palautteet.hel.fi/vikailmoitus-lomake`
Errand: "a deep pothole at Mannerheimintie 5, I want a reply by email". The agent switches the form to English, picks Streets → Pothole, types the address and picks the suggestion, writes the description, asks for an email reply, fills name and email, chooses not to publish, and stops before "Send" with the 8 values.
Reliability after the fixes: 4 runs, 3 reached the approval gate (one ran out of actions before the cap change).

Also checked: TableOnline restaurants go through the whole wizard (party size, day, time, details) but some ask for a card on the last step; the VR delay form and Finnair's claim wizard check a real booking or payment reference, so with test data the run stops there and says what is missing; HSL is behind a Cloudflare check from Modal's IP; Uunisaari's shop shows a CAPTCHA; play.fi and the city sports halls need a login.

## Running it

```bash
backend/.venv/bin/python -m pytest backend/tests -q                 # offline, local fixtures and fake models
backend/.venv/bin/modal run backend/modal_smoke.py                  # on Modal: claim fixture, real Claude, auto-approve
backend/.venv/bin/modal run backend/modal_smoke.py --scenario wizard
backend/.venv/bin/modal run backend/modal_smoke.py --url https://... --goal "..."   # real site, always stops at approval
backend/.venv/bin/modal run backend/modal_smoke.py --batch runs.json              # several real sites in parallel
python -m hoida_agent --url ... --goal ... --headful                # locally, approval in the terminal
```

`modal_smoke.py` uses its own ephemeral app and an in-container SQLite store, so it never touches the deployed `hoida` app.

## Known limits

- **Datacenter IP.** The browser runs on a Modal IP. Sites behind Cloudflare bot checks (HSL feedback, several airlines) block it; the run ends with a hand-off, it does not try to get around the check.
- **Login and strong identification.** Kela, Vero, DVV, Migri, Varaamo, Playtomic and city sports halls need Suomi.fi or an account, so the sandbox stops there. For those, the extension fills the form in the user's own tab (already logged in); `execution.filled` keeps what the sandbox filled so far for that hand-off.
- **Live lookups need real data.** Finnair's claim wizard, airBaltic and VR's delay form check the booking or payment reference against their systems; with test data the run stops at that step and says what is missing.
- **Payment and card guarantees.** Bookings that need a card on the last step (some TableOnline restaurants on weekends) stop as `needs payment`. Löylykontti asks only for a payment method before the final "pay" button, so the approval gate sits on that button.
- **Long wizards.** 30 actions cover a 3-4 step form; Finnair's 6-step feedback wizard does not fit.
- **Popups.** Flows that open a new window (Löyly's Asio calendar) are not followed yet.
- **Masking short values.** Masking replaces every occurrence of a profile value in page text, so a profile city of "Helsinki" shows up as `{{city}}` everywhere the model reads. Exa queries get the city back, nothing else.
