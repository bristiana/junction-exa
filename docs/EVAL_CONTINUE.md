# Eval: research rate and Continue (15 Nov 2026, production)

A fresh anonymous account, fake details only (Test Person, test@example.com, +358401234567). No run was approved; every run was stopped at the approval step or earlier.

## Research: 13 of 13 answered (100%), 24 of 26 facts confirmed on the page (92%)

| Errand | Mode | Answer | Time | Facts confirmed | Sources | Exa cost | Action |
|---|---|---|---|---|---|---|---|
| HSL ticket airport to Otaniemi | check | info | 28 s | 2/2 | 4 | $0.029 | reittiopas.hsl.fi |
| Kela aid for international students | check | info | 34 s | 2/2 | 4 | $0.029 | oma.kela.fi |
| DVV address change in Espoo | check | ready | 24 s | 2/2 | 5 | $0.030 | posti.fi change of address |
| Bank account without a Finnish ID | check | ready | 25 s | 3/3 | 4 | $0.029 | danskebank.fi basic banking |
| Kulttuurisauna Friday 18:00 | book | ready | 33 s | 2/2 | 1 | $0.026 | kulttuurisauna.fi |
| Finnkino Tennispalatsi Saturday | book | needs info | 31 s | 1/2 | 2 | $0.027 | finnkino.fi |
| Allas Sea Pool ticket | book | ready | 23 s | 2/2 | 3 | $0.028 | shop.allaspool.fi |
| Padel court in Espoo | book | ready | 37 s | 2/2 | 3 | $0.028 | play.fi House of Games |
| Helsinki library card | check | ready | 25 s | 2/2 | 4 | $0.029 | Helmet application PDF |
| Residence permit, non-EU master's | check | info | 20 s | 2/2 | 5 | $0.030 | enterfinland.fi |
| Pharmacy open Sunday near Otaniemi | find | info | 5 s | 2/2 | 2 | $0.009 | ainoapteekki.fi |
| Watch HOAS flats under €700 | watch | monitor on | 11 s | 2/2 | 5 | $0.012 | hoas.fi |
| httpbin pizza form (control) | book | ready | 20 s | 1/2 | 1 | $0.026 | httpbin.org/forms/post |

Median time to answer: 25 s. Exa cost for all 13: $0.33.

## Continue: 4 of 5 sites reach Approve after Stop and Continue (80%)

Each run was started with Fill it for me, stopped after 3 to 5 steps, then continued. Continue starts a fresh Modal container that replays the earlier steps.

| Site | First run stopped at | Continue | Time | Notes |
|---|---|---|---|---|
| httpbin.org/forms/post | step 5, consent question | reached Approve | 31 s | name, phone, email filled |
| play.fi (padel, Espoo) | step 4 | reached Approve | 19 s | court and time picked; the site needs an account to pay |
| shop.allaspool.fi | step 3 | reached Approve | 58 s | guest checkout, 14:00 ticket, €24 |
| kulttuurisauna.fi (men's slot) | step 4 | reached Approve after the fix | 37 s | failed before the fix, see below |
| finnkino.fi | step 2, bot wall | failed both times | 14 s | "needs captcha: finish by hand", by design |

## Bugs found

1. Fixed (PR #108, deployed): Kulttuurisauna gives NAINEN / WOMAN and MIES / MAN the same value, so a men's booking always became a women's booking. The agent now selects by position when values repeat. Retested: Continue reached Approve for "1 man".
2. Open: when Vali asks "May I use your saved name, email and phone?", answering with the details themselves (not "yes") counts as no. People will do this on WhatsApp.
3. Open: a "no" to that question carries into the continued run, so Allas reached Approve with empty name and email fields.
4. Open: some finished errands keep an unanswered "Which city?" research question (cinema, Allas, httpbin).
