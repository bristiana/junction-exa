// Vali service worker: starts errands, keeps polling them in the background, notifies when one is ready,
// and fills forms in the user's tab once they approve. Only this file writes the task list; the panel reads it.
// Two modes: errands go through the Vali API (lib/backend.js; the deployed server unless settings say otherwise) and
// tasks started on WhatsApp show up here too; with the server cleared in settings it talks to Exa directly.

import { createRun, getRun, getRunEvents, cancelRun, TERMINAL } from "./lib/exa.js";
import { buildRunRequest } from "./lib/task.js";
import { capturePage, fillPage } from "./lib/page-scripts.js";
import { fillPlaceholders } from "./lib/actions.js";
import { redactText } from "./lib/redact.js";
import * as backend from "./lib/backend.js";
import { isLinkSender, linkCodeInput } from "./lib/device-link.js";

const MAX_TASKS = 30;
const MAX_HIDDEN = 200;

// ---------- storage (serialized so two polls never overwrite each other) ----------
let chain = Promise.resolve();
function withTasks(fn) {
  chain = chain.catch(() => {}).then(async () => {
    const { tasks = [] } = await chrome.storage.local.get("tasks");
    const out = await fn(tasks);
    await chrome.storage.local.set({ tasks: tasks.slice(0, MAX_TASKS) });
    return out;
  });
  return chain;
}
async function settings() {
  const { exaKey = "", profile = {}, effort = "low", backendUrl } = await chrome.storage.local.get(["exaKey", "profile", "effort", "backendUrl"]);
  return { exaKey, profile, effort, backendUrl: backend.resolveBaseUrl(backendUrl) };
}
async function findTask(id) {
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  return tasks.find((x) => x.id === id) || null;
}

// ---------- setup ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "vali-selection", title: "Vali: take care of this", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "vali-page", title: "Vali: help with this page", contexts: ["page", "link"] });
  });
  schedulePoll();
});
chrome.runtime.onStartup.addListener(() => schedulePoll());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.backendUrl?.newValue) schedulePoll();
});

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
  const { exaKey, profile, effort, backendUrl } = await settings();
  let page = null;
  if (usePage && tabId) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: capturePage });
      page = res?.result || null; // text, selection and title come back redacted
    } catch (e) {
      page = null; // chrome:// pages, the Web Store and PDFs cannot be read
    }
    if (selection) {
      if (!page) {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        page = { url: tab?.url || "", title: redactText(tab?.title || ""), text: "", fields: [] };
      }
      page.selection = redactText(selection);
    }
  }
  const localPage = page ? { url: page.url, title: page.title, fields: page.fields || [], hadSelection: !!page.selection } : null;

  if (backendUrl) {
    await backend.ensureConnected();
    const parent = parentId ? await findTask(parentId) : null;
    const remote = await backend.createTask({
      task,
      page: backend.backendPage(page),
      effort,
      previous_task_id: parent?.remoteId || undefined,
    });
    const seed = { parentId: parentId || null, tabId: tabId || null, page: localPage, seen: false };
    const record = await withTasks((tasks) => {
      const i = tasks.findIndex((x) => x.remoteId === remote.id); // a poll may have brought it in already
      const rec = backend.toLocalTask(remote, i >= 0 ? { ...tasks[i], ...seed } : seed);
      if (i >= 0) tasks[i] = rec;
      else tasks.unshift(rec);
      return rec;
    });
    schedulePoll();
    return record;
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
    page: localPage,
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

// Server mode: one list call brings updates for this browser's errands and new ones from WhatsApp.
async function pollBackend() {
  await backend.ensureConnected();
  const config = await backend.loadConfig();
  const client = backend.createClient(config);
  const { tasks: remote = [] } = (await client.listTasks()) || {};
  const { hiddenTasks = [] } = await chrome.storage.local.get("hiddenTasks");
  const finished = [];
  const merge = (list) => withTasks(async (tasks) => {
    const current = await backend.loadConfig();
    if (current.token !== config.token || current.baseUrl !== config.baseUrl) return;
    const res = backend.mergeRemoteTasks(tasks, list, { hidden: hiddenTasks });
    tasks.splice(0, tasks.length, ...res.tasks);
    finished.push(...res.finished);
  });
  await merge(remote);
  // Active errands that fell off the first page of the list.
  const listed = new Set(remote.map((r) => r.id));
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  for (const t of tasks.filter((x) => x.backend && backend.isActive(x) && !listed.has(x.remoteId))) {
    try {
      await merge([await client.getTask(t.remoteId)]);
    } catch (e) {
      if (e.status === 404) await withTasks((ts) => { const x = ts.find((y) => y.id === t.id); if (x) { x.status = "failed"; x.error = "The task was not found on the Vali server."; } });
    }
  }
  for (const t of finished) notify(t);
}

let polling = false;
async function pollAll() {
  if (polling) return;
  polling = true;
  try {
    const { exaKey, backendUrl } = await settings();
    if (backendUrl) await pollBackend().catch(() => {});
    // Direct-mode errands keep polling Exa even after a server is set, until they finish.
    const { tasks = [] } = await chrome.storage.local.get("tasks");
    const active = tasks.filter((t) => !t.backend && !TERMINAL.has(t.status));
    if (!active.length) {
      if (!backendUrl) chrome.alarms.clear("vali-poll");
      return;
    }
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
      if (done) notify({ ...t, output: run.output });
    }
  } finally {
    polling = false;
  }
}

function notify(t) {
  const answer = t.output?.structured?.answer || t.output?.text || "Your errand is ready.";
  const task = String(t.task || "");
  chrome.notifications.create(t.id, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "Vali: " + (task.length > 50 ? task.slice(0, 50) + "…" : task),
    message: String(answer).slice(0, 180),
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const t = await findTask(id);
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
  chrome.alarms.create("vali-poll", { periodInMinutes: 0.5, delayInMinutes: 0.1 });
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "vali-poll") pollAll(); });

// ---------- approve: fill the form on the page ----------
async function fillForm(taskId) {
  const { profile } = await settings();
  const t = await findTask(taskId);
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

// ---------- server-only actions on one task (cancel, do it, approve, stop) ----------
async function onServerTask(taskId, fn) {
  const t = await findTask(taskId);
  if (!t?.backend) throw new Error("This needs a Vali server (settings).");
  const remote = await fn(t);
  const rec = await withTasks((tasks) => {
    const i = tasks.findIndex((x) => x.id === t.id);
    if (i < 0) return null;
    tasks[i] = backend.toLocalTask(remote, tasks[i]);
    return tasks[i];
  });
  schedulePoll();
  return rec;
}

// ---------- the badge on form pages (content/presence.js) ----------
function openFromPresence(msg, sender, reply) {
  const tabId = sender.tab?.id;
  if (!tabId) { reply({ ok: false, error: "No tab." }); return false; }
  // Called synchronously from the click on the badge, so Chrome can count it as a user gesture.
  let opening;
  try { opening = chrome.sidePanel.open({ tabId }); } catch (e) { opening = Promise.reject(e); }
  // The panel picks this up now, or the next time it opens (Alt+V) if Chrome refused to open it.
  chrome.storage.session.set({
    prefill: {
      at: Date.now(),
      tabId,
      source: "presence",
      task: "Help me fill in this form",
      usePage: true,
      selection: "",
      link: "",
      pageTitle: String(msg.title || sender.tab.title || "").slice(0, 200),
    },
  }).catch(() => {});
  Promise.resolve(opening).then(
    () => reply({ ok: true, data: { opened: true } }),
    () => reply({ ok: true, data: { opened: false } })
  );
  return true;
}

// ---------- messages from the panel and the badge ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === "presence-open") return openFromPresence(msg, sender, reply);
  const handlers = {
    linkAccount: async () => {
      if (!isLinkSender(sender, chrome.runtime.id)) throw new Error("Link your account from the extension panel.");
      const config = await backend.loadConfig();
      const { token } = await backend.createClient(config).redeemLink(linkCodeInput(msg.code));
      if (!token || typeof token !== "string") throw new Error("The server did not return an account. Try a new code.");
      const current = await backend.loadConfig();
      if (current.baseUrl !== config.baseUrl || current.token !== config.token) throw new Error("The account changed. Get a new code and try again.");
      await withTasks(async (tasks) => {
        tasks.splice(0, tasks.length, ...tasks.filter((t) => !t.backend));
        await chrome.storage.local.set({ tasks, backendToken: token, backendTokenUrl: config.baseUrl, backendUserId: "", hiddenTasks: [] });
      });
      await pollBackend();
      return true;
    },
    start: () => startTask(msg),
    poll: () => pollAll().then(() => true),
    fill: () => fillForm(msg.taskId),
    cancel: async () => {
      const t = await findTask(msg.taskId);
      if (t?.backend) {
        if (!TERMINAL.has(t.status)) await onServerTask(t.id, (x) => backend.cancel(x.remoteId));
        return true;
      }
      const { exaKey } = await settings();
      if (t && !TERMINAL.has(t.status)) await cancelRun(exaKey, t.runId).catch(() => {});
      await withTasks((ts) => { const x = ts.find((y) => y.id === msg.taskId); if (x && !TERMINAL.has(x.status)) x.status = "cancelled"; });
      return true;
    },
    execute: () => onServerTask(msg.taskId, async (t) => {
      const { profile } = await settings();
      return backend.execute(t.remoteId, { action_index: msg.actionIndex, start_url: msg.startUrl, goal: msg.goal, profile });
    }),
    approve: () => onServerTask(msg.taskId, (t) => backend.approve(t.remoteId)),
    stop: () => onServerTask(msg.taskId, (t) => backend.stop(t.remoteId)),
    message: () => onServerTask(msg.taskId, (t) => backend.message(t.remoteId, msg.text)),
    remove: async () => {
      const t = await findTask(msg.taskId);
      if (t?.remoteId) {
        // keep it from coming back with the next poll of the server's list
        const { hiddenTasks = [] } = await chrome.storage.local.get("hiddenTasks");
        await chrome.storage.local.set({ hiddenTasks: [t.remoteId, ...hiddenTasks.filter((x) => x !== t.remoteId)].slice(0, MAX_HIDDEN) });
      }
      return withTasks((ts) => { const i = ts.findIndex((y) => y.id === msg.taskId); if (i >= 0) ts.splice(i, 1); return true; });
    },
    seen: () => withTasks((ts) => { const x = ts.find((y) => y.id === msg.taskId); if (x) x.seen = true; return true; }),
  };
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve()
    .then(h)
    .then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: e?.message || String(e), status: e?.status, backend: !!e?.backend }));
  return true;
});
