import { test } from "node:test";
import assert from "node:assert/strict";
import { channelCounts, feedOf, quotesChecked, searchesOf, topDomains, totalsOf, watchesOf } from "../web/board-model.js";

const wa = {
  id: "t1", task: "What is playing at Tennispalatsi tonight?", source: "whatsapp", channel: "whatsapp", mode: "search",
  created_at: "2026-11-14T18:00:00+00:00", updated_at: "2026-11-14T18:00:20+00:00",
  research: {
    status: "completed", kind: "search", cost: 0.012,
    activity: [
      { t: 0, kind: "think", text: "Planning" },
      { t: 1.5, kind: "search", text: "Finnkino Tennispalatsi showtimes" },
      { t: 3, kind: "read", text: "finnkino.fi", url: "https://www.finnkino.fi/en/tennispalatsi" },
    ],
    output: {
      sources: [{ n: 1, url: "https://www.finnkino.fi/en/tennispalatsi", title: "Showtimes", quote: "Shows tonight" }],
      claims: [{ text: "9 films tonight.", sources: [1], supported: true }, { text: "Last at 21:30.", sources: [1], supported: false },
        { text: "I checked it.", own: true, supported: true }],
    },
  },
};
const web = {
  id: "t2", task: "Register my new address", source: "web", channel: "web", mode: "agent",
  created_at: "2026-11-14T17:00:00+00:00", updated_at: "2026-11-14T17:05:00+00:00",
  research: { status: "completed", kind: "agent", cost: 0.4, activity: [{ t: 2, kind: "search", text: "DVV moving notice" }], output: {} },
  execution: { status: "completed", exa: [{ kind: "search", query: "DVV form fields", cost_usd: 0.005 }, { kind: "read", url: "https://dvv.fi/x", cost_usd: 0.001 }] },
};
const watchTask = {
  id: "t3", task: "Watch for new HSL ticket prices", source: "whatsapp", mode: "monitor",
  created_at: "2026-11-13T10:00:00+00:00", updated_at: "2026-11-13T10:00:00+00:00",
  research: { status: "completed", kind: "monitor", watch_id: "w1", monitor_stubbed: false, activity: [],
    output: { structured: { key_facts: [{ label: "Watching for", value: "new HSL ticket prices" }] } } },
};

test("quotes checked counts judged sentences, not Vali's own words; else quotes found", () => {
  assert.equal(quotesChecked(wa), 2);
  assert.equal(quotesChecked({ research: { output: { sources: [{ quote: "a" }, { quote: "" }] } } }), 1);
  assert.equal(quotesChecked({}), 0);
});

test("top domains come from sources first, then pages read, without repeats", () => {
  assert.deepEqual(topDomains(wa), ["finnkino.fi"]);
  assert.deepEqual(topDomains({ research: { activity: [{ kind: "read", url: "https://www.kela.fi/a" }, { kind: "read", url: "https://kela.fi/b" }] } }), ["kela.fi"]);
});

test("totals prefer /v1/stats and fall back to the errands on screen", () => {
  const stats = { total: 9, by_channel: { whatsapp: 4, web: 3, desktop: 2 }, exa: { searches: 20, pages_read: 50 }, cost_usd: 1.5 };
  const withStats = totalsOf(stats, [wa, web]);
  assert.deepEqual([withStats.errands, withStats.searches, withStats.pages, withStats.cost, withStats.quoted], [9, 20, 50, 1.5, 2]);
  assert.deepEqual(withStats.channels, [["whatsapp", 4], ["web", 3], ["extension", 0], ["voice", 0], ["mac", 2]]);
  const counted = totalsOf(null, [wa, web]);
  assert.deepEqual([counted.errands, counted.searches, counted.pages], [2, 3, 2]);
  assert.equal(counted.cost.toFixed(3), "0.418");
  assert.deepEqual(channelCounts(null, [wa, web, watchTask]), [["whatsapp", 2], ["web", 1], ["extension", 0], ["voice", 0]]);
});

test("the feed is newest first with channel, mode, status, the Exa line and domains", () => {
  const [first, second] = feedOf([web, wa]);
  assert.equal(first.id, "t1");
  assert.deepEqual([first.channel, first.mode, first.status, first.tone], ["whatsapp", "Find", "Done", "done"]);
  assert.equal(first.exa, "Search 1 query, 1 result · Contents 1 of 2 sentences quoted");
  assert.deepEqual(first.domains, ["finnkino.fi"]);
  assert.equal(second.mode, "Research");
  assert.match(second.exa, /Form fill 1 search, 1 page read/);
});

test("searches list every research and form-fill query with its errand and channel, newest first", () => {
  const rows = searchesOf([web, wa]);
  assert.deepEqual(rows.map((r) => [r.query, r.channel, r.where]), [
    ["Finnkino Tennispalatsi showtimes", "whatsapp", "Research"],
    ["DVV form fields", "web", "Form fill"],
    ["DVV moving notice", "web", "Research"],
  ]);
  assert.equal(rows[0].at, "2026-11-14T18:00:01.500Z");
  assert.equal(rows[0].errand, wa.task);
});

test("watches join their errand, newest update first, and say when they last changed", () => {
  const watches = [{ id: "w1", query: "HSL fares", exa_monitor_id: "m1", created_at: "2026-11-13T10:00:00+00:00", unseen_count: 1,
    updates: [{ at: "2026-11-13T12:00:00+00:00", text: "new: old fares", sources: [] },
      { at: "2026-11-14T09:00:00+00:00", text: "new: 2027 fares out", sources: [{ url: "https://www.hsl.fi/en/news" }] }] },
  { id: "w2", query: "Migri times", exa_monitor_id: null, created_at: "2026-11-12T10:00:00+00:00", check_requested_at: null, updates: [] }];
  const [hsl, migri] = watchesOf(watches, [watchTask]);
  assert.deepEqual([hsl.criteria, hsl.taskId, hsl.live, hsl.unseen, hsl.channel], ["new HSL ticket prices", "t3", true, 1, "whatsapp"]);
  assert.deepEqual(hsl.when, { label: "Last update", at: "2026-11-14T09:00:00+00:00" });
  assert.deepEqual(hsl.updates[0], { text: "2027 fares out", at: "2026-11-14T09:00:00+00:00", url: "https://www.hsl.fi/en/news", domain: "hsl.fi" });
  assert.deepEqual([migri.criteria, migri.live, migri.when.label, migri.taskId], ["Migri times", false, "Since", null]);
  // Without the watches list, the errands that hold one.
  const [fromTask] = watchesOf(null, [wa, watchTask]);
  assert.deepEqual([fromTask.id, fromTask.criteria, fromTask.live], ["w1", "new HSL ticket prices", true]);
});
