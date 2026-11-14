import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { samePage, PAGE_CHANGED } from "../extension/lib/fill-here.js";
import { fillPage } from "../extension/lib/page-scripts.js";
import { createClient, backendPage } from "../extension/lib/backend.js";

test("a fill goes only to the page the user chose", () => {
  const form = "https://httpbin.org/forms/post";
  assert.equal(samePage(form, "https://httpbin.org/forms/post?x=1#top"), true);
  for (const other of ["https://httpbin.org/post", "https://evil.example/forms/post", "http://httpbin.org/forms/post", "about:blank", "", undefined]) {
    assert.equal(samePage(other, form), false, String(other));
  }
  assert.equal(samePage("chrome://settings", "chrome://settings"), false);
});

test("fillPage refuses in a document that is not the chosen page, before touching anything", () => {
  const saved = globalThis.location;
  globalThis.location = { origin: "https://httpbin.org", pathname: "/post" }; // the form was submitted or navigated away
  try {
    assert.deepEqual(fillPage([{ field_id: "h1", value: "Aino Virtanen" }], "https://httpbin.org/forms/post"), { filled: 0, skipped: [], error: PAGE_CHANGED });
    assert.equal(fillPage([], undefined).error, PAGE_CHANGED);
  } finally {
    globalThis.location = saved;
  }
});

test("the profile reaches the server only inside the execute body", async () => {
  const bodies = [];
  const client = createClient({ baseUrl: "https://vali.example", token: "t", fetchImpl: async (url, init) => {
    bodies.push({ url, body: init.body || "" });
    return new Response("{}");
  } });
  assert.equal("syncProfile" in client, false);
  const profile = { name: "Aino Virtanen", email: "test@example.com" };
  const page = backendPage({ url: "https://kela.fi/a", title: "Apply", text: "", fields: [{ id: "h1", label: "Email", type: "email", filled: true, hint: "email custemail" }] });
  await client.createTask({ task: "Apply", page });
  await client.companion({ url: "https://kela.fi/a", title: "Apply", headings: [], lang: "en" });
  await client.execute("t1", { start_url: "https://httpbin.org/forms/post", goal: "Fill it", profile });
  const leaks = bodies.filter((b) => /Aino|test@example\.com|custemail|"filled"/.test(b.body));
  assert.deepEqual(leaks.map((b) => new URL(b.url).pathname), ["/v1/tasks/t1/execute"]);
});

test("no script that runs in a page reads field values into what it sends", () => {
  for (const f of ["content/presence.js", "content/explain.js"]) {
    const src = readFileSync(new URL(`../extension/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\.value\b/, f);
  }
  const capture = readFileSync(new URL("../extension/lib/page-scripts.js", import.meta.url), "utf8").split("export function pageRedactor")[0];
  assert.deepEqual(capture.match(/el\.value\b[^;]*/g), ['el.value && type !== "checkbox") f.filled = true']);
});
