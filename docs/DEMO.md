# Vali: 3-minute demo script

For the Exa "Internet Butler" judging, Sun 15 Nov 10:00. Everything runs from the Mac app. Every errand below passed live in the overnight eval (`scripts/evals/scorecard.md`, texts in `scripts/evals/errands.json`), and the letter is the golden check's fixture (`scripts/golden.py`). Real sites always stop before the final button. Never click Approve on a real site.

Judging criteria (20% each): Use of Exa, Usefulness, Clarity of sources, Originality, Working implementation.

## The errands

| Id | Paste this | Ends at | Time |
|---|---|---|---|
| claim-ta-defect | `The kitchen tap in my TA rental flat is leaking. Report it to TA.` | approval before submit, 9 values, live view | about 95 s |
| claim-eu261 | `My Finnair flight from Helsinki to Barcelona last Tuesday landed 4 hours late. What can I get?` | answer: 400 EUR, EU rule cited, sources | about 25 s |
| claim-pothole-form | `Report a deep pothole at Mannerheimintie 5 in Helsinki to the city. I want a reply by email.` | approval before Send, 7 values | about 150 s |
| book-allas-tickets | `Buy 2 adult tickets for Allas Sea Pool for Sunday 22 November afternoon` | approval before payment, 7 values | about 85 s |
| book-sauna (backup) | `Book a shared sauna for 8 people next Saturday evening (21 November) at Löylykontti Sörnäinen` | approval before pay, 208 EUR | about 145 s |

The letter is `scripts/fixtures/letter.png`.

## Before the demo

Run `backend/.venv/bin/python scripts/demo_seed.py --token-file <file>` once, 10 minutes ahead, on the demo account's token. It creates three finished research errands (a find, the EU261 claim, the letter) so the list is not empty when the app opens. It never executes or approves anything. Use `--dry-run` to see what it would create. The token is the one the Mac app uses: it is stored encrypted in the app's settings (`~/Library/Application Support/Vali`) and desktop/README.md does not document exporting it, so save the demo account's token to a file when the account is created (Settings > Advanced accepts a token).

## Before the judges arrive (T-15 min)

1. `GOLDEN_TOKEN=... backend/.venv/bin/python scripts/golden.py`. All checks must pass. This also warms Modal.
2. Mac app running (`cd desktop && npm start`, or the dmg from `npm run dist`). Settings > Profile holds made-up data only. Microphone, Accessibility and Automation are already granted, so no permission prompt shows on stage.
3. Link the extension (Settings > Link with the extension). Both must show the same list.
4. Use an account that has not spent much today (cap $2 per day, 30 new errands per 10 minutes). The demo errands cost about $0.60 together. If rehearsals used it up, create a fresh account.
5. At T-5 min, start claim-eu261, claim-pothole-form, book-allas-tickets and book-sauna from the quick box (Alt+Space). Let them finish. They are the finished cards in the list.
6. Backups: a screen recording of one full run to the approval card, and yesterday's completed errands in the list.
7. WhatsApp is the main channel: see docs/SUBMISSION.md for the demo script.

## The script

### 0:00-0:15 Who it is for

**Say:** "Newcomers and students in Finland lose hours on errands: Finnish-only sites, rules that changed, long forms. Vali takes the errand. Exa finds the live answer, a cloud browser fills the real form, and it waits for your OK."

### 0:15-0:40 Give it a task on the Mac (Use of Exa, Usefulness)

**Do:**
1. Alt+Space. The quick box opens with the page you are on as a chip. Paste the TA errand, press Enter.
2. Drag `letter.png` onto the mascot.
3. (First run on a fresh Mac only: the welcome card shows the three ways to give an errand. Close it.)

**Say:** "Type it, say it, or drop a letter. The TA fault report runs for a minute and a half, so we come back to it."

**If it fails:** Alt+Space does nothing: use the menu bar icon, "New errand", or Alt+V in Chrome for the extension panel.

### 0:40-1:10 All errands at a glance (Working implementation)

**Do:** hover the mascot. The list shows every errand with a plain status. Point at the amber ones that need you, then at the Approve and Stop buttons. The mascot bubble says whether it needs an approval, an answer or a hand-off.

**Say:** "Everything in one list. One primary button per errand: Approve, Answer, or Stop. Nothing sends until I say so."

### 1:10-1:45 How Vali found this (Use of Exa, Clarity of sources)

**Do:** open claim-eu261 (done earlier). Show the answer: 400 EUR under EU261 and the 3-hour threshold, each fact with its source. Open "How Vali found this": the actual Exa searches and the pages read. Click one source.

**Say:** "These numbers come from the regulation and Finnair's own pages, read just now. Every fact has its source, and this panel shows the exact Exa queries."

If the answer cites the 2-month window: "That comes from a Finnish court ruling this April. A model without live search does not know it."

**If it fails:** open any completed claim errand instead. Do not run the Finnair wizard: it checks a real booking reference.

### 1:45-2:15 A form that stops at the last button (Working implementation, Originality)

**Do:** open the TA errand. While it runs, show the live view of the real fault report. At about 1:55 it reaches the approval card with 9 values and stops before submit. Open "How Vali found this" on it: next to the research it has a "While filling the form" list when the agent asked Exa during the run. Click **Stop**. Never approve.

**Say:** "It picked the property from the autocomplete and stopped at the preview. Claude decides each step but never sees my details: it types `{{name}}` and `{{email}}` and the real values go in at the last moment. If a form asks for something I did not give it, like an address or an opening time, it asks Exa from inside the run and the lookup is saved here."

Say the lookup line only if the "While filling the form" list actually has entries. The lookup flow is covered by the `execute-lookup-httpbin` eval errand, which is not in the 20-errand scorecard, so do not promise it.

**If it fails:** the card is not ready: show the pothole, Allas or sauna card from the list ("same thing, finished earlier"). Last resort: the recording.

### 2:15-2:45 Talk to Vali (Originality)

Only if `/health` shows `voice_agent` and the room is quiet.

**Do:** press Alt+Shift+V. The state chip above the mascot reads Connecting, then Listening. Ask: "What errands do I have running?" Captions show what you said and what Vali says, and the chip reads "Vali is speaking". Press Alt+Shift+V to end.

**Say:** "I can also just talk to it. Same butler, same list."

**If it fails:** no sound or any doubt: stop and move on. Do not retry. If the microphone is blocked, the mascot shows a message with a settings button.

### 2:45-3:00 Close

**Say:** "Vali does the digging with Exa, shows every source, fills the real form, and leaves the final click to you. Try it with your own errand."

Hand over the laptop with the quick box open. **Proof:** 20/20 live errands passed overnight, $1.47 in total.

## When the judges try their own errand

- "Find" errands answer in seconds and are the safest live query (a restaurant, a café open now, a laptop under a budget). Typing or holding Alt+Shift+Space both work.
- "Check" and "claim" errands use the Exa Agent and take 10-90 seconds. Say so before they press Enter.
- A question like "How do I book a dentist and what is the fee?" is answered with sources, not acted on. To make Vali do it, they must ask for it.
- Sites behind Suomi.fi, bank ID, a login, a CAPTCHA or a bot wall (Kela, Vero, Migri, HSL) stop with a one-line reason and a "Finish in your tab" button. That is the designed behaviour.
- Do not demo "watch" errands live.
- If asked about WhatsApp: "Meta blocks sending from unverified business portfolios, so the chat idea moved to iMessage. The plan is in docs/IMESSAGE.md."

## Timing notes

- Research only (claim-eu261): about 25 seconds. Agent research: 10-90 seconds.
- Runs to the approval card: Allas 85 s, TA 95 s, sauna 144 s, pothole 151 s.
- Live view runs at about 1 frame per second and pauses when the page is still.
