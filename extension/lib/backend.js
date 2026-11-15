// Client for the Vali API (docs/ARCHITECTURE.md). The deployed Vali server is the default; settings can point it
// elsewhere (a local server, the mock) or clear it, and then the extension talks to Exa directly (lib/exa.js).
// The base URL and the bearer token live in chrome.storage.local (backendUrl, backendToken). The token is never logged.
// backendUrl missing = the default server; "" = direct mode, chosen in settings.
// createClient() and the mapping helpers are pure, so they run in Node tests too.

import { TERMINAL } from "./exa.js";
import { redactText } from "./redact.js";

export const DEFAULT_BASE_URL = "https://bogdan-c-2206--vali-web.us-east.modal.run";

// The stored backendUrl -> the server to use ("" = direct mode).
export function resolveBaseUrl(stored) {
  return stored === undefined || stored === null ? DEFAULT_BASE_URL : String(stored);
}

export class BackendError extends Error {
  constructor(status, body) {
    const d = body?.detail;
    const msg =
      (typeof body === "string" && body) ||
      (typeof d === "string" && d) ||
      (Array.isArray(d) && d[0]?.msg) ||
      body?.error?.message ||
      (typeof body?.error === "string" && body.error) ||
      body?.message ||
      `The Vali server answered HTTP ${status}.`;
    super(String(msg));
    this.status = status;
    this.backend = true;
  }
}

// "127.0.0.1:8787/" -> "http://127.0.0.1:8787"; "vali.example.modal.run" -> "https://vali.example.modal.run"
export function normalizeBaseUrl(input) {
  let s = String(input || "").trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|127\.|\[::1\])/i.test(s) ? "http://" : "https://") + s;
  let u;
  try { u = new URL(s); } catch (_) { throw new BackendError(0, "That server URL does not look right."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new BackendError(0, "The server URL must start with https://.");
  return (u.origin + u.pathname).replace(/\/+$/, "");
}

const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));

export function createClient({ baseUrl = "", token = "", fetchImpl = globalThis.fetch, channel = "extension" } = {}) {
  async function call(path, { method = "GET", body, auth = true } = {}) {
    if (!baseUrl) throw new BackendError(0, "Set the Vali server in settings.");
    const headers = { Accept: "application/json", "X-Vali-Channel": channel };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      if (!token) throw new BackendError(401, "Press Connect in settings first.");
      headers.Authorization = "Bearer " + token;
    }
    let res;
    try {
      res = await fetchImpl(baseUrl + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (_) {
      throw new BackendError(0, "Can't reach the Vali server.");
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = text.slice(0, 300); }
    if (!res.ok) throw new BackendError(res.status, json);
    return json;
  }
  const id = (x) => encodeURIComponent(String(x));
  return {
    createUser: () => call("/v1/users", { method: "POST", body: {}, auth: false }),
    me: () => call("/v1/me"),
    linkCode: () => call("/v1/link/code", { method: "POST", body: {} }),
    redeemLink: (code) => call("/v1/link", { method: "POST", body: { code }, auth: false }),
    login: (email, password) => call("/v1/auth/login", { method: "POST", body: { email, password }, auth: false }),
    pair: () => call("/v1/pair", { method: "POST", body: {} }),
    createTask: ({ task, page, effort, previous_task_id } = {}) =>
      call("/v1/tasks", { method: "POST", body: clean({ task, page, effort, previous_task_id }) }),
    // A tip for the page the user is on (lib/companion.js builds the body): { tip } or { tip: null }.
    companion: (page) => call("/v1/companion", { method: "POST", body: page }),
    listTasks: (limit = 30) => call(`/v1/tasks?limit=${limit}`),
    // Totals for this user: { total, exa: { searches, pages_read }, cost_usd, ... } (the panel's stats strip).
    stats: () => call("/v1/stats"),
    getTask: (taskId) => call(`/v1/tasks/${id(taskId)}`),
    cancel: (taskId) => call(`/v1/tasks/${id(taskId)}/cancel`, { method: "POST", body: {} }),
    // The only request that carries the profile: the cloud browser types it into the form the user approved.
    execute: (taskId, { action_index, start_url, goal, profile } = {}) =>
      call(`/v1/tasks/${id(taskId)}/execute`, { method: "POST", body: clean({ action_index, start_url, goal, profile }) }),
    approve: (taskId) => call(`/v1/tasks/${id(taskId)}/approve`, { method: "POST", body: {} }),
    stop: (taskId) => call(`/v1/tasks/${id(taskId)}/stop`, { method: "POST", body: {} }),
    // "Continue in my browser": { url, cookies } once, within 15 minutes of the stop. The cookies are secrets.
    handoff: (taskId) => call(`/v1/tasks/${id(taskId)}/handoff`, { method: "POST", body: {} }),
    // A message to the running browser (the answer to execution.question); the agent reads it between steps.
    message: (taskId, text) => call(`/v1/tasks/${id(taskId)}/messages`, { method: "POST", body: { text: String(text || "") } }),
    // The newest frame of the live browser view. The image endpoint takes the token as ?t= (an <img> sends no headers).
    liveUrl(task) {
      const taskId = task?.remoteId || task?.id;
      if (!baseUrl || !token || !taskId) return null;
      const u = new URL(`${baseUrl}/v1/tasks/${id(taskId)}/live.jpg`);
      u.searchParams.set("t", token);
      return u.href;
    },
    // Screenshot n of a task's browser run: Cloudinary URLs as they are, API-served ones with the token as ?t=.
    shotUrl(task, n) {
      const taskId = task?.remoteId || task?.id;
      const shot = (task?.execution?.shots || []).find((s) => Number(s.n) === Number(n));
      const raw = shot?.url || (taskId && n != null ? `/v1/tasks/${id(taskId)}/shots/${Number(n)}.jpg` : "");
      if (!raw) return null;
      if (raw.startsWith("/")) {
        if (!baseUrl) return null;
        const u = new URL(baseUrl + raw);
        if (token) u.searchParams.set("t", token);
        return u.href;
      }
      try {
        const u = new URL(raw);
        if (u.protocol !== "https:" && u.protocol !== "http:") return null;
        if (baseUrl && u.href.startsWith(baseUrl + "/") && token && !u.searchParams.has("t")) u.searchParams.set("t", token);
        return u.href;
      } catch (_) {
        return null;
      }
    },
  };
}

// ---------- the configured server (chrome.storage.local) ----------
export async function loadConfig() {
  const s = await chrome.storage.local.get(["backendUrl", "backendToken"]);
  return { baseUrl: resolveBaseUrl(s.backendUrl), token: s.backendToken || "" };
}
async function configured() {
  return createClient(await loadConfig());
}

export const createUser = async () => (await configured()).createUser();
export const me = async () => (await configured()).me();
export const linkCode = async () => (await configured()).linkCode();
export const pair = async () => (await configured()).pair();
export const createTask = async (body) => (await configured()).createTask(body);
export const companion = async (page) => (await configured()).companion(page);
export const listTasks = async (limit) => (await configured()).listTasks(limit);
export const stats = async () => (await configured()).stats();
export const getTask = async (taskId) => (await configured()).getTask(taskId);
export const cancel = async (taskId) => (await configured()).cancel(taskId);
export const execute = async (taskId, opts) => (await configured()).execute(taskId, opts);
export const approve = async (taskId) => (await configured()).approve(taskId);
export const stop = async (taskId) => (await configured()).stop(taskId);
export const handoff = async (taskId) => (await configured()).handoff(taskId);
export const shotUrl = async (task, n) => (await configured()).shotUrl(task, n);
export const message = async (taskId, text) => (await configured()).message(taskId, text);
export const liveUrl = async (task) => (await configured()).liveUrl(task);

// With the default server nobody pressed Connect, so get a user on first use. No-op in direct mode or when this
// browser already has a token for the server in use.
export async function ensureConnected() {
  const s = await chrome.storage.local.get(["backendUrl", "backendToken", "backendTokenUrl"]);
  const baseUrl = resolveBaseUrl(s.backendUrl);
  if (!baseUrl) return null;
  if (s.backendToken && s.backendTokenUrl === normalizeBaseUrl(baseUrl)) return null;
  return connect(baseUrl);
}

// Saves the server URL. The first time a URL is saved this browser gets a user (POST /v1/users) and keeps its token.
// A token is reused when the same URL is saved again, so a WhatsApp link survives switching back and forth.
export async function connect(url) {
  const baseUrl = normalizeBaseUrl(url);
  if (!baseUrl) throw new BackendError(0, "Enter the Vali server URL.");
  const s = await chrome.storage.local.get(["backendToken", "backendTokenUrl"]);
  let token = s.backendTokenUrl === baseUrl ? s.backendToken || "" : "";
  const fresh = async () => {
    const u = await createClient({ baseUrl }).createUser();
    if (!u?.token) throw new BackendError(500, "The server did not hand out a token.");
    token = u.token;
    await chrome.storage.local.set({ backendToken: token, backendTokenUrl: baseUrl, backendUserId: u.user_id || "" });
  };
  if (!token) await fresh();
  let who;
  try {
    who = await createClient({ baseUrl, token }).me();
  } catch (e) {
    if (e.status !== 401) throw e;
    await fresh(); // the server forgot us (fresh database): start over
    who = await createClient({ baseUrl, token }).me();
  }
  await chrome.storage.local.set({ backendUrl: baseUrl });
  return who;
}

// ---------- mapping the server's Task to the panel's local record ----------
const EXEC_ACTIVE = new Set(["starting", "running", "awaiting_approval", "submitting"]);

function time(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : null;
}

// True while research or the browser run is still going, so the task needs polling.
export function isActive(t) {
  return !TERMINAL.has(t?.status) || EXEC_ACTIVE.has(t?.execution?.status);
}

// remote: the API's Task. prev: the local record it replaces (keeps tabId, page fields, seen, parentId).
export function toLocalTask(remote, prev = null) {
  const r = remote?.research || {};
  const status = r.status || "queued";
  const terminal = TERMINAL.has(status);
  const err = r.error;
  const error = typeof err === "string" ? err : err?.message || (status === "failed" ? "The run failed." : null);
  const rp = remote?.page;
  return {
    ...(prev || {}),
    id: prev?.id || remote.id,
    remoteId: remote.id,
    backend: true,
    parentId: prev?.parentId ?? null,
    runId: r.run_id || prev?.runId || null,
    task: remote.task ?? prev?.task ?? "",
    createdAt: time(remote.created_at) ?? prev?.createdAt ?? Date.now(),
    status,
    tabId: prev?.tabId ?? null,
    page: prev?.page ?? (rp ? { url: rp.url || "", title: rp.title || "", fields: rp.fields || [], hadSelection: false } : null),
    progress: Array.isArray(r.progress) && r.progress.length ? r.progress.slice(-12) : prev?.progress || [],
    output: r.output ?? null,
    error,
    cost: r.cost ?? null,
    stopReason: r.stop_reason ?? null,
    completedAt: terminal ? prev?.completedAt || time(remote.updated_at) || Date.now() : null,
    seen: prev?.seen ?? false,
    mode: remote.mode ?? null,
    research: { kind: r.kind, sources: r.sources, citations: r.citations, usage: r.usage, activity: r.activity,
      watch_id: r.watch_id, monitor_stubbed: r.monitor_stubbed, reused_from: r.reused_from, question: r.question ?? null },
    source: remote.source || "extension",
    execution: remote.execution ?? null,
  };
}

// Merges a page of server tasks into the local list. Returns the new list (newest first) and the tasks whose research
// finished since the last poll (for notifications). Tasks removed in this browser stay hidden.
export function mergeRemoteTasks(local, remote, { hidden = [] } = {}) {
  const skip = new Set(hidden);
  const tasks = [...(local || [])];
  const finished = [];
  for (const r of remote || []) {
    if (!r?.id || skip.has(r.id)) continue;
    const i = tasks.findIndex((t) => t.remoteId === r.id);
    const prev = i >= 0 ? tasks[i] : null;
    const next = toLocalTask(r, prev);
    if (prev) {
      tasks[i] = next;
      if (!TERMINAL.has(prev.status) && next.status === "completed") finished.push(next);
    } else {
      tasks.push(next);
    }
  }
  tasks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { tasks, finished };
}

// What the server gets from the captured page: redacted text, no typed field values.
export function backendPage(page) {
  if (!page) return null;
  const fields = (page.fields || []).map((f) => clean({ id: f.id, label: f.label, type: f.type, required: !!f.required, options: f.options?.length ? f.options : undefined }));
  return clean({
    url: page.url || "",
    title: redactText(page.title || ""),
    selection: redactText(page.selection || ""),
    text: redactText(page.text || ""),
    fields,
  });
}
