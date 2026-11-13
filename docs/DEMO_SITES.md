# Hoida: demo sites for the sandbox

Real sites for the two live sandbox demos (a booking and a claim/feedback form), checked 2026-11-14 (Sat, about 01:00-04:00 EET) in a fresh, logged-out headless Chromium (`agent-browser`). Nothing was booked, paid, submitted or confirmed. Where something had to be typed, only fake data was used (Test Person, test@example.com, +358401234567).

Before the demo, re-check availability: slots and party-size limits change by the hour.

## 1. Booking without login (Helsinki, Espoo, Vantaa)

Main scenario: "book a public sauna for 8 people this Saturday evening". Backup: a restaurant table (the court sites all need login, see below).

### Ranking

| # | Site | Start URL | Login | CAPTCHA | Steps to final button | Final button (stop before it) | Lang | Widget / iframe | Headless |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Löylykontti Sörnäinen** (container sauna; also Espoo Kivenlahti, Laaksolahti, Matinkylä) | https://www.loylykontti.fi/en/reserve (each slot has its own URL, e.g. `/en/reserve/166833`) | No (sign-in optional) | None seen | 2: pick slot, then one page (people, hours, details, payment method) | "Accept terms and pay 208.00 €" | EN/FI | Own system, no iframe | OK |
| 2 | **Magu** (vegan restaurant, Helsinki) | https://v2.tableonline.fi/instabook/bookings/bfJ1zd8?locale=en (from the "Book a table" button on https://maguhelsinki.fi) | No | None seen | 4: Welcome, Party size, Date & time, Details, then Voucher (optional) | Final confirm (label not reached) | EN/FI/SV/ET | TableOnline (book.tableonline.com) | OK |
| 3 | **TableOnline, Georgian Supra** (restaurant) | https://book.tableonline.com/mod_0VVMvXKwWARmoA?lang=en | No | None | 7: Welcome, Party size, Date & time, Promotions, Menus, Details, Voucher | Final confirm (label UNVERIFIED) | EN/FI/SV/ET | TableOnline | OK |
| 4 | **Allas Sea Pool** | https://shop.allaspool.fi/en/shop/tickets | No, but tick "As a guest" (default is login) | None seen to step 3 | 4: Tickets, Visit time, Customer details, Payment | "Continue to payment method" | EN/FI | Odoo webshop | OK |
| 5 | **Löyly** | https://varaus.asio.fi/onlinekalenteri/loyly/guest.php?ss_lang=eng | No | None | 4: people per side and date ("Proceed"), time list ("Book"), contact form, online payment | "Book" opens a popup; stop before it | EN/FI | Asio (iframe and a popup window) | OK, but needs popup handling |
| 6 | **Laguuni** (Espoo Keilaniemi, wood sauna) | https://shop.laguuniin.fi/en_US/winter/yleiset-sauna-amp-avantovuorot/public-wood-sauna-winter-swimming | Optional Google/Microsoft/email login; guest checkout UNVERIFIED | None seen | People, date, time, duration, "Add to basket", checkout (UNVERIFIED) | UNVERIFIED | EN/FI | Johku | Loads, hard to drive |
| 7 | Urheiluhallit (Helsinki city halls: badminton, padel) | https://kauppa.urheiluhallit.fi/webshop/reservations2/reservations/27/-/-/-?lang=1 | **Yes**, at step 3 | n/a | n/a | n/a | EN/FI/SV | Own webshop | OK |
| 8 | Varaamo (city spaces, e.g. Oodi group room 1) | https://varaamo.hel.fi/en/reservation-unit/289 | **Yes** ("Log in to book") | n/a | n/a | n/a | EN/FI/SV | City system | OK |
| 9 | Talihalli (badminton, squash, padel) | https://talihalli.cintoia.com/ | **Yes** (slot click redirects to `/login`) | n/a | n/a | n/a | FI | Cintoia | OK |
| 10 | Playtomic (Replay Padel Espoo) | https://playtomic.com/clubs/replay-padel | **Yes** ("Continue - €38.00" goes to app.playtomic.com/login) | n/a | n/a | n/a | EN | Playtomic | Loads (one 504); slot cells unlabelled |
| 11 | DinnerBooking (e.g. Allas Seagrill; Yes Yes Yes uses it too) | https://book.dinnerbooking.com/fi/en-US/book/table/pax/2860/2 | No | **Cloudflare Turnstile at step 1** | n/a | n/a | EN | DinnerBooking | **Blocked** |

**Pick: Löylykontti Sörnäinen** for the sauna demo (one-page flow, slot deep links, EN, no login or CAPTCHA, had 8 free places this Saturday evening). **Backup: Magu on TableOnline** (no login, no CAPTCHA, no payment step for 2 guests, real slots shown). Courts: no site works without an account; show availability only and stop at the login screen, or use a team demo account.

### Notes per site

**Löylykontti** (self-service seaside container sauna; the door code is emailed after payment)
- Fields: People (+/-), Sauna time (+/-), First name, Last name, Email, Phone, payment-method radio (online banking, Epassi/Edenred, MobilePay, Google Pay, card, Klarna, Walley; payment provider name UNVERIFIED).
- Seen for Sat 14.11, Sörnäinen: sauna 2 "Suvi" 20:30 had 8 places, €13 per person per hour; 8 people x 2 h showed **€208** for 20:30-22:30 (the form would not go above 8 people or 2 h). Other evening slots: Meri 20:00 (7 free), 21:00 (6), 22:00 (8); Suvi 21:30 (7), 22:30 (10). Whole sauna: Suvi 22:30 €79, Meri 23:00 €69, Suvi 23:30 €54.
- Kivenlahti (Espoo), Sat 14.11: €8-13 per person per hour, private €22-89 per hour.
- Safe stop: details and payment-method radio filled, stop before "Accept terms and pay ...". There is no separate review step, so the approval gate must sit on that button.

**Magu** (TableOnline instabook)
- Rules shown on the Welcome step: tables held 2 h; held 15 min if late; groups of 9+ need a credit-card guarantee (€25 per person if cancelled under 24 h); separate bills not available for groups over 10. A "Payment" step appears in the stepper for those groups; for 2 guests the steps were Welcome, Party size, Date & time, Details, Voucher (optional).
- Party size buttons 1-5 plus "More options".
- Seen for Sat 14.11, 2 guests: 16:00, 16:30, 17:00, 17:30, 18:00, 18:30, 19:00, 19:30, 20:00 all selectable. Sun 15.11 disabled (closed).
- Safe stop: the Details step (name, email, phone; fields as in the Georgian Supra flow), before the final confirm. Details step not opened here.

**TableOnline, Georgian Supra**
- Party size 1-5 adults (plus 0-4 children), so 8 cannot book here.
- Sat 14.11 for 2: 14:00-17:00 and 19:30-21:00.
- Details fields: First name, Last name, Email, Phone (+358), terms checkbox. No payment step seen; stopped at Details.

**Allas Sea Pool**
- Fields: ticket quantities by type, towel rental; date and 15-minute start times; guest checkout asks First name, Last name, Email.
- For 8 people, Sat 14.11 and Sat 21.11 only enabled 08:00 and 18:30-19:30 (why others are disabled is UNVERIFIED, probably full). Weekend ticket €24 (8 x €24 = €192); valid 2 h; advance tickets non-refundable.
- Safe stop: Customer details, before "Continue to payment method". (The test cart was emptied afterwards.)

**Löyly**
- Fields seen: men's-side and women's-side counts, date, optional souvenirs and breakfast. Contact form (step 3) not opened, fields UNVERIFIED.
- For 4 men + 4 women: Sat 14.11 "There are no bookable times"; Sat 21.11 and 28.11 evening slots "Not bookable" (men's side `free M=0`, women's side 13-23 free).
- "Book" runs `selectTime(1)`, which posts the form with `b_tee_varaus=1` into a new popup window; it may create a temporary hold, so it was not clicked. Playwright must handle the popup.

**Laguuni**
- Up to 9 people per session. €16 / 1 h, €26 / 2 h, €36 / 3 h per person. Sat 14.11 for 8: only 20:30-21:30 (€128); Sat 21.11 from 18:30, 8 x 2 h = €208.
- Problems: the sticky header covers the duration buttons (needed a JS click); "Add to basket" did nothing headless on two tries.

**Courts and city spaces (all need login)**
- Urheiluhallit: Pasila badminton Sat 14.11 10:00-17:00 all "Full", Sat 21.11 17:00 several courts free; €20 / h weekends, €14 weekdays; max 4 per court; paid bookings cannot be cancelled or moved.
- Talihalli: badminton €17 / 1 h, €28.50 / 1.5 h, €40 / 2 h.
- Playtomic Replay Padel: Sat 14.11 all courts unavailable; Sun 15.11 18:30: €38 / 1 h, €57 / 1.5 h, €76 / 2 h. PadelCenter Hernesaari is outdoors with no lights (unusable in November).
- Varaamo, Oodi group room 1: 2-8 people, free, 30 min-3 h; availability visible without login (Sat 14.11 18:00-19:30 free).

## 2. Claim, feedback and application forms without login

Main scenario: "my flight from Helsinki to Berlin landed 4 hours late": open the airline's EU261 form, fill it, stop before submit.

### Ranking

| # | Form | Start URL | Login | CAPTCHA | Steps to final button | Final button (stop before it) | Lang | Form tool / iframe | Headless |
|---|---|---|---|---|---|---|---|---|---|
| 1 (flight) | **Finnair compensation wizard** | https://www.finnair.com/fi-en/customer-care-and-contact-information/contact-and-request-forms/feedback-and-compensation, then "Apply for a compensation..." and "I am applying for myself..." lead to https://www.finnair.com/fi-en/customer-care-and-contact-information/contact-and-request-forms/compensation-wizard?formType=individual | No (login optional) | None found | Landing, Category (Flight disruptions / Baggage issues), Booking details (**live booking lookup**), later steps not reachable without a real booking, Summary | "Submit" (inferred from the feedback path) | EN | Finnair's own SPA, no iframe | OK |
| 2 (non-airline) | **City of Helsinki "Report a problem"** (anonymous) | https://palautteet.hel.fi/en, then the anonymous option leads to https://palautteet.hel.fi/vikailmoitus-lomake | No (bank ID optional) | None | 3: subject, location (map or address), description and contact | "Send" | EN | Liferay + Orbeon Forms (XForms), Leaflet map | OK |
| 3 | **TA defect report** (landlord) | https://www.ta.fi/en/defect-report-form/ (iframe, also works alone: https://asunnonhakijalle.production.kenno.pandia.fi/defect-notice/create?slug=t2&lang=en) | No | None | Form, then "Preview" | "Submit your fault report" (on the Preview page) | EN | Kenno (Pandia) in an iframe | OK |
| 4 | **Heka** (City of Helsinki housing) public fault form | https://portaali.tampuuri.fi/helsinginkaupunginasunnotoy/vikailmoitus | No | None found | 1 page | "Send" | EN UI, topics in FI | Tampuuri portal | OK (loaded only) |
| 5 | **Espoon Asunnot** service request | https://portaali.tampuuri.fi/espoonasunnot/huoltopyynto | No | None found | 1 page | "Lähetä" / "Send" | EN via language switch | Tampuuri portal | OK |
| 6 | Finnair feedback (no booking needed) | Same landing, then `compensation-wizard?formType=fya` | No | None | 6 steps, Summary reached | "Submit" | EN | Finnair SPA | OK |
| 7 | Aalto "Feedback on aalto.fi" | https://www.aalto.fi/en/services/feedback-on-aaltofi | No | Invisible Antibot (JS) | 1 page | "Send" | EN | Drupal 11 Webform + Antibot | OK (needs real key or mouse events) |
| 8 | University of Helsinki service request | https://uni-help.helsinki.fi/en/service-request | No (answer "No" to university credentials) | **hCaptcha** above Send | 1 page | "Send request" | EN | Drupal 11 Webform + hCaptcha | Loads; hCaptcha blocks submit |
| 9 | airBaltic delayed flight | https://www.airbaltic.com/en/submit-a-claim?category=flight&type=DELAYED | No | None | Step 1 booking reference + surname, "Confirm" (**live lookup, fake data fails**) | n/a | EN | Own site, Cookiebot | OK |

**Pick for the flight demo: Finnair wizard.** It is the only airline claim form that loaded headless with no login and no CAPTCHA. Catch: step 3 checks the booking reference against Finnair's live system; a fake reference returns "couldn't find any booking". A full run needs a real Finnair booking reference and family name (a team member's past booking), or the demo stops at step 3 and shows the hand-off. **Non-airline fallback: Helsinki "Report a problem"** (3 steps, map, attachments, EN, no CAPTCHA, clear "Send"). **Cleanest stop point: TA** (a built-in Preview page before submit).

**Blocked or login-only (do not use live):**
- Bot walls in headless Chromium: HSL feedback https://www.hsl.fi/en/feedback (Cloudflare "Performing security verification"; WebFetch gets 403), Norwegian claims (Cloudflare), Wizz Air ("confirm you are human"), SAS (bot block page), Lufthansa ("Security check"), KLM and Air France (`net::ERR_HTTP2_PROTOCOL_ERROR`).
- Login: Ryanair EU261 form (redirects to myRyanair), HOAS (MyHoas only; "You cannot submit a fault report by phone or email", https://www.hoas.fi/en/tenants/faults/fault-report/), Lumo (my.lumo.fi), SATO (OmaSATO), M2-Kodit (OmaM2), Heka OmaHeka.
- Espoo eFeedback (https://easiointi.espoo.fi/eFeedback/en): down for maintenance until 14.11.2026 16:00, not inspected.
- Not checked: Avara, Kortteliasunnot.

### Fields per form (* = required)

**Finnair claim wizard**
- Landing: "Apply for a compensation for flight disruptions or baggage issues", then "I am applying for myself or my travel companion" (other options: on behalf of another person, authorised representative of a company).
- Category: Flight disruptions (delayed or cancelled flight, overbooking, downgrading) or Baggage issues (delayed or damaged baggage). The page notes: submit EU261 claims "within two months after the disrupted flight date"; delayed-baggage claims within 21 days of receiving the bag and need a WorldTracer reference.
- Booking details: Booking reference* (6 characters, no 1 or 0), First name*, Family name*, Email*, Phone*, Country of residence* (default Finland), "Add companion" (same booking only).
- After the lookup (flight choice, delay details, bank details): UNVERIFIED.
- Safe stop: the Summary page, before "Submit".

**Finnair feedback path** (stand-in when there is no booking; it is feedback, not an EU261 claim): Category, sub-category, Booking info (reference, date, flight number, from/to, all optional), contact details*, topic checkboxes, rating, optional comment, Summary, "Submit".

**Helsinki "Report a problem"**
- Step 1: subject radio, then sub-topic. Step 2: location* (address autocomplete or map click). Step 3: description* (10-10,000 characters), up to 3 attachments (50 MB total), reply preference, email* if a reply is wanted, name, phone, publication-permission radio.
- "Next" enables asynchronously; wait after each choice. Stop before "Send".

**TA defect report**: property* (autocomplete of TA buildings), fault-type buttons, Description* and details, attachments (jpg/png/gif/pdf, 10 MB), "master key may be used" and "pets" switches, First name*, Surname*, Telephone*, Email (optional). Reached Preview with fake data; not submitted.

**Heka and Espoon Asunnot (Tampuuri)**: property or street search*, first name*, surname*, phone*, email*, topic and sub-topic, description*, attachments, pets*, entry method* (master key / call to agree / no visit). A submit creates a real maintenance ticket, so stop before "Send".

**University of Helsinki**: "I am..." select, first and last name*, email*, message*, attachment, privacy consent*, hCaptcha. Natural hand-off: the agent fills it, the human solves the CAPTCHA and sends.

**Aalto**: type radio, email*, Title*, Feedback*, URL, screenshot upload, privacy consent*, "Send".

**airBaltic**: booking reference + surname, live lookup; fake data gets "cannot find booking". Dead end without a real booking.

## Prompt injection and bot walls

- No page asked for the user's details or tried to instruct the agent.
- Bot walls (Cloudflare, Turnstile, hCaptcha) were not bypassed. The sandbox should treat them like a login: stop and hand the user the exact page.
