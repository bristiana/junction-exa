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
returned 403 and has `unverified: true`. Redirects were followed for Kela student
aid, Frank student cards and Elisa prepaid. No fees, deadlines, benefit amounts or
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
- Digitransit: <https://digitransit.fi/en/developers/apis/1-routing-api/> and
  <https://digitransit.fi/en/developers/apis/1-routing-api/itinerary-planning/>.
  Uses HSL v2 `planConnection`; disabled unless `VALI_DIGITRANSIT_KEY` is set.
  Schema reviewed; live routing untested because no key was supplied.
- Local holiday calculation: reference calendars at
  <https://almanakka.helsinki.fi/en/flag-days-and-holidays> and
  <https://www.suomenpankki.fi/en/money-and-payments/bank-holidays/>.
  Named public holidays are separate from customary Christmas/Midsummer Eve
  closures. Holidays do not establish an office's actual opening hours.

The four routes inherit `Depends(authenticate)` at application registration.
Service details use one existing Exa `search` call with inline contents/highlights,
restricted to the catalog's official host. Returned URLs are checked again before
quotes are exposed. Successful fact responses use the existing bounded `TTLCache`
implementation with a six-hour lifetime per application process. Exa failures do
not poison that cache; the catalog remains available. No live Exa call was made.
Public API calls use a five-second timeout with no retries; upstream failures are
reported as `available: false`, not as empty successful searches. Unit detail
failures retain the brief search result with `details_available: false`.

Offline fixture tests are in `backend/tests/api/test_services*.py`.
