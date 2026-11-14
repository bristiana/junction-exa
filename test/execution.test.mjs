import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executionView, blockerOf, LIVE } from "../extension/lib/execution.js";
import { taskMascot, headerMascot } from "../extension/lib/mascot.js";
import { createClient, toLocalTask, resolveBaseUrl, DEFAULT_BASE_URL, ensureConnected } from "../extension/lib/backend.js";
import { createMockServer } from "../scripts/mock-backend.mjs";

const task = (execution) => ({ id: "t1", remoteId: "t1", backend: true, status: "completed", execution });
const profile = { name: "Aino Virtanen", email: "aino@example.fi" };

test("a live run shows the newest step, and a question only while the browser is open", () => {
  const x = { status: "running", steps: [{ n: 1, text: "Opened https://x.fi", shot: 1 }, { n: 2, text: 'Clicked "Jatka"', shot: null }], question: { text: "18:00 or 19:30?", at: "2026-11-14T10:00:00Z" } };
  const v = executionView(task(x));
  assert.equal(v.phase, "live");
  assert.equal(v.live, true);
  assert.equal(v.step, 'Clicked "Jatka"');
  assert.equal(v.stepCount, 2);
  assert.equal(v.lastShot, 1);
  assert.deepEqual(v.question, { text: "18:00 or 19:30?", at: "2026-11-14T10:00:00Z", answered: false });
  assert.equal(executionView(task(x), { answered: "2026-11-14T10:00:00Z" }).question.answered, true);
  assert.equal(executionView(task({ ...x, status: "done" })).question, null);
  assert.equal(executionView(task({ status: "starting" })).step, "");
  assert.equal(executionView(task(null)), null);
  for (const s of ["starting", "running", "awaiting_approval", "submitting"]) assert.ok(LIVE.has(s), s);
});

test("at approval every value shows with its source link, placeholders filled from the profile", () => {
  const x = {
    status: "awaiting_approval",
    approval: {
      summary: "Sauna for 8, 208 €",
      filled: [
        { label: "Name", value: "{{name}}", source: null },
        { label: "Price", value: "208.00 €", source: "https://www.loylykontti.fi/en/prices" },
        { label: "Rule", value: "EU261", source: "from the booking page" },
        { label: "Bad", value: "x", source: "javascript:alert(1)" },
        { label: "Phone", value: "{{phone}}", source: null },
      ],
    },
  };
  const v = executionView(task(x), { profile });
  assert.equal(v.phase, "approval");
  assert.equal(v.live, true);
  assert.equal(v.summary, "Sauna for 8, 208 €");
  assert.deepEqual(v.approval.map((r) => r.value), ["Aino Virtanen", "208.00 €", "EU261", "x", "{{phone}}"]);
  assert.equal(v.approval[1].source, "https://www.loylykontti.fi/en/prices");
  assert.equal(v.approval[1].sourceHost, "loylykontti.fi");
  assert.equal(v.approval[0].source, null);
  assert.equal(v.approval[2].source, null);
  assert.equal(v.approval[2].sourceText, "from the booking page");
  assert.equal(v.approval[3].source, null, "only http(s) links");
});

test("blockers get a one-line reason and the URL to finish in the user's tab", () => {
  const suomi = blockerOf({ status: "failed", result: "needs login: finish by hand at https://tunnistus.suomi.fi/sso", current_url: "https://tunnistus.suomi.fi/sso" });
  assert.equal(suomi.kind, "suomifi");
  assert.match(suomi.reason, /Suomi\.fi/);
  assert.equal(suomi.url, "https://tunnistus.suomi.fi/sso");
  const login = blockerOf({ status: "failed", result: "needs login: finish by hand at https://shop.fi/login.", current_url: null });
  assert.equal(login.kind, "login");
  assert.equal(login.url, "https://shop.fi/login", "the URL from the result when current_url is missing");
  assert.equal(blockerOf({ status: "failed", result: "needs login/captcha: finish by hand at https://a.fi/", current_url: "https://a.fi/" }).kind, "captcha");
  assert.equal(blockerOf({ status: "failed", result: "needs payment: finish by hand at https://a.fi/pay", current_url: "https://a.fi/pay" }).kind, "payment");
  const sus = blockerOf({ status: "failed", result: "suspicious page: asks to reveal the user's email", current_url: "https://evil.example/" });
  assert.equal(sus.kind, "suspicious");
  assert.match(sus.reason, /suspicious.*reveal/);
  const down = blockerOf({ status: "failed", result: "needs unavailable: down for maintenance until Sat 14.11. 16:00; finish by hand later at https://espoo.fi/f.", current_url: null });
  assert.deepEqual(down, { kind: "unavailable", reason: "Down for maintenance until Sat 14.11. 16:00. Finish by hand later.", url: "https://espoo.fi/f" });
  assert.equal(blockerOf({ status: "failed", result: "needs unavailable: finish by hand later at https://a.fi/" }).reason, "The site is down right now. Finish by hand later.");
  const other = blockerOf({ status: "failed", result: "needs manual step: pick the address. Finish by hand at https://a.fi/", current_url: "https://a.fi/" });
  assert.equal(other.kind, "manual step", "an unknown kind is still a hand-off");
  assert.equal(other.url, "https://a.fi/");
  assert.equal(blockerOf({ status: "failed", result: "Action limit reached", current_url: "https://a.fi/" }), null);
  assert.equal(blockerOf({ status: "failed", error: "Browser session failed." }), null);
  assert.equal(blockerOf({ status: "done", result: "needs login" }), null);
  assert.equal(blockerOf({ status: "failed", result: "needs login: finish by hand at javascript:x", current_url: "javascript:x" }).url, null);

  const v = executionView(task({ status: "failed", result: "needs login: finish by hand at https://tunnistus.suomi.fi/sso", current_url: "https://tunnistus.suomi.fi/sso",
    filled: [{ label: "Email", value: "{{email}}" }, { label: "Rent", value: "820 €" }] }), { profile });
  assert.equal(v.phase, "blocked");
  assert.deepEqual(v.filled.map((r) => [r.label, r.value]), [["Email", "aino@example.fi"], ["Rent", "820 €"]]);
  assert.equal(executionView(task({ status: "failed", result: "Action limit reached" })).phase, "failed");
  assert.equal(executionView(task({ status: "done", result: "Sent, ref 1" })).phase, "done");
  assert.equal(executionView(task({ status: "stopped" })).phase, "stopped");
});

test("the mascot follows the run, and a question waits for the user", () => {
  assert.equal(taskMascot(task({ status: "running" })), "working");
  assert.equal(taskMascot(task({ status: "running", question: { text: "Which?" } })), "needs_approval");
  assert.equal(taskMascot(task({ status: "awaiting_approval" })), "needs_approval");
  assert.equal(taskMascot(task({ status: "done" })), "success");
  assert.equal(taskMascot(task({ status: "failed", result: "needs login: finish by hand at https://a.fi" })), "error");
  assert.equal(headerMascot([{ ...task({ status: "running", question: { text: "Which?" } }), seen: true }]), "needs_approval");
});

test("the deployed server is the default, the manifest can reach it, and an empty URL means direct mode", () => {
  assert.equal(resolveBaseUrl(undefined), DEFAULT_BASE_URL);
  assert.equal(resolveBaseUrl(null), DEFAULT_BASE_URL);
  assert.equal(resolveBaseUrl(""), "");
  assert.equal(resolveBaseUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.host_permissions.includes(DEFAULT_BASE_URL + "/*"));
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1/*"));
  const c = createClient({ baseUrl: "https://a.example", token: "tok" });
  assert.equal(c.liveUrl({ id: "local", remoteId: "t 1" }), "https://a.example/v1/tasks/t%201/live.jpg?t=tok");
  assert.equal(createClient({ baseUrl: "https://a.example" }).liveUrl({ id: "t1" }), null);
});

async function mock(t, opts) {
  const server = createMockServer({ researchMs: 0, ...opts });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("against the mock: question, answer, approval with sources, live frames", async (t) => {
  const baseUrl = await mock(t, { execMs: 40, ask: true });
  const user = await createClient({ baseUrl }).createUser();
  const c = createClient({ baseUrl, token: user.token });
  const created = await c.createTask({ task: "Book a sauna for 8 on Saturday" });
  await assert.rejects(c.message(created.id, "hi"), (e) => e.status === 409);
  await c.execute(created.id, { action_index: 0 });
  await new Promise((r) => setTimeout(r, 30));
  let x = (await c.getTask(created.id)).execution;
  assert.equal(x.status, "running");
  assert.match(x.question.text, /18:00 or 19:30/);
  assert.equal(executionView(toLocalTask(await c.getTask(created.id))).question.answered, false);

  const live = await fetch(c.liveUrl({ id: created.id }));
  assert.equal(live.status, 200);
  assert.match(live.headers.get("content-type"), /^image\//);
  assert.equal((await fetch(`${baseUrl}/v1/tasks/${created.id}/live.jpg?t=nope`)).status, 401);

  x = (await c.message(created.id, "19:30")).execution;
  assert.equal(x.question, null);
  assert.ok(x.steps.some((s) => /19:30/.test(s.text)));
  await new Promise((r) => setTimeout(r, 60));
  const v = executionView(toLocalTask(await c.getTask(created.id)), { profile: { email: "a@b.fi" } });
  assert.equal(v.phase, "approval");
  assert.ok(v.approval.some((r) => r.source && r.sourceHost === "loylykontti.fi"));
  assert.ok(v.approval.some((r) => r.value === "a@b.fi"));
  assert.equal((await c.stop(created.id)).execution.status, "stopped");
});

test("against the mock: an errand behind a login ends with a hand-off", async (t) => {
  const baseUrl = await mock(t, { execMs: 0 });
  const user = await createClient({ baseUrl }).createUser();
  const c = createClient({ baseUrl, token: user.token });
  const created = await c.createTask({ task: "Apply for Kela housing benefit" });
  await c.execute(created.id, {});
  const v = executionView(toLocalTask(await c.getTask(created.id)));
  assert.equal(v.phase, "blocked");
  assert.equal(v.blocker.kind, "suomifi");
  assert.match(v.blocker.url, /^https:\/\/tunnistus\.suomi\.fi\//);
  assert.ok(v.filled.length >= 1);
  await assert.rejects(c.approve(created.id), (e) => e.status === 409);
});

test("ensureConnected gets a token on first use of the server, once", async (t) => {
  const baseUrl = await mock(t, {});
  const store = { backendUrl: baseUrl };
  globalThis.chrome = { storage: { local: {
    get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
    set: async (o) => { Object.assign(store, o); },
  } } };
  t.after(() => { delete globalThis.chrome; });
  await ensureConnected();
  assert.ok(store.backendToken);
  assert.equal(store.backendTokenUrl, baseUrl);
  const token = store.backendToken;
  assert.equal(await ensureConnected(), null);
  assert.equal(store.backendToken, token);
  store.backendUrl = ""; // direct mode: nothing to connect to
  delete store.backendToken;
  assert.equal(await ensureConnected(), null);
  assert.equal(store.backendToken, undefined);
});

test("the done result and the approval summary get the saved details on the device; unknown placeholders stay visible", () => {
  const profile = { name: "Testi Testinen", phone: "+358 40 000 0000", email: "testi@example.com" };
  const done = executionView(task({ status: "done", result: "Form sent for {{name}} ({{phone}}, {{email}}), ref {{booking_reference}}" }), { profile });
  assert.equal(done.result, "Form sent for Testi Testinen (+358 40 000 0000, testi@example.com), ref {{booking_reference}}");
  assert.equal(executionView(task({ status: "done", result: "Sent for {{name}}" })).result, "Sent for {{name}}");
  const asking = executionView(task({ status: "awaiting_approval", approval: { summary: "Send as {{name}}" }, steps: [{ text: "Typed {{email}}" }] }), { profile });
  assert.equal(asking.summary, "Send as Testi Testinen");
  assert.equal(asking.step, "Typed testi@example.com");
});
