// What the panel shows for an errand's cloud browser run (task.execution, see docs/SANDBOX.md).
// Pure, so it runs in Node tests too. The panel renders the view with textContent only.

import { fillPlaceholders } from "./actions.js";

// The live frame is worth showing while the browser is open on the page.
export const LIVE = new Set(["starting", "running", "awaiting_approval", "submitting"]);

const http = (u) => {
  try {
    const x = new URL(String(u || ""));
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch (_) {
    return null;
  }
};
const host = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
};

// The agent ends a blocked run with failed and a result like "needs login/captcha: finish by hand at <url>",
// "needs unavailable: <outage>; finish by hand later at <url>" or "suspicious page: <one line>"
// (backend/vali_agent/agent.py). Any other "needs <kind>:" is still a hand-off. Returns null when the failure is not a blocker.
export function blockerOf(x) {
  if (!x || x.status !== "failed") return null;
  const text = String(x.result || x.error || "").trim();
  const url = http(x.current_url) || http((text.match(/finish by hand (?:later )?at (\S+)/i) || [])[1]?.replace(/[.,;)]+$/, "")) || http(x.start_url);
  const needs = text.match(/^needs ([a-z/ ]+?)\s*(?::|$)/i);
  const sus = text.match(/suspicious page\s*:?\s*(.*)$/i);
  let kind = null;
  let reason = "";
  if (needs) {
    const what = needs[1].toLowerCase().split("/").map((s) => s.trim());
    if (what.includes("captcha")) {
      kind = "captcha";
      reason = "The site shows a CAPTCHA. Only you can solve it.";
    } else if (what.includes("login")) {
      const suomi = /(^|\.)suomi\.fi$/i.test(host(url)) || /suomi\.fi|tunnistaudu|tunnistus/i.test(text);
      kind = suomi ? "suomifi" : "login";
      reason = suomi ? "The site asks for Suomi.fi identification. Log in yourself to go on." : "The site needs you to log in. Vali never handles passwords.";
    } else if (what.includes("payment")) {
      kind = "payment";
      reason = "Payment is next. Pay in your own tab.";
    } else if (what.includes("unavailable")) {
      kind = "unavailable";
      reason = outageReason(text);
    } else {
      kind = what[0];
      reason = "Vali needs you for this step. Finish it in your own tab.";
    }
  } else if (sus) {
    kind = "suspicious";
    const line = sus[1].replace(/\s+/g, " ").trim().slice(0, 140);
    reason = "Vali stopped: the page looked suspicious" + (line ? ` (${line})` : ".");
  }
  if (!kind) return null;
  return { kind, reason, url };
}

// "needs unavailable: down for maintenance until Sat 16:00; finish by hand later at <url>" -> one plain line.
function outageReason(text) {
  const said = text.replace(/^needs unavailable\s*:?\s*/i, "").split(/finish by hand/i)[0].replace(/\s+/g, " ").replace(/[\s.;,]+$/, "").trim().slice(0, 200);
  return (said ? said[0].toUpperCase() + said.slice(1) : "The site is down right now") + ". Finish by hand later.";
}

const rows = (list, profile) =>
  (Array.isArray(list) ? list : [])
    .filter((f) => f && (f.label || f.value))
    .map((f) => {
      const src = http(f.source);
      return {
        label: String(f.label || ""),
        value: fillPlaceholders(String(f.value ?? ""), profile),
        source: src,
        sourceHost: src ? host(src) : "",
        sourceText: !src && f.source ? String(f.source) : "",
      };
    });

// One view of the run: which section to show and everything it needs.
// answered: the question.at the user already answered here, so the box does not come back while the agent reads it.
export function executionView(t, { profile = {}, answered = null } = {}) {
  const x = t?.execution;
  if (!x?.status) return null;
  // The server only ever holds {{placeholders}}; the user's own details go back in here, on the device.
  const fill = (s) => fillPlaceholders(String(s || ""), profile);
  const steps = Array.isArray(x.steps) ? x.steps : [];
  const step = steps.length ? fill(steps[steps.length - 1]?.text) : "";
  const q = x.question && typeof x.question === "object" ? x.question : x.question ? { text: String(x.question) } : null;
  const question = q?.text && LIVE.has(x.status) ? { text: fill(q.text), at: q.at || q.text, answered: answered != null && answered === (q.at || q.text) } : null;
  const blocker = blockerOf(x);
  const phase =
    x.status === "awaiting_approval" ? "approval"
    : LIVE.has(x.status) ? "live"
    : blocker ? "blocked"
    : x.status; // done, failed, stopped
  const lastShot = steps.map((s) => s?.shot).filter((n) => n != null).pop() ?? (Array.isArray(x.shots) && x.shots.length ? x.shots[x.shots.length - 1].n : null);
  return {
    status: x.status,
    phase,
    live: LIVE.has(x.status),
    step,
    stepCount: steps.length,
    lastShot,
    question,
    summary: fill(x.approval?.summary),
    approval: rows(x.approval?.filled, profile),
    blocker,
    filled: rows(x.filled, profile),
    url: http(x.current_url) || http(x.start_url),
    result: fill(x.result),
    error: fill(x.error),
  };
}
