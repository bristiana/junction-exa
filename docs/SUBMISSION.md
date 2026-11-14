# Vali: Junction 2026 submission

Challenge: Exa, "The Internet Butler". Final deadline Sun 15 Nov 10:00 EET. Paste each block below into the platform form as it is.

Live app: https://bogdan-c-2206--vali-web.us-east.modal.run/

---

## 1. Project name (max 30)

```
Vali
```

4 characters.

## 2. Punchline (max 200)

```
Vali takes errands off newcomers in Finland: it reads the official pages live with Exa, cites every fact, fills the real form in a cloud browser and stops for your OK.
```

167 characters.

## 3. Description (max 5000, markdown)

Paste everything between the two lines. 4,864 characters (4,926 if the form counts line breaks as two).

---

## The problem

Moving to Finland means a stack of small errands: register your address, get a tax card, open a bank account without a Finnish ID, check a rent increase, book a sauna for friends. The rules sit on Finnish sites (DVV, Kela, Migri, Vero, city pages), often in Finnish first. The answer is spread over several pages and changes every year. The last step is a long form. A chatbot does not know this year's amounts or today's form.

## Who it is for

International students and newcomers in Finland. They have these errands in their first weeks, with less language and less context than locals.

## What Vali does

1. **Ask.** Type or say the errand at one link, in any language. Vali answers in that language.
2. **Watch it search.** A live trail shows each Exa search and each page read.
3. **Get a cited answer.** Every sentence has numbered sources. Each source shows its domain, an "official" tag, when it was read, its published date (with a warning when old) and the exact quote when Vali finds one. A sentence that no quote backs is marked.
4. **Get the plan.** Key facts, then the next steps, each marked "Vali" or "You".
5. **Fill it for me.** A cloud browser opens the real form, fills it, and stops before the final button. You see a live view and the filled values. Nothing is sent until you press Approve.

Also:

- **Your first weeks in Finland:** 26 official services (permit, registration, tax card, bank, Kela, healthcare, HSL discount) filtered by EU/non-EU and degree/exchange, with short quotes read live from the official page, nearby offices with hours from the Helsinki service map, and a landlord check in the PRH trade register.
- **Chrome extension:** a sourced tip on Kela, Migri, DVV, Vero, university and housing pages; "Ask Vali about this" on selected text; "Fill it here" fills the form in your own tab, behind your login, and you send it.
- **Mac app** with a voice agent (ElevenLabs): talk to Vali, start errands, approve by voice. The web page takes voice input too.

## How Vali uses Exa

- **`/search`** with highlights and a structured output schema for "find" errands. About 3 seconds.
- **`/agent/runs`** for check, claim, book and write errands: a structured answer (answer, key facts, steps, actions, form values) with field-level citations. The run's events feed the live trail.
- **`/contents`** re-reads every cited page to match each sentence to a verbatim quote and read the published date.
- **`/search` restricted to the official domain** for each hub service, cached 6 hours.
- **`/search` and `/contents` inside the cloud browser:** when a form asks for an address or a fee, the agent looks it up and saves the lookup on the errand.
- **`/monitors`** for "watch" errands: a daily search that reports only what is new.

None of this can come from training data: this year's benefit amounts, a form URL that moved last month, today's sauna prices, offices open now, a company registered last week.

## Sources

Numbered pills on every sentence with a quote popover. "How Vali found this" lists the exact Exa queries, the pages read, seconds and cost. The privacy sheet lists every page Vali touched.

## Privacy and safety

- Details saved in the extension or Mac app stay on your device. The AI only sees placeholders like `{{name}}`. Real values go to the cloud browser only for a form you approve, are typed at the last moment, masked in every snapshot the model reads, and never stored.
- Page text is redacted in the browser before it leaves (emails, phones, Finnish ID codes, IBANs, cards).
- Nothing is submitted, paid, booked or sent without your Approve. Payments always hand off to you.
- Page text is treated as data, never as instructions. A page that tries to steer the agent ends the run.
- Logins (Suomi.fi, bank ID), CAPTCHAs and bot walls stop the run with a reason and a link to finish yourself.

## Tech

FastAPI on Modal. One Modal container per browser run (Playwright Chromium driven by Claude). Postgres on Aiven. Jev routes errands. ElevenLabs for speech-to-text and the voice agent. Plain JS web page, Chrome extension, Electron Mac app.

## Limits

- Payments always hand off to you.
- Phone calls need a Twilio number. iMessage needs a dedicated Apple ID. WhatsApp is blocked by Meta business verification.
- Sites behind Suomi.fi or bank ID can be filled in your own tab with the extension, not in the cloud.
- Research takes 3 to 90 seconds depending on the errand.

## Try it

Open https://bogdan-c-2206--vali-web.us-east.modal.run/ (no sign-up) and ask:

1. `How do I register a change of address after moving to Helsinki?`
2. `Book a public sauna in Helsinki for a group of 8`
3. `Order a medium pizza with bacon on the httpbin test form at https://httpbin.org/forms/post for Aino Virtanen, test@example.com`, then press **Fill it for me** and watch it stop for your OK.

---

## 4. Technologies

```
Exa (Search, Contents, Agent runs, Monitors), Modal, Playwright + Chromium, Anthropic Claude, Aiven Postgres, ElevenLabs (speech-to-text, voice agent), Jev (TypeSafe AI), FastAPI, Python, JavaScript, Chrome extension (MV3), Electron, Helsinki service map API, PRH YTJ open data API, Codex, Claude Code
```

## 5. Video script

Rules: strictly under 2:00, public on YouTube or Vimeo. Record on the live web page in a fresh browser window, 1440x900, zoom 110%. Use made-up test data only. Speed up the cloud browser run in editing and say so on screen.

Before recording: run errand A once (warms Modal and the Exa cache), and keep a finished copy of A and B in "Your errands" as a fallback.

- Errand A (from Exa's brief video): `How do I register a change of address after moving to Helsinki?`
- Errand B (Fill it for me): `Order a medium pizza with bacon and cheese, delivery at 19:00, on the httpbin test order form at https://httpbin.org/forms/post. Name Aino Virtanen, phone +358401234567, email test@example.com. Write "ring the bell" as delivery instructions.`

### Full cut (1:56)

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:08 | Home page: "New in Finland? Hand me the errand." Mascot walks in. | "New in Finland? Every errand lives on a Finnish site, the rules change every year, and it ends in a long form." |
| 0:08-0:14 | Type errand A in the ask box, press Ask Vali. | "Vali takes the errand. I ask in plain words." |
| 0:14-0:28 | Working view. The trail fills: Exa searches, then suomi.fi, dvv.fi, posti.fi pages read. | "Vali searches the live web with Exa. You see every search and every page it reads, as it happens." |
| 0:28-0:46 | Answer view. Hover a numbered pill: popover with domain, "official", read time, quote. Point at a marked sentence if there is one. | "Every sentence has its sources. Hover one: the official page, when it was read, and the exact quote. If no quote backs a sentence, Vali marks it." |
| 0:46-0:56 | Scroll to key facts and "What happens next", with the "Vali" and "You" badges. | "Then the plan: the one-week deadline, the official service, what Vali does and what you do." |
| 0:56-1:04 | Open "How Vali found this": Exa queries, pages, seconds, cost. | "And how it found it: the exact Exa queries and every page, a few cents per errand." |
| 1:04-1:12 | Back home. Paste errand B, Ask Vali, answer appears, press Fill it for me. | "Now a form. This is httpbin's test form with made-up details, so nothing real is ordered." |
| 1:12-1:30 | Live view of the cloud browser filling the form. Caption: "Sped up 4x". | "A cloud browser on Modal opens the real page and fills it, with a live view. In the extension and the Mac app, your saved details stay on your device and the AI only sees placeholders." |
| 1:30-1:40 | "Waiting for your OK" card with the filled values. Press Approve. Status turns Done. | "It stops before the last button. Nothing is sent until I approve." |
| 1:40-1:50 | Click "First weeks": the 26 services, one opened with live quotes, nearby offices with hours, the company check. | "For your first weeks: 26 official services, read live, with nearby offices and a landlord check in the trade register." |
| 1:50-1:56 | Kela page with the extension tip, then the home page with the link on screen. | "It comes with you in Chrome too. Try Vali at the link below." |

If errand A shows no quote on any pill, swap shots 0:28-0:46 for errand `Book a public sauna in Helsinki for a group of 8` (in the 14 Nov live check its sources showed the price quotes from uunisaari.fi). Keep the same voiceover.

### 30-second cut (0:29)

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:05 | Home page, type errand A. | "New in Finland? Hand Vali the errand." |
| 0:05-0:12 | Trail of Exa searches and pages read. | "It searches the live web with Exa and shows every page it reads." |
| 0:12-0:19 | Answer, hover a pill with its quote. | "Every sentence shows its source, and the exact quote when Vali finds one." |
| 0:19-0:26 | httpbin form filled in the live view, "Waiting for your OK", Approve. | "A cloud browser fills the real form and waits for your OK." |
| 0:26-0:29 | Home page with the link. | "Vali. Try it at the link." |

## 6. Pitch deck outline (optional PDF, 5 slides)

1. **Vali: errands for newcomers in Finland**
   - Finnish-only sites, rules that change, long forms.
   - International students and newcomers have these errands in their first weeks.
   - A chatbot does not know this year's rules or today's form.
2. **Hand it the errand**
   - Ask in any language at one link, watch the live Exa trail.
   - Cited answer, key facts, a plan split into "Vali" and "You".
   - Fill it for me: a cloud browser fills the real form and stops for your OK.
3. **Exa does the reading**
   - Agent runs with field-level citations, Search for quick finds, Contents for quotes and dates.
   - Exa lookups inside the browser run when a form asks for something.
   - Monitors for watch errands. Every fact comes from a page read live.
4. **You can check every fact, and you keep control**
   - Numbered sources per sentence, exact quotes when found, official tag, freshness.
   - Saved details stay on your device; the AI sees placeholders. Real values reach the browser only for an approved form, never stored.
   - Nothing is sent, paid or booked without Approve. Page text is never an instruction.
5. **Built and tested**
   - Web page, Chrome extension, Mac app with voice. Modal, Aiven, ElevenLabs, Claude, Jev.
   - 39 of 44 judge-style phrases passed on the live API, median 33 seconds, about 2 cents each.
   - Limits: payments hand off to you; phone, iMessage and WhatsApp wait on third parties.

## 7. Checklist for Bogdan (on the platform)

- [ ] Make the repo reachable for judges. github.com/bristiana/junction-exa is **private** today: make it public or add the judges, or leave the repo link out.
- [ ] Record the video from section 5, under 2:00, upload to YouTube or Vimeo as **Public**, paste the link.
- [ ] Optional: export the 5 slides as a PDF and upload.
- [ ] Name: `Vali`. Punchline and description from sections 2 and 3. Technologies from section 4.
- [ ] Links: live app https://bogdan-c-2206--vali-web.us-east.modal.run/ and the repo.
- [ ] Main challenge: Exa, The Internet Butler.
- [ ] Tech challenges to tick: Modal (API and the browser sandbox), Aiven (Postgres), ElevenLabs (speech-to-text and voice agent). Codex only if the form allows it and you are fine claiming build-time use (Codex workers wrote and checked code; it is not in the running product). Do not tick Cloudinary: it is not configured on the deployed API.
- [ ] Check the multi-challenge rule on the form before ticking extra challenges.
- [ ] Do not deploy in the last hour. Run `scripts/golden.py` once around 09:00.
- [ ] Set the submission to **FINAL** before 10:00 EET (aim for 09:30).
- [ ] After the event: rotate the keys pasted in chat (Exa, Anthropic, ElevenLabs, Meta, Aiven, Modal).
