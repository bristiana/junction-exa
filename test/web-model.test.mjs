import { test } from "node:test";
import assert from "node:assert/strict";
import { activityOf, activityLine, channelOf, claimsOf, countersOf, draftsOf, errandStatus, factsOf, moodOf, pagesTouched, runStatus, findStats, primaryAction, publishedStamp, questionOf, sourcesOf, stepsOf } from "../web/model.js";

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

test("the privacy sheet lists each page once, browser pages first", () => {
  const task = { ...legacy, execution: { status: "done", start_url: "https://www.posti.fi/en/moving", exa: [{ kind: "read", url: "https://kela.fi/x" }] } };
  assert.deepEqual(pagesTouched(task).map((p) => [p.domain, p.how]),
    [["posti.fi", "opened in the browser"], ["dvv.fi", "read by Exa"], ["kela.fi", "read by Exa"]]);
});

test("an approved run reads as submitting before the worker notices", () => {
  assert.equal(runStatus({ execution: { status: "awaiting_approval", approval_decision: "approved" } }), "submitting");
  assert.equal(errandStatus({ ...legacy, execution: { status: "running", approval_decision: "stopped" } }).word, "Stopped");
});

test("a drafted email or message is shown with its text; other actions are not drafts", () => {
  const task = { research: { output: { structured: { actions: [
    { type: "email", label: "Send deposit request", to: "landlord@example.com", subject: "Deposit", body: "Hello,\n\nPlease return my deposit.\n{{name}}" },
    { type: "open_link", label: "Open", url: "https://kkv.fi", body: "not a draft" },
    { type: "copy_text", label: "Copy", body: "  " },
  ] } } } };
  assert.deepEqual(draftsOf(task), [{ type: "email", label: "Send deposit request", to: "landlord@example.com", subject: "Deposit",
    body: "Hello,\n\nPlease return my deposit.\n{{name}}" }]);
  assert.deepEqual(draftsOf({}), []);
});

test("output.lead opens the claims as Vali's own line; it is not a claim with sources", () => {
  const task = { research: { output: { lead: "Check kela.fi for your income limit.", claims: [{ text: "Not confirmed: x.", sources: [], supported: false }] } } };
  assert.deepEqual(claimsOf(task, []).map((c) => [c.text, c.supported]), [["Check kela.fi for your income limit.", true], ["Not confirmed: x.", false]]);
});

test("information links finish research without offering to fill a form", async () => {
  const { errandStage, linkActions } = await import('../web/model.js');
  for (const text of ['What are the pharmacy hours?', 'Which days is the museum open?', 'What do I need for a bank account?', 'How do I book a sauna?', 'Is this book in the library?']) {
    const task = { task: text, research: { status: 'completed', output: { structured: { actions: [
      { type: 'open_link', label: 'Visit the site', url: 'https://ainoapteekki.fi/hours' },
    ] } } } };
    assert.equal(errandStage(task).next.kind, 'done', text);
    assert.deepEqual(errandStage(task).stages, ['Found', 'Done']);
    assert.equal(linkActions(task)[0].domain, 'ainoapteekki.fi');
  }
});

test("explicit form requests and structured form actions offer the correct action", async () => {
  const { errandStage } = await import('../web/model.js');
  const task = { task: 'Find options', research: { status: 'completed', output: { structured: { actions: [
    { type: 'open_link', url: 'https://example.org/info' },
    { type: 'book', url: 'https://example.org/booking' },
  ] } } } };
  for (const type of ['fill', 'book', 'apply']) {
    task.research.output.structured.actions[1].type = type;
    assert.equal(errandStage(task).next.kind, 'fill');
    assert.equal(primaryAction(task).index, 1);
  }
  task.research.output.structured.actions.pop();
  for (const text of ['Fill in the test order form', 'Please book a sauna', 'Can you fill this form?', 'I need you to book a table']) {
    assert.equal(errandStage({ ...task, task: text }).next.kind, 'fill', text);
  }
  task.research.output.structured.actions = [];
  assert.equal(errandStage({ ...task, task: 'Book a sauna' }).next.kind, 'done');
});

test("browser stories shorten navigation, collapse repeats and show detail names only", async () => {
  const { detailsOf, friendlyStep, friendlySteps, errandStage } = await import('../web/model.js');
  const { runSteps } = await import('../web/board-model.js');
  assert.equal(friendlyStep('Navigated to https://www.httpbin.org/forms/post?secret=1'), 'Opened httpbin.org');
  const task = { research: { status: 'completed', known_details: ['name'] }, execution: { status: 'stopped', steps: [
    { text: 'Filled "Name" with Test Person' }, { text: 'Filled "Email" with test@example.com' },
    { text: 'Filled "Email" with test@example.com' }, { text: 'Scrolled down' },
    { text: 'Filled "Email" with test@example.com' }, { text: 'Ticked "Bacon"' },
  ] } };
  assert.deepEqual(detailsOf(task), ['name', 'email']);
  assert.equal(friendlySteps(task).length, 3);
  assert.equal(runSteps(task).steps.length, 3);
  assert.match(errandStage(task).line, /after “Ticked Bacon”\./);
  assert.deepEqual(detailsOf({ execution: { steps: [{ text: 'Opened https://example.org' }] } }), []);
  assert.deepEqual(detailsOf({ execution: { steps: [{ text: 'Filled in your email' }] } }), ['email']);
});

test("errand rows are shaped by kind: answer, booking, watch, draft", async () => {
  const { errandKind, errandLine, shortWhen, siteName } = await import("../web/model.js");
  const done = { status: "completed", output: { structured: { answer: "Yes. You can open a basic account with a passport [2]. Bring proof of study." } } };
  assert.equal(errandKind({ mode: "check", research: done }), "answer");
  assert.deepEqual(errandLine({ mode: "check", research: done }), { kind: "answer", label: "Answer", word: "", detail: "Yes. You can open a basic account with a passport." });
  const run = { status: "awaiting_approval", start_url: "https://kulttuurisauna.fi/", approval: { filled: [{ label: "Date", value: "22 Nov 2026" }, { label: "Time", value: "17:30" }] } };
  const booking = { mode: "book", task: "Book a sauna", research: done, execution: run };
  assert.deepEqual(errandLine(booking), { kind: "booking", label: "Booking", word: "Waiting for your OK", detail: "Kulttuurisauna, Sun 22 Nov 17:30" });
  assert.equal(errandLine({ ...booking, execution: { ...run, status: "done" } }).word, "Booked");
  assert.equal(errandLine({ ...booking, execution: { ...run, status: "stopped" } }).word, "Stopped, nothing sent");
  const watch = { mode: "watch", research: { ...done, watch_id: "w_1" }, execution: { status: "done" } };
  assert.deepEqual(errandLine(watch), { kind: "watch", label: "Watch", word: "Checks daily", detail: "no new matches yet" });
  watch.research.updates = [{ text: "new: Studio 545 €", sources: [{ url: "https://hoas.fi/a", title: "Studio at Kilonkallio 6" }] }];
  assert.equal(errandLine(watch).detail, "Studio at Kilonkallio 6");
  assert.equal(errandKind({ mode: "write", research: done }), "draft");
  assert.equal(errandLine({ mode: "claim", research: done }).label, "Form");
  assert.equal(shortWhen("this Friday at 17:30"), "Fri 17:30");
  assert.equal(shortWhen("2026-11-22T17:30:00"), "Sun 22 Nov 17:30");
  assert.equal(shortWhen("22.11.2026 klo 17.30"), "Sun 22 Nov 17:30");
  assert.equal(siteName("https://www.dvv.fi/en"), "DVV");
});
