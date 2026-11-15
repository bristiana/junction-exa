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
| Presentation | The slides as PDF (content in [SLIDES.md](SLIDES.md)) |
| Tech Challenge Participation | Modal, Aiven, plus any other we can back with the running product |

## 1. Project name (max 30)

```
Vali
```

4 characters.

## 2. Punchline (max 200)

```
New in Finland? Vali handles it. Ask on WhatsApp or the web: Exa reads today's official pages, Vali answers with the exact source and fills the real form. Nothing is sent until you tap Approve.
```

193 characters.

## 3. Description (max 5000, markdown)

Paste everything between the two lines. 4,233 characters (4,287 if the form counts line breaks as two).

---

Vali is the errand agent for newcomers in Finland. It fills the forms for you, with live research behind every field.

Moving to Finland means forms: DVV registration, a HOAS housing application, a sauna or a court for the weekend. The rules behind them sit on Finnish pages that change every year. On 1 August 2025 Kela moved students to the student housing supplement and they had to apply again. A model trained before that does not know.

## How it works

1. **You ask** on WhatsApp, the web or the Chrome extension. Then get on with your day.
2. **Vali researches in the background.** Exa searches the live web, reads today's official pages and checks every sentence against a quote.
3. **Vali answers** in one sentence, with the key facts and the exact source links, fitted to you: EU or not, student or not, Finnish ID or not.
4. **Vali fills the real form** in a private cloud browser on Modal and sends you a picture of it with **Approve** and **Stop**. Nothing is sent before Approve.
5. **Vali keeps watching.** "Watch ..." sets up a daily Exa Monitor, for example for new flats. Only new findings reach you.

The Chrome extension fills the form on the page you are on with your details, on your device. It never presses submit.

## Who it is for

International students and newcomers in their first year in Finland: bank, DVV, Migri, Kela, HSL, housing, and the weekend plans that come with a new life.

## How Vali uses Exa

Answers and form facts come from pages Exa reads live, not from training data.

- **Agent runs** (with events and continuation): research the errand into a structured answer with field citations, the steps, the form to fill and the next errand.
- **Search** with an output schema, highlights, domain and location filters and moderation: quick finds and service facts from the official site.
- **Contents** (at most a day old, live crawl fallback): re-reads every cited page so each sentence is checked against a quote, and brings the page picture for WhatsApp.
- **Monitors** with a signed webhook and "check now": the daily watches.
- **Fast search**: the extension's tip for the page you are on.
- **Search and Contents inside the cloud browser**: while the form stays open, Vali looks up a fact it needs (an address, a fee) and reads the page's real application links.

## Does it work

Live eval on production, fresh account, fake details: 13 of 13 research errands answered, 24 of 26 facts confirmed on the source page (92%), median 25 s, $0.33 of Exa in total. After Stop and Continue, the form reached the Approve step on 4 of 5 sites (Kulttuurisauna, Allas Sea Pool, play.fi padel, a test form). Finnkino stops at its bot wall by design and hands the page over.

On 15 Nov Vali made a real booking from WhatsApp: Kulttuurisauna, Sunday 22 Nov at 17:30, after a Stop and a Continue. The sauna confirmed it by email.

## You stay in control

- Nothing is sent, booked or submitted without your Approve. Stop any time; Continue picks up where it stopped without asking again.
- Payments are always yours. Paid tickets stop at the payment page.
- Logins (Suomi.fi, bank ID), CAPTCHAs and bot walls stop the run with a reason and a link to finish yourself.
- The AI sees placeholders like `{{name}}`. Real values are typed only into the form, at the last moment.
- Page text is treated as data, never as instructions.
- In the shared demo, Approve sends only on a test site. Anywhere else Vali stops right before sending.

## Built on Modal

Every form runs in its own private Chromium browser on Modal (2 CPUs, 4 GB), driven by Claude, with a live view on WhatsApp and the web. Exa research runs in separate Modal workers. The API and web app run on Modal too, with Aiven Postgres as the shared store.

## Try it

Sign in on the live app with the demo account (email and password in the form's notes). The dashboard shows every errand, Exa search and page read. Then ask:

1. `How can I open a bank account without a Finnish personal ID?`
2. `I study my master's at Aalto. How do I get the HSL student discount?`
3. `Book a public sauna at Kulttuurisauna on Sunday at 17:30, 1 man`, then tap **Fill it for me** and give any test name and email. Vali fills the real form and stops at Approve.

---

## 4. Technologies

```
Exa (Agent runs, Search, Contents, Monitors), Modal, Playwright + Chromium, Anthropic Claude, Aiven Postgres, WhatsApp Cloud API, ElevenLabs, Jev (TypeSafe AI), FastAPI, Python, JavaScript, Chrome extension (MV3), Codex, Claude Code
```

## 5. Video (under 2:00)

Screen recordings are in the scratchpad (`rec/`): WhatsApp in phone format, the web on a laptop. Blur the name and email in the form shots. Speed up cloud browser waits and say "sped up".

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:12 | The newcomer: Bogdan, Aalto student from Romania, a few weeks in Espoo. No Finnish ID yet, a pile of forms. | "Bogdan is new in Finland. Every errand here is a form, and the rules change every year." |
| 0:12-0:35 | WhatsApp: `How can I open a bank account without a Finnish personal ID?` 👀, then the answer with the page picture, facts, links and Next for you. | "He asks Vali. In the background Exa searches the live web, reads today's official pages and checks every sentence against a quote." |
| 0:35-1:10 | WhatsApp: book Kulttuurisauna Sunday 17:30. Book it, name and email, the cloud browser filling the real form (sped up), the filled-form picture with Approve and Stop. | "Then Vali fills the real form in a private cloud browser on Modal. It stops and waits. Nothing is sent until he taps Approve." |
| 1:10-1:18 | Approve, "Booked", then the sauna's confirmation email (blurred). | "He approved. A real booking." |
| 1:18-1:40 | Web dashboard: the numbers sentence, the errand list, open the sauna errand: You asked, Vali found, Vali did, Now. | "Everything lands on the web dashboard: what he asked, what Exa found, what Vali filled." |
| 1:40-1:52 | The demo account as judges will find it: errands answered, one form waiting at Approve, a watch on HOAS flats. | "The demo account is ready for you. In the demo, Approve stops right before sending." |
| 1:52-2:00 | Landing page: "New in Finland? Vali handles it." Built on Exa and Modal. | "Vali. New in Finland? Vali handles it." |

## 6. Slides

Slide content: [SLIDES.md](SLIDES.md). The earlier deck: https://claude.ai/artifact/37ghc6G5jLHQTEqyKDPh6q (update it to match, share it, then export the PDF).

## 7. Checklist (on the platform)

- [ ] Make the repo public (github.com/bristiana/junction-exa): only its owner can.
- [ ] Upload the video as **Public**, paste the link.
- [ ] Export the slides as PDF and upload.
- [ ] Name, punchline and description from sections 1 to 3. Technologies from section 4.
- [ ] Demo account email and password in the form's notes, never in the repo.
- [ ] Links: live app, repo, extension zip as Other Link.
- [ ] Before recording, leave the demo account in the state the video shows: answered errands, one form at Approve, a HOAS watch.
- [ ] Check the 3 "Try it" queries on the live app with the demo account.
- [ ] Main challenge: Exa, The Internet Butler. Tech challenges: Modal, Aiven.
- [ ] Do not deploy in the last hour.
- [ ] Set the submission to **FINAL** before 10:00 EET (aim for 09:30).
- [ ] After the event: rotate every API key used during the hackathon, including the WhatsApp app secret.
