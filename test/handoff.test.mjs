import { test } from "node:test";
import assert from "node:assert/strict";
import { cookieDetails, continueInBrowser } from "../extension/lib/handoff.js";
import { createClient } from "../extension/lib/backend.js";

const NOW = 1_800_000_000;

test("a Playwright cookie becomes chrome.cookies.set details with its flags kept", () => {
  assert.deepEqual(cookieDetails({ name: "cart", value: "abc", domain: ".gilda.fi", path: "/checkout", expires: NOW + 600,
    httpOnly: true, secure: true, sameSite: "Lax" }, NOW), {
    url: "https://gilda.fi/checkout", name: "cart", value: "abc", path: "/checkout", secure: true, httpOnly: true,
    sameSite: "lax", domain: ".gilda.fi", expirationDate: NOW + 600 });
  // host-only and a session cookie: no domain, no expiry
  const host = cookieDetails({ name: "__Host-s", value: "x", domain: "www.gilda.fi", path: "/", expires: -1, httpOnly: false,
    secure: true, sameSite: "Strict" }, NOW);
  assert.equal(host.url, "https://www.gilda.fi/");
  assert.equal("domain" in host, false);
  assert.equal("expirationDate" in host, false);
  assert.equal(host.sameSite, "strict");
  // SameSite=None without Secure is refused by Chrome, so it falls back
  assert.equal(cookieDetails({ name: "a", value: "1", domain: "x.fi", sameSite: "None", secure: false }, NOW).sameSite, "unspecified");
  assert.equal(cookieDetails({ name: "a", value: "1", domain: "x.fi", sameSite: "None", secure: false }, NOW).url, "http://x.fi/");
  assert.equal(cookieDetails({ name: "old", value: "1", domain: "x.fi", expires: NOW - 1 }, NOW), null);
  assert.equal(cookieDetails({ name: "", value: "1", domain: "x.fi" }, NOW), null);
});

test("continue in my browser sets the cookies, opens the page, and never returns the values", async () => {
  const set = [];
  const opened = [];
  const logged = [];
  const log = console.log;
  console.log = (...a) => logged.push(a);
  try {
    const out = await continueInBrowser({ url: "https://www.gilda.fi/checkout/123", cookies: [
      { name: "cart", value: "SECRET-1", domain: ".gilda.fi", path: "/", expires: -1, secure: true, sameSite: "Lax" },
      { name: "bad", value: "SECRET-2", domain: "www.gilda.fi", path: "/" },
    ] }, {
      setCookie: async (d) => { if (d.name === "bad") throw new Error("refused"); set.push(d); return d; },
      openTab: async (o) => opened.push(o.url),
    });
    assert.deepEqual(out, { set: 1 });
    assert.equal(JSON.stringify(out).includes("SECRET"), false);
  } finally {
    console.log = log;
  }
  assert.equal(set.length, 1);
  assert.equal(set[0].value, "SECRET-1");
  assert.deepEqual(opened, ["https://www.gilda.fi/checkout/123"]);
  assert.equal(logged.length, 0);
  await assert.rejects(continueInBrowser({ url: "javascript:alert(1)", cookies: [] }, { setCookie: async () => {}, openTab: async () => {} }));
});

test("the client posts to the hand-off route", async () => {
  const calls = [];
  const client = createClient({ baseUrl: "https://vali.test", token: "tok", fetchImpl: async (url, opts) => {
    calls.push([url, opts.method]);
    return new Response(JSON.stringify({ url: "https://x.fi/", cookies: [] }), { status: 200 });
  } });
  assert.deepEqual(await client.handoff("t_1"), { url: "https://x.fi/", cookies: [] });
  assert.deepEqual(calls, [["https://vali.test/v1/tasks/t_1/handoff", "POST"]]);
});
