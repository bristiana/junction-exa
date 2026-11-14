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
import { planFill, errandValues, samePage, PAGE_CHANGED } from "./lib/fill-here.js";
import { cacheKey, helpfulPage, companionPayload, cleanTip, cachedEntry, remember } from "./lib/companion.js";

const MAX_TASKS = 30;
const MAX_HIDDEN = 200;
const EXPLAIN_QUESTION = "What does this mean and what should I do?"; // "Ask Vali about this" on a selection
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
    chrome.contextMenus.create({ id: "vali-selection", title: "Ask Vali about this", contexts: ["selection"] });
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
  const opening = openPanelNow(tab.id);
  const selection = (info.selectionText || "").slice(0, 4000);
  const prefill = { at: Date.now(), tabId: tab.id, selection, link: info.linkUrl || "", pageTitle: tab.title || "" };
  // "Ask Vali about this" sends right away; if it can't, the question waits in the panel for one press on Send.
  if (selection) {
    startFromPage(tab.id, EXPLAIN_QUESTION, selection, opening)
      .catch(() => chrome.storage.session.set({ prefill: { ...prefill, task: EXPLAIN_QUESTION, usePage: true } }));
    return;
  }
  await chrome.storage.session.set({ prefill });
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
  const want = t.page?.url;
  if (!want) return { filled: 0, skipped: [], error: "Open the page with the form first." };
  // The active tab or the errand's own tab, only while it still shows the page the errand was started on.
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const own = t.tabId ? await chrome.tabs.get(t.tabId).catch(() => null) : null;
  const tab = [active, own].find((x) => x?.id && samePage(x.url, want));
  if (!tab) return { filled: 0, skipped: [], error: PAGE_CHANGED };
  // Re-tag the fields in case the page re-rendered since the errand started.
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capturePage });
  const resolved = values.map((v) => ({ field_id: v.field_id, value: fillPlaceholders(v.value, profile) }));
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillPage, args: [resolved, want] });
  return res?.result || { filled: 0, skipped: [] };
}
// "Fill it here": the form on the tab the user is on, from this browser's details and the errand's values.
// Never submits; passwords, cards and bank fields are left alone (lib/fill-here.js). Vali on the page says the rest.
// tabId and url: the tab and page the panel showed when the user pressed it; refused if the tab has moved on since.
async function fillHere(taskId, tabId, url) {
  const { profile } = await settings();
  const t = taskId ? await findTask(taskId) : null;
  if (!tabId || !/^https?:/.test(url || "")) return { filled: 0, error: "Open the page with the form first." };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !samePage(tab.url, url)) return { filled: 0, error: PAGE_CHANGED };
  const [cap] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capturePage });
  const plan = planFill(cap?.result?.fields, { profile, values: errandValues(t) });
  if (!plan.length) return { filled: 0, error: "I found nothing here I can fill from your details. Check them in settings." };
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillPage, args: [plan.map(({ field_id, value }) => ({ field_id, value })), url] });
  if (res?.result?.error) return { filled: 0, error: res.result.error };
  const filled = res?.result?.filled || 0;
  if (filled) chrome.tabs.sendMessage(tab.id, { type: "vali-say", text: `I filled ${filled} field${filled === 1 ? "" : "s"}. Check and send it yourself.` }).catch(() => {});
  return { filled };
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

// ---------- Vali on the page (content/presence.js, content/explain.js) ----------
// Called synchronously from a click on the page, so Chrome counts it as a user gesture and opens the panel.
function openPanelNow(tabId) {
  try { return chrome.sidePanel.open({ tabId }).then(() => true, () => false); } catch (_) { return Promise.resolve(false); }
}

// The panel picks the prefill up now, or the next time it opens (Alt+V) if Chrome refused to open it.
function openWithPrefill(msg, sender, reply, prefill) {
  const tabId = sender.tab?.id;
  if (!tabId) { reply({ ok: false, error: "No tab." }); return false; }
  const opening = openPanelNow(tabId);
  const pageTitle = String(msg.title || sender.tab.title || "").slice(0, 200);
  chrome.storage.session.set({ prefill: { at: Date.now(), tabId, link: "", selection: "", pageTitle, ...prefill } }).catch(() => {});
  opening.then((opened) => reply({ ok: true, data: { opened } }));
  return true;
}

// An errand started from the page the user is on ("Do it" on a tip, "Ask Vali about this"): it starts right away
// with the page attached, and the panel shows it. opening: openPanelNow(), already called inside the click.
async function startFromPage(tabId, task, selection, opening) {
  const rec = await startTask({ task, tabId, usePage: true, selection });
  await chrome.storage.session.set({ focusTask: rec.id });
  return { opened: await opening };
}
function startFromPageMessage(sender, reply, task, selection = "") {
  const tabId = sender.tab?.id;
  if (!tabId || !task) { reply({ ok: false, error: "Nothing to start." }); return false; }
  startFromPage(tabId, task, selection, openPanelNow(tabId))
    .then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: e?.message || String(e) }));
  return true;
}

// One tip per page from POST /v1/companion, asked at most once per URL per 6 h (chrome.storage.local companionCache).
let tipChain = Promise.resolve();
function withTipCache(fn) {
  tipChain = tipChain.catch(() => {}).then(async () => {
    const { companionCache = {} } = await chrome.storage.local.get("companionCache");
    await chrome.storage.local.set({ companionCache: fn(companionCache) });
  });
  return tipChain;
}

const askingTip = new Map(); // URL -> request in flight, so two tabs on one page ask once
async function companionTip(raw, sender) {
  const { presence, backendUrl, companionCache = {} } = await chrome.storage.local.get(["presence", "backendUrl", "companionCache"]);
  const payload = companionPayload({ ...raw, url: sender.url || raw?.url });
  if (presence === false || !backend.resolveBaseUrl(backendUrl) || !payload || !helpfulPage(payload.url, payload.title)) return null;
  const hit = cachedEntry(companionCache, payload.url);
  if (hit) return hit.seen ? null : hit.tip;
  if (!askingTip.has(payload.url)) askingTip.set(payload.url, askTip(payload).finally(() => askingTip.delete(payload.url)));
  return askingTip.get(payload.url);
}

async function askTip(payload) {
  let entry;
  try {
    await backend.ensureConnected();
    entry = { tip: cleanTip((await backend.companion(payload))?.tip) };
  } catch (_) {
    entry = { tip: null, failed: true }; // no server or no endpoint yet: no tip, ask again later
  }
  await withTipCache((cache) => remember(cache, payload.url, entry));
  return entry.tip;
}

function markTipSeen(url) {
  const key = cacheKey(url);
  return withTipCache((cache) => {
    const hit = key && cachedEntry(cache, key);
    return hit ? remember(cache, key, { ...hit, seen: true }) : cache;
  }).then(() => true);
}

// ---------- messages from the panel and the badge ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === "presence-open") return openWithPrefill(msg, sender, reply, { source: "presence", task: "Help me fill in this form", usePage: true });
  if (msg?.type === "explain") return startFromPageMessage(sender, reply, EXPLAIN_QUESTION, String(msg.selection || "").trim().slice(0, 4000));
  if (msg?.type === "companion-do") return startFromPageMessage(sender, reply, String(msg.task || "").trim().slice(0, 2000));
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
    "companion-tip": () => companionTip(msg.page, sender),
    "companion-seen": () => markTipSeen(sender.url),
    fill: () => fillForm(msg.taskId),
    fillHere: () => fillHere(msg.taskId, msg.tabId, msg.url),
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
