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

test("the panel shows research as searching and the browser run as serving", () => {
  const src = readFileSync(new URL("../extension/panel/panel.js", import.meta.url), "utf8");
  const map = vm.runInNewContext(`(${src.match(/const PANEL_POSE = (\{[^}]*\});/)[1]})`);
  const shown = (t) => { const p = taskMascot(t); return map[p] || p; };
  for (const s of ["queued", "pending", "running"]) assert.equal(shown(research(s)), "searching", s);
  for (const s of ["starting", "running", "submitting"]) assert.equal(shown(exec(s)), "working", s);
  assert.equal(shown(research("completed", "info_only")), "success");
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(new URL("../extension/lib/butler.js", import.meta.url), "utf8"), ctx);
  for (const p of Object.values(map)) {
    assert.ok(ctx.window.Butler.STATES.includes(p), p);
    assert.ok(existsSync(new URL(`../extension/mascot/${p}.svg`, import.meta.url)), p);
  }
  assert.match(readFileSync(new URL("../extension/lib/butler.js", import.meta.url), "utf8"), /working\(T, tau, L\) \{\s*POSES\.serving/);
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

// Exercise the actual renderer with a deterministic frame clock and a tiny SVG DOM.
function renderMascot(state, { reducedMotion = true, palette = "lilac" } = {}) {
  let now = 0, frame;
  const nodes = new Map();
  const svg = { querySelectorAll: () => [...nodes.values()] };
  const container = {
    set innerHTML(value) {
      nodes.clear();
      for (const [, name] of value.matchAll(/data-p="([^"]+)"/g)) {
        nodes.set(name, { dataset: { p: name }, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } });
      }
    },
    querySelector: () => svg,
    dispatchEvent() {},
  };
  const ctx = vm.createContext({
    window: { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: reducedMotion }) },
    document: { addEventListener() {}, removeEventListener() {} },
    performance: { now: () => now },
    requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() {},
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } },
    console,
  });
  vm.runInContext(readFileSync(new URL("../extension/lib/butler.js", import.meta.url), "utf8"), ctx);
  const api = ctx.window.Butler.create(container, { state, palette, trackPointer: false, hoverReact: false, reducedMotion: "auto" });
  const advance = (count = 240) => { for (let i = 0; i < count; i++) { now += 1000 / 60; frame(now); } };
  const attrs = (name) => nodes.get(name).attrs;
  const snapshot = () => JSON.stringify([...nodes].map(([name, node]) => [name, node.attrs]));
  advance();
  return { api, advance, attrs, snapshot, states: [...ctx.window.Butler.STATES], palettes: [...ctx.window.Butler.PALETTES] };
}

test("working serves a cloche on a raised glove; typing preserves the laptop", () => {
  const working = renderMascot("working");
  const serving = renderMascot("serving");
  assert.equal(working.snapshot(), serving.snapshot());
  assert.equal(working.attrs("trayC").opacity, "1.00");
  assert.equal(working.attrs("lap").opacity, "0.00");
  assert.match(working.attrs("gloveR").transform, /translate\(32.00 112.00\)/);
  assert.match(working.attrs("trayC").transform, /translate\(32.00 103.00\)/);
  const typing = renderMascot("typing");
  assert.equal(typing.api.getState(), "typing");
  assert.equal(typing.attrs("lap").opacity, "1.00");
  assert.equal(typing.attrs("trayC").opacity, "0.00");
  typing.api.setState("serving");
  typing.advance();
  assert.equal(typing.attrs("lap").opacity, "0.00");
  assert.equal(typing.attrs("trayC").opacity, "1.00");
});

test("error holds an open-handed shrug with a head tilt and an attached monocle", () => {
  const shrug = renderMascot("error");
  assert.match(shrug.attrs("gloveR").transform, /translate\(47.00 1(?:0[89]|1[01])\.\d+\) rotate\(-65.00\)/);
  assert.match(shrug.attrs("gloveL").transform, /translate\(153.00 1(?:0[89]|1[01])\.\d+\) rotate\(65.00\)/);
  assert.match(shrug.attrs("face").transform, /rotate\(-6.00 100 90\)/);
  assert.match(shrug.attrs("crest").transform, /rotate\(-6.00 100 90\)/);
  assert.equal(shrug.attrs("napkin").opacity, "0.00");
  assert.equal(shrug.attrs("sweat").opacity, "0.00");
  assert.ok(shrug.attrs("monocle").transform);
});

test("serving walks gently while reduced motion holds every new pose still", () => {
  const walk = renderMascot("serving", { reducedMotion: false });
  const before = walk.attrs("float").transform;
  walk.advance(20);
  assert.notEqual(walk.attrs("float").transform, before);
  for (const state of ["working", "serving", "typing", "error"]) {
    const still = renderMascot(state);
    const before = still.snapshot();
    still.advance(120);
    assert.equal(still.snapshot(), before, state);
  }
});

test("all states render finite attributes in every palette", () => {
  const { states, palettes } = renderMascot("idle");
  for (const palette of palettes) for (const state of states) {
    const mascot = renderMascot(state, { palette });
    assert.equal(mascot.api.getState(), state);
    assert.doesNotMatch(mascot.snapshot(), /NaN|Infinity|undefined/, `${palette}/${state}`);
    mascot.api.destroy();
  }
});
