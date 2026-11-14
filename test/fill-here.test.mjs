import { test } from "node:test";
import assert from "node:assert/strict";
import { planFill, errandValues } from "../extension/lib/fill-here.js";

// The fake test person from scripts/golden.py.
const PROFILE = { name: "Aino Virtanen", email: "test@example.com", phone: "+358401234567" };
// capturePage() fields of https://httpbin.org/forms/post
const HTTPBIN = [
  { id: "h1", type: "text", label: "Customer name:", hint: " custname " },
  { id: "h2", type: "tel", label: "Telephone:", hint: " custtel " },
  { id: "h3", type: "email", label: "E-mail address:", hint: " custemail " },
  { id: "h4", type: "radio", label: "Pizza Size", options: ["Small", "Medium", "Large"] },
  { id: "h5", type: "checkbox", label: "Bacon", hint: " topping " },
  { id: "h6", type: "time", label: "Preferred delivery time:", hint: " delivery " },
  { id: "h7", type: "textarea", label: "Delivery instructions:", hint: " comments " },
];

test("fills name, phone and email on the httpbin form from the profile", () => {
  const plan = planFill(HTTPBIN, { profile: PROFILE });
  assert.deepEqual(plan.map((p) => [p.field_id, p.value]), [["h1", "Aino Virtanen"], ["h2", "+358401234567"], ["h3", "test@example.com"]]);
});

test("adds the errand's own values by label, never ticks a checkbox", () => {
  const task = {
    page: { fields: [{ id: "x9", label: "Delivery instructions" }] },
    output: { structured: { form_fill: [{ field_id: "x9", value: "ring the bell" }] } },
    execution: { filled: [{ label: "Pizza Size", value: "Medium" }, { label: "Preferred delivery time", value: "19:00" }, { label: "Bacon", value: "yes" }] },
  };
  const plan = planFill(HTTPBIN, { profile: PROFILE, values: errandValues(task) });
  const byId = Object.fromEntries(plan.map((p) => [p.field_id, p.value]));
  assert.equal(byId.h4, "Medium");
  assert.equal(byId.h6, "19:00");
  assert.equal(byId.h7, "ring the bell");
  assert.equal("h5" in byId, false);
});

test("never touches passwords, cards, bank details, identity codes or what the user already typed", () => {
  const fields = [
    { id: "a", type: "text", label: "Card number", hint: "cc-number" },
    { id: "b", type: "text", label: "Name on card", hint: "cc-name" },
    { id: "c", type: "text", label: "IBAN" },
    { id: "d", type: "text", label: "Tilinumero" },
    { id: "e", type: "text", label: "Henkilötunnus" },
    { id: "f", type: "text", label: "Username", hint: "username" },
    { id: "g", type: "text", label: "Bank account holder name" },
    { id: "h", type: "email", label: "Email", filled: true },
    { id: "i", type: "text", label: "Verification code" },
  ];
  assert.deepEqual(planFill(fields, { profile: PROFILE, values: [{ label: "IBAN", value: "FI00 1234" }] }), []);
});

test("whole words only: no name into company name or filename, no address into email address", () => {
  const fields = [
    { id: "a", type: "text", label: "Company name" },
    { id: "b", type: "text", label: "Maiden name" },
    { id: "c", type: "text", label: "Filename" },
    { id: "d", type: "text", label: "Address" },
    { id: "e", type: "email", label: "Sähköpostiosoite" },
  ];
  const plan = planFill(fields, { profile: PROFILE, values: [{ label: "Email address", value: "other@example.org" }] });
  assert.deepEqual(plan.map((p) => [p.field_id, p.value]), [["e", "test@example.com"]]);
});

test("splits the full name, uses autocomplete hints, skips placeholders it cannot fill", () => {
  const fields = [
    { id: "a", type: "text", label: "Etunimi" },
    { id: "b", type: "text", label: "Sukunimi" },
    { id: "c", type: "text", label: "Your details", hint: "email x y" },
    { id: "d", type: "text", label: "City" },
    { id: "e", type: "date", label: "Date of birth" },
  ];
  const plan = planFill(fields, { profile: { ...PROFILE, date_of_birth: "1.2.1999" }, values: [{ label: "City", value: "{{city}}" }] });
  assert.deepEqual(plan.map((p) => [p.field_id, p.value]), [["a", "Aino"], ["b", "Virtanen"], ["c", "test@example.com"]]);
});
