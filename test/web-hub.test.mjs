import { test } from "node:test";
import assert from "node:assert/strict";
import { clipQuote, companyVerdict, errandFor, factSources, officeLine, timeline, todayHours } from "../web/hub-model.js";

const catalog = { groups: [
  { id: "before_arrival", services: [{ id: "residence-permit", name: "Residence permit", applies_to: { citizenship: ["non_eu"], study: ["degree", "exchange"] } }] },
  { id: "first_week", services: [{ id: "eu-registration", name: "EU registration", applies_to: { citizenship: ["eu"], study: ["degree", "exchange"] } },
    { id: "bank-account", name: "Bank account", applies_to: { citizenship: ["eu", "non_eu"], study: ["degree"] } }] },
  { id: "ongoing", services: [] },
] };

test("the timeline keeps phase order, drops empty phases and filters by who you are", () => {
  assert.deepEqual(timeline(catalog, {}).map((p) => [p.title, p.services.length]), [["Before you arrive", 1], ["First week", 2]]);
  assert.deepEqual(timeline(catalog, { citizenship: "eu", study: "exchange" }).flatMap((p) => p.services.map((s) => s.id)), ["eu-registration"]);
});

test("today's hours come from service-map text, or stay unknown", () => {
  const wednesday = new Date(2026, 10, 18), saturday = new Date(2026, 10, 14);
  assert.equal(todayHours("open Mon-Fri 09-16", wednesday), "Open today 09:00–16:00");
  assert.equal(todayHours("open Mon-Fri 9.30-16", saturday), "Closed today");
  assert.equal(todayHours("by appointment", wednesday), null);
  const office = officeLine({ name: { en: "Kela Kamppi" }, street_address: { fi: "Salomonkatu 17" }, address_zip: "00100",
    opening_hours: [{ en: "open Mon-Fri 09-16" }], is_public_holiday: true, public_holiday: "Christmas Day" }, wednesday);
  assert.equal(office.address, "Salomonkatu 17, 00100");
  assert.equal(office.hours, "Christmas Day: offices are generally closed");
  assert.equal(office.tone, "holiday");
});

test("the register verdict prefers an exact, active name and never claims more than the register says", () => {
  const company = (name, id, endDate = null) => ({ businessId: { value: id, registrationDate: "1990-01-01" }, names: [{ name }], endDate,
    companyForms: [{ descriptions: [{ languageCode: "3", description: "Limited company" }] }] });
  const result = { available: true, companies: [company("Example Homes Oy", "1-1", "2010-01-01"), company("Example Oy", "2-2")] };
  assert.equal(companyVerdict(result, "Example").tone, "good");
  assert.match(companyVerdict(result, "Example").line, /Example Oy \(2-2\) is a registered limited company since 1990-01-01/);
  assert.equal(companyVerdict({ available: true, companies: [company("Example", "3-3", "2020-05-05")] }, "example").tone, "bad");
  assert.equal(companyVerdict({ available: true, companies: [] }, "Nobody").tone, "none");
  assert.equal(companyVerdict({ available: false }, "x").tone, "unknown");
});

test("live facts become numbered sources, one per page, unsafe links dropped", () => {
  const { sources, quotes } = factSources([
    { url: "https://kela.fi/a", title: "A", quote: "First." }, { url: "https://kela.fi/a", title: "A", quote: "Second." },
    { url: "https://kela.fi/b", title: "B", quote: "Third." }, { url: "javascript:alert(1)", quote: "Bad." }]);
  assert.deepEqual(sources.map((s) => s.n), [1, 2]);
  assert.deepEqual(quotes.map((q) => q.n), [1, 1, 2]);
});

test("Ask Vali carries the service and who you are, never personal details", () => {
  const service = { name: "Student aid", organisation: "Kela", official_url: "https://www.kela.fi/financial-aid-for-students" };
  assert.match(errandFor(service, { citizenship: "non_eu", study: "degree" }), /^Student aid \(Kela\): what do I need to do as a non-EU degree student/);
  assert.match(errandFor(service, {}, true), /Stop before submitting\.$/);
});

test("long markdown highlights become a short plain quote", () => {
  const raw = "## How do I get one? You can register at a DVV service point if you live in Finland. ### Read more [here](https://dvv.fi/x) about the **appointment** and what to bring with you. " + "x ".repeat(300);
  const quote = clipQuote(raw);
  assert.ok(quote.length <= 241);
  assert.match(quote, /^You can register at a DVV service point if you live in Finland\./);
  assert.doesNotMatch(quote, /[#*\]]/);
});
