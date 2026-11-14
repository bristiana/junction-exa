import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { taskMascot, headerMascot, finishFlash, POSES, STILLS } from "../extension/lib/mascot.js";
import { createClient, toLocalTask } from "../extension/lib/backend.js";
import { createMockServer } from "../scripts/mock-backend.mjs";

const research = (status, result) => ({ id: status + (result || ""), status, output: result ? { structured: { status: result } } : null });
const exec = (status) => ({ id: "x" + status, status: "completed", output: { structured: { status: "ready_to_approve" } }, execution: { status } });

test("each errand gets the pose for where it is", () => {
  assert.equal(taskMascot(research("queued")), "thinking");
  assert.equal(taskMascot(research("running")), "thinking");
  assert.equal(taskMascot(research("pending")), "thinking");
  assert.equal(taskMascot(research("completed", "info_only")), "success");
  assert.equal(taskMascot(research("completed")), "success");
  assert.equal(taskMascot(research("completed", "ready_to_approve")), "needs_approval");
  assert.equal(taskMascot(research("completed", "needs_info")), "needs_approval");
  assert.equal(taskMascot(research("completed", "not_possible")), "error");
  assert.equal(taskMascot(research("failed")), "error");
  assert.equal(taskMascot(research("cancelled")), "idle");
  for (const s of ["starting", "running", "submitting"]) assert.equal(taskMascot(exec(s)), "working", s);
  assert.equal(taskMascot(exec("awaiting_approval")), "needs_approval");
  assert.equal(taskMascot(exec("done")), "success");
  assert.equal(taskMascot(exec("failed")), "error");
  assert.equal(taskMascot(exec("stopped")), "idle");
});

test("the header follows the errand that matters most", () => {
  const running = research("running");
  const browsing = exec("running");
  const waiting = exec("awaiting_approval");
  const done = research("completed", "info_only");
  assert.equal(headerMascot([]), "idle");
  assert.equal(headerMascot([done]), "idle");
  assert.equal(headerMascot([done, running]), "thinking");
  assert.equal(headerMascot([running, browsing]), "working");
  assert.equal(headerMascot([running, browsing, waiting]), "needs_approval");
  assert.equal(headerMascot([waiting], { focused: true }), "listening");
  assert.equal(headerMascot([running], { flash: { state: "success", until: 2000 }, now: 1000 }), "success");
  assert.equal(headerMascot([running], { flash: { state: "success", until: 2000 }, now: 3000 }), "thinking");
  // a result to approve waits for the user only until they open it; a browser run on hold always does
  const result = { ...research("completed", "ready_to_approve"), seen: false };
  assert.equal(headerMascot([result]), "needs_approval");
  assert.equal(headerMascot([{ ...result, seen: true }]), "idle");
  assert.equal(headerMascot([{ ...waiting, seen: true }]), "needs_approval");
});

test("a short flash when something finishes, never on first load", () => {
  const before = new Map([["a", "thinking"], ["b", "working"]]);
  assert.equal(finishFlash(new Map(), [{ id: "a", status: "completed" }]), null);
  assert.equal(finishFlash(before, [{ id: "a", status: "completed" }]), "success");
  assert.equal(finishFlash(before, [{ id: "a", status: "completed", output: { structured: { status: "ready_to_approve" } } }]), "success");
  assert.equal(finishFlash(before, [{ id: "a", status: "failed" }, { id: "b", status: "completed", execution: { status: "done" } }]), "error");
  assert.equal(finishFlash(before, [{ id: "b", status: "completed", execution: { status: "awaiting_approval" } }]), null);
  assert.equal(finishFlash(before, [{ id: "a", status: "cancelled" }]), null);
  assert.equal(finishFlash(before, [{ id: "a", status: "running" }]), null);
});

test("every pose exists in the mascot library and every card pose has a still", () => {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(new URL("../extension/lib/butler.js", import.meta.url), "utf8"), ctx);
  const states = [...ctx.window.Butler.STATES];
  for (const p of POSES) assert.ok(states.includes(p), p);
  for (const p of STILLS) assert.ok(existsSync(new URL(`../extension/mascot/${p}.svg`, import.meta.url)), p);
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  for (const r of manifest.web_accessible_resources.flatMap((w) => w.resources)) {
    assert.ok(existsSync(new URL(`../extension/${r}`, import.meta.url)), r);
  }
});

test("the mock's demo errands cover every browser run state and a failed errand", async (t) => {
  const server = createMockServer({ researchMs: 0, execMs: 0 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(baseUrl + "/mock/demo", { method: "POST" })).status, 404);
  const user = await createClient({ baseUrl }).createUser();
  assert.equal((await fetch(baseUrl + "/mock/demo", { method: "POST" })).status, 200);
  const { tasks } = await createClient({ baseUrl, token: user.token }).listTasks();
  const poses = tasks.map((x) => taskMascot(toLocalTask(x))).sort();
  // failed research + login blocker, approval + question, finished run + the seeded WhatsApp answer
  assert.deepEqual(poses, ["error", "error", "needs_approval", "needs_approval", "success", "success"]);
});
