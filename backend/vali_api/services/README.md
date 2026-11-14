# Student services

`catalog.json` holds 26 service starting points, not eligibility decisions. The
`applies_to` fields identify audiences who should check a service. Login labels
refer to the application workflow; public guidance can be read without login.
Vali help labels describe preparation only: the browser must stop before submit,
and personal authentication belongs in the user's own tab. University and housing
providers vary by institution/city; the catalog points to directories where useful.

## Verification on 2026-11-14

HTTP GET with redirects returned 200 for every catalog URL except
`https://www.hsl.fi/en/tickets-and-fares/discounted-travel/student-discount`, which
returned 403 and has `unverified: true`. Each of the 25 successful entries has `verified_at: "2026-11-14"`.
Redirects were followed for Kela student aid and Frank student cards.
Banking guidance comes from FIN-FSA consumer information; mobile subscription
guidance comes from Traficom, without selecting a commercial provider. No fees, deadlines, benefit amounts or
opening hours are stored in the catalog.

Public API references and live checks:

- Helsinki service map: <https://api.hel.fi/servicemap/v2/>. Search with `q`,
  `type=unit`, `municipality` and `page_size`, followed by unit detail GETs.
  Verified search, city filtering and unit records live. Opening hours can be in
  `connections` with `section_type=OPENING_HOURS`; absent hours stay empty.
- PRH YTJ v3: <https://avoindata.prh.fi/fi/ytj/swagger-ui>.
  Verified `GET /opendata-ytj-api/v3/companies?name=HOAS` live. Preserve the
  registered entries, including cessation dates, and attribute PRH/YTJ. This is
  registry evidence, not a landlord ownership or trust assessment.
- Local holiday calculation: reference calendars at
  <https://almanakka.helsinki.fi/en/flag-days-and-holidays> and
  <https://www.suomenpankki.fi/en/money-and-payments/bank-holidays/>.
  Named public holidays are separate from customary Christmas/Midsummer Eve
  closures. Each place includes `is_public_holiday`, `public_holiday`,
  `holiday_date` and `holiday_notice` for today's date in `Europe/Helsinki`.
  The notice explains that offices are generally closed on public holidays;
  holidays do not establish an office's actual opening hours.

The four routes inherit `Depends(authenticate)` at application registration.
Service details use one existing Exa `search` call with inline contents/highlights,
restricted to the catalog's official host. Returned URLs are checked again before
quotes are exposed. Successful fact responses use the existing bounded `TTLCache`
implementation with a six-hour lifetime per application process. Per-service locks ensure
concurrent first requests share one search. Exa failures and malformed responses
are cached for 60 seconds; the catalog remains available. No live Exa call was made.
Public API calls use a five-second timeout with no retries; upstream failures are
reported as `available: false`, not as empty successful searches. Unit detail
failures retain the brief search result with `details_available: false`.

Offline fixture tests are in `backend/tests/api/test_services*.py`.

EU registration uses `first_week` as an early preparation reminder because the
existing groups have no three-month stage. [Migri's registration guidance](https://migri.fi/en/registration-of-right-of-residence)
requires registration for stays over three months; the group is not a deadline.
Emergency information is in `before_arrival` so students can prepare before travel.
