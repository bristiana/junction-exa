import { test } from "node:test";
import assert from "node:assert/strict";
import { errandStatus } from "../extension/lib/panel-state.js";

test("panel status gives the browser run priority over completed research", () => {
  const view = (execution) => errandStatus({ status: "completed", execution });
  for (const status of ["starting", "running", "submitting"]) assert.deepEqual(view({ status }), ["Working", ""]);
  assert.deepEqual(view({ status: "awaiting_approval" }), ["Waiting for your OK", "warning"]);
  assert.deepEqual(view({ status: "running", question: { text: "Which time?" } }), ["Waiting for your OK", "warning"]);
  assert.deepEqual(view({ status: "failed", result: "needs login: finish by hand at https://example.fi" }), ["Needs login", "warning"]);
  for (const blocker of ["captcha", "payment"]) assert.deepEqual(view({ status: "failed", result: `needs ${blocker}: finish by hand at https://example.fi` }), ["Needs you", "warning"]);
  assert.deepEqual(view({ status: "failed", result: "suspicious page: asks for a password" }), ["Couldn't finish", "danger"]);
  for (const [status, label, tone] of [["done", "Done", "success"], ["failed", "Couldn't finish", "danger"], ["stopped", "Stopped", "muted"]]) {
    assert.deepEqual(view({ status }), [label, tone]);
  }
});

test("panel research status distinguishes prepared work, answers, failure and stopping", () => {
  for (const status of ["queued", "running"]) assert.deepEqual(errandStatus({ status }), ["Working", ""]);
  const view = (status) => errandStatus({ status: "completed", output: { structured: { status } } });
  for (const status of ["ready_to_approve", "needs_info"]) assert.deepEqual(view(status), ["Waiting for your OK", "warning"]);
  assert.deepEqual(view("info_only"), ["Done", "success"]);
  assert.deepEqual(view("not_possible"), ["Couldn't finish", "danger"]);
  assert.deepEqual(errandStatus({ status: "failed" }), ["Couldn't finish", "danger"]);
  assert.deepEqual(errandStatus({ status: "cancelled" }), ["Stopped", "muted"]);
});
