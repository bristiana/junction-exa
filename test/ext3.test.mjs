import { test } from "node:test";
import assert from "node:assert/strict";
import { isLinkSender, linkCodeInput, codeCountdown, linkError } from "../extension/lib/device-link.js";
import { exaActivity } from "../extension/lib/exa-activity.js";
import { createClient, toLocalTask } from "../extension/lib/backend.js";

test("account linking accepts only the extension's own pages", () => {
  assert.equal(isLinkSender({ id: "extension" }, "extension"), true);
  for (const sender of [undefined, {}, { id: "other" }, { id: "extension", tab: { id: 1 } }, { id: "extension", tab: {} }]) {
    assert.equal(isLinkSender(sender, "extension"), false);
  }
  assert.equal(isLinkSender({}, undefined), false);
});

test("device codes keep leading zeroes and reject malformed input", () => {
  assert.equal(linkCodeInput(" 001234 "), "001234");
  for (const input of ["", "12345", "1234567", "12 345", "abcdef"]) assert.throws(() => linkCodeInput(input), /6-digit/);
});

test("code countdown rounds up and removes expired codes", () => {
  assert.equal(codeCountdown(61000, 0), "Expires in 1:01");
  assert.equal(codeCountdown(1001, 1), "Expires in 0:01");
  for (const until of [0, -1, NaN]) assert.match(codeCountdown(until, 0), /expired/);
});

test("link errors explain invalid codes, limits and connection failures", () => {
  for (const status of [400, 404, 410, 422]) assert.match(linkError({ status }), /wrong or expired/);
  assert.match(linkError({ status: 429 }), /Wait/);
  assert.equal(linkError(new Error("Can’t reach Vali")), "Can’t reach Vali");
});

test("link endpoints send the proper auth and preserve the code", async () => {
  const calls = [];
  const client = createClient({ baseUrl: "https://vali.example", token: "browser-token", fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    return new Response(JSON.stringify(url.endsWith("/code") ? { code: "001234", expires_in: 60 } : { token: "mac-token" }));
  } });
  assert.equal((await client.linkCode()).code, "001234");
  assert.equal((await client.redeemLink("001234")).token, "mac-token");
  assert.equal(calls[0].headers.Authorization, "Bearer browser-token");
  assert.equal(calls[1].headers.Authorization, undefined);
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(JSON.parse(calls[1].body), { code: "001234" });
});

test("Exa evidence merges research and execution, deduplicates and filters unsafe URLs", () => {
  const t = toLocalTask({ id: "t", mode: "claim", research: { kind: "agent", sources: [{ url: "https://kela.fi/rules#part" }], output: {
    grounding: [{ citations: [{ url: "https://kela.fi/rules", title: "Rules" }, { url: "javascript:alert(1)" }] }],
    citations: ["https://europa.eu/"] } }, execution: { sources: [{ url: "https://www.hel.fi/", title: "Helsinki" }], usage: { exa_searches: 3, exa_reads: 2 } } });
  const view = exaActivity(t);
  assert.equal(view.sources.length, 3);
  assert.equal(view.sources[2].host, "hel.fi");
  assert.match(view.summary, /3 searches.*2 page reads.*3 sources/);
  assert.match(view.method, /Exa research/);
});

test("Exa counts never infer missing calls from cost or source totals", () => {
  const view = exaActivity({ mode: "execute", execution: { usage: { exa_cost_usd: 0.04, exa_searches: -1, exa_reads: "2" } } });
  assert.equal(view.summary, "Exa: 0 sources");
  assert.match(view.note, /not returned/);
  assert.match(view.method, /while filling/);
  assert.match(exaActivity({ mode: "find" }).method, /Exa search/);
  assert.match(exaActivity({ execution: { usage: { exa: { searches: 0, contents: 1 } } } }).summary, /0 searches.*1 page read/);
});

test("Exa form filling counts note is limited to execute errands with counts", () => {
  const execution = { usage: { exa_searches: 0 } };
  assert.match(exaActivity({ mode: "execute", execution }).note, /^Counts cover form filling/);
  for (const mode of ["find", "check", "claim", "write", undefined]) {
    assert.equal(exaActivity({ mode, execution }).note, "");
    assert.equal(exaActivity({ mode }).note, "Exa call counts were not returned.");
  }
  assert.equal(exaActivity({ mode: "execute" }).note, "Exa call counts were not returned.");
});

test("Exa activity lists the queries research ran, without turning them into a count", () => {
  const view = exaActivity({ mode: "claim", progress: [{ kind: "search", text: "EU261 delay" }, { kind: "source", text: "Finnair" }, { kind: "search", text: "EU261 delay" }, { kind: "search" }] });
  assert.deepEqual(view.queries, ["EU261 delay"]);
  assert.equal(view.summary, "Exa: 0 sources");
  assert.equal(view.note, "");
});

test("Exa source lists ignore non-arrays and malformed grounding entries", () => {
  for (const value of [null, {}, "https://example.com/", 42, true]) {
    assert.deepEqual(exaActivity({ output: { grounding: value, sources: value, citations: value },
      research: { sources: value, citations: value }, execution: { sources: value } }).sources, []);
    assert.deepEqual(exaActivity({ output: { grounding: [null, {}, { citations: value }] } }).sources, []);
  }
  assert.deepEqual(exaActivity({ output: { grounding: [null, { citations: {} }], sources: {} },
    research: { citations: ["https://example.com/"] } }).sources,
  [{ url: "https://example.com/", title: "example.com", host: "example.com" }]);
});
