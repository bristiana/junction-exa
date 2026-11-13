import { test } from "node:test";
import assert from "node:assert/strict";
import { fillPlaceholders, unfilledPlaceholders, mailtoUrl, gmailUrl, calendarUrl, numberSources, citesFor, resolveAction, safeHttpUrl } from "../extension/lib/actions.js";

test("placeholders are filled from the profile and unknown ones stay visible", () => {
  const p = { name: "Aino Virtanen", email: "aino@example.com" };
  assert.equal(fillPlaceholders("Hi, I am {{name}} ({{ email }}), ref {{booking_reference}}", p), "Hi, I am Aino Virtanen (aino@example.com), ref {{booking_reference}}");
  assert.deepEqual(unfilledPlaceholders("{{name}} {{booking_reference}} {{name}}"), ["name", "booking_reference"]);
});

test("mail links encode subject and body", () => {
  const u = mailtoUrl({ to: "claims@finnair.com", subject: "EU261 claim", body: "Line 1\nLine 2 & more" });
  assert.equal(u, "mailto:claims@finnair.com?subject=EU261%20claim&body=Line%201%0ALine%202%20%26%20more");
  const g = new URL(gmailUrl({ to: "a@b.fi", subject: "S", body: "B" }));
  assert.equal(g.searchParams.get("su"), "S");
  assert.equal(g.searchParams.get("to"), "a@b.fi");
});

test("calendar links handle all-day and timed events", () => {
  const d = new URL(calendarUrl({ label: "Deadline", start: "2026-11-30" }));
  assert.equal(d.searchParams.get("dates"), "20261130/20261201");
  const t = new URL(calendarUrl({ label: "Sauna", start: "2026-11-14T18:00", end: "2026-11-14T20:00", location: "Löyly" }));
  assert.equal(t.searchParams.get("dates"), "20261114T180000/20261114T200000");
  assert.equal(t.searchParams.get("location"), "Löyly");
  assert.equal(calendarUrl({ label: "x", start: "next week" }), null);
  const e = new URL(calendarUrl({ label: "x", start: "2026-12-31" }));
  assert.equal(e.searchParams.get("dates"), "20261231/20270101");
});

test("sources are numbered once and mapped to fields, including nested paths", () => {
  const grounding = [
    { field: "answer", citations: [{ url: "https://europa.eu/a", title: "Air passenger rights" }, { url: "https://finnair.com/claim" }], confidence: "high" },
    { field: "steps.1.detail", citations: [{ url: "https://finnair.com/claim" }], confidence: "low" },
    { field: "key_facts[0].value", citations: [{ url: "javascript:alert(1)" }] },
  ];
  const m = numberSources(grounding);
  assert.equal(m.sources.length, 2);
  assert.equal(m.sources[1].host, "finnair.com");
  assert.deepEqual(citesFor(m.byField, "answer").nums, [1, 2]);
  const s1 = citesFor(m.byField, "steps[1]");
  assert.deepEqual(s1.nums, [2]);
  assert.equal(s1.confidence, "low");
  assert.deepEqual(citesFor(m.byField, "key_facts[0]").nums, []);
  assert.deepEqual(citesFor(m.byField, "steps[10]").nums, []);
});

test("actions resolve to safe links and report missing details", () => {
  const p = { name: "Aino" };
  const r = resolveAction({ type: "email", label: "Send claim", to: "claims@x.fi", subject: "Claim", body: "{{name}}, booking {{booking_reference}}" }, p);
  assert.equal(r.kind, "email");
  assert.deepEqual(r.missing, ["booking_reference"]);
  assert.ok(r.gmail.includes("Aino"));
  assert.equal(resolveAction({ type: "open_link", label: "Open", url: "javascript:alert(1)" }, p).url, null);
  assert.equal(resolveAction({ type: "phone_call", label: "Call", to: "+358 (9) 123 456" }, p).url, "tel:+3589123456");
  assert.equal(safeHttpUrl("https://kela.fi/x"), "https://kela.fi/x");
});
