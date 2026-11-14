import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askQuestion, askPage, firstSentences, topSource, askView } from "../extension/lib/ask.js";

test("only the typed question, one line and clipped", () => {
  assert.equal(askQuestion("  how much   does it\ncost? "), "how much does it cost?");
  assert.equal(askQuestion(" "), "");
  assert.equal(askQuestion("x"), "");
  assert.equal(askQuestion("a".repeat(900)).length, 500);
});

test("the page goes as its address only, without query or fragment", () => {
  assert.deepEqual(askPage("https://migri.fi/en/extended-permit-for-studies?email=a@b.fi#x"), { url: "https://migri.fi/en/extended-permit-for-studies" });
  assert.equal(askPage("chrome://settings"), null);
  assert.equal(askPage(""), null);
});

test("the bubble shows the first two sentences, without citation markers", () => {
  const a = "The fee is €350 online [1]. On paper it is €450, e.g. at a service point [2]. Processing takes 2 months.";
  assert.equal(firstSentences(a), "The fee is €350 online. On paper it is €450, e.g. at a service point.");
  assert.equal(firstSentences("A ticket costs 3.20 eur. **Buy** it in the app."), "A ticket costs 3.20 eur. Buy it in the app.");
  assert.ok(firstSentences("word ".repeat(200)).length <= 280);
  assert.equal(firstSentences(""), "");
});

test("the top source is the first claim's source, then verified sources, then grounding", () => {
  const sources = [{ n: 1, url: "https://www.kela.fi/a" }, { n: 2, url: "https://migri.fi/fees" }];
  assert.deepEqual(topSource({ claims: [{ text: "x", sources: [] }, { text: "y", sources: [2] }], sources }), { url: "https://migri.fi/fees", domain: "migri.fi" });
  assert.deepEqual(topSource({ sources }), { url: "https://www.kela.fi/a", domain: "kela.fi" });
  assert.deepEqual(topSource({ grounding: [{ field: "answer", citations: [{ url: "https://hsl.fi/t" }] }] }), { url: "https://hsl.fi/t", domain: "hsl.fi" });
  assert.equal(topSource({ sources: [{ url: "javascript:alert(1)" }] }), null);
  assert.equal(topSource(null), null);
});

test("states: thinking, searching, done, failed", () => {
  assert.equal(askView({ id: "a", status: "queued" }).state, "thinking");
  assert.equal(askView({ id: "a", status: "running" }).state, "searching");
  const done = askView({ id: "a", status: "completed", output: { structured: { answer: "It costs €350. Pay online. More." }, sources: [{ n: 1, url: "https://migri.fi/x" }] } });
  assert.deepEqual(done, { id: "a", state: "done", text: "It costs €350. Pay online.", source: { url: "https://migri.fi/x", domain: "migri.fi" } });
  assert.equal(askView({ id: "a", status: "completed", output: { text: "" } }).state, "failed");
  assert.equal(askView({ id: "a", status: "failed", error: "boom" }).error, "boom");
  assert.equal(askView(null).state, "failed");
});

test("the ask sends nothing from the page but the question and the address", () => {
  const bg = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
  const ask = bg.slice(bg.indexOf("async function askFromPage"), bg.indexOf("const lastRefresh"));
  assert.match(ask, /pageOnly: askPage\(/);
  assert.doesNotMatch(ask, /usePage|selection|capturePage/);
  const presence = readFileSync(new URL("../extension/content/presence.js", import.meta.url), "utf8");
  assert.match(presence, /send\(\{ type: "ask", question \}\)/);
});
