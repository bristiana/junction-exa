import { test } from "node:test";
import assert from "node:assert/strict";
import { toLocalTask, mergeRemoteTasks, backendPage, isActive, createClient, normalizeBaseUrl } from "../extension/lib/backend.js";
import { createMockServer } from "../scripts/mock-backend.mjs";

const output = {
  text: "You can claim €250.",
  structured: { answer: "You can claim €250.", status: "ready_to_approve", steps: [], actions: [] },
  grounding: [{ field: "answer", citations: [{ url: "https://europa.eu/", title: "EU" }], confidence: "high" }],
};

function remoteTask(over = {}) {
  return {
    id: "t_1",
    user_id: "u_1",
    source: "extension",
    mode: "claim",
    task: "My flight AY123 was 4 hours late",
    created_at: "2026-11-14T10:00:00Z",
    updated_at: "2026-11-14T10:01:30Z",
    page: { url: "https://example.fi/claim", title: "Claim", fields: [{ id: "h1", label: "Full name", type: "text", required: true }] },
    research: {
      status: "completed",
      run_id: "agent_run_1",
      progress: [{ kind: "search", text: "EU261 delay compensation" }],
      output,
      cost: 0.04,
      stop_reason: "schema_satisfied",
      error: null,
    },
    execution: null,
    ...over,
  };
}

test("a server task maps onto the local record the panel renders", () => {
  const execution = { status: "awaiting_approval", steps: [], shots: [{ n: 1, url: "https://res.cloudinary.com/x/1.jpg" }] };
  const t = toLocalTask(remoteTask({ execution }));
  assert.equal(t.id, "t_1");
  assert.equal(t.remoteId, "t_1");
  assert.equal(t.backend, true);
  assert.equal(t.status, "completed");
  assert.deepEqual(t.output, output);
  assert.deepEqual(t.progress, [{ kind: "search", text: "EU261 delay compensation" }]);
  assert.equal(t.cost, 0.04);
  assert.equal(t.stopReason, "schema_satisfied");
  assert.equal(t.runId, "agent_run_1");
  assert.equal(t.mode, "claim");
  assert.equal(t.source, "extension");
  assert.equal(t.execution, execution);
  assert.equal(t.createdAt, Date.parse("2026-11-14T10:00:00Z"));
  assert.equal(t.completedAt, Date.parse("2026-11-14T10:01:30Z"));
  assert.equal(t.error, null);
  assert.equal(t.seen, false);
  assert.equal(t.page.title, "Claim");
  assert.equal(t.page.fields[0].id, "h1");
});

test("mapping keeps what only this browser knows", () => {
  const prev = { id: "t_1", remoteId: "t_1", parentId: "t_0", tabId: 42, seen: true, status: "running", completedAt: null,
    page: { url: "https://example.fi/claim", title: "Claim", fields: [{ id: "h1", label: "Full name", type: "text", current: "x" }], hadSelection: true } };
  const t = toLocalTask(remoteTask(), prev);
  assert.equal(t.tabId, 42);
  assert.equal(t.parentId, "t_0");
  assert.equal(t.seen, true);
  assert.equal(t.page.hadSelection, true);
});

test("running, failed and cancelled tasks", () => {
  const running = toLocalTask(remoteTask({ research: { status: "running", progress: [] } }));
  assert.equal(running.status, "running");
  assert.equal(running.completedAt, null);
  assert.equal(running.output, null);
  assert.ok(isActive(running));
  const failed = toLocalTask(remoteTask({ research: { status: "failed", error: { message: "Exa timed out" } } }));
  assert.equal(failed.error, "Exa timed out");
  assert.equal(toLocalTask(remoteTask({ research: { status: "failed", error: "boom" } })).error, "boom");
  assert.equal(toLocalTask(remoteTask({ research: { status: "failed" } })).error, "The run failed.");
  assert.equal(toLocalTask(remoteTask({ research: {} })).status, "queued");
  const doing = toLocalTask(remoteTask({ execution: { status: "running" } }));
  assert.ok(isActive(doing), "a running browser run keeps the task active");
  assert.ok(!isActive(toLocalTask(remoteTask())));
});

test("WhatsApp tasks keep their source", () => {
  const t = toLocalTask(remoteTask({ id: "t_w", source: "whatsapp", page: null }));
  assert.equal(t.source, "whatsapp");
  assert.equal(t.page, null);
});

test("merging adds new server tasks, updates known ones, reports finished ones and keeps removed ones hidden", () => {
  const local = [
    { id: "a-local", task: "direct mode errand", status: "completed", createdAt: Date.parse("2026-11-14T09:00:00Z") },
    { id: "t_1", remoteId: "t_1", backend: true, status: "running", tabId: 7, createdAt: Date.parse("2026-11-14T10:00:00Z") },
  ];
  const remote = [
    remoteTask({ id: "t_3", source: "whatsapp", created_at: "2026-11-14T11:00:00Z" }),
    remoteTask(),
    remoteTask({ id: "t_gone", created_at: "2026-11-14T12:00:00Z" }),
  ];
  const { tasks, finished } = mergeRemoteTasks(local, remote, { hidden: ["t_gone"] });
  assert.deepEqual(tasks.map((t) => t.id), ["t_3", "t_1", "a-local"]);
  assert.equal(tasks[1].tabId, 7);
  assert.equal(tasks[1].status, "completed");
  assert.deepEqual(finished.map((t) => t.id), ["t_1"]);
  assert.equal(tasks[0].source, "whatsapp");
  // a second merge with the same data reports nothing new
  assert.equal(mergeRemoteTasks(tasks, remote, { hidden: ["t_gone"] }).finished.length, 0);
});

test("the server gets redacted page text and no typed field values", () => {
  const page = {
    url: "https://example.fi/claim",
    title: "Claim for test@example.com",
    selection: "",
    text: "Nimi: Test Person\nPuhelin: +358401234567\nHinta 1 299,00 €",
    fields: [{ id: "h1", label: "Full name", type: "text", required: true, current: "Test Person" }, { id: "h2", label: "Airline", type: "select", options: ["Finnair"] }],
  };
  const p = backendPage(page);
  assert.equal(p.title, "Claim for [email]");
  assert.equal(p.text, "Nimi: [name]\nPuhelin: [phone]\nHinta 1 299,00 €");
  assert.equal(p.selection, undefined);
  assert.deepEqual(p.fields, [{ id: "h1", label: "Full name", type: "text", required: true }, { id: "h2", label: "Airline", type: "select", required: false, options: ["Finnair"] }]);
  assert.ok(!JSON.stringify(p).includes("Test Person"));
  assert.equal(backendPage(null), null);
});

test("server URLs are normalized", () => {
  assert.equal(normalizeBaseUrl(" 127.0.0.1:8787/ "), "http://127.0.0.1:8787");
  assert.equal(normalizeBaseUrl("vali.example.modal.run"), "https://vali.example.modal.run");
  assert.equal(normalizeBaseUrl("https://api.example.com/vali/"), "https://api.example.com/vali");
  assert.equal(normalizeBaseUrl(""), "");
  assert.throws(() => normalizeBaseUrl("ftp://example.com"));
});

test("screenshot URLs: Cloudinary as is, API-served ones with the token", () => {
  const c = createClient({ baseUrl: "http://127.0.0.1:8787", token: "tok" });
  const task = { remoteId: "t_1", execution: { shots: [{ n: 1, url: "https://res.cloudinary.com/demo/1.jpg" }, { n: 2, url: "/v1/tasks/t_1/shots/2.jpg" }] } };
  assert.equal(c.shotUrl(task, 1), "https://res.cloudinary.com/demo/1.jpg");
  assert.equal(c.shotUrl(task, 2), "http://127.0.0.1:8787/v1/tasks/t_1/shots/2.jpg?t=tok");
  assert.equal(c.shotUrl({ id: "t_9" }, 3), "http://127.0.0.1:8787/v1/tasks/t_9/shots/3.jpg?t=tok");
  assert.equal(c.shotUrl({ execution: { shots: [{ n: 1, url: "javascript:alert(1)" }] } }, 1), null);
});

test("the client works against the mock server", async (t) => {
  const server = createMockServer({ researchMs: 0, execMs: 0 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  await assert.rejects(createClient({ baseUrl, token: "nope" }).me(), (e) => e.status === 401);
  const user = await createClient({ baseUrl }).createUser();
  assert.ok(user.token && user.user_id);
  const c = createClient({ baseUrl, token: user.token });

  const who = await c.me();
  assert.equal(who.whatsapp_linked, false);
  const { code, expires_at } = await c.pair();
  assert.match(code, /^\d{6}$/);
  assert.ok(Date.parse(expires_at) > Date.now());
  assert.deepEqual(await c.syncProfile({ name: "Test Person" }), { ok: true });

  const created = await c.createTask({ task: "Find a public sauna in Helsinki", page: backendPage({ url: "https://example.fi", title: "x", fields: [{ id: "h1", label: "Email", type: "email" }] }), effort: "low" });
  assert.equal(created.source, "extension");
  const { tasks } = await c.listTasks();
  assert.equal(tasks.length, 2);
  assert.ok(tasks.some((x) => x.source === "whatsapp"), "the mock seeds a WhatsApp task");
  const mapped = mergeRemoteTasks([], tasks).tasks;
  assert.equal(mapped.length, 2);
  assert.ok(mapped.every((x) => x.status === "completed" && x.output?.structured?.answer));

  const got = await c.getTask(created.id);
  assert.deepEqual(got.research.output.structured.form_fill, [{ field_id: "h1", value: "{{email}}" }]);
  let run = await c.execute(created.id, { action_index: 0 });
  assert.ok(["running", "awaiting_approval"].includes(run.execution.status));
  assert.equal(run.execution.start_url, "https://www.suomi.fi/");
  run = await c.getTask(created.id);
  assert.equal(run.execution.status, "awaiting_approval");
  run = await c.approve(created.id);
  assert.equal(run.execution.status, "submitting");
  const shot = await fetch(c.shotUrl(toLocalTask(run), 1));
  assert.equal(shot.status, 200);
  await shot.arrayBuffer();
  assert.equal((await c.cancel(created.id)).research.status, "completed");
  await assert.rejects(c.getTask("t_missing"), (e) => e.status === 404);
});
