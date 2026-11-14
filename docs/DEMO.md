# Vali: 3-minute demo script

For the Exa "Internet Butler" judging, Sun 15 Nov 10:00. Every errand below comes from verified runs (see `docs/SANDBOX_REPORT.md` and `scripts/golden.py`). Real sites always stop before the final button. Never click "Approve" on a real site.

Rehearse the Löylykontti step through the extension at least once. Its verified runs started the sandbox directly; the Helsinki form and the httpbin form were verified end to end through the API.

Judging criteria (20% each): **Use of Exa**, **Usefulness**, **Clarity of sources**, **Originality**, **Working implementation**. Each step below says which one it hits.

## Before the judges arrive (T-15 min)

1. Run the golden checks: `GOLDEN_TOKEN=... backend/.venv/bin/python scripts/golden.py`. All 3 must pass. This also warms the Modal images.
2. Chrome: the extension is loaded unpacked and Settings shows the server `https://bogdan-c-2206--vali-web.us-east.modal.run`. "Your details" holds made-up test data only (a fake name, an `example.com` email, a fake `+358` number).
3. Open three tabs:
   - `https://www.loylykontti.fi/en/reserve` (sauna booking)
   - `https://palautteet.hel.fi/vikailmoitus-lomake` (Helsinki "Report a problem", backup)
   - `https://httpbin.org/forms/post` (test form, last-resort backup)
4. Desktop app running (`cd desktop && npm start`), mascot visible bottom right. To share the extension's task list, paste the extension's token in desktop Settings. Get it from the extension's service worker console: `chrome.storage.local.get('backendToken').then(console.log)`.
5. Backups ready: a screen recording of one full Löylykontti run up to the approval card, and yesterday's completed tasks still in the task list (find, claim, sauna at approval).
6. Use an account that has not spent much today. The API stops research for an account at $2 per day (`VALI_DAILY_CAP_USD`) and allows 30 new errands per 10 minutes. If rehearsals used the account, create a fresh one.

## The script

### 0:00-0:15 Who it is for

**Do:** nothing yet. Chrome is on the Löylykontti tab, side panel closed.

**Say:** "Newcomers and students in Finland lose hours on errands: Finnish-only sites, rules that changed this year, long forms. Vali takes the errand. Exa finds the live answer, and a cloud browser fills the real form and waits for your OK."

**Hits:** Usefulness (a named group with real errands).

### 0:15-0:45 Find: a sauna (extension)

**Do:** press Alt+V to open the side panel. Type: `Find a sauna in Helsinki open tonight for 6 people`. Press Enter.

**Shows:** the mascot thinks, then in about 3 seconds a short answer with options, prices and opening hours, each with numbered sources. Hover or click one source to show it is a real page.

**Say:** "This is Exa search with structured output, live. Tonight's hours and prices are not in any model's training data. Every fact has its source, and the numbers link to the page."

**Hits:** Use of Exa, Clarity of sources, Working implementation.

**If it fails:** open the completed sauna task from earlier in the list and walk through the same sources. Say "this ran an hour ago, same query".

### 0:45-1:05 Claim: Finnair delay (desktop mascot), then start the booking

**Do:**
1. Press Alt+Space. The task box opens next to the mascot. Type: `My Finnair flight HEL-BCN was 4 hours late, what can I get?` Press Enter. The mascot switches to working.
2. Go back to Chrome, still on the Löylykontti tab. In the side panel type: `Book a shared sauna for 8 at Löylykontti Sörnäinen next Saturday evening, 2 hours`. Press Enter. Both errands now research in parallel.

**Say:** "Same Vali on the desktop. The claim goes to the Exa Agent, which reads the regulation and the airline's own pages. While it works, I hand off a booking on the page I am on."

**Hits:** Originality (one butler across surfaces), Working implementation.

**If it fails:** if Alt+Space does nothing, use the menu bar icon, "New errand". If the desktop app is down, type the claim errand in the side panel instead.

### 1:05-1:30 Claim answer

**Do:** click the macOS notification (or the mascot) when the claim finishes. Expand the task.

**Shows:** the amount under EU261 (for HEL-BCN, an intra-EU flight over 1,500 km, expect €400; read what Vali says), the 3-hour threshold, the 2-month filing window Finnair enforces after the Market Court ruling of April 2026, and the next step with a link to Finnair's claim wizard. Each fact carries its citation.

**Say:** "These numbers come from the regulation and Finnair's own pages, read just now. Vali also tells you what it still needs: the booking reference." If the answer cites the 2-month window, add: "That deadline comes from a Finnish court ruling this April. A model without live search does not know it."

**Hits:** Use of Exa, Clarity of sources, Usefulness.

**If it fails:** the Agent can take up to 90 seconds. If it is not back, say "it is still reading, we come back to it" and go to the next step. Return at 2:40 if there is time. If it failed, open the completed claim task from earlier.

Do not run the Finnair wizard itself: it checks a real booking reference, so with test data it stops at that step.

### 1:30-2:35 Do it: book the sauna (extension, cloud browser)

**Do:**
1. Open the sauna task in the side panel. When research is done, click **Let Vali do it**.
2. The live view appears: the cloud browser opens loylykontti.fi, picks the location, moves to Saturday.
3. Vali asks which free start time to take (the slots are live). Type an answer, for example `the earliest one after 19:00`, and click Send answer.
4. It sets 8 people and 2 hours, fills name, email and phone, picks online banking, then stops. The approval card shows "Vali will submit" with the slot, sauna, 8 people, 2 h, the total, and every filled value.
5. Click **Stop**. Never approve here.

**Say (while it fills):** "This is a real Finnish booking site in a browser on Modal. Claude decides each step, but it never sees my details. It types `{{name}}` and `{{email}}`; the real values are put in at the last moment, and they are blurred in the live view. Anything that pays, sends or confirms is blocked until I approve."

**Say (at the approval card):** "It stopped before 'Accept terms and pay'. I can approve with one tap, or stop. I stop, because this is a real sauna."

**Hits:** Originality (research to a done form with an approval gate), Working implementation, Usefulness.

**If it fails:**
- Run stops as `needs payment` with the same summary: show it, it is the same stop point. Say "it reached the pay step and handed it back".
- Run fails or hangs before 2:20: switch to the Helsinki tab and hand off `A deep pothole at Mannerheimintie 5, I want a reply by email`, then Let Vali do it (verified 3 of 4 runs, about 60 seconds). If time is short, play the recording instead.
- Modal or the site is down: the httpbin tab. Hand off `Order a medium pizza with bacon and cheese, delivery at 19:00, ring the bell` on the httpbin test order form. httpbin is an echo service, so here you may approve and show the run finish with the echoed order.
- Last resort: the screen recording of a full Löylykontti run.

### 2:35-2:50 WhatsApp (optional)

Only if a WhatsApp errand was checked live in the last hour. Meta has locked the business account, so Vali receives WhatsApp messages but cannot reply until Meta unlocks it.

**Do:** show the phone. Send a voice note to Vali: "Find a sauna in Helsinki open tonight for 6 people".

**Shows:** the errand appears in the extension task list with a WhatsApp tag, transcribed by ElevenLabs. Replies, approvals by reply button and the live screenshot on the phone wait on Meta.

**Say:** "Same task list from the phone, voice notes included. Start on the bus, approve on the laptop."

**If it fails or is not verified:** skip it. Say one line: "WhatsApp is built and tested offline; Meta still has to unlock our business number." Do not show the mock backend as if it were live.

### 2:50-3:00 Close

**Say:** "Vali does the digging with Exa, shows every source, fills the real form, and leaves the final click to you. Try it: give it your own errand."

Hand the laptop to the judges with the side panel open.

## When the judges try their own errand

- "Find" errands answer in seconds and are the safest live query. Good prompts: a restaurant, a café open now, a laptop under a budget.
- "Check" and "claim" errands use the Exa Agent and take 10-90 seconds. Say so before they press Enter.
- If they ask for "do it" on a new site: it works on forms without login. Sites behind Suomi.fi, bank ID, a login, a CAPTCHA or Cloudflare (Kela, Vero, Migri, HSL) stop with a one-line reason and a "Finish in your tab" button. That is the designed behaviour; show it rather than apologise.
- Do not demo "watch" errands: Exa Monitors are not wired yet, so a watch is only saved locally.

## Timing notes

- Find: about 3 seconds.
- Agent research: 10-90 seconds (22-28 seconds in the verified runs).
- Sandbox on a real site: 50-60 seconds to the approval card, plus about 25 seconds of research before Let Vali do it is available. That is why the booking starts at 0:45.
- Live view runs at about 1 frame per second; it pauses when the page is still.
