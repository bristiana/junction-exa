import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { cacheKey, helpfulPage, companionPayload, cleanTip, cachedEntry, remember, TIP_TTL_MS, RETRY_MS } from "../extension/lib/companion.js";

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL("../extension/content/presence.js", import.meta.url), "utf8"), ctx);
const { blockedHost } = ctx.__valiPresence;
// A tip is asked only where the content script runs (not blocked) and the page is one where Vali helps.
const qualifies = (url, title = "") => !blockedHost(new URL(url).hostname) && helpfulPage(url, title);

test("tips on public services, studying, housing, travel, shops and bookings", () => {
  for (const url of [
    "https://www.kela.fi/students-in-higher-education", "https://dvv.fi/en/moving-in-finland", "https://www.vr.fi/en/compensation",
    "https://migri.fi/en/residence-permit", "https://www.vero.fi/en/individuals/", "https://www.helsinki.fi/en/admissions",
    "https://www.hoas.fi/en/", "https://www.hsl.fi/en/tickets-and-fares", "https://www.verkkokauppa.com/fi/product/1",
    "https://www.uscis.gov/forms", "https://www.ox.ac.uk/admissions", "https://kurssit.example.fi/ilmoittautuminen",
  ]) assert.equal(qualifies(url), true, url);
  assert.equal(qualifies("https://example.com/news", "Apply for a parking permit"), true);
});

test("no tips on search, mail, chat, banks or ordinary pages", () => {
  for (const url of [
    "https://www.google.com/search?q=kela", "https://duckduckgo.com/?q=kela", "https://mail.google.com/mail/u/0/",
    "https://outlook.live.com/mail/", "https://web.whatsapp.com/", "https://app.slack.com/client", "https://chatgpt.com/",
    "https://www.op.fi/henkiloasiakkaat", "https://www.nordea.fi/en/personal/", "https://tunnistus.suomi.fi/",
    "https://www.paypal.com/fi/home", "https://example.com/blog/cats", "https://news.ycombinator.com/",
  ]) assert.equal(qualifies(url), false, url);
  assert.equal(helpfulPage("chrome://settings", "Apply"), false);
});

test("the server gets only address, title, headings, language and selection, redacted", () => {
  const raw = {
    url: "https://www.kela.fi/apply?email=aino%40example.com#form",
    title: "Apply | Kela",
    headings: Array.from({ length: 20 }, (_, i) => (i === 0 ? "Questions? Mail aino@example.com" : `Heading ${i}`)),
    lang: "EN",
    selection: "Call me on 040 123 4567",
    cookies: "session=1",
    fields: [{ value: "secret" }],
    text: "page body",
  };
  const out = companionPayload(raw);
  assert.deepEqual(Object.keys(out).sort(), ["headings", "lang", "selection", "title", "url"]);
  assert.equal(out.url, "https://www.kela.fi/apply");
  assert.equal(out.headings.length, 12);
  assert.equal(out.headings[0], "Questions? Mail [email]");
  assert.equal(out.selection, "Call me on [phone]");
  assert.equal(out.lang, "en");
  assert.equal("selection" in companionPayload({ ...raw, selection: "" }), false);
  assert.equal(companionPayload({ url: "file:///Users/me/a.pdf" }), null);
});

test("tips from the server are checked before they reach the page", () => {
  const tip = cleanTip({
    text: "  You can apply for the housing supplement online.  ",
    sources: [
      { url: "javascript:alert(1)", title: "x" },
      { url: "https://www.kela.fi/housing", title: "Housing" },
      { url: "https://kela.fi/a" }, { url: "https://migri.fi/b" }, { url: "https://vero.fi/c" }, { url: "https://dvv.fi/d" },
    ],
    action: { label: "", task: "Apply for the Kela housing supplement" },
  });
  assert.equal(tip.text, "You can apply for the housing supplement online.");
  assert.deepEqual(tip.sources.map((s) => s.domain), ["kela.fi", "migri.fi", "vero.fi"]);
  assert.deepEqual(tip.action, { label: "Do it", task: "Apply for the Kela housing supplement" });
  assert.equal(cleanTip({ text: "Hi", sources: [] }).action, null);
  for (const t of [null, undefined, {}, { text: "  " }]) assert.equal(cleanTip(t), null);
});

test("one request per URL per 6 hours; failures are asked again after 15 minutes", () => {
  const t0 = 1_000_000_000;
  let cache = remember({}, "https://kela.fi/a", { tip: null }, t0);
  cache = remember(cache, "https://kela.fi/b", { tip: null, failed: true }, t0);
  assert.ok(cachedEntry(cache, "https://kela.fi/a", t0 + TIP_TTL_MS - 1));
  assert.equal(cachedEntry(cache, "https://kela.fi/a", t0 + TIP_TTL_MS), null);
  assert.ok(cachedEntry(cache, "https://kela.fi/b", t0 + RETRY_MS - 1));
  assert.equal(cachedEntry(cache, "https://kela.fi/b", t0 + RETRY_MS), null);
  // expired entries go when another page is remembered
  cache = remember(cache, "https://kela.fi/c", { tip: null }, t0 + RETRY_MS);
  assert.deepEqual(Object.keys(cache).sort(), ["https://kela.fi/a", "https://kela.fi/c"]);
  assert.equal(cacheKey("https://kela.fi/a?x=1#y"), "https://kela.fi/a");
});
