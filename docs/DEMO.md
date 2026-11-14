# Vali: demo

The story: Bogdan is a master's student from Romania at Aalto, a few weeks into life in Espoo. He is still fighting the newcomer errands (bank, EU registration, a cheaper flat, the HSL student price) and this weekend he is also at Junction (what to submit, what to bring, a sauna after). He messages Vali on WhatsApp and Vali handles both.

Judging (20% each): use of Exa, usefulness, clarity of sources, originality, works on live queries. Tech challenges: Modal, Aiven, ElevenLabs, Codex.

## Scenarios

Every scenario runs on production with the demo account. Times are measured on production.

| # | Bogdan sends (WhatsApp unless noted) | What Vali does | Ends at | Time |
|---|---|---|---|---|
| 1 | `I study my master's at Aalto. How do I get the HSL student discount on my travel card?` | Exa Agent research on HSL and Aalto pages | Steps for the student status in the HSL app, documents, links | about 35 s |
| 2 | `How can I open a bank account without a Finnish personal ID?` | Exa Agent research, every sentence checked on the page | Basic account first, documents to bring, Danske, Nordea, DVV links | about 35 s |
| 2b | `I'm going to the Junction hackathon at Dipoli this weekend. What should I bring and can I sleep there?` | Exa reads the Junction pages | What to bring, sleeping rules, link | about 30 s |
| 3 | `I am a Romanian student moving to Espoo. What do I have to register as an EU citizen, and where?` | Exa Agent research on Migri and DVV | Register the EU right of residence at Migri, then the address at DVV, with links | about 40 s |
| 3b | `Pharmacy open on Sunday near Otaniemi` | Exa search | Otaniemi pharmacy closed Sunday, Aino Apteekki in Tapiola 12-18 | about 15 s |
| 4 | `Book me a public sauna for Sunday at 17:30 after the hackathon` then tap **Book it** | Cloud browser on Modal fills the real Kulttuurisauna form, asks once for name and email | Picture of the filled form with Approve and Stop | about 60 s |
| 5 | Tap **Stop**, then **Continue** | A fresh Modal container replays the steps and picks up where it stopped | Back at Approve, nothing was sent | about 45 s |
| 6 | `Watch for new HOAS student apartments in Espoo under 700 euros a month` | Exa Monitor, daily | Watch on the dashboard, first matches with links | about 25 s |
| 7 | Web dashboard (demo link) | Everything from WhatsApp is already there | Errands, Exa searches, pages read, facts confirmed, cost; click an errand to see the chat, what Vali opened and where it stands | live |
| 8 | Chrome, on the Junction submission form: ask the Vali in the corner `What is the limit for the punchline?` | Exa reads the page and the rules | The answer next to the field | about 10 s |

Real booking (scenario 4, only in the recording): Sunday 15 Nov 17:30 at Kulttuurisauna, pay €17 on site. Claude taps Approve on this one booking (allowed by Bogdan), then shows the confirmation email. In every other run, tap Stop.

## 2-minute video

| Time | Shot | Say |
|---|---|---|
| 0:00-0:10 | WhatsApp, phone format: Bogdan's first message (1) | "Bogdan studies at Aalto. Still no Finnish ID, still paying full price on HSL, and this weekend: Junction." |
| 0:10-0:25 | Vali reacts 👀, answers in one sentence with the HSL link | "Vali reads the live web with Exa and answers with the exact source." |
| 0:25-0:40 | Bank question (2): answer with Danske, Nordea, DVV | "Every sentence is checked against a quote on the page." |
| 0:40-1:05 | Sauna (4): Book it, the question, the filled-form picture, Approve | "A cloud browser on Modal fills the real form. Nothing is sent until he taps Approve." |
| 1:05-1:15 | Confirmation email from Kulttuurisauna | "A real booking." |
| 1:15-1:25 | Stop, then Continue (5) | "Stopped? Continue picks up where it left off." |
| 1:25-1:45 | Dashboard via the demo link: the sentence of numbers, click the sauna errand, the story and the state | "Everything from WhatsApp lands here: what he asked, what Vali found, what it did, where it stands." |
| 1:45-1:55 | Chrome corner Vali on the Junction form (8) | "And Vali sits in the corner of every page." |
| 1:55-2:00 | Logo, "Vali, your valet in Finland" | |

## Before recording or judging (T-15 min)

1. Open the demo link once (`#demo=<token>`); it warms the Modal API.
2. Run scenario 1 on WhatsApp; it must answer within 30 s.
3. WhatsApp Web in phone format, only the Vali chat visible (hide the chat list). Clear the composer before typing.
4. Fake data only for every run except the one real sauna booking. Never approve anywhere else.
5. Backup: the recording, and the finished errands already on the demo account.

## When judges try it

- They get the demo link: it logs into the demo account, everything above is already there.
- "Find" questions answer in seconds; research questions take 10-60 s.
- Sites behind bank ID, Suomi.fi or a CAPTCHA stop with a one-line reason and "Open the site" to finish by hand. That is by design.
- WhatsApp: the Meta test number only reaches verified numbers, so judges use the web or the demo link.
