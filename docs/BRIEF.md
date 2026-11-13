# Hoida: brief

**One line:** hand off an errand. Hoida digs through the live web with Exa, works out what has to happen, prepares it, and when you approve, does it for you in a cloud browser.

**Name:** *hoida* is Finnish for "take care of it" (from *hoitaa*, to handle; *hoida se* = "you handle it"). It is short, says what the product does, and is local to the people it serves first.

**Challenge:** Exa, The Internet Butler (main). Tech challenges: Modal, Codex, Aiven, Cloudinary, ElevenLabs.

---

## 1. Who it is for

Newcomers and international students in Finland. Their errands are the tedious kind the Exa brief describes, made harder by language and unfamiliar systems:

- the rules are on Finnish sites (Kela, DVV, Migri, Vero, city sites, landlords, HSL), often in Finnish first;
- the answer is spread over several pages and changes (amounts, deadlines, opening hours, prices);
- the last step is a long form, an email in the right tone, or a booking widget.

A model alone cannot do this: it does not know this year's Kela amounts, today's sauna slots or the airline's claim form. Exa can find it, and Hoida turns it into the next step.

## 2. What Hoida does

Every errand goes through the same loop: **find → work out → prepare → (approve) → do → keep watching**. Hoida picks the mode from the errand.

| Mode | Example errands | Exa | What the user gets |
|---|---|---|---|
| **Find and compare** | "Quiet café near Otaniemi open now", "laptop in Finland under €1000 with 16 GB and Linux", "vegan restaurant for our anniversary on Saturday" | Search (`auto`), Connect (Affiliate.com prices, Jinko hotels/flights) | 3-5 ranked options with price, distance, opening hours, each with its source; links to book; calendar entry |
| **Check and explain** | "Is this rent increase legal?" (selected lease clause), "TL;DR this Finnish letter", "what does this Kela decision mean" | Contents (the page or link the user is on), Agent | Verdict first, the rule behind it with the source, what to do next, a draft reply |
| **Claim and apply** | Flight delay compensation (EU261), HSL refund, Kela student benefits, change of address | Agent (rules, amounts, the right form), Contents | Amount and eligibility with sources, a pre-filled form (in the user's tab or in the sandbox), an email draft |
| **Book** | Public sauna for 8 this Saturday, padel court, doctor's appointment slot | Search + Agent (who has slots, booking page) | The sandbox opens the booking page, picks the slot, fills the details and stops before "confirm" |
| **Watch** | "Tell me when a 2-room flat in Espoo under €900 shows up", "when Kela's student allowance changes" | Monitors (scheduled search, webhook) | A message on WhatsApp / a notification when something new appears, with the source |
| **Write** | Email to the landlord, complaint to an airline, message to a university office | Agent (who to write to, what rule to cite) | Ready draft with the right address and cited rule; opens in Gmail or the mail app |

Hoida **never sends, pays, books or submits on its own**. Drafts are drafts, forms stop before submit, bookings stop before confirm. One tap approves.

## 3. Channels and shared context

**Chrome extension** (side panel)
- Click the icon or press Alt+H, type the errand, or right-click any text or page: "Hoida: take care of this".
- It sends the page context (URL, title, selected text, redacted page text, form fields) with the errand.
- It can fill the form on the page you are on, in your own browser, with your own login.
- On pages with a form (claims, applications, bookings), Hoida peeks in from the edge and offers to help.

**WhatsApp**
- Text or voice note ("my flight from Helsinki to Berlin landed 4 hours late"). Voice notes are transcribed with ElevenLabs.
- Replies with the short answer, the key facts and numbered source links, and the prepared actions as numbered choices ("1 = file the claim, 2 = email draft").
- Approvals on the phone: screenshot of the filled form, reply "yes" to submit or "stop".

**One task list.** The extension shows a 6-digit pairing code; the user sends `link 123456` to Hoida on WhatsApp. From then on an errand started on the phone shows up in the browser and the other way round: start from the lease page on the laptop, approve from the phone on the bus.

## 4. How it works

```
extension ─┐                               ┌─ Exa: /search, /contents, /agent/runs, /monitors, Connect
           ├─ Hoida API (FastAPI on Modal) ─┤
WhatsApp ──┘   Postgres on Aiven            └─ sandbox: Modal container per run, Playwright Chromium + Claude
               screenshots on Cloudinary       voice notes: ElevenLabs speech-to-text
```

1. **Route.** A quick classification picks the mode and the effort (fast search for "find" errands, Exa Agent for research, sandbox for "do", Monitors for "watch").
2. **Research with Exa.** Fast path: `/search` with highlights (about 1 s) for simple finds. Deep path: `/agent/runs` with a structured output schema (answer, key facts, steps, actions, missing info, form values) and field-level citations. `/contents` reads the page or link the errand is about.
3. **Prepare.** Actions are built from the structured output: email drafts (Gmail / mail app), calendar entries, links, phone scripts, form values.
4. **Do it (sandbox).** For claims, applications and bookings the API starts a Modal function with headless Chromium. Claude drives it with a small tool set (open, read, click, type, select, scroll, look, request approval, finish). Each step posts a screenshot. Personal data never reaches the model: it types `{{name}}`, the sandbox substitutes the real value, and page snapshots are masked back before the model sees them.
5. **Approve.** Clicking anything that looks like a final submit is blocked until the user approves. Logins (bank ID), CAPTCHAs and payment pages stop the run and hand the user the exact page to finish by hand.
6. **Watch.** Exa Monitors run the search on a schedule and call our webhook only when something is new; Hoida forwards it to WhatsApp and the extension.

## 5. Trust and privacy

- Every fact shows where it came from: numbered sources on each answer, fact and step, with Exa's confidence; low-confidence facts are marked.
- Personal details (name, email, phone, address, date of birth) stay in the extension. Exa and Claude only see placeholders. Syncing them to the server for WhatsApp-started errands is opt-in.
- Page text is redacted in the browser before it leaves: emails, phone numbers (+358 and international), Finnish personal identity codes (HETU), IBANs, card numbers and address lines.
- The sandbox runs one errand per container and is torn down after it.

## 6. How this scores (Exa's criteria, 20% each)

| Criterion | How Hoida answers it |
|---|---|
| Use of Exa | Four Exa surfaces in one product (Search, Contents, Agent, Monitors) plus Connect partners; every answer depends on live pages (this year's amounts, today's slots, the current form). |
| Usefulness to real people | A named group (newcomers and students in Finland) with errands they actually have; demo on real Finnish sites. |
| Clarity of sources | Field-level citations on every fact and step, confidence, links in WhatsApp messages too. |
| Originality | Hands-off in the full sense: research → prepared action → a cloud browser that does it, with an approval gate; one errand across browser and phone. |
| Works on live queries | Fast path for simple finds (seconds), progress shown while the agent works, graceful fallbacks (links and drafts) when a site blocks automation. |

Workshop note from Exa: they judge **actionability** first ("does it send the email? fill in the form?"). Every mode ends in a prepared action.

## 7. Tech challenges (only where the use is real)

| Partner | Real use in Hoida |
|---|---|
| Modal | The sandbox (one container per run with Chromium) and the API itself. The heavy lifting. |
| Codex | Built with Codex workers alongside Claude Code; the README documents how. |
| Aiven | Postgres for users, the shared task list, WhatsApp links and watches. |
| Cloudinary | Sandbox screenshots, delivered to the extension and WhatsApp. Also fill their survey. |
| ElevenLabs | Speech-to-text for WhatsApp voice notes. |

Left out on purpose: Context.dev and Oxylabs (they compete with Exa, our main challenge).

## 8. Demo plan

1. **Find (live, judges' choice):** "Find a public sauna in Helsinki for 8 people this Saturday evening that I can book online." Options with prices and slots, sources, calendar entry.
2. **Check:** select a clause on a Finnish lease page, "Is this legal?" Verdict with the law section cited, draft reply to the landlord.
3. **Claim, cross-channel:** WhatsApp voice note about a 4-hour delay. Hoida answers the amount with the EU rule cited and asks for the booking reference. "1" starts the sandbox: it opens the airline's claim form and fills it; the screenshot arrives on WhatsApp; the run stops before submit (we do not file a fake claim live).
4. **Watch:** "Tell me when a 2-room flat in Espoo under €900 is listed." Monitor created, shown in the list.

The 2-minute video follows the same order.

## 9. Scope

| Priority | What |
|---|---|
| P0 | Backend on Modal with Exa research (fast + agent), shared task list, extension on the backend, sources everywhere, actions (email, calendar, link, form fill in the user's tab). |
| P0 | Sandbox "do it" with approval gate and screenshots, for one claim form and one booking site. |
| P1 | WhatsApp: text in, answers out, pairing, approvals by reply. |
| P1 | Watch with Exa Monitors. |
| P2 | Voice notes (ElevenLabs), presence on form pages, Exa Connect partners, Cloudinary (fallback: API serves screenshots). |

## 10. Timeline (deadline Sun 15 Nov 10:00, submit by 09:30)

| When | What |
|---|---|
| Sat 01-04 | Base structure, API contract, store, research path end to end locally |
| Sat 04-12 | Sandbox agent, Modal deploy, extension on the backend |
| Sat 12-18 | WhatsApp, pairing, approvals on the phone, Monitors |
| Sat 18-24 | Demo scenarios on real sites, fixes, voice notes, presence |
| Sun 00-06 | Hardening, README, Codex write-up, video recording |
| Sun 06-09:30 | Final checks, submission form, set to FINAL |

## 11. New ideas (proposed, in order of value for judging)

| Idea | Why it matters | Cost |
|---|---|---|
| **Photo of a Finnish letter on WhatsApp** (Kela, Vero, DVV, landlord): Hoida reads it, explains it in plain English with the official source, puts the deadline in the calendar and drafts the reply | The most common newcomer pain; strong "real people" story; works on live input the judges bring | Claude vision for reading + Exa Agent; P1 |
| **Live view of the cloud browser** in the side panel and as screenshots on WhatsApp | Makes "it does it for you" visible; the demo moment | CDP screencast in the sandbox; in the sandbox brief |
| **Errand receipt**: after an errand, one page with what was found, what was sent or filled, when, every source and the screenshots; shareable link | Scores on clarity of sources and trust; proof for the user if the claim is disputed | Rendered from the Task JSON; P1 |
| **Deadline keeper**: every deadline Hoida finds goes on a timeline; Exa Monitors watch the rule behind it (e.g. Kela amounts, rent rules) and nudge when it changes | Turns one-off answers into ongoing help; uses Monitors meaningfully | P2 |
| **Exa Connect partners**: Jinko (live flight and hotel prices) for travel disruption, Affiliate.com (product prices) for "find" errands | More Exa surface used, answers no model could know | One field in the agent run; P2 |

## 12. Risks

- **Sites that block automation** (bank ID, CAPTCHAs): the run stops and hands over the exact page; the demo uses sites that work.
- **Claude credit ($20):** the agent runs at low effort with prompt caching and a 30-step cap; the model is one env var.
- **Exa Agent latency (10-60 s):** fast path for simple finds, live progress for the rest.
- **WhatsApp setup** (Meta test number, up to 5 recipients in development): set up early; the extension works without it.
