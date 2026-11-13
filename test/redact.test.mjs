import { test } from "node:test";
import assert from "node:assert/strict";
import { redactText, visibleText, createRedactor } from "../extension/lib/redact.js";
import { capturePage, pageRedactor } from "../extension/lib/page-scripts.js";

// All personal data here is fake. 131052-308T is the documented sample henkilötunnus.
const REDACT = [
  ["Contact: test@example.com", "Contact: [email]"],
  ["Write to test.person+claims@example.com today", "Write to [email] today"],
  ["Henkilötunnus 131052-308T", "Henkilötunnus [id-code]"],
  ["HETU 131052A308T.", "HETU [id-code]."],
  ["IBAN FI21 1234 5600 0007 85", "IBAN [iban]"],
  ["FI2112345600000785", "[iban]"],
  ["IBAN DE89 3704 0044 0532 0130 00", "IBAN [iban]"],
  ["Tilisiirto FI21 1234 5600 0007 85 EUR", "Tilisiirto [iban] EUR"],
  ["Card 4111 1111 1111 1111", "Card [card]"],
  ["Card 4111-1111-1111-1111", "Card [card]"],
  ["4111111111111111", "[card]"],
  ["Amex 3782 822463 10005", "Amex [card]"],
  ["Name: Test Person", "Name: [name]"],
  ["Full name: Test Person", "Full name: [name]"],
  ["Nimi: Test Person", "Nimi: [name]"],
  ["Etunimi: Test", "Etunimi: [name]"],
  ["Sukunimi: Person", "Sukunimi: [name]"],
  ["Osoite: Testikatu 1 A 2, 00100 Helsinki", "Osoite: [address]"],
  ["Puhelin: 040 123 4567", "Puhelin: [phone]"],
  ["Sähköposti: test@example.com", "Sähköposti: [email]"],
  ["Henkilötunnus: 131052-308T", "Henkilötunnus: [id-code]"],
  ["Date of birth: 13.10.1952", "Date of birth: [birth-date]"],
  ["Syntymäaika: 13.10.1952", "Syntymäaika: [birth-date]"],
  ["Name\nTest Person\nEmail\ntest@example.com", "Name\n[name]\nEmail\n[email]"],
  ["Vastaanottaja\nTest Person\nOsoite\nTestikatu 1", "Vastaanottaja\n[name]\nOsoite\n[address]"],
  ["Testikatu 1 A 2", "[address]"],
  ["Mannerheimintie 12 B 34, 00100 Helsinki", "[address]"],
  ["Esimerkkikuja 3", "[address]"],
  ["Testipolku 5 as 7", "[address]"],
  ["Länsiväylä 10, 02160 Espoo", "[address]"],
  ["Toimitus: Testitie 4, 33100 Tampere", "Toimitus: [address]"],
  ["02150 Espoo", "[address]"],
  ["Kela, PL 450, 00056 KELA", "Kela, PL 450, [address]"],
  ["10 Downing Street", "[address]"],
];

const PHONES = [
  "+358 40 123 4567", "+358401234567", "+358 (0)40 123 4567", "00358 40 123 4567",
  "040 123 4567", "040-1234567", "0401234567", "044 123 4567", "045 1234 567", "050 123 45 67",
  "09 123 4567", "(09) 123 4567", "09-1234567", "014 123 456",
  "+44 20 7946 0958", "+46 8 123 456 78", "+1 (415) 555-0100",
];

const KEEP = [
  "Hinta 1 299,00 €",
  "Total: 1 299,00 €",
  "Yhteensä 1 299,00 € (sis. ALV 24 %)",
  "Päivämäärä 14.11.2026",
  "Deadline 14.11.2026 at 23:59",
  "Since 2019, updated 2026",
  "Order 12345678",
  "Tilausnumero 1234567",
  "Order #654321",
  "Tilausnumero 04412345",
  "Open 9-17",
  "Avoinna ma–pe 9.00–17.00, la 10–14",
  "Klo 08.00-16.00",
  "Take tram 4 along Mannerheimintie to the station.",
  "The office moved from Hämeentie to Mannerheimintie.",
  "Event on Mannerheimintie 14.11.2026",
  "Customer service: open 9-16",
  "Your name will appear on the card.",
  "Y-tunnus 1234567-8",
  "Card 4111 1111 1111 1112", // fails the Luhn check
  "131052-308A", // wrong check character
  "Sauna for 8 people, 25 € per person",
  "Flight AY123 landed 4 hours late",
];

test("redacts emails, ids, IBANs, cards, labelled values and addresses", () => {
  for (const [input, want] of REDACT) assert.equal(redactText(input), want, input);
});

test("redacts Finnish and international phone numbers", () => {
  for (const p of PHONES) assert.equal(redactText("Tel: " + p), "Tel: [phone]", p);
  assert.equal(redactText("Soita 040 123 4567 tai 09 123 4567."), "Soita [phone] tai [phone].");
});

test("keeps prices, dates, years, order numbers, opening hours and street names in prose", () => {
  for (const s of KEEP) assert.equal(redactText(s), s, s);
});

test("redaction is idempotent and handles empty input", () => {
  assert.equal(redactText(null), "");
  assert.equal(redactText(""), "");
  for (const [input] of REDACT) assert.equal(redactText(redactText(input)), redactText(input), input);
});

// Fake DOM for visibleText: element nodes with localName / childNodes / attributes, text nodes with nodeValue.
function txt(s) {
  return { nodeType: 3, nodeValue: s };
}
function el(tag, attrs, ...children) {
  const a = attrs || {};
  return {
    nodeType: 1,
    localName: tag,
    hidden: !!a.hidden,
    isContentEditable: a.contenteditable === "true",
    getAttribute: (n) => (n in a ? String(a[n]) : null),
    childNodes: children.map((c) => (typeof c === "string" ? txt(c) : c)),
  };
}
function formPage() {
  const input = el("input", { value: "Test Person" });
  input.value = "Test Person";
  return el("main", null,
    el("h1", null, "Muuttoilmoitus"),
    el("p", null, "Hinta 1 299,00 €, due 14.11.2026"),
    el("label", null, "Nimi", input),
    el("textarea", null, "Testikatu 1 A 2"),
    el("select", null, el("option", null, "Espoo")),
    el("script", null, "var token = 'x';"),
    el("style", null, ".a{}"),
    el("div", { hidden: true }, "piilotettu 999 €"),
    el("div", { "aria-hidden": "true" }, "koriste"),
    el("div", { contenteditable: "true" }, "private notes"),
    el("p", null, "Contact: test@example.com, +358401234567"),
    el("dl", null, el("dt", null, "Name"), el("dd", null, "Test Person"), el("dt", null, "Status"), el("dd", null, "Sent")),
    el("p", null, el("b", null, "Open"), " ", el("i", null, "9-17")));
}

test("visibleText skips form fields, scripts, hidden and editable parts, and redacts", () => {
  const out = visibleText(formPage());
  assert.match(out, /Muuttoilmoitus/);
  assert.match(out, /Hinta 1 299,00 €, due 14\.11\.2026/);
  assert.match(out, /Contact: \[email\], \[phone\]/);
  assert.match(out, /Name\n\[name\]\nStatus\nSent/);
  assert.match(out, /Open 9-17/);
  for (const bad of ["Test Person", "Testikatu", "Espoo", "token", "piilotettu", "koriste", "private notes", "test@example.com"]) {
    assert.ok(!out.includes(bad), bad);
  }
});

test("visibleText respects maxChars", () => {
  const root = el("div", null, ...Array.from({ length: 50 }, (_, i) => el("p", null, "Rivi numero " + i + " jossa on aika pitkä teksti")));
  assert.ok(visibleText(root, 200).length <= 200);
  assert.equal(visibleText(null), "");
});

test("capturePage carries a verbatim copy of createRedactor", () => {
  const norm = (s) => s.replace(/\s+/g, " ");
  assert.ok(norm(capturePage.toString()).includes(norm(createRedactor.toString())), "lib/page-scripts.js capturePage() is out of sync with lib/redact.js");
});

test("the in-page redactor gives the same output as lib/redact.js", () => {
  const inPage = pageRedactor();
  const samples = [...REDACT.map(([s]) => s), ...PHONES.map((p) => "Tel: " + p), ...KEEP];
  for (const s of samples) assert.equal(inPage.redactText(s), redactText(s), s);
  assert.equal(inPage.visibleText(formPage()), visibleText(formPage()));
  assert.equal(inPage.visibleText(formPage(), 40), visibleText(formPage(), 40));
});
