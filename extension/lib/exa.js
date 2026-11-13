// Thin client for the Exa API (https://exa.ai/docs). Works in the service worker, the side panel and Node 18+.
// The key is passed in by the caller; it is never hardcoded or logged.

const BASE = "https://api.exa.ai";

export class ExaError extends Error {
  constructor(status, body) {
    const msg = body?.error?.message || body?.message || body?.error || `HTTP ${status}`;
    super(typeof msg === "string" ? msg : JSON.stringify(msg));
    this.status = status;
    this.code = body?.error?.code || body?.code || null;
  }
}

async function call(key, path, { method = "GET", body, signal } = {}) {
  if (!key) throw new ExaError(401, { message: "Add your Exa API key in Hoida's settings." });
  const res = await fetch(BASE + path, {
    method,
    signal,
    headers: { "x-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { message: text.slice(0, 300) }; }
  if (!res.ok) throw new ExaError(res.status, json);
  return json;
}

// Exa Agent: async multi-step research with structured output and field-level citations.
export function createRun(key, request) {
  return call(key, "/agent/runs", { method: "POST", body: request });
}

export function getRun(key, id) {
  return call(key, `/agent/runs/${encodeURIComponent(id)}`);
}

export function cancelRun(key, id) {
  return call(key, `/agent/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} });
}

// Stored events of a run (search traces, sources found so far). Used for the live progress view.
export function getRunEvents(key, id, limit = 100) {
  return call(key, `/agent/runs/${encodeURIComponent(id)}/events?limit=${limit}`);
}

// Contents: clean text of a page we already have (used when the task is about the page you are on).
export function getContents(key, urls, opts = {}) {
  return call(key, "/contents", { method: "POST", body: { urls, text: { maxCharacters: 8000 }, ...opts } });
}

// Search: quick sourced lookup, used for the key check in settings.
export function search(key, query, opts = {}) {
  return call(key, "/search", { method: "POST", body: { query, type: "auto", numResults: 3, contents: { highlights: true }, ...opts } });
}

export const TERMINAL = new Set(["completed", "failed", "cancelled"]);
