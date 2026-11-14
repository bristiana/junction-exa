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
  assert.equal(first.exa, "Searched the web once, read 1 page, confirmed 1 of 2 facts on the page.");
  assert.deepEqual(first.domains, ["finnkino.fi"]);
  assert.equal(second.mode, "Research");
  assert.match(second.exa, /looked up 2 details for the form/);
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

test('a stopped booking reads Stopped even when the research had asked something', async () => {
  const { errandStatus } = await import('../web/model.js');
  const task = { research: { status: 'completed', question: { text: 'Which day?', answer: null }, output: { structured: { status: 'needs_info' } } },
                 execution: { status: 'stopped' } };
  assert.equal(errandStatus(task).word, 'Stopped');
  assert.equal(errandStatus({ ...task, execution: null }).word, 'Needs your answer');
});

// ---------- one errand as a conversation ----------
const booking = {
  id: "t4", task: "Book a sauna this Friday", channel: "whatsapp", created_at: "2026-11-14T16:00:00+00:00",
  research: {
    status: "completed", question: { text: "How many people?", options: ["2", "4"], answer: "4" },
    activity: [{ kind: "read", text: "Price list", url: "https://kulttuurisauna.fi/prices.pdf" }, { kind: "read", text: "kulttuurisauna.fi", url: "https://kulttuurisauna.fi/en" }],
    output: {
      structured: { answer: "Kulttuurisauna has a slot on Friday at 18:00. It costs 15 EUR per person. Bring a towel.",
        key_facts: [{ label: "When", value: "Fri 18:00" }, { label: "Price", value: "15 EUR" }, { label: "Where", value: "Merihaka" }, { label: "Extra", value: "Towel" }] },
      sources: [{ n: 1, url: "https://kulttuurisauna.fi/en", title: "Kulttuurisauna", image: "https://kulttuurisauna.fi/og.jpg" },
        { n: 2, url: "https://www.hel.fi/saunas", title: "Saunas", image: "http://hel.fi/x.jpg" }],
    },
  },
  execution: {
    status: "awaiting_approval", start_url: "https://kulttuurisauna.fi/book", current_url: "https://kulttuurisauna.fi/book",
    steps: [{ text: "Opened https://kulttuurisauna.fi/book" }, { text: "Read the page" }, { text: 'Clicked "Friday"' }, { text: 'Clicked "18:00"' },
      { text: 'Set people to "4"' }, { text: 'Filled "Email" with {{email}}' }, { text: "Waiting for your approval" }],
    exa: [{ kind: "read", url: "https://kulttuurisauna.fi/faq" }],
    question: { text: "Which email should I use?", at: "2026-11-14T16:02:00+00:00" },
    inbox: [{ text: "My work email", at: "2026-11-14T16:03:00+00:00" }, { text: "Friday please", at: "2026-11-14T16:01:00+00:00" }],
    approval: { summary: "Sauna for 4, Fri 18:00, {{email}}", filled: [{ label: "Date", value: "Fri" }, { label: "Email", value: "{{email}}" }] },
  },
};

test("helpers: placeholders read as words, PDFs by path, short answers keep two sentences", async () => {
  const { isPdf, plainPlaceholders, runSteps, shortAnswer } = await import("../web/board-model.js");
  assert.equal(plainPlaceholders('Filled "Email" with {{first_name}}'), 'Filled "Email" with your first name');
  assert.equal(isPdf("https://migri.fi/a/form.PDF?x=1"), true);
  assert.equal(isPdf("https://migri.fi/pdf"), false);
  assert.equal(shortAnswer(booking), "Kulttuurisauna has a slot on Friday at 18:00. It costs 15 EUR per person.");
  assert.equal(shortAnswer({ research: { output: { claims: [{ text: "One." }, { text: "Two." }, { text: "Three." }] } } }), "One. Two.");
  const { steps, more } = runSteps(booking, 3);
  assert.deepEqual(steps, ['Chose 18:00', 'Set people to 4', 'Filled in your email']);
  assert.equal(more, 2); // "Opened kulttuurisauna.fi" and "Clicked Friday"; quiet steps are not counted
});

test("the thread: errand, research question and answer, Vali's short answer, the browser run in order", async () => {
  const { threadOf } = await import("../web/board-model.js");
  const thread = threadOf(booking);
  assert.deepEqual(thread.map((b) => [b.who, b.text]), [
    ["me", "Book a sauna this Friday"],
    ["vali", "How many people?"],
    ["me", "4"],
    ["vali", "Kulttuurisauna has a slot on Friday at 18:00. It costs 15 EUR per person."],
    ["vali", "Waiting for your OK"],
    ["me", "Friday please"],
    ["vali", "Which email should I use?"],
    ["me", "My work email"],
    ["vali", "Sauna for 4, Fri 18:00, your email"],
  ]);
  assert.equal(thread[1].tone, null); // answered: no longer waiting on you
  assert.deepEqual(thread[3].facts.map((f) => f.label), ["When", "Price", "Where"]);
  assert.deepEqual(thread[3].sources.map((s) => [s.n, s.domain]), [[1, "kulttuurisauna.fi"], [2, "hel.fi"]]);
  assert.deepEqual(thread[8].steps, ["Filled: Date, Email"]);
  assert.equal(thread[8].tone, "you");
  const approved = threadOf({ ...booking, execution: { ...booking.execution, status: "completed", approval_decision: "approved", result: "Booked. See you Friday." } });
  assert.deepEqual(approved.slice(-2).map((b) => [b.who, b.text, b.tone]), [["me", "Approve", undefined], ["vali", "Booked. See you Friday.", "done"]]);
  const stopped = threadOf({ ...booking, execution: { ...booking.execution, status: "stopped", approval_decision: "stopped" } });
  assert.equal(stopped.at(-1).text, "Stop"); // the state block under the chat says where it stopped
  const working = threadOf({ task: "Kela benefits", research: { status: "running", activity: [{ kind: "search", text: "Kela student" }] } });
  assert.deepEqual(working.map((b) => [b.who, b.label, b.tone]), [["me", undefined, undefined], ["vali", "Working", "working"]]);
  assert.equal(working[1].text, "Searching “Kela student”");
});

test("opened by Vali: sources first with https images, then reads, form-fill reads and browser pages, PDFs marked", async () => {
  const { pagesOpened } = await import("../web/board-model.js");
  const pages = pagesOpened(booking);
  assert.deepEqual(pages.map((p) => [p.url, p.how, p.pdf]), [
    ["https://kulttuurisauna.fi/en", "Source 1", false],
    ["https://www.hel.fi/saunas", "Source 2", false],
    ["https://kulttuurisauna.fi/prices.pdf", "Read by Exa", true],
    ["https://kulttuurisauna.fi/faq", "Read for the form", false],
    ["https://kulttuurisauna.fi/book", "Opened in the browser", false],
  ]);
  assert.equal(pages[0].image, "https://kulttuurisauna.fi/og.jpg");
  assert.equal(pages[1].image, null); // http images are dropped
  assert.equal(pages[2].title, "Price list");
  assert.deepEqual(pagesOpened({}), []);
});
