import { errandStatus } from "../lib/panel-state.js";
import { hasNextStep } from "../lib/mascot.js";

// "Waiting for your OK" only when there is something to approve (see hasNextStep). A plain answer to a find / check
// errand is Done ("New answer" until opened).
export function panelStatus(t) {
  const plain = !t.execution?.status && t.status === "completed" && t.output?.structured?.status === "ready_to_approve" && !hasNextStep(t);
  return plain ? [t.seen ? "Done" : "New answer", "success"] : errandStatus(t);
}
