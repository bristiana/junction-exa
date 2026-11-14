# Vali: errand test set

20 errands newcomers and international students in Finland actually have, spread over Vali's modes. For each: what the user types or says, the facts a correct answer must contain (with the source where each was verified), and the prepared next step.

- Every fact was checked on **2026-11-14** on the cited page unless marked otherwise. Prices, slots and listings are what was on the page that day; they change.
- **UNVERIFIED** = could not be confirmed on an authoritative page; a correct answer should not state it as fact.
- Status: **Verified** = all key facts sourced; **Partial** = at least one key fact UNVERIFIED.

| # | Mode | Errand | Status |
|---|---|---|---|
| 1 | find | Public sauna for 8 this Saturday evening | Verified |
| 2 | find | Linux laptop under €1000 with 16 GB | Partial |
| 3 | find | Vegan restaurant for a date on Saturday | Verified |
| 4 | find | Quiet café near Otaniemi open now (Saturday) | Verified |
| 5 | check | Is this rent increase legal? | Verified |
| 6 | check | When must I get my deposit back? | Verified |
| 7 | check | Do I get the HSL student discount? | Verified |
| 8 | check | When do I apply to extend my student residence permit? | Verified |
| 9 | check | Do I need a tax card for my student job? | Verified |
| 10 | claim | EU261: Helsinki-Berlin landed 4 h late | Verified |
| 11 | claim | Kela student aid and housing supplement 2026 | Verified |
| 12 | claim | I moved: who do I notify, by when? | Verified |
| 13 | claim | Just arrived: personal identity code and EU registration | Verified |
| 14 | claim | HSL refund (unused season ticket / delay costs) | Partial |
| 15 | book | Book the sauna for 8 | Verified |
| 16 | book | Badminton or padel court on Saturday | Verified |
| 17 | watch | 2-room flat in Espoo under €900 | Verified |
| 18 | watch | Tell me when Kela student aid or Migri processing times change | Verified |
| 19 | write | Email the landlord: something broke in the flat | Verified |
| 20 | write | Complaint to Finnair about a delayed bag | Verified |

**18 of 20 fully verified.** Two things that changed recently and that a model without live search gets wrong: students in Finland have been on the student **housing supplement**, not general housing allowance, since 1 Aug 2025 (#11), and the Residential Leases Act was amended by **Act 531/2026, in force 1 Oct 2026**, so the rent-increase rule is now §27 and older leases keep some old rules (#5, #6). Live outage today: **MyTax (Vero) is down until Sun 15 Nov 18:00** (#9).

---

## Find

### 1. Public sauna for 8 this Saturday evening (Helsinki)
**User:** "Find a public sauna in Helsinki for 8 people this Saturday evening that I can book online."

| Fact | Value (seen 2026-11-14) | Source |
|---|---|---|
| Löylykontti Sörnäinen | Online booking, no login. Sat 14.11 sauna "Suvi" 20:30 had 8 free places; €13 per person per hour; 8 people x 2 h = **€208**. Other evening slots: Meri 20:00 (7 free), 21:00 (6), 22:00 (8); Suvi 21:30 (7), 22:30 (10). Whole sauna (private) €54-79 per hour on late slots | https://www.loylykontti.fi/en/reserve |
| Löyly | €29 per 2 h (towel included), +€12 per extra hour. Sat hours 9-11 and 13-23. For 4 men + 4 women: no bookable times Sat 14.11; Sat 21.11 and 28.11 evenings "Not bookable" (men's side full). Private sauna up to 10 people €600 per 2 h Fri-Sun, €500 Mon-Thu | https://www.loylyhelsinki.fi/en/public-sauna, https://www.loylyhelsinki.fi/en/private-sauna, booking https://varaus.asio.fi/onlinekalenteri/loyly/guest.php?ss_lang=eng |
| Allas Sea Pool | Weekend ticket €24 (8 x €24 = €192), valid 2 h, advance tickets non-refundable. Sat 08-21 (sauna time ends 20:40). For 8 on Sat 14.11 only 08:00 and 18:30-19:30 start times enabled. Private sauna from €800 (10 people), not on weekends | https://www.allaspool.fi/en/pools-and-saunas, https://shop.allaspool.fi/en/shop/tickets |
| Kotiharjun sauna | €16, no booking for the public sauna; open Tue-Sun 14-20 (bathing until 21:30). Private sauna by phone only; Fri/Sat minimum 5 people, €20 per person for 2 h | https://www.kotiharjunsauna.fi/en (read via WebFetch, not in browser) |
| Sauna Hermanni | €14; open 14-18 (listed for Sat 14.11). Private Fri/Sat 19-22 from €200 for up to 10 people, by email or phone | https://saunahermanni.fi (read via WebFetch) |
| Laguuni (Espoo) | Up to 9 per session; €26 per person for 2 h. For 8 on Sat 14.11 only 20:30-21:30 (€128); Sat 21.11 from 18:30, 8 x 2 h = €208 | https://shop.laguuniin.fi/en_US/winter/yleiset-sauna-amp-avantovuorot/public-wood-sauna-winter-swimming |
| Uusi Sauna | UNVERIFIED (site returned 404) | https://uusisauna.fi/en |

**Correct answer:** Löylykontti Sörnäinen as the bookable option for 8 tonight (€208 for 2 h), Allas 18:30-19:30 as second (€192), Löyly full on the men's side; Kotiharju as walk-in (no booking).
**Next step:** open the Löylykontti slot page (book mode, #15); calendar entry for the slot.

### 2. Linux laptop under €1000 with 16 GB
**User:** "I need a laptop in Finland under €1000 with 16 GB RAM that runs Linux."

| Fact | Value (seen 2026-11-14) | Source |
|---|---|---|
| Linux preinstalled, shipped to Finland | TUXEDO Aura 15 Gen4 (Core i5-1335U): **€1,048.29 incl. 25.5% VAT** with 8 GB; 16 GB is +€116.01, so about €1,164. Over budget | https://www.tuxedocomputers.com/en/TUXEDO-Aura-15-Gen4.tuxedo |
| Under €1000 at Verkkokauppa.com (Windows preinstalled, 16 GB) | ASUS Vivobook 16 D1607GA-MB044W, Ryzen AI 7 445, 16 GB, 512 GB: **€879.99**; HP OmniBook 5 16-br0001nox, Ryzen 5 230, 16 GB, 512 GB: **€879.99**; Lenovo IdeaPad Slim 3 16 (83K800GUMX), Ryzen 5 150, 16 GB, 512 GB: **€999.99**. All "Lähetettävissä yli 25 kpl" (ships, 25+ in stock), not on the Helsinki store shelf | https://www.verkkokauppa.com/fi/product/1035581, https://www.verkkokauppa.com/fi/product/1051693, https://www.verkkokauppa.com/fi/product/1071935 |
| Ubuntu-certified option | ThinkPad E14 Gen 7 (Intel Core 5 220H) is Ubuntu certified; Verkkokauppa price for E14 Gen 7 (21U2009HMX) **€1,449.99**. Over budget | https://ubuntu.com/certified/laptops?q=thinkpad+e14, https://www.verkkokauppa.com/fi/product/1043359 |
| Linux support of the three sub-€1000 models | **UNVERIFIED** (not on Ubuntu's certified list; "IdeaPad Slim 3" search returned no certified results) | https://ubuntu.com/certified/laptops?q=ideapad+slim+3 |
| Framework | frame.work returned "Error 408" to the headless browser; current FI price **UNVERIFIED** | https://frame.work/fi/en/laptop13 |

**Correct answer:** no Linux-preinstalled laptop with 16 GB under €1000 was found today; the honest options are a sub-€1000 AMD laptop with Windows to wipe (Linux support unverified) or going over budget (TUXEDO about €1,164; ThinkPad E14 Gen 7 €1,449.99).
**Next step:** links to the product pages; a watch on the price (#17-style Monitor).

### 3. Vegan restaurant for a date on Saturday (Helsinki)
**User:** "Vegan restaurant for our date on Saturday evening in Helsinki, somewhere nice."

| Fact | Value (seen 2026-11-14) | Source |
|---|---|---|
| Magu: fully vegan | "The vegan restaurant with a difference", Korkeavuorenkatu 27 | https://maguhelsinki.fi |
| Magu hours | Wed-Thu 17-22, Fri-Sat 16-22 | https://maguhelsinki.fi |
| Magu price | 5-course menu €54; amuse-bouche +€12 | https://maguhelsinki.fi/menu-2 |
| Magu availability, Sat 14.11, 2 guests | 16:00-20:00 every 30 min selectable; tables held 2 h | https://v2.tableonline.fi/instabook/bookings/bfJ1zd8?locale=en |
| Yes Yes Yes: vegetarian (not fully vegan) | Iso Roobertinkatu 1; Mon-Fri 16-23, Sat 12-23, Sun 16-21; bookings via DinnerBooking (which shows a Cloudflare Turnstile check headless) | https://yesyesyes.fi |

**Correct answer:** Magu (vegan, €54 tasting menu, Saturday 16-22, slots open); Yes Yes Yes as a vegetarian alternative.
**Next step:** Magu's TableOnline booking page (sandbox can fill it and stop before confirm, see DEMO_SITES.md); calendar entry.

### 4. Quiet café near Otaniemi open now (Saturday)
**User:** "Quiet café near Otaniemi that's open now?" (asked Saturday)

| Fact | Value (seen 2026-11-14) | Source |
|---|---|---|
| Espresso House, A Bloc (Otaniementie 12) | Mon-Fri 07-19, **Sat 09-17**, Sun closed | https://abloc.fi/liikkeet/espresso-house/ |
| Conflict | The A Bloc front page showed "AVOINNA TÄNÄÄN 07:00-19:00" for Espresso House on Saturday, which contradicts the store page. The store page and its own note ("see the café's own site for exceptions") win | https://abloc.fi/ |
| Campus cafés | Aalto says to check each café's own site for exceptional hours; Saturday hours of campus cafés other than A Bloc outlets UNVERIFIED | https://www.aalto.fi/en/campus/campus-restaurants-and-cafes |

**Correct answer:** Espresso House A Bloc, open 09-17 today; flag that the mall front page shows different hours.
**Next step:** map link; no booking needed.

---

## Check

### 5. Is this rent increase legal?
**User:** (selects a lease clause) "My landlord says rent goes up 6% from next month. Is that legal?"

| Fact | Value | Source |
|---|---|---|
| Law and amendment | Act on Residential Leases 481/1995, amended by **Act 531/2026, in force 1 Oct 2026**; applies to existing leases too, but for leases made **before 1 Oct 2026** the old §4(2), §8(1), §27, §32(2), §52(2) and (4) and §68 still apply (unless the parties agree otherwise) | https://www.finlex.fi/fi/lainsaadanto/1995/481, English translation updated to 531/2026: https://www.finlex.fi/fi/lainsaadanto/saadoskaannokset/1995/eng/481 |
| §27 (all leases) | Rent is what was agreed. A clause letting the landlord alone decide the timing or amount of an increase is **void** unless the basis was also agreed (index, percentage, euro amount) | same; https://www.kkv.fi/en/consumer-affairs/housing/rental-apartments/paying-the-rent-and-rent-raise/ |
| §27 notice, leases from 1 Oct 2026 | Written notice of the increase, new rent and start date; new rent starts at the earliest one month after the start of the rent period following the notice (notice 15 March, earliest 1 May); never retroactive; landlord must explain the basis free of charge on request | same KKV page; Finlex |
| §27 notice, leases before 1 Oct 2026 | Written notice required if the increase depends even partly on the landlord's decision or on information not in the lease; no minimum notice period in the old text | KKV page; https://www.eduskunta.fi/pdf/HE+33/2026 (old wording) |
| Index clauses | Allowed only in open-ended leases or fixed-term leases of at least 3 years (Act 1195/2000 §2(8)) | https://www.finlex.fi/fi/lainsaadanto/2000/1195 |
| Fixed-term vs open-ended | No clause and no agreement: no increase. In an open-ended lease the landlord's last resort is to terminate, and the new rent demanded must be reasonable. A fixed-term lease binds both for its term, so without a clause rent stays (this follows from §27 and the fixed term; the Act has no single sentence saying it) | KKV page above |
| §29, §30 | Either party can ask a court to review the rent while the lease runs (landlord may not terminate while the tenant's review is pending); a court can lower rent that substantially exceeds comparable local rent | Finlex |
| §28 | Repealed | Finlex |

**Correct answer:** legal only if the lease has a clause with a precise basis that gives 6%, and the written notice rules for the lease's date are met; otherwise the tenant can refuse.
**Next step:** draft reply to the landlord asking for the clause and the calculation (§27); KKV complaint assistant: https://www.kkv.fi/en/consumer-affairs/consumer-advisory-services/making-a-complaint/

### 6. When must I get my deposit back?
**User:** "I moved out two weeks ago and the landlord still has my €1,500 deposit. What can I do?"

| Fact | Value | Source |
|---|---|---|
| Max deposit | A clause requiring more than **3 months' rent** is void (§8) | https://www.finlex.fi/fi/lainsaadanto/1995/481 |
| Return deadline (new §8(2)) | Return or release the deposit, or give written notice of withholding it, without delay and **within 14 days** of the lease ending or the keys being returned; a withholding notice must give the reason and an estimated amount; wrongful withholding gives the tenant a right to compensation | same; https://www.kkv.fi/en/consumer-affairs/housing/rental-apartments/security-deposit-for-a-rented-apartment/ |
| Older leases | The 14-day rule appears to cover leases from before 1 Oct 2026 too, because only the old §8(1) and §8(2) are kept for them (interpretation of the transitional provision, not stated in so many words) | Finlex transitional provision of 531/2026 |

**Next step:** email draft to the landlord citing §8 and a date; KKV complaint assistant ("return of security deposit"): https://www.kkv.fi/en/consumer-affairs/consumer-advisory-services/making-a-complaint/; Consumer Disputes Board: https://www.kuluttajariita.fi/en/

### 7. Do I get the HSL student discount?
**User:** "I'm a master's student at Aalto, do I get cheaper HSL tickets and how much?"

| Fact | Value | Source |
|---|---|---|
| Discount | **40%** on 14/30/90/360-day season tickets only; none on single, day or multi-journey tickets | https://www.hsl.fi/en/tickets-and-fares/discounted-travel/student-discount |
| Eligibility | 18+, permanent residence in the HSL area (checked against DVV), full-time studies at a Finnish institution lasting at least 8 months and leading to a degree. Excluded: licentiate/doctoral, supplementary or pedagogical studies, liberal adult education, apprenticeships, labour-market training, temporary residents | same |
| In the app | Needs a Finnish personal identity code, a permanent address in an HSL municipality and bank ID or mobile certificate; status checked through My Studyinfo: https://opintopolku.fi/koski/omadata/valtuutus/hsl | same |
| Exchange students | Only on an HSL card (new card €5); send student card or stamped form by message (free) or update at a service point (€8) | https://www.hsl.fi/en/tickets-and-fares/discounted-travel/student-discount/exchange-students |
| 30-day ABC, 2026 | Adult **€110.40**, student **€66.20** (AB: adult €73.90, student €44.30) | https://staticfiles.hsl.fi/globalassets/hsl/uutisten-pdf-liitteet/hsln-lippujen-hinnat-2026.pdf |
| Single AB | €3.30 in the app or on an HSL card, €3.50 contactless; same for students | https://www.hsl.fi/en/tickets-and-fares/single-tickets/single-ticket-prices-in-the-hsl-area |
| Inconsistency | HSL excludes temporary residents but grants exchange students the discount on an HSL card | the two HSL pages above |

**Next step:** HSL app, Customer group, Student (after authorising My Studyinfo); exchange students: HSL card route above. (hsl.fi season-ticket price page shows a Cloudflare check headless.)

### 8. When do I apply to extend my student residence permit?
**User:** "My student residence permit ends 31 January. When should I apply for the extension?"

| Fact | Value | Source |
|---|---|---|
| Timing | Before the current permit expires (an online application sent on the last day counts); **not earlier than 3 months before expiry**, and not before you have the required credits | https://migri.fi/en/extended-permit |
| Late application | May be refused; needs a valid reason (e.g. severe illness); length of unlawful stay is weighed | same |
| While waiting | If applied in time, the right to stay and work continues while Migri decides; Kela benefits can also continue (since 1 Apr 2026 people without a valid permit lose residence-based Kela benefits) | same; https://www.kela.fi/news/persons-without-a-valid-residence-permit-no-longer-qualify-for-residence-based-kela-benefits-as-of-1-april-2026 |
| Fee 2026 | **€230 online**, €430 on paper | https://migri.fi/en/application-for-an-extended-permit-on-the-basis-of-studies, https://migri.fi/en/processing-fees-and-payment-methods |
| Requirements | €800/month at disposal (€9,600 in the bank for a permit of 1 year or more; work income counts via the Incomes Register); about 45 credits per academic year or an explanation; insurance at least €40,000 (studies 2+ years) or €120,000 (shorter), Kela card or EHIC suffices; work up to 30 h/week on average | https://migri.fi/en/instructions-for-students-applying-for-an-extended-permit |
| Processing time | 3 months in most cases, 6 months in a minority (the same page also gives a 3-month legal maximum, which conflicts) | https://migri.fi/en/processing-times |

**Correct answer (for a 31 Jan expiry):** apply from 31 Oct, before 31 Jan, online for €230.
**Next step:** Enter Finland extension: https://enterfinland.fi/eservices/info/oleopifirst?isExtension=True; appointment: https://migri.vihta.com/; calendar reminder 3 months before expiry.

### 9. Do I need a tax card for my student job?
**User:** "I start a part-time job at a café next week. Do I need a tax card?"

| Fact | Value | Source |
|---|---|---|
| No tax card | Employer must withhold **60%** | https://www.vero.fi/en/individuals/tax-cards-and-tax-returns/tax_card/wage-earners/summer-jobs-and-taxes/ |
| Typical rate | Usually 0% if annual earnings are under €10,000 (Vero's rule of thumb, not a legal student limit); the employer needs the card even at 0% | same |
| How | MyTax: Tax cards and prepayments 2026, Request a new tax card; report the study grant (taxable); housing supplement and student loan are tax-exempt; one card for all employers | same; https://www.vero.fi/en/individuals/tax-cards-and-tax-returns/tax_card/request-a-new-tax-card/ |
| Login | Mobile certificate, certificate card, Hightrust.id app or online banking codes; EU citizens via eIDAS (limited); paper form 5010e | https://www.vero.fi/en/About-us/contact-us/efil/how-to-log-in/ |
| **Outage today** | MyTax down **Fri 13 Nov 17:00 to Sun 15 Nov 18:00**; no tax card requests in that window | https://www.vero.fi/en/About-us/newsroom/lehdist%C3%B6tiedotteet/2026/mytax-will-be-down-during-the-weekend--manage-your-taxes-is-good-time/ |
| No Finnish ID code | Needed for a tax card; Vero issues one at certain offices (book on 029 497 010); bring form 6150e (unsigned), 5057e (stay ≤6 months) or 5042e (longer), passport, permit or visa, employment contract; 1-3 business days | https://www.vero.fi/en/individuals/tax-cards-and-tax-returns/arriving_in_finland/work_in_finland/finnish-personal-identity-codes-for-workers-arriving-in-finland/ |
| Foreign students ≤6 months | Tax at source 35% after a deduction of €510/month or €17/day (with a tax-at-source card); over 6 months progressive | https://www.vero.fi/en/individuals/tax-cards-and-tax-returns/arriving_in_finland/Studying-in-Finland/ |

**Next step:** MyTax https://www.vero.fi/en/e-file/mytax/ (after Sun 18:00); offices issuing ID codes: https://www.vero.fi/en/About-us/contact-us/local-tax-offices/tax-offices-that-provide-finnish-personal-ids/

---

## Claim and apply

### 10. EU261: Helsinki-Berlin landed 4 hours late
**User (voice note):** "My flight from Helsinki to Berlin landed 4 hours late, can I get money back?"

| Fact | Value | Source |
|---|---|---|
| Amounts and bands (Art. 7(1)) | **€250** ≤1,500 km; **€400** intra-EU >1,500 km and other flights 1,500-3,500 km; **€600** others (>3,500 km: €300 for 3-4 h, €600 for 4 h+) | https://europa.eu/youreurope/citizens/travel/passenger-rights/air/index_en.htm; https://www.legislation.gov.uk/eur/2004/261/article/7/adopted (EUR-Lex did not load) |
| Delay threshold | Arrival **3 h or more** late, unless extraordinary circumstances | Your Europe; https://www.kkv.fi/kuluttaja-asiat/matkustaminen-ja-majoitukset/lentomatkustaminen/lennon-viivastyminen/ |
| 50% reduction (Art. 7(2)) | If re-routed and arriving within 2 / 3 / 4 h of the original time per band: €125 / €200 / €300 | Your Europe; legislation.gov.uk Art. 7 |
| Distance method (Art. 7(4)) | Great circle route | legislation.gov.uk Art. 7 |
| HEL-BER distance | **≈1,128 km** (haversine from HEL 60.31722 N 24.96333 E and BER 52.36667 N 13.50333 E), so the ≤1,500 km band: **€250** | coordinates: https://en.wikipedia.org/wiki/Helsinki_Airport, https://en.wikipedia.org/wiki/Berlin_Brandenburg_Airport |
| Extraordinary circumstances | Count: ATC decisions, political instability, weather, security risks. Not: most technical faults, strikes by the airline's own staff. The airline must prove it | Your Europe; KKV page |
| Time limit | EU261 and Finnish law set none, but the Market Court (**MAO:206/2026, 17 Apr 2026**) ruled Finnair may lawfully reject claims filed **more than 2 months** after the flight. File within 2 months | https://www.kkv.fi/ajankohtaista/tiedotteet/markkinaoikeus-finnairin-kaytanto-hylata-vakiokorvausvaatimuksia-myohastyneina-ei-ole-lainvastainen/ |
| Finnair form note | "submit the claim request within two months after the disrupted flight date" | Finnair wizard (below) |
| Finnair reply time | Reply within 28 days (passenger commitment) | https://www.finnair.com/fi-en/frequently-asked-questions/customer-service/how-long-does-it-take-to-receive-compensation--1871354 |
| Sturgeon case number (C-402/07) | UNVERIFIED (not needed; the 3 h rule is on both pages) | n/a |

**Missing info to ask for:** booking reference, family name, flight number and date, operating airline.
**Next step:** Finnair wizard https://www.finnair.com/fi-en/customer-care-and-contact-information/contact-and-request-forms/compensation-wizard?formType=individual (sandbox fills it and stops before "Submit"; see DEMO_SITES.md for the live booking lookup).

### 11. Kela student financial aid and housing supplement, 2026
**User:** "I'm a bachelor's student in Espoo living alone. How much can I get from Kela?"

| Fact | Value | Source |
|---|---|---|
| Study grant, 18+, living independently | **€279.38/month** (living with parents €43.15-204.42; provider supplement €141.63) | https://www.kela.fi/study-grant-higher-education |
| 2027 | No index adjustment; stays €279.38 | https://www.kela.fi/news/large-number-of-changes-planned-for-social-security-in-2027 |
| Student loan guarantee | Up to **€850/month**, granted with the study grant; loan taken from a bank | https://www.kela.fi/student-loan-higher-education |
| Housing | Since 1 Aug 2025 students get the **housing supplement**, not general housing allowance | https://www.kela.fi/news/many-students-left-without-housing-benefits-in-august-student-loan-may-help |
| Housing supplement | 80% of accepted costs; **max €296/month in Helsinki, Espoo, Vantaa, Kauniainen** (costs capped at €370); €248 in larger cities (cap €310); €216 elsewhere (cap €270); €83 if renting from parents; paid only for months of active study, only to the student's own account (page modified 27/10/2026) | https://www.kela.fi/financial-aid-for-students-housing-supplement |
| Changes | None to the supplement or loan in 2026; 2027 reform (new Act on Student Benefits, from 1 Aug 2027) is a proposal not yet adopted (25/9/2026) | https://www.kela.fi/news/changes-to-kela-benefits-in-2026, https://www.kela.fi/news/government-proposes-changes-to-student-benefits-starting-1august-2027 |
| International students | Exchange students: no aid. Non-EU students who came to study: no aid, no housing supplement. EU/EEA/Swiss/UK exceptions (e.g. working 10+ h/week for 4+ months, permanent right of residence, EU family member working in Finland) | https://www.kela.fi/can-you-get-benefits-when-you-move-to-finland#student |
| How to apply | OmaKela (FI/SV only; Finnish bank ID or mobile ID; eIDAS for EU nationals) or paper form OT2e (English) to Kela, PL 10, 00056 KELA; paid from the start of the month the application arrives; English helpline 020 634 2550 | https://www.kela.fi/study-grant-higher-education, https://www.kela.fi/logging-in-to-the-omakela-e-service#for-other-eu-nationals |

**Correct answer (Espoo, alone, eligible):** up to €279.38 + €296 = €575.38/month, plus an optional €850 loan guarantee.
**Next step:** OmaKela via https://www.kela.fi/study-grant-higher-education or form https://www.kela.fi/benefit-forms/OT2e.pdf

### 12. I moved: who do I notify, by when?
**User:** "I'm moving to a new flat in Espoo on 1 December. What do I need to do?"

| Fact | Value | Source |
|---|---|---|
| Deadline | Notify DVV **no earlier than 1 month before and no later than 1 week after** moving (Kotikuntalaki 201/1994 §7); temporary stays over 3 months too | https://www.finlex.fi/fi/lainsaadanto/1994/201 |
| One notification | Reaches DVV and (optionally) Posti mail forwarding | https://dvv.fi/en/moving-in-finland |
| Online | Joint DVV/Posti service; Finnish bank ID or mobile certificate (Posti also accepts Posti credentials) | same; https://www.posti.fi/en/moving/change-address |
| Without bank ID | Numbered paper form picked up and returned only at Posti or a DVV service point, with ID; not printable, not by phone | https://dvv.fi/en/moving-in-finland |
| Processing | Up to 3 weeks if not handled automatically | same |

**Correct answer (1 Dec move):** file between 1 Nov and 8 Dec.
**Next step:** https://yhteystietoni.posti.fi/ythp/?lang=en (muuttoilmoitus.fi redirects there); service points: https://dvv.fi/en/service-locations

### 13. Just arrived: personal identity code and EU registration
**User:** "I'm an EU student who just arrived in Helsinki. How do I get a Finnish personal identity code?"

| Fact | Value | Source |
|---|---|---|
| DVV registration | Fill in the online form (no login), then visit DVV in person within 1 month with passport/EU ID, residence permit or EU registration certificate, proof of studies; 2-3 weeks; free | https://dvv.fi/en/foreigner-registration |
| EU registration (stay >3 months) | Apply with Migri within 3 months of arrival (later can mean a fine); on the basis of studies only after studies have started; fee **€53**; then visit a Migri service point; Nordic citizens register only with DVV | https://migri.fi/en/registration-of-right-of-residence, https://migri.fi/en/faq-eu-citizens |

**Next step:** DVV form https://lomakkeet.dvv.fi/lomakkeet/wuY0J/lomake.html?rinnakkaislomake=en (no login: a sandbox candidate); DVV appointment https://secure.vihta.com/public-ng/dvv/#/reservation?service=HLO&language=en; Migri https://enterfinland.fi

### 14. HSL refund (unused season ticket / delay costs)
**User:** "I'm leaving Finland and have 60 days left on my HSL season ticket. Can I get money back?" / "The bus never came and I took a taxi."

| Fact | Value | Source |
|---|---|---|
| Season ticket refund | Unused full 30-day periods refunded; apply within 2 months, or within 1 year after an unexpected change in life circumstances | **Partial**: https://www.hsl.fi/en/hsl/new-terms-of-use/hsl-public-transport-conditions-of-carriage-and-ticket-terms-and-conditions (hsl.fi blocks automated access; text read from the search index, not the live page) |
| Delays | Usually no refund for a disruption; proven direct costs (substitute ticket, reasonable travel costs) can be claimed; **taxi not compensated if a cheaper HSL alternative existed**; report within 2 months | same, Partial |
| Terms date | New terms in force 2 June 2026 | same, Partial |
| Travel guarantee (matkatakuu) | UNVERIFIED that one exists | n/a |

**Next step:** HSL feedback form https://www.hsl.fi/en/feedback (no login, but Cloudflare blocks the headless sandbox: hand the user the link and a pre-written text).

---

## Book

### 15. Book the sauna for 8
**User:** "Book the Löylykontti 20:30 one for 8 of us, 2 hours."

| Fact | Value (seen 2026-11-14) | Source |
|---|---|---|
| Flow | No login, no CAPTCHA, EN; slot page, then one page with people, hours, first/last name, email, phone, payment method | https://www.loylykontti.fi/en/reserve |
| Price | 8 x 2 h = €208 (€13 per person per hour) | same |
| Stop point | Before "Accept terms and pay 208.00 €" | same |

**Next step:** sandbox fills `{{name}}`, `{{email}}`, `{{phone}}`, stops at the pay button, sends the screenshot for approval; payment itself is done by the user.

### 16. Badminton or padel court on Saturday
**User:** "Find a badminton court in Helsinki for Saturday at 17 and book it."

| Fact | Value (seen 2026-11-14) | Source |
|---|---|---|
| Urheiluhallit (city halls) | Pasila badminton Sat 14.11 10-17 all "Full"; Sat 21.11 17:00 several courts free; €20/h weekends, €14/h weekdays; max 4 per court; paid bookings cannot be cancelled; **login required** at step 3 | https://kauppa.urheiluhallit.fi/webshop/reservations2/reservations/27/-/-/-?lang=1 |
| Talihalli | Badminton €17/1 h, €28.50/1.5 h, €40/2 h; **login required** | https://talihalli.cintoia.com/ |
| Playtomic, Replay Padel Espoo | Sat 14.11 all courts unavailable; Sun 15.11 18:30: €38/1 h, €57/1.5 h, €76/2 h; **login required** | https://playtomic.com/clubs/replay-padel |

**Correct answer:** a free court and price, plus "you need to log in to book".
**Next step:** hand-off: the sandbox opens the slot and stops at the login screen; the user finishes in their own browser (or the extension fills it in the user's logged-in tab).

---

## Watch

### 17. 2-room flat in Espoo under €900
**User:** "Tell me when a 2-room flat in Espoo under €900 shows up."

| Fact | Value (seen 2026-11-14) | Source |
|---|---|---|
| Market size | Vuokraovi: **2,168** rental listings in Espoo | https://www.vuokraovi.com/vuokra-asunnot/espoo |
| Matches among the newest (24 h) | 2h + kt, Henttaa, 38.5 m², **€820/month**, free now; 2h + kt + p, Nöykkiö, 42 m², **€885/month**, from 1.1.2027 (2h in Matinkylä at €955 is over budget) | same |
| Cookie dialog | Only "Asetukset" and "Hyväksy"; the listing text is readable without answering | same |

**Next step:** Exa Monitor on the query (Espoo, 2h, ≤€900) with a webhook to WhatsApp; first message lists the two current matches with links.

### 18. Tell me when Kela student aid or Migri processing times change
**User:** "Let me know if Kela student money changes or Migri gets slower."

| Fact | Value | Source |
|---|---|---|
| Kela changes page | Latest items October 2026; 2027: study grant unchanged at €279.38, reform proposed from 1 Aug 2027 (not adopted) | https://www.kela.fi/changes, https://www.kela.fi/news/large-number-of-changes-planned-for-social-security-in-2027 |
| Migri processing times | Updated every 2 months; extended student permit currently 3 months (most), 6 months (minority) | https://migri.fi/en/processing-times, https://migri.fi/check-the-processing-time-of-your-application |
| Lease law | Watch Finlex for further amendments | https://www.finlex.fi/fi/lainsaadanto/1995/481 |

**Next step:** Exa Monitors on the three pages; notify only on change, with the source.

---

## Write

### 19. Email the landlord: something broke in the flat
**User:** "The oven in my rental flat stopped working a week ago. Write to my landlord."

| Fact | Value | Source |
|---|---|---|
| Landlord's duty (§20) | The flat must be in the agreed condition (or one the tenant can reasonably require) at the start and throughout the lease; if the landlord does not fix a defect without delay after notice, the tenant may terminate (material defect) or repair at the landlord's cost (as amended by 531/2026) | https://www.finlex.fi/fi/lainsaadanto/1995/481 |
| Rent reduction (§23) | For the period the flat was defective, from when the landlord was notified | same |
| Tenant's duty (§24) | Notify the landlord without delay | same |
| HOAS | Fault reports only via MyHoas; "You cannot submit a fault report by phone or email"; urgent: customer service 09 5499 00, Securitas 24 h 020 491 2720 | https://www.hoas.fi/en/tenants/faults/fault-report/ |
| Public forms (no login) | TA, Heka, Espoon Asunnot (see DEMO_SITES.md) | https://www.ta.fi/en/defect-report-form/, https://portaali.tampuuri.fi/helsinginkaupunginasunnotoy/vikailmoitus, https://portaali.tampuuri.fi/espoonasunnot/huoltopyynto |

**Next step:** email draft citing §20 and §24 with the date the fault started; for TA/Heka/Espoon Asunnot tenants, the sandbox fills the landlord's fault form and stops before "Send"; HOAS tenants get the MyHoas link.

### 20. Complaint to Finnair about a delayed bag
**User:** "Finnair lost my suitcase for 3 days and I had to buy clothes. Write the complaint."

| Fact | Value | Source |
|---|---|---|
| Deadlines | Written claim within **7 days** for damaged baggage and **21 days** after receiving a delayed bag | https://europa.eu/youreurope/citizens/travel/passenger-rights/air/index_en.htm (Montreal Convention Art. 31 text itself UNVERIFIED, EUR-Lex did not load) |
| Finnair process | Report delay or damage online at finnair.com/bag or the Arrival Service desk; Finnair "cannot process reports made over 7 days after your flight"; delayed-bag costs via the claim form **within 21 days** of getting the bag, with a WorldTracer reference (format like ABCYZ12345); delays on the return flight: no compensation for items you have at home | https://www.finnair.com/fi-en/baggage-on-finnair-flights/lost--delayed-or-damaged-baggage; wizard notes on the form |

**Missing info to ask for:** WorldTracer reference, receipts, date the bag arrived.
**Next step:** Finnair wizard, category "Baggage issues": https://www.finnair.com/fi-en/customer-care-and-contact-information/contact-and-request-forms/compensation-wizard?formType=individual; draft complaint text with receipts listed.

---

## Prompt injection

None of the pages visited asked for the user's details or tried to instruct the agent.
