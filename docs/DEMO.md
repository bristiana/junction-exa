# Vali: 3-minute demo script

For the Exa "Internet Butler" judging, Sun 15 Nov 10:00. The main path starts on the Mac app, then shows the extension. Every errand below comes from verified runs (see `docs/SANDBOX_REPORT.md` and `scripts/golden.py`). Real sites always stop before the final button. Never click "Approve" on a real site.

Rehearse the Löylykontti step through the Mac app at least once. Its verified runs started the sandbox directly; the Helsinki form and the httpbin form were verified end to end through the API.

Judging criteria (20% each): **Use of Exa**, **Usefulness**, **Clarity of sources**, **Originality**, **Working implementation**. Each step below says which one it hits. The three Exa moments are marked **Exa moment**: search, research with sources, and Exa lookups mid-form.

## Before the judges arrive (T-15 min)

1. Run the golden checks: `GOLDEN_TOKEN=... backend/.venv/bin/python scripts/golden.py`. All 3 must pass. This also warms the Modal images.
2. Mac app: running (`cd desktop && npm start`, or the installed dmg build from `npm run dist`). The mascot is bottom right. Server is `https://bogdan-c-2206--vali-web.us-east.modal.run`. Settings > Profile holds made-up test data only (a fake name, an `example.com` email, a fake `+358` number). macOS has granted the microphone, Accessibility and Automation once, so no permission prompt appears on stage.
3. Link the extension: in the extension settings press Show code and type it in the Mac app (Settings > Link with the extension), or the other way round. Both must show the same errand list. If linking fails, paste the extension token under Advanced.
4. Chrome: the extension is loaded unpacked and Settings shows the same server. Its "Your details" holds the same made-up data.
5. Open three tabs:
   - `https://www.loylykontti.fi/en/reserve` (sauna booking, keep this one in front)
   - `https://palautteet.hel.fi/vikailmoitus-lomake` (Helsinki "Report a problem", backup)
   - `https://httpbin.org/forms/post` (test form, last-resort backup)
6. Put a sample Finnish letter (photo or PDF, made-up details, under 10 MB) on the desktop, in a Finder window next to the mascot.
7. Backups ready: a screen recording of one full Löylykontti run up to the approval card, and yesterday's completed tasks still in the list (find, claim, sauna at approval).
8. Use an account that has not spent much today. The API stops research for an account at $2 per day (`VALI_DAILY_CAP_USD`) and allows 30 new errands per 10 minutes. If rehearsals used the account, create a fresh one.
9. WhatsApp is parked and is not part of the demo. Do not open it.

## The script

### 0:00-0:10 Who it is for

**Do:** nothing yet. Chrome is in front on the Löylykontti tab.

**Say:** "Newcomers and students in Finland lose hours on errands: Finnish-only sites, rules that changed this year, long forms. Vali takes the errand. Exa finds the live answer, and a cloud browser fills the real form and waits for your OK."

**Hits:** Usefulness (a named group with real errands).

### 0:10-0:30 Quick box: find a sauna (Mac app)

**Do:** press Alt+Space. The quick box opens in the middle of the screen. Type: `Find a sauna in Helsinki open tonight for 6 people`. Press Enter. (A chip with the Chrome tab may be attached; remove it with its x.)

**Shows:** the mascot switches to working. In about 3 seconds the answer appears with options, prices and opening hours, each with numbered sources. Click one source to show it is a real page.

**Say:** "This is Exa search with structured output, live. Tonight's hours and prices are not in any model's training data. Every fact has its source."

**Exa moment 1: search.** **Hits:** Use of Exa, Clarity of sources, Working implementation.

**If it fails:** if Alt+Space does nothing, try Alt+V or use the menu bar icon, "New errand". If the Mac app is down, type the same errand in the extension side panel (Alt+V in Chrome). If the answer is slow, open the completed sauna task from earlier and say "this ran an hour ago, same query".

### 0:30-0:50 Talk to Vali: a claim

**Do:** hold Alt+Shift+Space and say: "My Finnair flight Helsinki to Barcelona was four hours late, what can I get?" Let go. The text appears in the box and the errand starts.

**Shows:** the mascot listens, then works. The Exa Agent starts reading the regulation and Finnair's own pages (10-90 seconds).

**Say:** "I can also just say it. The recording goes to speech-to-text, and the errand starts. The claim goes to the Exa Agent while I carry on."

**Hits:** Originality (voice, letters and text into one butler), Working implementation.

**If it fails:** if the microphone does not pick up, type the claim in the quick box (Alt+Space): `My Finnair flight HEL-BCN was 4 hours late, what can I get?`. Optional extra if the voice agent is configured (`/health` shows `voice_agent`): press Alt+Shift+V and talk with Vali, then press it again to stop. Skip it if there is any doubt.

### 0:50-1:05 Drop a letter

**Do:** drag the sample letter from Finder onto the mascot.

**Shows:** the mascot reads the letter and a new errand appears: "Explain this letter and tell me what to do", with a short plain summary and next steps.

**Say:** "Finnish letters are the worst part. I drop it on Vali. It reads the photo or PDF, strips personal data, and tells me what to do and by when."

**Hits:** Usefulness, Originality.

**If it fails:** say "reading takes a few seconds" and move on. If it errors (unreadable file, over 10 MB), skip it. Scanned PDFs without text are rejected by design; use a photo or a text PDF.

### 1:05-1:20 Start the booking

**Do:** click Chrome so the Löylykontti tab is in front. Press Alt+Space. The tab title and address come along as a chip. Type: `Book a shared sauna for 8 at Löylykontti Sörnäinen next Saturday evening, 2 hours`. Press Enter.

**Say:** "Same box, but this time it knows the page I am on. While Exa researches the booking, let me show the claim."

**If it fails:** use the extension instead: Alt+V, type the same errand on the Löylykontti tab.

### 1:20-1:40 Claim answer with sources

**Do:** hover the mascot to open all errands at a glance. Open the claim errand when it is done (a macOS notification also fires).

**Shows:** the amount under EU261 (for HEL-BCN, an intra-EU flight over 1,500 km, expect €400; read what Vali says), the 3-hour threshold, the 2-month filing window Finnair enforces after the Market Court ruling of April 2026, and the next step with a link to Finnair's claim wizard. Each fact carries its citation.

**Say:** "These numbers come from the regulation and Finnair's own pages, read just now. Vali also tells me what it still needs: the booking reference." If the answer cites the 2-month window, add: "That deadline comes from a Finnish court ruling this April. A model without live search does not know it."

**Exa moment 2: research with sources.** **Hits:** Use of Exa, Clarity of sources, Usefulness.

**If it fails:** the Agent can take up to 90 seconds. If it is not back, say "it is still reading, we come back to it" and go to the next step. If it failed, open the completed claim task from earlier.

Do not run the Finnair wizard itself: it checks a real booking reference, so with test data it stops at that step.

### 1:40-2:25 Do it: book the sauna (live run to approval)

**Do:**
1. In the glance list, open the sauna errand. When research is done, click **Let Vali do it**.
2. The live view appears: the cloud browser opens loylykontti.fi, picks the location, moves to Saturday. Steps scroll under the picture.
3. Vali asks which free start time to take (the slots are live). Answer in the list, for example `the earliest one after 19:00`, and click Send answer.
4. It sets 8 people and 2 hours, fills name, email and phone, picks online banking, then stops. The mascot gets an amber ring and a notification. The approval card shows what Vali will submit: the slot, sauna, 8 people, 2 h, the total, and every filled value.
5. Click **Stop**. Never approve here.

**Say (while it fills):** "This is a real Finnish booking site in a browser on Modal. Claude decides each step, but it never sees my details. It types `{{name}}` and `{{email}}`; the real values stay on this Mac and are put in at the last moment, and they are blurred in the live view. Anything that pays, sends or confirms is blocked until I approve."

**Say (at the approval card):** "It stopped before 'Accept terms and pay'. I can approve with one click, or stop. I stop, because this is a real sauna."

**Exa moment 3: Exa mid-form.** Point at a step or a source on the card that came from a lookup while the form stayed open (opening hours, a slot rule, a price). Say: "It did not leave the form to look that up. It asked Exa from inside the run, and the source is on the card." Only say this if you can see such a step or source. Otherwise skip the line.

**Hits:** Use of Exa, Originality (research to a done form with an approval gate), Working implementation, Usefulness.

**If it fails:**
- Run stops as `needs payment` with the same summary: show it, it is the same stop point. Say "it reached the pay step and handed it back".
- Run fails or hangs before 2:15: switch to the Helsinki tab and hand off `A deep pothole at Mannerheimintie 5, I want a reply by email`, then Let Vali do it (verified 3 of 4 runs, about 60 seconds). If time is short, play the recording instead.
- Modal or the site is down: the httpbin tab. Hand off `Order a medium pizza with bacon and cheese, delivery at 19:00, ring the bell` on the httpbin test order form. httpbin is an echo service, so here you may approve and show the run finish with the echoed order.
- Last resort: the screen recording of a full Löylykontti run.

### 2:25-2:35 All errands at a glance

**Do:** hover the mascot once more.

**Shows:** the list with every errand: the sauna find, the claim, the letter, the booking (stopped), each with one status line. The badge counts what is running and an amber ring shows what needs you.

**Say:** "One place for everything Vali is doing for me."

**Hits:** Clarity, Usefulness.

### 2:35-2:55 The extension

**Do:** switch to Chrome and press Alt+V. The side panel opens with the same errands, because the two apps are linked. On the Helsinki tab, show the mascot peeking in on the form.

**Shows:** the same task list and the same sources, now next to the page. The extension also works on its own: with no server set it calls Exa directly.

**Say:** "Same account, same errands, in the browser. It sees the form on the page and offers to fill it, and it works without our server too."

**Hits:** Working implementation, Originality (one butler across surfaces).

**If it fails:** if the panel list is empty, the link is not set up. Say "the extension has its own list too" and show a completed find in it. If the panel does not open, skip to the close.

### 2:55-3:00 Close

**Say:** "Vali does the digging with Exa, shows every source, fills the real form, and leaves the final click to you. Try it: give it your own errand."

Hand the laptop to the judges with the quick box ready (Alt+Space).

## When the judges try their own errand

- "Find" errands answer in seconds and are the safest live query. Good prompts: a restaurant, a café open now, a laptop under a budget. They can type, or hold Alt+Shift+Space and say it.
- "Check" and "claim" errands use the Exa Agent and take 10-90 seconds. Say so before they press Enter.
- If they ask for "do it" on a new site: it works on forms without login. Sites behind Suomi.fi, bank ID, a login, a CAPTCHA or Cloudflare (Kela, Vero, Migri, HSL) stop with a one-line reason and a "Finish in your tab" button. That is the designed behaviour; show it rather than apologise.
- Do not demo "watch" errands: Exa Monitors are not wired yet, so a watch is only saved locally.
- WhatsApp is parked, so do not offer it. If asked: "Meta blocks sending from unverified business portfolios, so we moved the chat idea to iMessage. The plan is in docs/IMESSAGE.md."

## Timing notes

- Find: about 3 seconds.
- Agent research: 10-90 seconds (22-28 seconds in the verified runs).
- Sandbox on a real site: 50-60 seconds to the approval card, plus about 25 seconds of research before Let Vali do it is available. That is why the booking starts at 1:05 and the claim answer is read while it researches.
- Live view runs at about 1 frame per second; it pauses when the page is still.
