import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { exaUses, EXA_USES } from "../shared/exa-uses.js";
import { toLocalTask } from "../extension/lib/backend.js";

const rows = (task) => Object.fromEntries(exaUses(task).map((r) => [r.key, `${r.label}: ${r.detail}`]));
const read = (url) => ({ t: 2, kind: "read", text: new URL(url).hostname, url });
const think = (text) => ({ t: 0, kind: "think", text });
// What citations.cite leaves on the output: judged claims (true/false), Vali's own lines, quoted sources.
const checked = {
  claims: [{ text: "a", sources: [1], supported: true }, { text: "b", sources: [1], supported: true },
    { text: "c", sources: [], supported: false }, { text: "I will watch for x.", sources: [], supported: null, own: true }],
  sources: [{ n: 1, url: "https://kela.fi/a", quote: "a." }, { n: 2, url: "https://vero.fi/b" }],
};

test("a find errand shows its search and the quote check", () => {
  const task = { mode: "find", research: { kind: "search", status: "completed", output: checked, activity: [
    think("Planning a find errand"), { t: 0, kind: "search", text: "public sauna Helsinki" },
    read("https://a.fi/1"), read("https://b.fi/2"), read("https://c.fi/3"), think("Checking 3 cited pages"), { t: 4, kind: "done", text: "Answer ready" }] } };
  assert.deepEqual(rows(task), { search: "Search: 1 query, 3 results", contents: "Contents: 2 of 3 sentences quoted" });
});

test("a check errand counts the Exa Agent's searches and pages from the live trail", () => {
  const activity = [think("Planning a check errand"), ...["EU261 delay", "Finnair compensation"].map((text) => ({ t: 1, kind: "search", text })),
    read("https://finnair.com/a"), read("https://europa.eu/b"), read("https://kkv.fi/c"), think("Research finished")];
  const task = { mode: "check", research: { kind: "agent", status: "completed", run_id: "r1", output: checked, activity } };
  assert.deepEqual(rows(task), { agent: "Agent research: 2 searches, 3 pages", contents: "Contents: 2 of 3 sentences quoted" });
});

test("a watch errand shows the monitor and today's search", () => {
  const research = { kind: "monitor", status: "completed", watch_id: "w_1", monitor_stubbed: false, output: checked,
    activity: [think("Planning a watch errand"), { t: 0, kind: "search", text: "HSL strike" }, read("https://hsl.fi/a")] };
  assert.deepEqual(rows({ mode: "watch", research }), { search: "Search: 1 query, 1 result", monitor: "Monitor: webhook on",
    contents: "Contents: 2 of 3 sentences quoted" });
  // Saved without a live monitor (no public URL or no slot): said plainly; a failed find adds no search row.
  const stubbed = { ...research, monitor_stubbed: true, output: { text: "I saved a watch", grounding: [] }, activity: [think("Planning")] };
  assert.deepEqual(rows({ research: stubbed }), { monitor: "Monitor: saved, not live" });
});

test("the cloud browser's Exa calls while filling the form are counted", () => {
  const execution = { status: "done", exa: [{ kind: "search", query: "q", results: [] }, { kind: "search", query: "r", error: "x" },
    { kind: "read", url: "https://migri.fi/x", results: [] }, { kind: "other" }] };
  assert.equal(rows({ execution }).fill, "Form fill: 2 searches, 1 page read");
  assert.equal(rows({ execution: { exa: [{ kind: "read", url: "https://a.fi" }] } }).fill, "Form fill: 1 page read");
});

test("only what happened is listed", () => {
  for (const task of [null, undefined, {}, { research: {} }, { research: { kind: "search", activity: "x" } },
    { research: { kind: "search", activity: [think("Planning")] } }, { research: { kind: "monitor" } }, { execution: { exa: {} } }]) {
    assert.deepEqual(exaUses(task), []);
  }
  // An unchecked answer (quote check failed or skipped): support null, no quotes, so no Contents row.
  const unchecked = { claims: [{ text: "a", sources: [1], supported: null }], sources: [{ n: 1, url: "https://kela.fi" }] };
  assert.equal(rows({ research: { kind: "search", output: unchecked } }).contents, undefined);
  // The word-overlap fallback still read the pages and kept their quotes.
  assert.equal(rows({ research: { kind: "search", output: { ...unchecked, sources: [{ quote: "q" }] } } }).contents, "Contents: 1 quote found");
});

test("reused research made no new Exa calls; agent runs without a trail fall back to cited pages", () => {
  const reused = { kind: "agent", reused_from: "2026-11-14T10:00:00Z", output: checked, activity: [think("Same question answered 4 min ago")] };
  assert.deepEqual(rows({ research: reused }), { reuse: "Reuse: earlier answer, no new calls" });
  const grounding = [{ field: "answer", citations: [{ url: "https://a.fi" }, { url: "https://b.fi" }] }, { citations: [{ url: "https://a.fi" }] }];
  assert.equal(rows({ runId: "r1", output: { grounding } }).agent, "Agent research: 2 pages cited"); // extension direct mode
  assert.equal(rows({ research: { kind: "agent", run_id: "r1" } }).agent, "Agent research: 1 run");
});

test("the extension's local task keeps what the rows need", () => {
  const remote = { id: "t_1", task: "Watch HSL strikes", mode: "watch", created_at: "2026-11-14T10:00:00Z", updated_at: "2026-11-14T10:00:05Z",
    research: { kind: "monitor", status: "completed", watch_id: "w_1", monitor_stubbed: false, output: checked,
      activity: [think("Planning"), { t: 0, kind: "search", text: "HSL strike" }, read("https://hsl.fi/a")] },
    execution: { exa: [{ kind: "search", query: "q" }] } };
  assert.deepEqual(exaUses(toLocalTask(remote)), exaUses(remote));
  assert.equal(exaUses(remote).length, 4);
});

test("the static list is short plain labels, and every copy matches shared/", async () => {
  assert.ok(EXA_USES.length >= 6 && EXA_USES.length <= 7);
  for (const [label, detail] of EXA_USES) assert.ok(label.split(" ").length <= 3 && detail.split(" ").length <= 4 && !/[?!]/.test(label + detail));
  const source = await readFile(new URL("../shared/exa-uses.js", import.meta.url), "utf8");
  for (const copy of ["../extension/shared/exa-uses.js", "../web/exa-uses.js"]) {
    assert.equal(await readFile(new URL(copy, import.meta.url), "utf8"), source, `${copy} is stale: run npm run sync-shared`);
  }
});
