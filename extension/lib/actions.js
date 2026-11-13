// Turns the agent's structured result into things the user can approve: links, drafts, calendar entries, sources.
// Pure functions, no chrome.* calls, so they run in Node tests too.

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/gi;

// Replace {{name}}-style placeholders with the user's saved details. Unknown ones stay visible so the user notices.
export function fillPlaceholders(text, profile = {}) {
  if (text == null) return text;
  return String(text).replace(TOKEN, (m, key) => {
    const v = profile[key.toLowerCase()];
    return v != null && String(v).trim() !== "" ? String(v) : m;
  });
}

export function unfilledPlaceholders(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(TOKEN)) out.add(m[1].toLowerCase());
  return [...out];
}

export function mailtoUrl({ to, subject, body }) {
  const q = [];
  if (subject) q.push("subject=" + encodeURIComponent(subject));
  if (body) q.push("body=" + encodeURIComponent(body));
  return `mailto:${encodeURIComponent(to || "").replace(/%40/g, "@")}${q.length ? "?" + q.join("&") : ""}`;
}

export function gmailUrl({ to, subject, body }) {
  const p = new URLSearchParams({ view: "cm", fs: "1" });
  if (to) p.set("to", to);
  if (subject) p.set("su", subject);
  if (body) p.set("body", body);
  return "https://mail.google.com/mail/?" + p.toString();
}

// "2026-11-20" -> all-day; "2026-11-20T10:00" -> timed (local time, Google reads it in the user's zone).
function gcalStamp(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return m[4] ? `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00` : `${m[1]}${m[2]}${m[3]}`;
}

function nextDay(stamp) {
  const d = new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8) + 1));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function calendarUrl({ label, body, start, end, location }) {
  const s = gcalStamp(start);
  if (!s) return null;
  let e = gcalStamp(end);
  if (!e) e = s.length === 8 ? nextDay(s) : s.replace(/T(\d{2})/, (_, h) => "T" + String(Math.min(23, +h + 1)).padStart(2, "0"));
  const p = new URLSearchParams({ action: "TEMPLATE", text: label || "Errand", dates: `${s}/${e}` });
  if (body) p.set("details", body);
  if (location) p.set("location", location);
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

export function safeHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch (_) {
    return null;
  }
}

// Number every distinct source once, and map each output field to its source numbers.
// grounding: [{ field: "steps[0].detail", citations: [{url, title}], confidence }]
export function numberSources(grounding = []) {
  const sources = [];
  const index = new Map();
  const byField = {};
  for (const g of grounding || []) {
    const nums = [];
    for (const c of g.citations || []) {
      const url = safeHttpUrl(c.url);
      if (!url) continue;
      if (!index.has(url)) {
        index.set(url, sources.length + 1);
        sources.push({ n: sources.length + 1, url, title: c.title || hostOf(url), host: hostOf(url) });
      }
      nums.push(index.get(url));
    }
    if (nums.length) byField[normField(g.field)] = { nums: [...new Set(nums)], confidence: g.confidence || null };
  }
  return { sources, byField };
}

function normField(f) {
  return String(f || "").replace(/^\$\.?/, "").replace(/\.(\d+)(?=\.|$)/g, "[$1]");
}

// Source numbers for a field and everything under it, e.g. "steps[1]" collects steps[1].title and steps[1].detail.
export function citesFor(byField, prefix) {
  const out = new Set();
  let confidence = null;
  for (const [f, v] of Object.entries(byField || {})) {
    if (f === prefix || f.startsWith(prefix + ".") || f.startsWith(prefix + "[")) {
      v.nums.forEach((n) => out.add(n));
      if (v.confidence === "low" || (v.confidence === "medium" && confidence !== "low")) confidence = v.confidence;
      else if (!confidence) confidence = v.confidence;
    }
  }
  return { nums: [...out].sort((a, b) => a - b), confidence };
}

export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
}

// One approved action -> what the button does.
export function resolveAction(action, profile) {
  const a = { ...action };
  for (const k of ["subject", "body", "label", "location", "to"]) if (a[k]) a[k] = fillPlaceholders(a[k], profile);
  const missing = unfilledPlaceholders([a.subject, a.body, a.to].join(" "));
  switch (a.type) {
    case "email":
      return { kind: "email", mailto: mailtoUrl(a), gmail: gmailUrl(a), text: a.body || "", missing, action: a };
    case "calendar":
      return { kind: "link", url: calendarUrl(a), missing, action: a };
    case "open_link":
      return { kind: "link", url: safeHttpUrl(a.url), missing, action: a };
    case "phone_call":
      return { kind: "link", url: a.to ? "tel:" + String(a.to).replace(/[^\d+]/g, "") : null, text: a.body || "", missing, action: a };
    default:
      return { kind: "copy", text: a.body || a.label || "", missing, action: a };
  }
}
