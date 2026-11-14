// "Ask Vali anything" from the mascot on a page (content/presence.js): what the errand is started with and what the
// bubble shows of it. Only the typed question and the page address (no query or fragment) leave the page: never the
// page text, the selection, form fields or their values. Pure, so test/ask.test.mjs runs it in Node.

import { TERMINAL } from "./exa.js";
import { numberSources, safeHttpUrl, hostOf } from "./actions.js";
import { cacheKey } from "./companion.js";

export const ASK_MAX = 500;
export const ASK_SNIPPET_MAX = 280;

// The question as typed, one line, clipped. "" when there is nothing to ask.
export function askQuestion(text) {
  const q = String(text ?? "").replace(/\s+/g, " ").trim();
  return q.length >= 2 ? q.slice(0, ASK_MAX) : "";
}

// The page the question was asked on, as the errand API's "page": its address without the query and fragment
// (they can carry personal data). null on pages that are not ordinary web pages.
export function askPage(url) {
  const key = cacheKey(url);
  return key ? { url: key } : null;
}

// The first n sentences of the answer, without citation markers or markdown, clipped to max characters.
export function firstSentences(text, n = 2, max = ASK_SNIPPET_MAX) {
  const s = String(text || "")
    .replace(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, "") // [1], [1, 2]
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1") // [text](url)
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  // A sentence ends at . ! ? followed by a space and a capital, digit or quote; "e.g. the" and "€1.50" stay whole.
  const out = s.split(/(?<=[.!?])\s+(?=["“(\p{Lu}\p{N}])/u).slice(0, n).join(" ").replace(/\s+([.,;:!?])/g, "$1");
  return out.length > max ? out.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : out;
}

// The source the answer leans on most: the first source of the first claim that has one, else the first verified
// source, else the first cited one.
export function topSource(output) {
  const out = output || {};
  const sources = Array.isArray(out.sources) ? out.sources : [];
  const byN = (n) => sources.find((s) => s?.n === n) || sources[n - 1];
  const candidates = [];
  for (const c of Array.isArray(out.claims) ? out.claims : []) {
    for (const ref of Array.isArray(c?.sources) ? c.sources : []) candidates.push(typeof ref === "number" ? byN(ref) : ref);
  }
  candidates.push(...sources);
  const map = numberSources(out.grounding);
  candidates.push(...(map.byField.answer?.nums || []).map((n) => map.sources[n - 1]), ...map.sources);
  for (const c of candidates) {
    const url = safeHttpUrl(c?.url);
    if (url) return { url, domain: hostOf(url) };
  }
  return null;
}

// What the bubble shows for a local task record (background.js tasks list).
// state: "thinking" (queued), "searching" (running), "done", "failed".
export function askView(t) {
  if (!t) return { state: "failed", error: "That question is gone. Ask again." };
  const status = t.status || "queued";
  if (!TERMINAL.has(status)) return { id: t.id, state: status === "queued" || status === "pending" ? "thinking" : "searching" };
  if (status !== "completed") {
    return { id: t.id, state: "failed", error: status === "cancelled" ? "That question was cancelled." : t.error || "Vali could not answer that. Try again." };
  }
  const out = t.output || {};
  const text = firstSentences(out.structured?.answer || out.text || "");
  if (!text) return { id: t.id, state: "failed", error: "No answer came back. Open it in the panel." };
  return { id: t.id, state: "done", text, source: topSource(out) };
}
