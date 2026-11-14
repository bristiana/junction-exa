// The side panel as a chat: which errands make one conversation, what Vali is waiting for, where the composer's
// text goes, and the numbers in the stats strip. Pure, so it runs in Node tests too.

import { LIVE } from "./execution.js";

const list = (v) => (Array.isArray(v) ? v : []);
// A follow-up errand repeats the first one and adds what the user typed after this marker (see composerMessage).
export const ANSWERS = "\n\nMy answers:\n";

// The conversation's title: the first errand without the answers added later.
export const titleOf = (t) => String(t?.task || "").split(ANSWERS)[0];

// What the user typed for this errand: the whole errand, or only the newest answer of a follow-up.
export function userText(t) {
  const s = String(t?.task || "");
  const i = s.lastIndexOf(ANSWERS);
  return i >= 0 ? s.slice(i + ANSWERS.length) : s;
}

// One conversation per first errand with its follow-ups (parentId), oldest first. Newest conversation first.
export function conversations(tasks) {
  const all = list(tasks).filter((t) => t?.id);
  const byId = new Map(all.map((t) => [t.id, t]));
  const rootId = (t) => {
    const seen = new Set();
    let cur = t;
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parentId); }
    return cur.id;
  };
  const groups = new Map();
  for (const t of all) {
    const id = rootId(t);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(t);
  }
  return [...groups].map(([id, items]) => {
    items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return { id, title: titleOf(items[0]), tasks: items, last: items.at(-1), at: Math.max(...items.map((t) => t.createdAt || 0)) };
  }).sort((a, b) => b.at - a.at);
}

// The conversation a task belongs to.
export const conversationOf = (convos, taskId) => list(convos).find((c) => c.tasks.some((t) => t.id === taskId)) || null;

// What Vali waits for in this conversation (its newest errand), or null:
//   execution: the cloud browser asked (execution.question) -> POST /v1/tasks/{id}/messages
//   research: the server's research.question -> the same endpoint; the server reruns the research with the answer
//   followup: missing_info on an answer without a server question -> a follow-up errand carrying the answer
// answered: task id -> question.at already answered here, so the question does not come back while the agent reads it.
export function pendingAsk(convo, { answered = new Map() } = {}) {
  const t = convo?.tasks?.at(-1);
  if (!t) return null;
  const x = t.execution;
  if (x?.status) {
    const q = x.question && typeof x.question === "object" ? x.question : x.question ? { text: String(x.question) } : null;
    const at = q?.at || q?.text;
    if (!q?.text || !LIVE.has(x.status) || answered.get(t.id) === at) return null;
    return { route: "execution", taskId: t.id, text: String(q.text), at, options: [] };
  }
  const rq = t.research?.question;
  if (t.backend && rq?.text) {
    if (rq.answer != null || t.status === "failed" || t.status === "cancelled") return null;
    return { route: "research", taskId: t.id, text: String(rq.text), options: list(rq.options).map(String).filter(Boolean).slice(0, 4) };
  }
  const missing = list(t.output?.structured?.missing_info).map(String).filter(Boolean);
  if (t.status === "completed" && missing.length) return { route: "followup", taskId: t.id, text: missing.join(" "), questions: missing, options: [] };
  return null;
}

// The background message for what the user typed while Vali waits (ask), or null: then it is a new errand.
export function composerMessage(ask, text, task) {
  if (!ask) return null;
  if (ask.route === "execution" || ask.route === "research") return { type: "message", taskId: ask.taskId, text };
  return { type: "start", task: `${task.task}${ANSWERS}${text}`, tabId: task.tabId ?? undefined, usePage: !!task.page,
    previousRunId: task.runId || undefined, parentId: task.id };
}

// The browser run's back-and-forth, in time order: the questions Vali asked (remembered here, since the server clears
// a question once it is answered) and what the user sent (execution.inbox).
export function executionTurns(t, asked = []) {
  const x = t?.execution || {};
  const turns = list(asked).filter((q) => q?.text).map((q) => ({ who: "vali", text: String(q.text), at: String(q.at || "") }));
  const q = x.question && typeof x.question === "object" ? x.question : null;
  if (q?.text && !turns.some((s) => s.at === String(q.at || "") && s.text === q.text)) turns.push({ who: "vali", text: String(q.text), at: String(q.at || "") });
  for (const m of list(x.inbox)) if (m?.text) turns.push({ who: "user", text: String(m.text), at: String(m.at || "") });
  return turns.map((s, i) => ({ ...s, i })).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.i - b.i)).map(({ i, ...s }) => s);
}

// Adds the browser's current question to what this panel remembers ({ taskId: [{ text, at }] }). Returns true if new.
export function rememberQuestion(log, t) {
  const q = t?.execution?.question;
  if (!q?.text || !t?.id) return false;
  const seen = (log[t.id] ||= []);
  if (seen.some((s) => s.text === q.text && s.at === (q.at || ""))) return false;
  seen.push({ text: String(q.text), at: String(q.at || "") });
  return true;
}

// The first sentences of an answer for the bubble; more says whether the rest was cut.
export function shortAnswer(text, max = 2) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  const parts = s ? s.split(/(?<=[.!?])\s+(?=[A-ZÄÖÅ0-9“"(])/) : [];
  if (parts.length <= max) return { text: s, more: false };
  return { text: parts.slice(0, max).join(" "), more: true };
}

// The stats strip: the server's GET /v1/stats when it has one, else counted from the errands in this browser.
export function chatStats(stats, tasks) {
  const sums = list(tasks).reduce((acc, t) => {
    const trail = list(t?.research?.activity).length ? list(t.research.activity) : list(t?.progress);
    const fill = list(t?.execution?.exa);
    acc.searches += trail.filter((e) => e?.kind === "search").length + fill.filter((e) => e?.kind === "search").length;
    acc.pages += trail.filter((e) => e?.kind === "read" || e?.kind === "source").length + fill.filter((e) => e?.kind === "read").length;
    acc.cost += (Number(t?.cost) || 0) + fill.reduce((sum, c) => sum + (Number(c?.cost_usd) || 0), 0);
    return acc;
  }, { searches: 0, pages: 0, cost: 0 });
  const has = stats && Number.isFinite(stats.total);
  return {
    errands: has ? stats.total : list(tasks).length,
    searches: has && Number.isFinite(stats.exa?.searches) ? stats.exa.searches : sums.searches,
    pages: has && Number.isFinite(stats.exa?.pages_read) ? stats.exa.pages_read : sums.pages,
    cost: has && Number.isFinite(stats.cost_usd) ? stats.cost_usd : sums.cost,
  };
}

export const money = (n) => "$" + (Number(n) || 0).toFixed(Number(n) > 0 && Number(n) < 0.1 ? 3 : 2);

// "now", "5 min", "3 h", "2 d" for the history list.
export function ago(ms, now = Date.now()) {
  const s = Math.max(0, (now - (Number(ms) || now)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
