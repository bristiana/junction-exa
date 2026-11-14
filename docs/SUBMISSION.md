# Vali: Junction 2026 submission

Challenge: Exa, "The Internet Butler". Final deadline Sun 15 Nov 10:00 EET. Paste each block into the platform form as it is.

Live app: https://bogdan-c-2206--vali-web.us-east.modal.run/

---

## 1. Project name (max 30)

```
Vali
```

4 characters.

## 2. Punchline (max 200)

```
Your valet for life in Finland. Just arrived? Permits, bank, Kela, HSL, saunas, rent: message Vali, it researches the live web with Exa, fills the real form and acts when you tap Approve.
```

187 characters.

## 3. Description (max 5000, markdown)

Paste everything between the two lines. 3,970 characters (4,025 if the form counts line breaks as two).

---

Vali is your valet for life in Finland, built for foreigners who just arrived. Documents, money, transport, bookings, housing: message it on WhatsApp and it handles the errand. Say you just landed in Espoo for your master's and need a bank account, but have no Finnish ID yet. The answer is spread over bank sites and DVV, half in Finnish, and it changed this year. No chatbot knows it.

So you message Vali on WhatsApp: *"Can I open a bank account without a Finnish ID?"* Vali reacts 👀 and about 30 seconds later answers in two sentences, with the key facts and the exact Danske Bank, Nordea and DVV pages it read. Every sentence is checked against a quote from those pages.

## Who it is for

International students and newcomers in Finland. In their first weeks they face bank, Kela, DVV and housing errands, and a new life to set up: a sauna with new friends, a film on Saturday. Less language, less context, same deadlines.

## What Vali does

- **Answers with sources.** One or two sentences, the key facts, the exact links.
- **Gets it done.** Tap **Book it**. Vali opens the real booking page in a cloud browser, fills it, and sends you a screenshot of the filled form with **Approve** and **Stop**. It books only after you tap Approve.
- **Asks once.** Missing your name or email? Vali asks once, or asks before it uses details you saved.
- **Never pays for you.** Pay-on-site bookings like Kulttuurisauna in Helsinki are completed for real. Paid ones like cinema tickets at Gilda are filled up to the payment page. Tap **Continue in my browser** and the same cart opens in your own Chrome, so you pay yourself.
- **Keeps watching.** "Watch ..." sets up a daily Exa Monitor. Only new findings reach your WhatsApp. "Check now" runs it right away.
- **Stays quiet.** Vali reacts instead of flooding the chat: 👀 on it, 🚀 started, ✍️ got your reply, 👍 approved, ✋ stopped.

## Same Vali, everywhere

- **WhatsApp:** the main channel. Name, picture, tap buttons.
- **Web:** ask, see every errand, and open the **Dashboard**: errands by channel, Exa searches, pages read, quotes checked, Exa cost, and every search query, filling live as you message on WhatsApp.
- **Chrome extension:** the Vali mascot sits in the corner of every page. Click it and ask anything about the page. It also hands paid bookings over to your browser.

## How Vali uses Exa

Vali's answers come from pages Exa reads live, not from training data: this year's bank rules, today's sauna slots, this week's films.

- **Agent runs** (`/agent/runs` + events) research the errand and return a structured answer with citations.
- **Search** with an output schema and highlights for quick finds.
- **Contents** re-reads every cited page and checks each sentence against a verbatim quote.
- **Monitors** with a signed webhook for watches, plus trigger for "check now".
- **Fast search** for the extension's page tip.
- **Search and Contents inside the cloud browser** when a form needs a fact, like an address or a fee.

## Clear sources

Every answer ends with the exact source links. On the web, every sentence has numbered sources with the quote, the domain, an "official" tag and when it was read. The dashboard shows each Exa call behind each errand.

## You stay in control

- Your details stay on your device. The AI sees placeholders like `{{name}}`, and real values are typed only into a form you approve.
- Nothing is booked, sent or submitted without your Approve.
- Payments are always yours.
- Page text is treated as data, never as instructions.

## Tech

Exa, Modal (API and one cloud browser per run), Playwright and Chromium driven by Claude, Aiven Postgres, WhatsApp Cloud API, Chrome extension, plain JS web app.

## Try it

Open the live app, tap **WhatsApp** to link your number, and send an errand. Or ask on the web:

1. `Can I open a bank account without a Finnish ID?`
2. `Book Kulttuurisauna for 2 this Friday evening`
3. `Watch for new Kela news for international students`

---

## 4. Technologies

```
Exa (Agent runs, Search, Contents, Monitors), Modal, Playwright + Chromium, Anthropic Claude, Aiven Postgres, WhatsApp Cloud API, ElevenLabs, Jev (TypeSafe AI), FastAPI, Python, JavaScript, Chrome extension (MV3), Codex, Claude Code
```

## 5. Video script (1:50)

Rules: strictly under 2:00, public on YouTube or Vimeo. Screen-record the phone (WhatsApp) and the laptop (web, Chrome). Made-up test details only. Speed up cloud browser waits in editing and say "sped up" on screen.

Before recording: send each errand once to warm Modal and the Exa cache, and keep a finished copy of each in the chat as a fallback.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:10 | Problem. A student in Espoo, a phone full of Finnish bank and DVV pages. Caption: "New in Finland. No Finnish ID." | "You just moved to Finland. Every errand lives on a Finnish site, the rules changed this year, and no chatbot knows them." |
| 0:10-0:28 | WhatsApp: Vali's name and picture. Send `Can I open a bank account without a Finnish ID?`. 👀 appears. Answer in two sentences with Danske Bank, Nordea and DVV links. | "So I message Vali. It searches the live web with Exa, reads the bank and DVV pages, checks every sentence against a quote, and answers with the exact links." |
| 0:28-0:52 | Send `Book Kulttuurisauna for 2 this Friday evening`. Answer with **Book it**. Tap it, 🚀. Vali asks once for name and email. Screenshot of the filled form arrives with **Approve** / **Stop**. Tap Approve, 👍. Cut to the confirmation email. Caption: "sped up". | "Book it. A cloud browser fills the real booking form and sends me a screenshot. Nothing happens until I tap Approve. And that is a real booking." |
| 0:52-1:10 | Send a Gilda cinema errand. Vali fills it up to the payment page. Laptop: tap **Continue in my browser**, the same cart opens in Chrome at payment. | "Paid tickets? Vali fills everything up to payment, then hands the same cart to my own browser. I pay, never Vali." |
| 1:10-1:24 | Send `Watch for new Kela news for international students`. Then `check now`. A new finding arrives in the chat. | "Vali keeps watching with an Exa Monitor and only messages me when something new appears." |
| 1:24-1:38 | Laptop: web Dashboard filling live as the errands land: errands by channel, Exa searches, pages read, quotes checked, cost, the queries. | "Everything shows up on the dashboard: every Exa search, every page read, every quote checked." |
| 1:38-1:46 | Chrome on a Kela page. Click the Vali mascot in the corner, ask about the page, cited answer. | "And Vali sits on every page. Click it and ask." |
| 1:46-1:50 | Closing slide: "Vali. Your errands, done. Built on Exa." Logos and the live link. | "Vali. Built on Exa." |

## 6. Slide outline (6 slides)

| # | Title | One line | On screen |
|---|---|---|---|
| 1 | Vali | Your errand butler in Finland, on WhatsApp. | Mascot, WhatsApp chat with Vali's picture, live link. |
| 2 | New in Finland, no Finnish ID | The answers exist, but they are buried in Finnish pages that change every year. | Persona: non-EU master's student in Espoo, with the bank, DVV and Kela pages behind them. |
| 3 | Message it, get the source | A cited answer in about 30 seconds, quotes checked. | WhatsApp bank answer with the Danske Bank, Nordea and DVV links. |
| 4 | Tap Book it, then Approve | Vali fills the real form; you approve; payments stay yours. | Filled-form screenshot with Approve / Stop, sauna confirmation email, Gilda cart in Chrome. |
| 5 | Exa does the reading | Agent runs, Search, Contents quote checks, Monitors, all live. | Dashboard: Exa searches, pages read, quotes checked, cost per errand. |
| 6 | Try Vali | WhatsApp, web and Chrome, one Vali. | Live link, QR code, "Built on Exa". |

## 7. Checklist (on the platform)

- [ ] Make the repo reachable for judges (github.com/bristiana/junction-exa is private): make it public, add the judges, or leave the link out.
- [ ] Record the video from section 5, under 2:00, upload as **Public**, paste the link.
- [ ] Optional: export the 6 slides as a PDF and upload.
- [ ] Name, punchline and description from sections 1 to 3. Technologies from section 4.
- [ ] Links: live app and repo.
- [ ] Main challenge: Exa, The Internet Butler. Tech challenges: Modal, Aiven, plus any other you can back with the running product.
- [ ] Do not deploy in the last hour.
- [ ] Set the submission to **FINAL** before 10:00 EET (aim for 09:30).
- [ ] After the event: rotate every API key used during the hackathon.
