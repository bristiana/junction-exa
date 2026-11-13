// Hoida service worker: starts Exa Agent runs, keeps polling them in the background, notifies when an errand is ready,
// and fills forms in the user's tab once they approve. Only this file writes the task list; the panel reads it.

import { createRun, getRun, getRunEvents, cancelRun, TERMINAL } from "./lib/exa.js";
import { buildRunRequest } from "./lib/task.js";
import { capturePage, fillPage } from "./lib/page-scripts.js";
import { fillPlaceholders } from "./lib/actions.js";

const MAX_TASKS = 30;

// ---------- storage (serialized so two polls never overwrite each other) ----------
let chain = Promise.resolve();
function withTasks(fn) {
  chain = chain.then(async () => {
    const { tasks = [] } = await chrome.storage.local.get("tasks");
    const out = await fn(tasks);
    await chrome.storage.local.set({ tasks: tasks.slice(0, MAX_TASKS) });
    return out;
  });
  return chain;
}
async function settings() {
  const { exaKey = "", profile = {}, effort = "low" } = await chrome.storage.local.get(["exaKey", "profile", "effort"]);
  return { exaKey, profile, effort };
}

// ---------- setup ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "hoida-selection", title: "Hoida: take care of this", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "hoida-page", title: "Hoida: help with this page", contexts: ["page", "link"] });
  });
});
chrome.runtime.onStartup.addListener(() => schedulePoll());

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  // Must run synchronously inside the click to count as a user gesture.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  await chrome.storage.session.set({
    prefill: {
      at: Date.now(),
      tabId: tab.id,
      selection: info.selectionText || "",
      link: info.linkUrl || "",
      pageTitle: tab.title || "",
    },
  });
});

// ---------- runs ----------
async function startTask({ task, tabId, usePage, selection, previousRunId, parentId }) {
  const { exaKey, profile, effort } = await settings();
  let page = null;
  if (usePage && tabId) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: capturePage });
      page = res?.result || null;
    } catch (e) {
      page = null; // chrome:// pages, the Web Store and PDFs cannot be read
    }
    if (selection) {
      if (!page) {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        page = { url: tab?.url || "", title: tab?.title || "", text: "", fields: [] };
      }
      page.selection = selection;
    }
  }
  const request = buildRunRequest(task, page, profile, { effort });
  if (previousRunId) request.previousRunId = previousRunId;
  const run = await createRun(exaKey, request);
  const record = {
    id: crypto.randomUUID(),
    parentId: parentId || null,
    runId: run.id,
    task,
    createdAt: Date.now(),
    status: run.status || "queued",
    tabId: tabId || null,
    page: page ? { url: page.url, title: page.title, fields: page.fields || [], hadSelection: !!page.selection } : null,
    progress: [],
    output: null,
    error: null,
    cost: null,
    completedAt: null,
    seen: false,
  };
  await withTasks((tasks) => { tasks.unshift(record); });
  schedulePoll();
  return record;
}

function progressFromEvents(events = []) {
  const lines = [];
  for (const ev of events) {
    const d = ev.data || {};
    const name = ev.event || "";
    if (name.includes("source")) {
      const url = d.url || d.source?.url;
      if (url) lines.push({ kind: "source", text: d.title || d.source?.title || url, url });
    } else if (name.includes("search") || name.includes("tool")) {
      const q = d.query || d.description || d.item?.query || d.item?.description || d.arguments?.query;
      if (q) lines.push({ kind: "search", text: String(q) });
    }
  }
  // newest last, keep the tail
  const seen = new Set();
  return lines.filter((l) => { const k = l.kind + l.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(-12);
}

let polling = false;
async function pollAll() {
  if (polling) return;
  polling = true;
  try {
    const { exaKey } = await settings();
    const { tasks = [] } = await chrome.storage.local.get("tasks");
    const active = tasks.filter((t) => !TERMINAL.has(t.status));
    if (!active.length) { chrome.alarms.clear("hoida-poll"); return; }
    for (const t of active) {
      let run;
      try { run = await getRun(exaKey, t.runId); } catch (e) {
        if (e.status === 404) await withTasks((ts) => { const x = ts.find((y) => y.id === t.id); if (x) { x.status = "failed"; x.error = "The run was not found."; } });
        continue;
      }
      let progress = null;
      if (!TERMINAL.has(run.status)) {
        try { progress = progressFromEvents((await getRunEvents(exaKey, t.runId)).data); } catch (_) {}
      }
      const done = run.status === "completed";
      await withTasks((ts) => {
        const x = ts.find((y) => y.id === t.id);
        if (!x) return;
        x.status = run.status;
        if (progress && progress.length) x.progress = progress;
        if (TERMINAL.has(run.status)) {
          x.completedAt = Date.now();
          x.output = run.output || null;
          x.cost = run.costDollars?.total ?? null;
          x.stopReason = run.stopReason || null;
          if (run.status === "failed") x.error = run.error?.message || "The run failed.";
        }
      });
      if (done) notify(t, run);
    }
  } finally {
    polling = false;
  }
}

function notify(t, run) {
  const answer = run.output?.structured?.answer || run.output?.text || "Your errand is ready.";
  chrome.notifications.create(t.id, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "Hoida: " + (t.task.length > 50 ? t.task.slice(0, 50) + "…" : t.task),
    message: String(answer).slice(0, 180),
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  const t = tasks.find((x) => x.id === id);
  await chrome.storage.session.set({ focusTask: id });
  if (t?.tabId) {
    try {
      const tab = await chrome.tabs.get(t.tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (_) {}
  }
  chrome.notifications.clear(id);
});

function schedulePoll() {
  chrome.alarms.create("hoida-poll", { periodInMinutes: 0.5, delayInMinutes: 0.1 });
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "hoida-poll") pollAll(); });

// ---------- approve: fill the form on the page ----------
async function fillForm(taskId) {
  const { profile } = await settings();
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  const t = tasks.find((x) => x.id === taskId);
  const values = t?.output?.structured?.form_fill || [];
  if (!t || !values.length) return { filled: 0, skipped: [], error: "Nothing to fill." };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const target = tab && t.page?.url && sameDoc(tab.url, t.page.url) ? tab.id : t.tabId;
  if (!target) return { filled: 0, skipped: [], error: "Open the page with the form first." };
  // Re-tag the fields in case the page re-rendered since the errand started.
  await chrome.scripting.executeScript({ target: { tabId: target }, func: capturePage });
  const resolved = values.map((v) => ({ field_id: v.field_id, value: fillPlaceholders(v.value, profile) }));
  const [res] = await chrome.scripting.executeScript({ target: { tabId: target }, func: fillPage, args: [resolved] });
  return res?.result || { filled: 0, skipped: [] };
}
function sameDoc(a, b) {
  try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname === y.pathname; } catch (_) { return false; }
}

// ---------- messages from the panel ----------
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handlers = {
    start: () => startTask(msg),
    poll: () => pollAll().then(() => true),
    fill: () => fillForm(msg.taskId),
    cancel: async () => {
      const { exaKey } = await settings();
      const { tasks = [] } = await chrome.storage.local.get("tasks");
      const t = tasks.find((x) => x.id === msg.taskId);
      if (t && !TERMINAL.has(t.status)) await cancelRun(exaKey, t.runId).catch(() => {});
      await withTasks((ts) => { const x = ts.find((y) => y.id === msg.taskId); if (x && !TERMINAL.has(x.status)) x.status = "cancelled"; });
      return true;
    },
    remove: () => withTasks((ts) => { const i = ts.findIndex((y) => y.id === msg.taskId); if (i >= 0) ts.splice(i, 1); return true; }),
    seen: () => withTasks((ts) => { const x = ts.find((y) => y.id === msg.taskId); if (x) x.seen = true; return true; }),
  };
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve()
    .then(h)
    .then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: e?.message || String(e), status: e?.status }));
  return true;
});
