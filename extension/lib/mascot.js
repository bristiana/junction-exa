// Which pose the Vali mascot takes: one per errand (the still on each card) and one for the panel header
// (the animated one, following the errand that matters most). Pure, so it runs in Node tests too.
// Poses are the states of lib/butler.js; the stills live in extension/mascot/<pose>.svg.

export const POSES = ["idle", "listening", "thinking", "searching", "working", "needs_approval", "success", "error"];
export const STILLS = ["idle", "searching", "working", "needs_approval", "success", "error"]; // the ones a card can show
export const FLASH_MS = { success: 4000, error: 6000 };
const BUSY = new Set(["searching", "working"]);
const asks = (t) => !!t?.execution?.question?.text && ["starting", "running", "submitting"].includes(t.execution.status);

// A finished answer is "ready_to_approve" even when there is nothing to approve. Only a prepared action or form, or a
// claim / book / write errand whose next step is to do it, is a real next step; a plain answer is just done.
const DO_IT = new Set(["claim", "book", "write"]);
export function hasNextStep(t) {
  const s = t.output?.structured;
  // A link to open is an option, not a step to approve (the web shows it as Done too); drafts and forms are.
  const steps = (s?.actions || []).filter((a) => a?.type !== "open_link");
  return s?.status === "ready_to_approve" && !!(steps.length || s.form_fill?.length || DO_IT.has(t.mode));
}

// One errand. The browser run (execution) comes after research, so once it exists it decides.
export function taskMascot(t) {
  const x = t?.execution?.status;
  if (x) {
    if (x === "awaiting_approval") return "needs_approval";
    if (asks(t)) return "needs_approval"; // the browser waits for an answer
    if (x === "done") return "success";
    if (x === "failed") return "error";
    if (x === "stopped") return "idle";
    return "working"; // starting, running, submitting
  }
  switch (t?.status) {
    case "completed": {
      const s = t.output?.structured?.status;
      if (s === "needs_info" || hasNextStep(t)) return "needs_approval";
      if (s === "not_possible") return "error";
      return "success";
    }
    case "failed":
      return "error";
    case "cancelled":
      return "idle";
    default:
      return "searching"; // queued, running, and any other status Exa reports: research searches the web with Exa
  }
}

// Does this errand wait for the user right now? A browser run on hold always does; a finished research result
// with something to approve or answer only until the user has opened it.
function waits(t) {
  return taskMascot(t) === "needs_approval" && (t.execution?.status === "awaiting_approval" || asks(t) || !t.seen);
}

// The header: typing beats everything, then a short flash after something finished, then whatever needs the user,
// then the cloud browser, then research.
export function headerMascot(tasks = [], { focused = false, flash = null, now = Date.now() } = {}) {
  if (focused) return "listening";
  if (flash && flash.until > now && POSES.includes(flash.state)) return flash.state;
  const list = tasks || [];
  if (list.some(waits)) return "needs_approval";
  const poses = list.map(taskMascot);
  if (poses.includes("working")) return "working";
  if (poses.includes("searching")) return "searching";
  return "idle";
}

// Compares the poses from the last update (Map id -> pose) with the tasks now. Returns "error" if a running errand
// just failed, "success" if one just finished (research done, or the browser run submitted), otherwise null.
export function finishFlash(before, tasks = []) {
  let out = null;
  for (const t of tasks || []) {
    const prev = before?.get?.(t.id);
    if (!BUSY.has(prev)) continue;
    const now = taskMascot(t);
    if (now === "error") return "error";
    if (now === "success" || (now === "needs_approval" && !t.execution)) out = "success";
  }
  return out;
}
