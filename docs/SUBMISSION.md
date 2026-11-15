# Vali: Junction 2026 submission

Challenge: Exa, "The Internet Butler". Final deadline Sun 15 Nov 10:00 EET. Paste each block into the platform form as it is.

Live app: https://bogdan-c-2206--vali-web.us-east.modal.run/

Judges' access: sign in with the demo account, already full of real errands, on the web and in the extension. The email and password go in the form's notes, not in the repo. The `#demo=<token>` link opens the same account, view only.

Chrome extension: download it from **Get the extension** on the site (`/vali-extension.zip`), unzip it, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, then sign in from its settings with the same account.

---

## Form fields

| Field | What to paste |
|---|---|
| Project Name | Section 1 |
| Punchline | Section 2 |
| Description | Section 3 |
| Challenge Picker | The Internet Butler (Exa) |
| Project Demo URL | The live app link above |
| Source Code URL | github.com/bristiana/junction-exa (make it public first) |
| Video link | The 2-minute video from section 5, public |
| Other Link | The extension zip: /vali-extension.zip on the live app |
| Presentation | The slides as PDF |
| Tech Challenge Participation | Modal, Aiven, plus any other we can back with the running product |

## 1. Project name (max 30)

```
Vali
```

4 characters.

## 2. Punchline (max 200)

```
Your valet for life in Finland. Message Vali on WhatsApp: it reads the live web with Exa, answers for your situation with the exact source, fills the real form and books when you tap Approve.
```

191 characters.

## 3. Description (max 5000, markdown)

Paste everything between the two lines. 4,653 characters (4,710 if the form counts line breaks as two).

---

Vali is your valet for life in Finland, made for foreigners. Meet Bogdan: a master's student from Romania at Aalto, a few weeks into life in Espoo. He still has no Finnish personal ID, no Finnish bank account and pays full price on HSL. And this weekend he is at Junction. The answers he needs are spread over Finnish pages that change every year. No chatbot knows them.

So he messages Vali on WhatsApp: *"How can I open a bank account without a Finnish personal ID?"* Vali reacts 👀 and about 30 seconds later answers in one sentence, with the page picture, the key facts and the exact Danske Bank and Migri links. Every sentence is checked against a quote from today's version of the page. The answer ends with **Next for you**: register your EU right of residence at Migri. One tap starts it.

## Who it is for

International students and newcomers in Finland. Bank, Kela, DVV, Migri, HSL and housing errands, and a new life to set up: a sauna with friends, a film on Saturday, a court for a game.

## What Vali does

- **Answers for your situation.** Vali asks once: EU or not, student or not. Answers then fit you (no Finnish ID yet, no bank ID, student prices) and explain Finnish words.
- **Answers with sources.** One sentence, the key facts, the exact links. Route questions get an HSL journey planner link with both ends already filled in.
- **Gets it done.** Tap **Book it**. A private cloud browser opens the real booking page, fills it, and sends a picture of the filled form with **Approve** and **Stop**. Nothing is sent before Approve.
- **Stop and Continue.** Plans change. Tap Stop. Tap Continue later and Vali picks up where it stopped, without asking again for what you already told it.
- **Never pays for you.** Pay-on-site bookings are completed for real. Paid tickets stop at the payment page and open in your own browser.
- **Keeps watching.** "Watch ..." sets up a daily Exa Monitor for things that change: prices, rules, slots, flats. Only new findings reach your WhatsApp.

Tonight Vali made a real booking from WhatsApp: Kulttuurisauna in Helsinki, Sunday 22 Nov at 17:30, after a Stop and a Continue. The sauna confirmed it by email.

## Same Vali, everywhere

- **WhatsApp:** the main channel. Buttons, reactions, page pictures, PDFs.
- **Web:** sign in with email and password, a WhatsApp code or the demo link. The dashboard shows every errand, Exa search and page read, live. Each errand reads as a short story: you asked, Vali found, Vali did, and where it stands now, with the one button that moves it on.
- **Chrome extension:** a chat with Vali in the side panel and the mascot in the corner of every page.

## How Vali uses Exa

Answers come from pages Exa reads live, not from training data.

- **Agent runs** research the errand into a structured answer with field citations and the next errand.
- **Search** with domain and location filters, moderation and an output schema for quick finds.
- **Contents** re-reads every cited page (at most a day old) and checks each sentence against a quote. It also brings the page picture for WhatsApp.
- **Monitors** with a signed webhook for watches, plus "check now".
- **Fast search** for the mascot's page tips.
- **Search and Contents inside the cloud browser** when a form needs a fact or the real booking link.

## Does it work

Live eval on production, fresh account, fake details: 13 of 13 research errands answered, 24 of 26 facts confirmed on the source page (92%), median 25 s, $0.33 of Exa in total. Continue reached the approval step on 4 of 5 booking sites (Kulttuurisauna, Allas Sea Pool, play.fi padel, a test form). Finnkino stops at its bot wall by design and hands over the page.

## You stay in control

- Nothing is booked, sent or submitted without your Approve.
- Payments are always yours.
- The AI sees placeholders like `{{name}}` for details you saved; real values are typed only into a form you approve.
- Page text is treated as data, never as instructions.

## Built on Modal

Every **Book it** runs in its own private Chromium browser on Modal (2 CPUs, 4 GB), driven by Claude, with a live view on WhatsApp and the web. **Continue** starts a fresh run told what the last one did and what you said. Exa research runs in separate Modal workers. The API and web app run on Modal too, with Aiven Postgres as the shared store.

## Try it

Sign in on the live app with the demo account (email and password in the form's notes) and ask:

1. `How can I open a bank account without a Finnish personal ID?`
2. `I study my master's at Aalto. How do I get the HSL student discount?`
3. `Book a public sauna at Kulttuurisauna on Sunday at 17:30`

---

## 4. Technologies

```
Exa (Agent runs, Search, Contents, Monitors), Modal, Playwright + Chromium, Anthropic Claude, Aiven Postgres, WhatsApp Cloud API, ElevenLabs, Jev (TypeSafe AI), FastAPI, Python, JavaScript, Chrome extension (MV3), Codex, Claude Code
```

## 5. Video (under 2:00)

Screen recordings are in the scratchpad (`rec/`): WhatsApp in phone format, the web on a laptop. Blur the name and email in the booking shots. Speed up cloud browser waits and say "sped up".

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:12 | Bogdan's situation: Aalto student from Romania, no Finnish ID, Junction this weekend. | "Bogdan studies at Aalto. No Finnish ID yet, no Finnish bank, and this weekend he is at Junction." |
| 0:12-0:32 | WhatsApp: `How can I open a bank account without a Finnish personal ID?` 👀, then the answer with the Danske Bank picture, facts, links and Next for you. | "Vali reads the live web with Exa, answers for his situation in one sentence, and links the exact pages." |
| 0:32-1:05 | WhatsApp: book Kulttuurisauna Sunday 17:30. Book it, name and email, the filled-form picture with Approve and Stop. Stop, then Continue: back at Approve without asking again. Approve. "Booked". | "A private cloud browser on Modal fills the real form. Stop, Continue, and it picks up where it left off. Nothing is sent until he taps Approve." |
| 1:05-1:12 | The sauna's confirmation email (blurred details). | "A real booking." |
| 1:12-1:32 | Web dashboard: the sentence of numbers, click the sauna errand, the chat thread to "Booked". | "Everything from WhatsApp lands on the dashboard, live." |
| 1:32-1:50 | The errand story: You asked, Vali found, Vali did, Now, with the options and Next for you. | "Each errand tells what he asked, what Vali found, what it did, and what is next." |
| 1:50-2:00 | Landing page: "Your valet for life in Finland." Built on Exa and Modal. | "Vali. Your valet for life in Finland." |

## 6. Slides

The deck: https://claude.ai/artifact/37ghc6G5jLHQTEqyKDPh6q (share it, then export the PDF).

## 7. Checklist (on the platform)

- [ ] Make the repo public (github.com/bristiana/junction-exa): only its owner can.
- [ ] Upload the video as **Public**, paste the link.
- [ ] Export the slides as PDF and upload.
- [ ] Name, punchline and description from sections 1 to 3. Technologies from section 4.
- [ ] Links: live app, repo, demo link as Other Link.
- [ ] Main challenge: Exa, The Internet Butler. Tech challenges: Modal, Aiven.
- [ ] Do not deploy in the last hour.
- [ ] Set the submission to **FINAL** before 10:00 EET (aim for 09:30).
- [ ] After the event: rotate every API key used during the hackathon, including the WhatsApp app secret.
