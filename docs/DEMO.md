# Vali: demo

The story: Bogdan is a master's student from Romania at Aalto, a few weeks into life in Espoo. He is still fighting the newcomer errands (bank, EU registration, a cheaper flat, the HSL student price) and this weekend he is also at Junction (what to submit, what to bring, a sauna after). He messages Vali on WhatsApp and Vali handles both.

Judging (20% each): use of Exa, usefulness, clarity of sources, originality, works on live queries. Tech challenges: Modal, Aiven, ElevenLabs, Codex.

## Scenarios

Every scenario runs on production with the demo account. Times are measured on production.

| # | Bogdan sends (WhatsApp unless noted) | What Vali does | Ends at | Time |
|---|---|---|---|---|
| 1 | `I study my master's at Aalto. How do I get the HSL student discount on my travel card?` | Exa Agent research on HSL and Aalto pages | Steps for the student status in the HSL app, documents, links | about 35 s |
| 2 | `How can I open a bank account without a Finnish personal ID?` | Exa Agent research, every sentence checked on the page | Basic account first, documents to bring, Danske, Nordea, DVV links | about 35 s |
| 2b | `I'm going to the Junction hackathon this weekend. What should I bring and can I sleep there?` | Exa reads the Junction pages | Hype Areena is open 24/7 but has no sleeping areas; book a hotel. Link | about 30 s |
| 2c | `Rent a basketball court in Espoo for 4 friends on Saturday afternoon` | Exa search | Kameleonten in Leppävaara, two courts, Saturday 9-20, request link | about 25 s |
| 2d | `Where can we eat near Hype Areena on Saturday night, something cheap for 5?` | Exa search | Putte's Bar and Pizza, Himalayan Tandoor, prices, links | about 20 s |
| 2e | `Two cinema tickets in Helsinki city centre for Saturday 21 November evening, a film in English` | Exa Agent research | Kino Regina in Oodi, 18:00, €10, booking link | about 40 s |
| 3 | `I am a Romanian student moving to Espoo. What do I have to register as an EU citizen, and where?` | Exa Agent research on Migri and DVV | Register the EU right of residence at Migri, then the address at DVV, with links | about 40 s |
| 3b | `Pharmacy open on Sunday near Otaniemi` | Exa search | Otaniemi pharmacy closed Sunday, Aino Apteekki in Tapiola 12-18 | about 15 s |
| 4 | `Can you book the Kulttuurisauna public sauna for me on Sunday 22 Nov at 17:30? 1 man` then tap **Book it** | Cloud browser on Modal fills the real Kulttuurisauna form, asks once for name and email | Picture of the filled form with Approve and Stop | about 60 s |
| 5 | Tap **Stop**, then **Continue** | A fresh Modal run replays the steps and uses what you already said, without asking again | Back at Approve, nothing was sent | about 45 s |
| 6 | `Watch for new HOAS student apartments in Espoo under 700 euros a month` | Exa Monitor, daily | Watch on the dashboard, first matches with links | about 25 s |
| 7 | Web dashboard (demo link) | Everything from WhatsApp is already there | Errands, Exa searches, pages read, facts confirmed, cost; click an errand to see the chat, what Vali opened and where it stands | live |
| 8 | Chrome, on the Junction submission form: ask the Vali in the corner `What is the limit for the punchline?` | Exa reads the page and the rules | The answer next to the field | about 10 s |

Real booking, done on 15 Nov at 01:54: Kulttuurisauna, Sunday 22 Nov 2026 at 17:30, men's shift, pay on site (15 Nov was full; Vali noticed and offered the 22nd). Booked from WhatsApp after a Stop and a Continue, and confirmed by the sauna's email. In every other run, tap Stop.

Every answer fits the demo account's situation (EU, Romania, Aalto master's student, Espoo, no Finnish ID, no bank) and ends with **Next for you**.

## 2-minute video

Recordings (scratchpad `rec/`): `s2-bank.mp4` (WhatsApp bank answer), `s4-sauna3.mp4` (the real booking with Stop, Continue and Approve), `s7-thread.mp4` (dashboard thread and errand story), `s-dashboard.mp4` (dashboard overview). Blur the name and email in the booking shots.

| Time | Shot | Say |
|---|---|---|
| 0:00-0:12 | Bogdan's situation | "Bogdan studies at Aalto. No Finnish ID yet, no Finnish bank, and this weekend he is at Junction." |
| 0:12-0:32 | WhatsApp: the bank question, 👀, the answer with the Danske Bank picture and Next for you | "Vali reads the live web with Exa, answers for his situation in one sentence, and links the exact pages." |
| 0:32-1:05 | WhatsApp: the sauna, Book it, name and email, the filled form, Stop, Continue, Approve, Booked | "A private cloud browser on Modal fills the real form. Stop, Continue, and it picks up where it left off. Nothing is sent until he taps Approve." |
| 1:05-1:12 | The sauna's confirmation email | "A real booking." |
| 1:12-1:32 | Dashboard: numbers, click the sauna errand, the thread to Booked | "Everything from WhatsApp lands on the dashboard, live." |
| 1:32-1:50 | The errand story: You asked, Vali found, Vali did, Now | "Each errand tells what he asked, what Vali found, what it did, and what is next." |
| 1:50-2:00 | Landing: "Your valet for life in Finland." | "Vali. Your valet for life in Finland." |

## Before recording or judging (T-15 min)

1. Open the demo link once (`#demo=<token>`) and tap **Open the demo account**; it warms the Modal API.
2. Run scenario 1 on WhatsApp; it must answer within 30 s.
3. WhatsApp Web in phone format, light theme, only the Vali chat visible (hide the chat list). Clear the composer before typing. Do not repeat a question asked in the last 30 minutes: Vali reuses that answer.
4. Fake data only for every run except the one real sauna booking. Never approve anywhere else.
5. Backup: the recording, and the finished errands already on the demo account.

## When judges try it

- They get the demo link: it opens the sign-in page, **Open the demo account** logs in, and everything above is already there. They can also create their own account with email and password.
- "Find" questions answer in seconds; research questions take 10-60 s (median 25 s in the live eval).
- Sites behind bank ID, Suomi.fi, a CAPTCHA or a bot wall (Finnkino) stop with a one-line reason and "Open the site" to finish by hand. That is by design. Continue reached the approval step on 4 of 5 booking sites (docs/EVAL_CONTINUE.md).
- WhatsApp: the Meta test number only reaches verified numbers, so judges use the web or the demo link.
