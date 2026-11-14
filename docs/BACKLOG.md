# Overnight backlog (14-15 Nov)

Goal for the morning: a stable base on every front. WhatsApp works end to end, errands go to the sandbox correctly, and Vali sits on the desktop.

Rules for the loop: every item is verified live, not only with tests. Commits as Bogdan-ca, pushed as PRs to main, merged with rebase when CI is green. Deploy straight to the `hoida` / `vali` app. The sandbox gets a redeploy after any change in `hoida_agent/`. Never mention the old extension in commits.

## A. WhatsApp
- [ ] A1 Live run from WhatsApp Web (Vali chat only): help text when not paired, pair with a code, a find errand returns a result, a claim errand gets research, then "do it", the sandbox, the approval message, approve, done. Fix whatever breaks.
- [x] A2 No silent failures: log exceptions in process_messages / push_task / ChannelAPI with the task id and the Graph error code, never the message text.
- [x] A3 During a running execution, free text goes to POST /v1/tasks/{id}/messages. Send execution.question when it appears. Send live.jpg as an image with the approval.
- [x] A4 Approve / Stop as WhatsApp reply buttons, with text fallback ("da", "yes", "stop").
- [x] A5 Voice notes: ElevenLabs speech-to-text becomes an errand. Check what already exists first.

## B. Sandbox dispatch
- [x] B1 Deploy the merged API. Check that /execute from the API and from WhatsApp spawns hoida-sandbox and that steps, live.jpg and approval come back.
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
- [ ] E1 Packages hoida_* to vali_*, env HOIDA_* to VALI_*, Modal apps vali / vali-sandbox, Modal secret vali. Update the Meta webhook callback to the new URL, plus the extension and desktop defaults. Re-verify WhatsApp live.

## F. Demo
- [ ] F1 docs/DEMO.md: a 3-minute script with the exact errands that work.
- [ ] F2 README: what Vali is, setup, partners used (Exa, Modal, Aiven, Jev, ElevenLabs, Codex).

## Needs Bogdan
- Meta rejects every outbound message with 131031 "Business Account locked". In WhatsApp Manager, check why the account is locked and request a review. Until then Vali receives messages but cannot reply (A1, plus a live check of A3-A5).

## Log
- 04:40 Merged the sandbox. Golden 3/3 live. WhatsApp hardening (305 tests) and extension live view, approval and blockers (42 tests) committed. CI added, PR #1 open. Desktop app in progress.
- 04:55 Desktop app (Electron) built: mascot window, tray, Alt+Space quick task, shared panel, notifications. 6 tests, smoke screenshots checked.
