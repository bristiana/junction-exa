import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// content/presence.js is a classic content script. Outside a page it only defines its rules and stops.
const src = readFileSync(new URL("../extension/content/presence.js", import.meta.url), "utf8");
const ctx = vm.createContext({});
vm.runInContext(src, ctx);
const { blockedHost, formWords } = ctx.__valiPresence;

test("never on search, mail, chat, payment or bank sites", () => {
  for (const h of ["www.google.com", "google.com", "mail.google.com", "docs.google.com", "www.google.fi", "chromewebstore.google.com",
    "outlook.live.com", "web.whatsapp.com", "app.slack.com", "mail.example.fi", "chatgpt.com",
    "www.op.fi", "op.fi", "www.nordea.fi", "netbank.nordea.fi", "danskebank.fi", "www.s-pankki.fi", "aktia.fi",
    "www.saastopankki.fi", "omasp.fi", "www.handelsbanken.fi", "tunnistus.suomi.fi", "www.paytrail.com", ""]) {
    assert.equal(blockedHost(h), true, h);
  }
});

test("allowed on ordinary sites, including ones that only end like a bank", () => {
  for (const h of ["www.kela.fi", "www.finnair.com", "dvv.fi", "www.hel.fi", "hop.fi", "example.com", "www.posti.fi", "localhost"]) {
    assert.equal(blockedHost(h), false, h);
  }
});

test("claim, application, booking, registration and complaint pages, in English and Finnish", () => {
  for (const s of [
    "/fi-en/claims/flight-delay Finnair",
    "Apply for student financial aid",
    "Refund request | HSL",
    "Online booking – Löyly",
    "Table reservation",
    "Register for the course",
    "Registration form",
    "Make a complaint",
    "Compensation for delays",
    "Asumistukihakemus",
    "Korvaushakemus | Kela",
    "Hae korvausta",
    "Varauksen tiedot",
    "Ilmoittautuminen kurssille",
    "Muuttoilmoitus | Posti",
    "Anna palautetta",
  ]) {
    assert.equal(formWords(s), true, s);
  }
});

test("ordinary pages do not look like forms", () => {
  for (const s of ["Kela – Opiskelijan tuet", "Apple MacBook Air", "Helsinki weather", "/news/2026/11/14", "Uutiset", ""]) {
    assert.equal(formWords(s), false, s);
  }
});
