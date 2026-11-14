# Vali: demo

The story: Ana, a non-EU student, lands in Helsinki on Friday for Junction. She has no Finnish ID, no HSL app and no idea where anything is. She messages Vali on WhatsApp and Vali handles the rest.

Judging (20% each): use of Exa, usefulness, clarity of sources, originality, works on live queries. Tech challenges: Modal, Aiven, ElevenLabs, Codex.

## Scenarios

Every scenario runs on production with the demo account. Times are measured on production.

| # | Ana sends (WhatsApp unless noted) | What Vali does | Ends at | Time |
|---|---|---|---|---|
| 1 | `I land at Helsinki Airport on Friday for the Junction hackathon at Dipoli in Otaniemi. How do I get there and which HSL ticket do I buy?` | Exa search, reads HSL pages | Train and metro or light rail 15, ABC ticket, HSL link | about 20 s |
| 2 | `How can I open a bank account without a Finnish personal ID?` | Exa Agent research, every sentence checked on the page | Basic account first, documents to bring, Danske, Nordea, DVV links | about 35 s |
| 3 | `Pharmacy open on Sunday near Otaniemi` | Exa search | Otaniemi pharmacy closed Sunday, Aino Apteekki in Tapiola 12-18 | about 15 s |
| 4 | `Book me a public sauna for Sunday at 17:30 after the hackathon` then tap **Book it** | Cloud browser on Modal fills the real Kulttuurisauna form, asks once for name and email | Picture of the filled form with Approve and Stop | about 60 s |
| 5 | Tap **Stop**, then **Continue** | A fresh Modal container replays the steps and picks up where it stopped | Back at Approve, nothing was sent | about 45 s |
| 6 | `Watch for new HOAS student apartments in Espoo under 700 euros a month` | Exa Monitor, daily | Watch on the dashboard, first matches with links | about 25 s |
| 7 | Web dashboard (demo link) | Everything from WhatsApp is already there | Errands, Exa searches, pages read, facts confirmed, cost; click an errand to see the chat, what Vali opened and where it stands | live |
| 8 | Chrome, on the Junction submission form: ask the Vali in the corner `What is the limit for the punchline?` | Exa reads the page and the rules | The answer next to the field | about 10 s |

Real booking (scenario 4, only in the recording): Sunday 15 Nov 17:30 at Kulttuurisauna, pay €17 on site. Bogdan taps Approve himself, then shows the confirmation email. In every other run, tap Stop.

## 2-minute video

| Time | Shot | Say |
|---|---|---|
| 0:00-0:10 | WhatsApp, phone format: Ana's first message (1) | "Ana just landed for Junction. No Finnish ID, no HSL app." |
| 0:10-0:25 | Vali reacts 👀, answers in one sentence with the HSL link | "Vali reads the live web with Exa and answers with the exact source." |
| 0:25-0:40 | Bank question (2): answer with Danske, Nordea, DVV | "Every sentence is checked against a quote on the page." |
| 0:40-1:05 | Sauna (4): Book it, the question, the filled-form picture, Approve | "A cloud browser on Modal fills the real form. Nothing is sent until she taps Approve." |
| 1:05-1:15 | Confirmation email from Kulttuurisauna | "A real booking." |
| 1:15-1:25 | Stop, then Continue (5) | "Stopped? Continue picks up where it left off." |
| 1:25-1:45 | Dashboard via the demo link: the sentence of numbers, click the sauna errand, the story and the state | "Everything from WhatsApp lands here: what she asked, what Vali found, what it did, where it stands." |
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
