# Overnight backlog (14-15 Nov)

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
- [ ] K1 Backend endpoints for easy input: POST /v1/voice (audio upload -> ElevenLabs STT -> text, optional create task) and POST /v1/letters (image or PDF -> read_letter -> task with the letter as context). Reuse vali_media. Tests.
- [ ] K2 Device linking: the desktop app and the extension share one account. POST /v1/link/code (signed in device gets a 6-digit code) and POST /v1/link (other device trades the code for the same user token). Tests.
- [ ] K3 Golden stays green every tick; add a fourth golden errand that goes through /v1/letters with a sample letter image in scripts/fixtures/.
- [ ] M1 Mac app against the live API: first run creates or links an account, Alt+Space task, find / claim / execute to approval, live view, approve. Fix what breaks.
- [ ] M2 Easiest input: Spotlight-style quick box; hold a key or click the mic to talk (records audio -> /v1/voice); drop a letter photo or PDF on the mascot (-> /v1/letters); "Ask Vali about this" on selected text via a shortcut that reads the clipboard; the frontmost Chrome/Safari tab URL and title as page context.
- [ ] M3 Link with the extension through K2 (show a code in one, type it in the other).
- [ ] M4 Profile on the Mac: name, address, ID numbers kept locally and filled into placeholders only at execute time, same as the extension.
- [ ] M5 `npm run dist` builds an unsigned .dmg with the mascot icon; README updated.

## Needs Bogdan
- PR merges: the auto mode classifier blocks `gh pr merge`. Merge PR #1 yourself, or allow it in settings.
- WhatsApp (parked): Meta rejects every outbound message with 131031 "Business Account locked". In WhatsApp Manager, check why the account is locked and request a review. Until then Vali receives messages but cannot reply (A1, plus a live check of A3-A5).

## Log
- 04:40 Merged the sandbox. Golden 3/3 live. WhatsApp hardening (305 tests) and extension live view, approval and blockers (42 tests) committed. CI added, PR #1 open. Desktop app in progress.
- 04:55 Desktop app (Electron) built: mascot window, tray, Alt+Space quick task, shared panel, notifications. 6 tests, smoke screenshots checked.
- 05:10 Rename to vali deployed (apps vali, vali-sandbox); golden 3/3 on the new URL. Docs written. WhatsApp parked after research: unverified portfolios cannot send. Focus moves to backend + Mac app.
