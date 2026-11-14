# Sandbox: what was built (14 Nov 2026, 01:20-03:50 EET)

Branch `hoida-sandbox` (worktree `junction-exa-sandbox`), 23 local commits on top of `hoida-base` 5172af6. Nothing pushed. 246 offline tests pass (`backend/.venv/bin/python -m pytest backend/tests -q`). How it works and how to run it: `docs/SANDBOX.md`.

## In one paragraph

When the user says "do it", Vali opens the real website in a cloud browser on Modal. Claude decides each step. Exa looks things up while the form stays open. Jev finds the element to click. The model only ever sees `{{placeholders}}`; real values are typed at the last moment and blurred in every frame. It shows its work live, asks the user when a choice is theirs, and stops before anything final (send, pay, confirm, book) until the user approves. On a login, Suomi.fi, CAPTCHA, bot wall or suspicious page it stops with a one-line reason and the URL to finish by hand.

## Verified end to end on Modal

| Task | Path | Result |
|---|---|---|
| `t_55bba48cb5b340688960e4f4fe7f1a4d` | API → Exa research → execute → httpbin test order form → approve | done after one final click, 89 s, Claude $0.07 |
| `t_52f39a2debb14f5088d5835678965b05` | API → Exa research → execute → Helsinki "Report a problem" (real) → stop | stopped at approval with every value, 105 s, $0.25, Jev re-found one button |
| `t_16951c698e8445ebb7b734df502f71c3` | main API `vali` creates the task, browser runs on the separate `vali-sandbox` app, main API serves steps, live frames and approval | done, 47 s, $0.06 |

Real-site demo flows (test data, always stopped before the final button): **Löylykontti sauna for 8** (3 runs: 2 at approval, 1 filled everything and stopped before paying) and **Helsinki pothole report** (4 runs: 3 at approval). Prompt injection fixture: stops with `suspicious page`. Typical run: 50-60 s and $0.20-0.40 on real sites, $0.03-0.07 on simple forms. Testing used about $6 of the Claude budget and well under $1 of Exa.

## What changed

**Agent (`backend/vali_agent/`)**
- `exa_search` / `exa_read` tools (Exa `/search` `type: auto`, `userLocation: FI`; `/contents` with `maxAgeHours: 6`, not the deprecated `livecrawl`). Each filled value can carry its source URL (`approval.filled[].source`); all URLs go to `execution.sources`.
- Jev: finds the element for a click target when the ref is missing or stale (`find_element`), and gives the submit guard a second opinion that can only make it stricter.
- `ask_user` tool and mid-run user messages, read between steps.
- Live view: CDP screencast to `store.put_live_frame`; fields holding profile values are blurred in frames and screenshots.
- Real-site hardening found by running on Finnish sites: iframes, open shadow DOM, ARIA widgets, custom dropdowns, date/time inputs, hidden radios clicked through labels, late-enabled Next buttons, elements behind open dialogs, popup windows, slow pages (20 s), cookie banners closed with the minimal option (en/fi/sv/de) including late consent dialogs.
- Guard: wizard steps on `type=submit` buttons pass (Jatka, 4 henkilöä, 19:00); final words stay gated (vahvista, varaus, maksa, continue to payment); plain links outside forms are not final unless they pay, confirm or send; cookie-banner buttons are never gated.
- Blockers: Suomi.fi / pankkitunnukset / BankID walls, visible CAPTCHAs and Cloudflare checks stop the run; footer mentions and invisible reCAPTCHA v3 badges do not.
- Limits: 30 page actions plus 30 model calls (reading, Exa and questions are free). Usage and estimated cost per run in `execution.usage`. `execution.filled` keeps what was filled for a hand-off.

**Outside the agent** (each its own commit)
- `store.patch_execution(message=)`: appends to `execution.inbox`.
- `app.py`: `run_browser_session` wires live frames, usage, inbox, `ask_user` (`execution.question`), final usage/sources/filled; new `POST /v1/tasks/{id}/messages`.
- `modal_sandbox.py`: the sandbox as its own Modal app `vali-sandbox`.
- `modal_app.py`: `spawn_browser_session` calls `vali-sandbox`'s `browser_session` by name, falling back to the local one.
- `modal_smoke.py` (ephemeral Modal runs on fixtures or real sites), `scripts/jev_bench.py`.

## For the other parts of Vali

- **Merge.** Merge or rebase `hoida-sandbox` into `hoida-base`. The uncommitted `app.py` / `store.py` work in the main checkout will likely conflict in `run_browser_session` and `patch_execution`; the sandbox side is additive.
- **Deploy.** The sandbox deploys on its own: `modal deploy backend/modal_sandbox.py`. The API keeps deploying from `hoida-base`. Once the `modal_app.py` commit is in `hoida-base`, `/execute` runs on `vali-sandbox`.
- **Extension.** Show `live.jpg` while `running` / `awaiting_approval`, `execution.question` (answer with `POST /v1/tasks/{id}/messages`), `approval.filled[].source` next to values, `execution.filled` + `current_url` for "finish in your tab" on blockers.
- **WhatsApp.** While a task has a running execution, free text should go to `POST /messages` (the agent reads it between steps) instead of starting a new task; send `execution.question` when it appears.

## Mistake and fix

Three deploys from this branch went over the main `vali` app (03:33-03:41) and replaced the WhatsApp and Jev-routing code for a few minutes. The main app was redeployed from `hoida-base` at 03:43 (v7, current). From now on the sandbox deploys only as `vali-sandbox`.

## Open

- Live view averages about 1 frame per second (target was 2): frames come only while the page changes.
- Real-site runs cost up to $0.39; most of it is cache writes of new page snapshots.
- Not usable live: HSL (Cloudflare from Modal's IP), VR and Finnair claims (need a real booking or payment reference), TableOnline restaurants that ask for a card on weekends.
- Keys were pasted in chat during setup: rotate them after the event.
