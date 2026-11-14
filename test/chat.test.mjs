import { test } from "node:test";
import assert from "node:assert/strict";
import { conversations, conversationOf, pendingAsk, composerMessage, executionTurns, rememberQuestion, shortAnswer, chatStats, money, ago, userText, titleOf, ANSWERS } from "../extension/lib/chat.js";

test("follow-ups join their first errand's conversation, newest conversation first", () => {
  const tasks = [
    { id: "b", task: "Book a sauna", createdAt: 30 },
    { id: "a2", parentId: "a", task: `Claim my delay${ANSWERS}AY123`, createdAt: 20 },
    { id: "a", task: "Claim my delay", createdAt: 10 },
    { id: "c", parentId: "gone", task: "Orphan", createdAt: 5 },
  ];
  const convos = conversations(tasks);
  assert.deepEqual(convos.map((c) => c.id), ["b", "a", "c"]);
  assert.deepEqual(convos[1].tasks.map((t) => t.id), ["a", "a2"]);
  assert.equal(convos[1].title, "Claim my delay");
  assert.equal(conversationOf(convos, "a2").id, "a");
  assert.equal(conversationOf(convos, "zzz"), null);
  assert.equal(userText(tasks[1]), "AY123");
  assert.equal(titleOf(tasks[1]), "Claim my delay");
  assert.deepEqual(conversations(null), []);
});

test("the composer answers the browser's question, then the server's research question, then missing info", () => {
  const exec = { id: "x", backend: true, status: "completed", execution: { status: "running", question: { text: "18:00 or 19:30?", at: "t1" } } };
  const ask = pendingAsk({ tasks: [exec] });
  assert.equal(ask.route, "execution");
  assert.deepEqual(composerMessage(ask, "18:00", exec), { type: "message", taskId: "x", text: "18:00" });
  assert.equal(pendingAsk({ tasks: [exec] }, { answered: new Map([["x", "t1"]]) }), null);
  assert.equal(pendingAsk({ tasks: [{ ...exec, execution: { status: "done", question: { text: "?" } } }] }), null);

  const research = { id: "r", backend: true, status: "completed", research: { question: { text: "Which city?", options: ["Helsinki", "Espoo"], answer: null } } };
  const rAsk = pendingAsk({ tasks: [research] });
  assert.deepEqual([rAsk.route, rAsk.options], ["research", ["Helsinki", "Espoo"]]);
  assert.equal(composerMessage(rAsk, "Espoo", research).type, "message");
  assert.equal(pendingAsk({ tasks: [{ ...research, research: { question: { text: "Which city?", answer: "Espoo" } } }] }), null);

  const direct = { id: "d", status: "completed", task: "Claim", runId: "run1", tabId: 3, page: null, output: { structured: { missing_info: ["Flight number?"] } } };
  const fAsk = pendingAsk({ tasks: [direct] });
  assert.equal(fAsk.route, "followup");
  assert.deepEqual(composerMessage(fAsk, "AY123", direct), { type: "start", task: `Claim${ANSWERS}AY123`, tabId: 3, usePage: false, previousRunId: "run1", parentId: "d" });
  assert.equal(composerMessage(null, "hi", direct), null);
  assert.equal(pendingAsk(null), null);
});

test("the browser's questions stay in the thread after the server clears them", () => {
  const log = {};
  const t = { id: "x", execution: { status: "running", question: { text: "Which name?", at: "2026-11-14T10:00:01Z" }, inbox: [{ text: "Ada", at: "2026-11-14T10:00:05Z" }] } };
  assert.equal(rememberQuestion(log, t), true);
  assert.equal(rememberQuestion(log, t), false);
  const cleared = { ...t, execution: { ...t.execution, question: null } };
  assert.deepEqual(executionTurns(cleared, log.x).map((s) => [s.who, s.text]), [["vali", "Which name?"], ["user", "Ada"]]);
  assert.equal(executionTurns(t, log.x).length, 2); // the live question is not doubled
  assert.deepEqual(executionTurns({}, undefined), []);
});

test("short answers keep two sentences, decimals intact", () => {
  assert.deepEqual(shortAnswer("It costs 1.5 €. Pay online. Then wait."), { text: "It costs 1.5 €. Pay online.", more: true });
  assert.deepEqual(shortAnswer("  One line  "), { text: "One line", more: false });
  assert.deepEqual(shortAnswer(null), { text: "", more: false });
});

test("stats prefer GET /v1/stats and fall back to the errands in this browser", () => {
  const tasks = [
    { cost: 0.02, research: { activity: [{ kind: "search" }, { kind: "read" }, { kind: "read" }] } },
    { progress: [{ kind: "search" }, { kind: "source" }], execution: { exa: [{ kind: "search", cost_usd: 0.005 }] } },
  ];
  assert.deepEqual(chatStats(null, tasks), { errands: 2, searches: 3, pages: 3, cost: 0.025 });
  assert.deepEqual(chatStats({ total: 9, exa: { searches: 20, pages_read: 50 }, cost_usd: 0.4 }, tasks), { errands: 9, searches: 20, pages: 50, cost: 0.4 });
  assert.equal(money(0.025), "$0.025");
  assert.equal(money(1.2), "$1.20");
  assert.equal(money(0), "$0.00");
  assert.equal(ago(0 + 1000, 30_000), "now");
  assert.equal(ago(0 + 1, 2 * 3600_000), "1 h");
});
