# Overnight backlog (14-15 Nov)

## Morning summary (08:30)
Vali is ready to demo. 44 PRs merged overnight, each reviewed and green in CI. Live = main.

Verified live this morning:
- Golden 5/5: find, claim research, letter, execute on httpbin until approval and done, and an Exa lookup made while filling a form.
- Evals 20/21 on real Finnish sites (the one miss is the sauna booking stopping at the bank choice, which is the intended payment hand-off). New-site sweep 8/10.
- Mac app end to end in the real windows (npm run live-app): quick box, letter drop, research, How Vali found this, approve on httpbin, done.
- Voice end to end without a mic (scripts/voice_check.py): the real ElevenLabs agent created and tracked an errand through our API, 14/14.

What to show (docs/DEMO.md, 3 minutes): give a task on the Mac (Alt+Space, talk, drop a letter), see every errand at once (Alt+Shift+G, A approves, S stops), one errand to approval with the live view, How Vali found this with the Exa searches and the lookups made while filling the form, then talk to Vali.

Before the demo: run `backend/.venv/bin/python scripts/demo_seed.py --token-file <demo token>` 10 minutes ahead, and do not deploy in the last hour (a deploy cuts running requests). The dmg is at desktop/dist/Vali-0.1.0-arm64.dmg.

Known limits: phone calls need a Twilio number or SIP trunk; iMessage is built but needs a dedicated Apple ID; WhatsApp is blocked by Meta until business verification; payments always hand over to you.


Five tracks until 10:00, presented to mentors in the morning:
1. Call: talk to Vali by voice (ElevenLabs agent), phone later (V1, V2, P1).
2. Valet: the mascot lives on screen, moves, reacts and follows what you do (S1-S3).
3. Polish: one design system shared by the Mac app and the extension (D3-D5, U1-U3).
4. Mac app: the main surface, easy input, all errands at a glance (M1-M5).
5. Backend: fast, reliable, golden always green (K1-K5).
Code rules: lean and simple, small named functions, no frameworks, one file per concern, easy for agents to read. Every change ships as its own PR, is reviewed by a Claude reviewer, and is merged once CI is green.

Goal for the morning: a stable base on every front. WhatsApp works end to end, errands go to the sandbox correctly, and Vali sits on the desktop.

Rules for the loop: every item is verified live, not only with tests. Commits as Bogdan-ca, pushed as PRs to main, merged with rebase when CI is green. Deploy straight to the `vali` app. The sandbox gets a redeploy after any change in `vali_agent/`. Never mention the old extension in commits.

## A. WhatsApp
- [ ] A1 Live run from WhatsApp Web (Vali chat only): help text when not paired, pair with a code, a find errand returns a result, a claim errand gets research, then "do it", the sandbox, the approval message, approve, done. Fix whatever breaks.
- [x] A2 No silent failures: log exceptions in process_messages / push_task / ChannelAPI with the task id and the Graph error code, never the message text.
- [x] A3 During a running execution, free text goes to POST /v1/tasks/{id}/messages. Send execution.question when it appears. Send live.jpg as an image with the approval.
- [x] A4 Approve / Stop as WhatsApp reply buttons, with text fallback ("da", "yes", "stop").
- [x] A5 Voice notes: ElevenLabs speech-to-text becomes an errand. Check what already exists first.

## B. Sandbox dispatch
- [x] B1 Deploy the merged API. Check that /execute from the API and from WhatsApp spawns vali-sandbox and that steps, live.jpg and approval come back.
- [x] B2 scripts/golden.py runs three errands live against the deployed API (find; claim research; execute on a demo form until approval) and prints pass/fail, time and cost. Run it every iteration.

## C. Desktop app (Electron, desktop/)
- [x] C1 Scaffold: transparent always-on-top window with the Vali mascot (lib/butler.js), tray icon, global shortcut that opens a task box. Talks to the same API with the same user token and pairing.
- [x] C2 Chat window: reuses the extension panel (task list, results, approval, live view, question answer).
- [x] C3 macOS notifications for approval needed / question / done. The mascot state follows the newest task.
- [x] C4 `npm run desktop` + packaging notes in desktop/README.md.

## D. Extension
- [x] D1 Approve / Stop, live.jpg while running, execution.question with an answer box, filled values with their sources, "finish in your tab" on blockers.
- [x] D2 Default API URL = the deployed Modal URL; settings still allow localhost.

## E. Rename to Vali (after A-D are stable)
- [x] E1 Use vali_* packages and VALI_* env names with legacy env fallback; Modal apps vali / vali-sandbox, Modal secret vali. Update the Meta webhook callback to the new URL, plus the extension and desktop defaults. Re-verify WhatsApp live.

## F. Demo
- [x] F1 docs/DEMO.md: a 3-minute script with the exact errands that work.
- [x] F2 README: what Vali is, setup, partners used (Exa, Modal, Aiven, Jev, ElevenLabs, Codex).

## G. Focus from 05:10: backend + Mac app (WhatsApp parked)
WhatsApp is parked: Meta blocks sending from unverified business portfolios (131031). The code stays; it is not on the demo path.
- [x] K1 Backend endpoints for easy input: POST /v1/voice (audio upload -> ElevenLabs STT -> text, optional create task) and POST /v1/letters (image or PDF -> read_letter -> task with the letter as context). Reuse vali_media. Tests.
- [x] K2 Device linking: the desktop app and the extension share one account. POST /v1/link/code (signed in device gets a 6-digit code) and POST /v1/link (other device trades the code for the same user token). Tests.
- [x] K3 Golden stays green every tick; add a fourth golden errand that goes through /v1/letters with a sample letter image in scripts/fixtures/.
- [x] M1 Mac app against the live API: first run creates or links an account, Alt+Space task, find / claim / execute to approval, live view, approve. Fix what breaks.
- [x] M2 Easiest input: Spotlight-style quick box; hold a key or click the mic to talk (records audio -> /v1/voice); drop a letter photo or PDF on the mascot (-> /v1/letters); "Ask Vali about this" on selected text via a shortcut that reads the clipboard; the frontmost Chrome/Safari tab URL and title as page context.
- [x] M3 Link with the extension through K2 (show a code in one, type it in the other).
- [x] M4 Profile on the Mac: name, address, ID numbers kept locally and filled into placeholders only at execute time, same as the extension.
- [x] M5 `npm run dist` builds an unsigned .dmg with the mascot icon; README updated.
- [x] M7 Keyboard control of all errands (Alt+Shift+G, arrows, A approve, S stop).
- [x] M6 First run: welcome card with the three ways to give a task, a sample errand, and linking.

## X. Any site, any errand, Exa visible (Bogdan, 05:45)
- [x] X1 scripts/evals/errands.json: 20 real errands across all six modes and many site types (city services, Kela, Migri, Vero, HSL, VR, Finnair, housing, banks, shops, restaurants, sports venues, universities, forms with wizards, PDFs). scripts/evals/run.py runs them live against the API (find/check/claim/write/watch to an answer, book/claim with execute until approval, never past it) and writes a scorecard (pass, time, cost, Exa calls, failure reason).
- [x] X2 Fix the top failures in the agent (backend/vali_agent) and research (backend/vali_api/research.py), rerun, repeat. Target: 16/20.
- [x] X3 Show Exa at work in the UI: each errand lists what Exa did (search, contents, agent research, monitor) with sources, so the demo shows how Exa powers Vali.
- [x] X5 Exa during form runs: every exa_search / exa_read the browser agent makes is stored on the errand and shown in "How Vali found this"; the agent looks things up when a form asks what the profile and page do not say.
- [x] X4 Real watch mode with Exa Monitors (currently stubbed): create, webhook to /webhooks/exa with a secret, notify in the app.

## S. Valet on screen
- [x] S1 The mascot walks and idles on screen: gentle idle motion, walks to a corner when you type, peeks in when something needs you, sleeps when nothing runs. Draggable, remembers its spot, never covers the active text cursor (move away on hover).
- [x] S2 Reacts to errands: working (carries a tray), needs approval (rings a bell), done (bow), error (shrug); speech bubble with the one-line status.
- [x] S3 Context aware: knows the frontmost app and tab title (no content) and offers one relevant suggestion in the bubble ("Rent letter open? I can explain it").

## D. Design system
- [x] D3 shared/ design tokens (colors, type scale, spacing, radius, shadows, motion) as one CSS file plus a tiny component set (button, input, card, badge, list row, live view) used by both the Mac app and the extension. Light and dark.
- [x] D4 Apply it to the Mac app and the extension panel; remove one-off styles.
- [x] D5 Visual review: screenshots of every state in both surfaces, fix spacing, contrast and copy.

## K. Backend (more)
- [x] K4 Speed (cache + timings; status streaming not done): find under 5 s, claim research under 30 s; cache Exa answers per normalized question for 10 min; stream task status.
- [x] K5 Reliability: retries with backoff for Exa/Claude/Jev, clear error messages in tasks, a /v1/status page with recent failures, no silent excepts.

## U. Simple UI (Bogdan, 05:25)
- [x] U1 One glance, everything at once: the mascot shows a small badge with the number of active errands and a colored ring for "needs you". Hover or click opens a compact list of ALL errands (running, waiting for you, done today) with one-line status, and Approve / Stop / Answer right in the list, without opening the full chat.
- [x] U2 Strip the UI to the minimum: one input ("What should I take care of?"), the list, and the active errand's live view. No settings or jargon on the main screen; settings behind one gear. Big touch targets, plain words ("Waiting for your OK", "Done", "Needs login").
- [x] U3 Same simplification in the extension panel, so both look and behave the same.
- [ ] P1 Phone: Bogdan has an Orange number. ElevenLabs phone calls need Twilio or a SIP trunk, not a mobile SIM. Options for tomorrow: port/forward to a Twilio number, or try the Orange number as a real WhatsApp Business number (the forum tip for 131031).

## H. Voice and iMessage
- [x] V1 Talk to Vali: an ElevenLabs agent (created through the ElevenLabs API by a script in backend/scripts/, id stored as VALI_ELEVENLABS_AGENT_ID) with server tools that call our API: create errand, task status, read approval, approve, stop. POST /v1/voice/session returns a signed conversation URL for the authed user. The Mac app's mascot opens a live voice conversation (WebSocket/WebRTC from the ElevenLabs JS client). Verify with a real spoken round trip.
- [x] V3 Live captions, state chip and mic ring while talking to Vali.
- [x] V4 Voice verified end to end without a mic: ElevenLabs simulation test drives the real agent and our tool webhooks (scripts/voice_check.py, 14/14).
- [ ] V2 Phone (only if Bogdan buys a Twilio number): import it into ElevenLabs, inbound calls reach the same agent, and Vali calls you when an approval is waiting (POST /v1/convai/twilio/outbound-call).
- [x] I1 Spec: docs/IMESSAGE.md. No official iMessage API for bots (Apple Messages for Business needs an approved provider). Workable path: a Mac signed in to a dedicated Vali Apple ID runs a bridge in the Mac app that reads ~/Library/Messages/chat.db (Full Disk Access) and replies through AppleScript to Messages. Allowed senders only, linked to a Vali account with a code. Works while that Mac is on.
- [x] I2 Build the bridge in desktop/ (imessage.mjs in the main process, a Settings toggle, allowed handles, link code flow), reusing the WhatsApp flow logic: errand in, result out, "da"/"stop" for approvals. Test with a fixture chat.db; live test needs the dedicated Apple ID.

## Needs Bogdan
- Rotate the keys pasted in chat during the event (Exa, Anthropic, ElevenLabs, Meta, Aiven, Modal).
- Codex runs: the permission classifier sometimes blocks `codex exec` (sends code to OpenAI). Allow it with a Bash permission rule if you want Codex workers; until then Claude workers take those tasks.
- WhatsApp (parked): Meta rejects every outbound message with 131031 "Business Account locked". In WhatsApp Manager, check why the account is locked and request a review. Until then Vali receives messages but cannot reply (A1, plus a live check of A3-A5).

## Log
- 04:40 Merged the sandbox. Golden 3/3 live. WhatsApp hardening (305 tests) and extension live view, approval and blockers (42 tests) committed. CI added, PR #1 open. Desktop app in progress.
- 04:55 Desktop app (Electron) built: mascot window, tray, Alt+Space quick task, shared panel, notifications. 6 tests, smoke screenshots checked.
- 05:10 Rename to vali deployed (apps vali, vali-sandbox); golden 3/3 on the new URL. Docs written. WhatsApp parked after research: unverified portfolios cannot send. Focus moves to backend + Mac app.
- 05:20 PR #1 merged. Bogdan allowed merging any PR and deploying. New items: voice (V1, V2) and iMessage (I1, I2).
- 05:30 Plan widened to five tracks until 10:00: call, valet on screen, design system polish, Mac app, backend. One PR per item with a Claude review.
- 05:20 Merged PRs #2-#7: voice/letters/linking API, design system, iMessage spec, voice agent (agent created in ElevenLabs, session live), extension redesign, Mac app (live-checked, dmg built). Running: Exa Monitors + rate limit, 20-errand eval, Mac voice + valet motion, extension linking + Exa trail, docs refresh.
- 05:50 Merged #9-#13: Exa Monitors watch mode, extension linking + Exa trail, Mac talk-to-Vali (real agent spoke) + valet on screen, serving pose, extension polish. Evals 20/20 live ($6 total). iMessage bridge in review fixes (chat.style bug caught).
- 06:10 Merged #16-#18: routing (check vs find), Mac visual polish (14 fixes), agent safety (newline never submits, order/purchase always gated, guest path only from a real control). Approval-stop rerun 5/5, golden 4/4, 502 backend tests. Running: Exa during form runs, Exa cache (K4), extension visual review (D5), desktop status bubble.
- 06:20 Merged #19 mascot bubble (approval vs question vs hand-off) and #20 Exa cache (10 min, hit costs 0). Extension visual review done, ships with Exa during form runs. Running: Exa during form runs, 10-errand sweep on new sites, Mac first run.
- 06:50 Merged #21-#25: how-to questions route to check, Mac first-run welcome, live captions while talking, Exa lookups during form runs (masked before sending, shown in the trail), extension polish. New-site sweep 8/10 (dentist routing fixed; Espoo form was down for maintenance). Golden 4/4. Running: outage hand-off + address suggestion guard fix, extension leftovers, demo docs, dmg rebuild.
- 07:45 Merged #26-#35: demo docs, one-line composer, mascot narrates Exa and has a searching pose, golden lookup check, Mac live end-to-end check (demo flow passed twice), plain answers read Done, keyboard control of the list, site outages become a hand-off and address suggestions click (stricter guard kept for 'Place order'). Golden 5/5 after fixing the lookup errand's delivery time.
- 08:30 Merged #37-#39: 08:00 regression 20/21 (sauna payment hand-off is intended, eval updated), voice check end to end (citation markers no longer spoken), letters reply to the sender and done text shows your details only on your device (company contact details checked in code). Live = main, golden 5/5. dmg rebuilt.
- 08:30 Merged #40-#44: backlog, captions hide voice tags, demo seed script, aligned text buttons, dead database socket no longer hangs requests (cause verified in logs). Live = main, golden 5/5, dmg rebuilt. Code freeze; health checks only until 10:00. (Log times after 07:00 ran about 20 minutes ahead.)
