import { blockerOf, LIVE } from "./execution.js";

// One plain status for every errand, with a tone for whose turn comes next.
export function errandStatus(t) {
  const x = t.execution;
  if (x?.status) {
    const blocker = blockerOf(x);
    if (blocker) return [blocker.kind === "login" || blocker.kind === "suomifi" ? "Needs login" : blocker.kind === "suspicious" ? "Couldn't finish" : "Needs you", blocker.kind === "suspicious" ? "danger" : "warning"];
    if (x.status === "awaiting_approval" || x.question && LIVE.has(x.status)) return ["Waiting for your OK", "warning"];
    if (LIVE.has(x.status)) return ["Working", ""];
    if (x.status === "done") return ["Done", "success"];
    if (x.status === "stopped") return ["Stopped", "muted"];
    return ["Couldn't finish", "danger"];
  }
  if (t.status === "queued" || t.status === "running") return ["Working", ""];
  if (t.status === "cancelled") return ["Stopped", "muted"];
  if (t.status === "failed" || t.output?.structured?.status === "not_possible") return ["Couldn't finish", "danger"];
  if (["ready_to_approve", "needs_info"].includes(t.output?.structured?.status)) return ["Waiting for your OK", "warning"];
  return ["Done", "success"];
}
