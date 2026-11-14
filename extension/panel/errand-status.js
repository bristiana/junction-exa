import { errandStatus } from "../lib/panel-state.js";

// "Waiting for your OK" only when there is something to approve: a prepared action or form, or a claim / book / write
// errand whose next step is to do it. A plain answer to a find / check errand is Done ("New answer" until opened).
const DO_IT = new Set(["claim", "book", "write"]);
export function hasNextStep(t) {
  const s = t.output?.structured;
  return s?.status === "ready_to_approve" && !!(s.actions?.length || s.form_fill?.length || DO_IT.has(t.mode));
}

export function panelStatus(t) {
  const plain = !t.execution?.status && t.status === "completed" && t.output?.structured?.status === "ready_to_approve" && !hasNextStep(t);
  return plain ? [t.seen ? "Done" : "New answer", "success"] : errandStatus(t);
}
