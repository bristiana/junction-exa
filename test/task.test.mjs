import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRunRequest, outputSchema } from "../extension/lib/task.js";

test("form fields only appear in the schema when the page has a form", () => {
  assert.equal(outputSchema({ hasForm: false }).properties.form_fill, undefined);
  assert.ok(outputSchema({ hasForm: true }).properties.form_fill);
});

test("schema is valid enough for Exa: every required key exists", () => {
  for (const hasForm of [true, false]) {
    const s = outputSchema({ hasForm });
    for (const k of s.required) assert.ok(s.properties[k], k);
  }
});

test("personal values never go into the query, only which ones exist", () => {
  const profile = { name: "Aino Virtanen", email: "aino@example.com", city: "Espoo", language: "English" };
  const page = { url: "https://example.fi/form", title: "Claim", text: "x", fields: [{ id: "h1", label: "Full name", type: "text", required: true }] };
  const r = buildRunRequest("Claim my delay compensation", page, profile);
  assert.ok(!r.query.includes("Aino"));
  assert.ok(!r.query.includes("aino@example.com"));
  assert.ok(r.query.includes("name, email, city"));
  assert.ok(r.query.includes('h1: "Full name" (text, required)'));
  assert.ok(r.outputSchema.properties.form_fill);
  assert.equal(r.effort, "low");
});
