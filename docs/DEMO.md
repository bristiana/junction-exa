# Vali: 3-minute demo script

For the Exa "Internet Butler" judging, Sun 15 Nov 10:00. The main path starts on the Mac app, then shows the extension. Every errand below passed live in the overnight eval (`scripts/evals/scorecard.md`, errand texts in `scripts/evals/errands.json`). Real sites always stop before the final button. Never click "Approve" on a real site.

Rehearse the Löylykontti step through the Mac app at least once. Paste the errand texts exactly as written below.

Judging criteria (20% each): **Use of Exa**, **Usefulness**, **Clarity of sources**, **Originality**, **Working implementation**. Each step below says which one it hits. The three Exa moments are marked **Exa moment**: research with sources, research before a booking, and Exa lookups mid-form.

## The five demo errands

| # | Id | Paste this | Ends at | Time |
|---|---|---|---|---|
| 1 | book-sauna | `Book a shared sauna for 8 people next Saturday evening (21 November) at Löylykontti Sörnäinen` | approval before pay: the slot, 208 EUR total, sources | about 145 s |
| 2 | claim-pothole-form | `Report a deep pothole at Mannerheimintie 5 in Helsinki to the city. I want a reply by email.` | approval before Send: 7 values | about 150 s |
| 3 | claim-ta-defect | `The kitchen tap in my TA rental flat is leaking. Report it to TA.` | approval before submit, after property autocomplete and preview | about 95 s |
| 4 | book-allas-tickets | `Buy 2 adult tickets for Allas Sea Pool for Sunday 22 November afternoon` | approval before payment, after a 4-step wizard with guest checkout | about 85 s |
| 5 | claim-eu261 | `My Finnair flight from Helsinki to Barcelona last Tuesday landed 4 hours late. What can I get?` | answer: 400 EUR with the EU rule cited (research only) | about 25 s |

## Before the judges arrive (T-15 min)

1. Run the golden checks: `GOLDEN_TOKEN=... backend/.venv/bin/python scripts/golden.py`. All 3 must pass. This also warms the Modal images.
2. Mac app: running (`cd desktop && npm start`, or the installed dmg build from `npm run dist`). The mascot is bottom right. Server is `https://bogdan-c-2206--vali-web.us-east.modal.run`. Settings > Profile holds made-up test data only (a fake name, an `example.com` email, a fake `+358` number). macOS has granted the microphone, Accessibility and Automation once, so no permission prompt appears on stage.
3. Link the extension: in the extension settings press Show code and type it in the Mac app (Settings > Link with the extension), or the other way round. Both must show the same errand list. If linking fails, paste the extension token under Advanced.
4. Chrome: the extension is loaded unpacked and Settings shows the same server. Its "Your details" holds the same made-up data.
5. Open four tabs:
   - `https://www.loylykontti.fi/en/reserve` (sauna booking, keep this one in front)
   - `https://palautteet.hel.fi/vikailmoitus-lomake` (Helsinki "Report a problem")
   - `https://asunnonhakijalle.production.kenno.pandia.fi/defect-notice/create?slug=t2&lang=en` (TA fault report)
   - `https://shop.allaspool.fi/en/shop/tickets` (Allas Sea Pool shop)
6. At T-5 min, start errands 2, 3 and 4 from the quick box (Alt+Space) and let them run to their approval cards. They take 85-150 s each, so they cannot run live inside 3 minutes. They are shown at 1:00 as finished cards.
7. Backups ready: a screen recording of one full Löylykontti run up to the approval card, and yesterday's completed tasks still in the list.
8. Use an account that has not spent much today. The API stops research for an account at $2 per day (`VALI_DAILY_CAP_USD`) and allows 30 new errands per 10 minutes. The five errands cost about $0.90 together. If rehearsals used the account, create a fresh one.
9. WhatsApp is parked and is not part of the demo. Do not open it.

## The script

### 0:00-0:10 Who it is for

**Do:** nothing yet. Chrome is in front on the Löylykontti tab.

**Say:** "Newcomers and students in Finland lose hours on errands: Finnish-only sites, rules that changed this year, long forms. Vali takes the errand. Exa finds the live answer, and a cloud browser fills the real form and waits for your OK."

**Hits:** Usefulness (a named group with real errands).

### 0:10-0:25 Start the booking (Mac app, errand 1: book-sauna)

**Do:** press Alt+Space. The tab title and address come along as a chip. Paste: `Book a shared sauna for 8 people next Saturday evening (21 November) at Löylykontti Sörnäinen`. Press Enter.

**Say:** "Same box, and it knows the page I am on. This runs for a couple of minutes, so while Exa researches the booking, let me show a claim."

**If it fails:** if Alt+Space does nothing, try Alt+V or use the menu bar icon, "New errand". If the Mac app is down, type the same errand in the extension side panel (Alt+V in Chrome).

### 0:25-1:00 Claim with sources (errand 5: claim-eu261)

**Do:** press Alt+Space again. Paste: `My Finnair flight from Helsinki to Barcelona last Tuesday landed 4 hours late. What can I get?`. Press Enter. Open the errand when it is done (about 25 s; a macOS notification also fires).

**Shows:** 400 EUR under EU261, the 3-hour threshold, and the next step. Each fact carries its citation. Click one source to show it is a real page.

**Say:** "These numbers come from the regulation and Finnair's own pages, read just now. Every fact has its source." If the answer cites the 2-month window, add: "That deadline comes from a Finnish court ruling this April. A model without live search does not know it."

**Exa moment 1: research with sources.** **Hits:** Use of Exa, Clarity of sources, Usefulness.

**If it fails:** the Agent can take up to 90 seconds. If it is not back, say "it is still reading, we come back to it" and go on. If it failed, open the completed claim task from earlier. Do not run the Finnair wizard itself: it checks a real booking reference.

### 1:00-1:50 Forms that stop at the last button (errands 2, 3, 4)

**Do:** hover the mascot to open all errands at a glance. Open the pothole errand (claim-pothole-form), then the TA fault report (claim-ta-defect), then the Allas tickets (book-allas-tickets). Show each approval card for a few seconds.

**Shows:**
- Pothole: the real Helsinki "Report a problem" form, stopped before Send, with 7 values filled.
- TA: the fault report with the property picked from the autocomplete, stopped at the preview before submit.
- Allas: a 4-step shop wizard with guest checkout, stopped before payment.

**Say:** "Three different real sites, three different shapes: a city form, an iframe form with a preview, a shop wizard. Each one stops before the final button. Claude decides each step but never sees my details. It types `{{name}}` and `{{email}}`; the real values stay on this Mac and go in at the last moment."

**Hits:** Working implementation, Usefulness, Originality.

**If it fails:** if a card is missing, rerun that errand live from the quick box and say "this takes about 90 seconds, here is yesterday's run" while you open the completed one. Last resort: the screen recording.

### 1:50-2:20 Talk to Vali (optional)

Only do this if `/health` shows `voice_agent` and the room is quiet. Skip it otherwise.

**Do:** press Alt+Shift+V on the Mac. Ask out loud: "What do I need to bring to the sauna booking?" The ElevenLabs agent answers. Press Alt+Shift+V again to stop.

**Say:** "I can also just talk to Vali. It is a voice agent on the same butler."

**Hits:** Originality.

**If it fails:** if there is no sound or any doubt, stop and go on. Do not retry on stage.

### 2:20-2:40 The sauna approval card (errand 1)

**Do:** open the sauna errand. If the run is still going, show the live view while it fills. It reaches the approval card about 145 s after the start. The card shows the slot, the 8 people, 2 h, the 208 EUR total, every filled value, and the sources. Click **Stop**. Never approve here.

**Say (at the approval card):** "It stopped before 'Accept terms and pay'. I can approve with one click, or stop. I stop, because this is a real sauna."

**Exa moment 2: research before the booking.** Point at the 208 EUR total and the sources on the card. Say: "Exa researched the price and the rules before the browser started, and the sources are on the card."

**Exa moment 3: Exa mid-form.** Only if you can see a step or source on the card that came from a lookup while the form stayed open (a slot rule, a price). Say: "It did not leave the form to look that up. It asked Exa from inside the run." Otherwise skip the line.

**Hits:** Use of Exa, Originality (research to a done form with an approval gate), Working implementation, Usefulness.

**If it fails:**
- Run stops as `needs payment` with the same summary: show it, it is the same stop point. Say "it reached the pay step and handed it back".
- Run is not ready at 2:40: show the pothole card from step 1:00 again and say "same thing, finished earlier". Then play the recording of the full Löylykontti run.
- Modal or the sites are down: the recording and yesterday's completed tasks.

### 2:40-2:55 The extension

**Do:** switch to Chrome and press Alt+V. The side panel opens with the same errands, because the two apps are linked. On the Helsinki tab, show the mascot peeking in on the form.

**Shows:** the same task list and the same sources, now next to the page. The extension also works on its own: with no server set it calls Exa directly.

**Say:** "Same account, same errands, in the browser. It sees the form on the page and offers to fill it, and it works without our server too."

**Hits:** Working implementation, Originality (one butler across surfaces).

**If it fails:** if the panel list is empty, the link is not set up. Say "the extension has its own list too" and show a completed claim in it. If the panel does not open, skip to the close.

### 2:55-3:00 Close

**Say:** "Vali does the digging with Exa, shows every source, fills the real form, and leaves the final click to you. Try it: give it your own errand."

Hand the laptop to the judges with the quick box ready (Alt+Space).

**Proof:** 20/20 live errands passed in the overnight eval, $1.47 in total. Scorecard: `scripts/evals/scorecard.md` (errands in `scripts/evals/errands.json`).

## When the judges try their own errand

- "Find" errands answer in seconds and are the safest live query. Good prompts: a restaurant, a café open now, a laptop under a budget. They can type, or hold Alt+Shift+Space and say it.
- "Check" and "claim" errands use the Exa Agent and take 10-90 seconds. Say so before they press Enter.
- If they ask for "do it" on a new site: it works on forms without login. Sites behind Suomi.fi, bank ID, a login, a CAPTCHA or Cloudflare (Kela, Vero, Migri, HSL) stop with a one-line reason and a "Finish in your tab" button. That is the designed behaviour; show it rather than apologise.
- Do not demo "watch" errands: watching is not wired to Exa yet, so a watch is only saved locally.
- WhatsApp is parked, so do not offer it. If asked: "Meta blocks sending from unverified business portfolios, so we moved the chat idea to iMessage. The plan is in docs/IMESSAGE.md."

## Timing notes

- Research only (claim-eu261): about 25 seconds.
- Agent research: 10-90 seconds.
- Sandbox runs in the eval: Allas 85 s, TA 95 s, sauna 144 s, pothole 151 s, from start to the approval card.
- Live view runs at about 1 frame per second; it pauses when the page is still.
