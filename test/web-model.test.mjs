import { test } from "node:test";
import assert from "node:assert/strict";
import { activityOf, activityLine, channelOf, claimsOf, countersOf, errandStatus, factsOf, moodOf, findStats, primaryAction, publishedStamp, questionOf, sourcesOf, stepsOf } from "../web/model.js";

const legacy = {
  created_at: "2026-11-14T10:00:00Z", updated_at: "2026-11-14T10:00:20Z",
  research: {
    status: "completed", cost: 0.025,
    progress: [{ kind: "search", text: "DVV notification of move" }, { kind: "source", text: "Moving", url: "https://dvv.fi/en/moving" }],
    output: {
      structured: {
        answer: "Notify DVV within one week; it is free. You can do it online.",
        key_facts: [{ label: "Deadline", value: "One week" }],
        steps: [{ title: "Open the form", detail: "", url: "https://posti.fi/x", done_by_hoida: true }, { title: "Check", detail: "d" }],
        actions: [{ type: "copy_text", label: "Copy" }, { type: "open_link", label: "Open", url: "https://www.posti.fi/en/moving" }],
      },
      grounding: [
        { field: "structured.answer", citations: [{ url: "https://dvv.fi/en/moving", title: "Moving" }] },
        { field: "structured.key_facts[0]", citations: [{ url: "https://www.posti.fi/en/moving", title: "Posti" }, { url: "javascript:alert(1)" }] },
      ],
    },
  },
};

test("older tasks: sources come from grounding, claims from the answer's sentences", () => {
  const sources = sourcesOf(legacy);
  assert.deepEqual(sources.map((s) => [s.n, s.domain, s.official]), [[1, "dvv.fi", true], [2, "posti.fi", false]]);
  const claims = claimsOf(legacy, sources);
  assert.deepEqual(claims.map((c) => c.text), ["Notify DVV within one week; it is free.", "You can do it online."]);
  assert.deepEqual(claims[0].sources, [1]);
  assert.equal(factsOf(legacy, sources)[0].source.n, 2);
});

test("new fields win: output.claims and output.sources, unknown source numbers dropped", () => {
  const task = { research: { status: "completed", output: {
    claims: [{ text: "Within one week.", sources: [1, 9] }, { text: "Assumed.", sources: [], supported: false }],
    sources: [{ n: 1, url: "https://dvv.fi/a", title: "A", domain: "dvv.fi", official: true, quote: "one week", published: "2025-03-04", stale: true }],
  } } };
  const sources = sourcesOf(task);
  assert.equal(sources[0].quote, "one week");
  assert.equal(sources[0].stale, true);
  const claims = claimsOf(task, sources);
  assert.deepEqual(claims[0].sources, [1]);
  assert.equal(claims[1].supported, false);
  assert.equal(publishedStamp(sources[0].published), "updated Mar 2025");
});

test("activity prefers research.activity and reads progress otherwise", () => {
  assert.deepEqual(activityOf(legacy).map((l) => l.kind), ["search", "read"]);
  const lines = activityOf({ research: { activity: [{ t: 2.4, kind: "read", text: "dvv.fi", url: "https://dvv.fi/x" }, { t: 23, kind: "done", text: "Answer ready" }] } });
  assert.equal(activityLine(lines[0]), "Reading dvv.fi");
  assert.equal(findStats({ research: { activity: lines.map((l) => ({ ...l })) } }, []).seconds, 23);
});

test("steps say who acts, the primary action is the first with a web address, answered questions close", () => {
  assert.deepEqual(stepsOf(legacy).map((s) => s.by), ["Vali", "You"]);
  assert.deepEqual(primaryAction(legacy), { index: 1, url: "https://www.posti.fi/en/moving", domain: "posti.fi", label: "Open" });
  assert.equal(questionOf({ research: { question: { text: "How many?", options: ["2-4"], answer: "2-4" } } }), null);
  assert.deepEqual(questionOf({ research: { question: { text: "How many?", options: ["2-4", "5-8"], answer: null } } }).options, ["2-4", "5-8"]);
});

test("errand rows: who acts next, which channel, and counters with or without /v1/stats", () => {
  assert.equal(errandStatus(legacy).word, "Done");
  assert.equal(errandStatus({ ...legacy, execution: { status: "awaiting_approval", approval: { summary: "Send the form" } } }).tone, "you");
  assert.equal(errandStatus({ research: { status: "running", progress: [] } }).word, "Working");
  assert.equal(errandStatus({ research: { status: "cancelled" } }).word, "Stopped");
  assert.equal(channelOf({ source: "voice" }), "voice");
  assert.equal(channelOf({ channel: "web", source: "extension" }), "web");
  assert.equal(channelOf({ source: "extension", page: { title: "Uploaded letter" } }), "letter");
  assert.deepEqual(countersOf({ total: 42, exa: { searches: 120, pages_read: 310 }, cost_usd: 0.81 }, []), { errands: 42, searches: 120, pages: 310, cost: 0.81 });
  assert.deepEqual(countersOf(null, [legacy]), { errands: 1, searches: 1, pages: 2, cost: 0.025 });
  assert.equal(countersOf(null, [{ research: { status: "completed" } }]).searches, null);
});

test("the mascot's pose follows the errand", () => {
  assert.equal(moodOf({ research: { status: "running", progress: [] } }), "thinking");
  assert.equal(moodOf(legacy), "success");
  assert.equal(moodOf({ ...legacy, execution: { status: "awaiting_approval" } }), "needs_approval");
  assert.equal(moodOf({ research: { status: "failed" } }), "error");
});
