// Client for the Vali API (docs/ARCHITECTURE.md). Used when a "Vali server" URL is set in settings;
// without one the extension talks to Exa directly (lib/exa.js).
// The base URL and the bearer token live in chrome.storage.local (backendUrl, backendToken). The token is never logged.
// createClient() and the mapping helpers are pure, so they run in Node tests too.

import { TERMINAL } from "./exa.js";
import { redactText } from "./redact.js";

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

// "127.0.0.1:8787/" -> "http://127.0.0.1:8787"; "hoida.example.modal.run" -> "https://hoida.example.modal.run"
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

export function createClient({ baseUrl = "", token = "", fetchImpl = globalThis.fetch } = {}) {
  async function call(path, { method = "GET", body, auth = true } = {}) {
    if (!baseUrl) throw new BackendError(0, "Set the Vali server in settings.");
    const headers = { Accept: "application/json" };
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
    pair: () => call("/v1/pair", { method: "POST", body: {} }),
    syncProfile: (profile) => call("/v1/profile", { method: "PUT", body: { profile: profile || {} } }),
    createTask: ({ task, page, effort, previous_task_id } = {}) =>
      call("/v1/tasks", { method: "POST", body: clean({ task, page, effort, previous_task_id }) }),
    listTasks: (limit = 30) => call(`/v1/tasks?limit=${limit}`),
    getTask: (taskId) => call(`/v1/tasks/${id(taskId)}`),
    cancel: (taskId) => call(`/v1/tasks/${id(taskId)}/cancel`, { method: "POST", body: {} }),
    execute: (taskId, { action_index, start_url, goal, profile } = {}) =>
      call(`/v1/tasks/${id(taskId)}/execute`, { method: "POST", body: clean({ action_index, start_url, goal, profile }) }),
    approve: (taskId) => call(`/v1/tasks/${id(taskId)}/approve`, { method: "POST", body: {} }),
    stop: (taskId) => call(`/v1/tasks/${id(taskId)}/stop`, { method: "POST", body: {} }),
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
  return { baseUrl: s.backendUrl || "", token: s.backendToken || "" };
}
async function configured() {
  return createClient(await loadConfig());
}

export const createUser = async () => (await configured()).createUser();
export const me = async () => (await configured()).me();
export const pair = async () => (await configured()).pair();
export const syncProfile = async (profile) => (await configured()).syncProfile(profile);
export const createTask = async (body) => (await configured()).createTask(body);
export const listTasks = async (limit) => (await configured()).listTasks(limit);
export const getTask = async (taskId) => (await configured()).getTask(taskId);
export const cancel = async (taskId) => (await configured()).cancel(taskId);
export const execute = async (taskId, opts) => (await configured()).execute(taskId, opts);
export const approve = async (taskId) => (await configured()).approve(taskId);
export const stop = async (taskId) => (await configured()).stop(taskId);
export const shotUrl = async (task, n) => (await configured()).shotUrl(task, n);

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
