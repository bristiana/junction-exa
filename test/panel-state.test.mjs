import { test } from "node:test";
import assert from "node:assert/strict";
import { errandStatus } from "../extension/lib/panel-state.js";
import { panelStatus } from "../extension/panel/errand-status.js";
import { hasNextStep } from "../extension/lib/mascot.js";

test("panel says Waiting for your OK only with something to approve", () => {
  const done = (extra, structured = {}) => ({ status: "completed", output: { structured: { status: "ready_to_approve", ...structured } }, ...extra });
  assert.deepEqual(panelStatus(done({ seen: true })), ["Done", "success"]);
  assert.deepEqual(panelStatus(done({ seen: false, mode: "find" })), ["New answer", "success"]);
  assert.deepEqual(panelStatus(done({ mode: "check" }, { actions: [] })), ["New answer", "success"]);
  assert.deepEqual(panelStatus(done({ mode: "check" }, { actions: [{ type: "email", label: "Send" }] })), ["Waiting for your OK", "warning"]);
  for (const mode of ["claim", "book", "write"]) assert.deepEqual(panelStatus(done({ mode })), ["Waiting for your OK", "warning"]);
  assert.equal(hasNextStep(done({ mode: "find" })), false);
  assert.deepEqual(panelStatus(done({ mode: "find" }, { status: "needs_info" })), ["Needs your answer", "warning"]);
  assert.deepEqual(panelStatus(done({ execution: { status: "awaiting_approval" }, mode: "find" })), ["Waiting for your OK", "warning"]);
});

test("panel status gives the browser run priority over completed research", () => {
  const view = (execution) => errandStatus({ status: "completed", execution });
  for (const status of ["starting", "running", "submitting"]) assert.deepEqual(view({ status }), ["Working", ""]);
  assert.deepEqual(view({ status: "awaiting_approval" }), ["Waiting for your OK", "warning"]);
  assert.deepEqual(view({ status: "running", question: { text: "Which time?" } }), ["Needs your answer", "warning"]);
  assert.deepEqual(view({ status: "failed", result: "needs login: finish by hand at https://example.fi" }), ["Needs login", "warning"]);
  for (const blocker of ["captcha", "payment", "unavailable", "something new"]) assert.deepEqual(view({ status: "failed", result: `needs ${blocker}: finish by hand at https://example.fi` }), ["Needs you", "warning"]);
  assert.deepEqual(view({ status: "failed", result: "suspicious page: asks for a password" }), ["Couldn't finish", "danger"]);
  for (const [status, label, tone] of [["done", "Done", "success"], ["failed", "Couldn't finish", "danger"], ["stopped", "Stopped", "muted"]]) {
    assert.deepEqual(view({ status }), [label, tone]);
  }
});

test("panel research status distinguishes prepared work, answers, failure and stopping", () => {
  for (const status of ["queued", "running"]) assert.deepEqual(errandStatus({ status }), ["Working", ""]);
  const view = (status) => errandStatus({ status: "completed", output: { structured: { status } } });
  assert.deepEqual(view("ready_to_approve"), ["Waiting for your OK", "warning"]);
  assert.deepEqual(view("needs_info"), ["Needs your answer", "warning"]);
  assert.deepEqual(view("info_only"), ["Done", "success"]);
  assert.deepEqual(view("not_possible"), ["Couldn't finish", "danger"]);
  assert.deepEqual(errandStatus({ status: "failed" }), ["Couldn't finish", "danger"]);
  assert.deepEqual(errandStatus({ status: "cancelled" }), ["Stopped", "muted"]);
});

test("a found answer with only links is Done, like the web", () => {
  const t = { status: "completed", seen: true, mode: "check", output: { structured: { status: "ready_to_approve", actions: [{ type: "open_link", url: "https://example.fi" }] } } };
  assert.deepEqual(panelStatus(t), ["Done", "success"]);
  assert.deepEqual(panelStatus({ ...t, mode: "book" }), ["Waiting for your OK", "warning"]);
});
