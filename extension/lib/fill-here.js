// "Fill it here": fill the form on the tab the user is on (often behind their own login) from the details saved in this
// browser and the errand's own values. This file only plans; page-scripts.js fillPage() fills, highlights each field and
// never submits. Nothing here leaves the device. Pure, so test/fill-here.test.mjs runs it in Node.

import { fillPlaceholders, unfilledPlaceholders } from "./actions.js";

// Never touched: passwords, cards, bank details, identity codes, usernames and one-time codes.
const SENSITIVE = /pass(word)?|salasana|\bpin\b|card|kortti|cvc|cvv|\bcc-|expir|iban|\bbic\b|swift|account|tilinumero|bank|pankki|identity code|henkilötunnus|\bhetu\b|social security|ssn|username|user name|käyttäjätunnus|one-time|otp|verification code|vahvistuskoodi/i;
// Text-like fields only. Checkboxes are never ticked: they are consents and terms.
const FILLABLE = new Set(["text", "email", "tel", "textarea", "select-one", "date", "time", "number", "url", "radio"]);

// autocomplete tokens first, then words in the label, name or id. Order matters: "e-mail address" is an email.
const AUTOCOMPLETE = {
  name: "name", "given-name": "first_name", "family-name": "last_name", email: "email", tel: "phone", "tel-national": "phone",
  "street-address": "address", "address-line1": "address", "postal-code": "postal_code", "address-level2": "city",
  country: "country", "country-name": "country", bday: "date_of_birth",
};
const WORDS = [
  ["email", /e-?mail|sähköposti/i],
  ["phone", /phone|\btel\b|telephone|mobile|puhelin|matkapuhelin|\bgsm\b/i],
  ["postal_code", /post(al)?.?code|\bzip\b|postinumero/i],
  ["city", /\bcity\b|\btown\b|kaupunki|postitoimipaikka|kotikunta/i],
  ["country", /country|\bmaa\b|valtio/i],
  ["date_of_birth", /birth|syntymä/i],
  ["nationality", /nationality|citizenship|kansalaisuus/i],
  ["address", /address|street|osoite/i],
  ["first_name", /first.?name|given.?name|etunimi/i],
  ["last_name", /last.?name|family.?name|surname|sukunimi/i],
  ["name", /name|\bnimi\b/i],
];

const norm = (s) => String(s || "").toLowerCase().replace(/[*:]/g, " ").replace(/\s+/g, " ").trim();

// The profile value for one detail; first and last name come from the full name.
function profileValue(kind, profile) {
  const full = String(profile.name || "").trim();
  if (kind === "first_name") return profile.first_name || full.split(/\s+/).slice(0, -1).join(" ");
  if (kind === "last_name") return profile.last_name || (full.includes(" ") ? full.split(/\s+/).pop() : "");
  return profile[kind] || "";
}

function detailOf(field) {
  for (const token of norm(field.hint).split(" ")) if (AUTOCOMPLETE[token]) return AUTOCOMPLETE[token];
  const text = `${field.label || ""} ${field.hint || ""}`;
  return (WORDS.find(([, re]) => re.test(text)) || [])[0] || null;
}

// The errand's own values with their labels: the prepared form fill and what the cloud browser filled so far.
export function errandValues(task) {
  const labels = Object.fromEntries((task?.page?.fields || []).map((f) => [f.id, f.label]));
  const prepared = (task?.output?.structured?.form_fill || []).map((f) => ({ label: labels[f.field_id], value: f.value }));
  const x = task?.execution || {};
  const run = [...(x.filled || []), ...(x.approval?.filled || [])].map((f) => ({ label: f.label, value: f.value }));
  return [...prepared, ...run].filter((v) => norm(v.label) && v.value != null && String(v.value).trim());
}

function errandValueFor(field, values) {
  const label = norm(field.label);
  if (label.length < 3) return null;
  const hit = values.find((v) => norm(v.label) === label) ||
    values.find((v) => { const l = norm(v.label); return l.length >= 4 && (label.includes(l) || l.includes(label)); });
  return hit ? String(hit.value) : null;
}

// fields: capturePage().fields. Returns [{ field_id, value, label }] for the fields Vali can fill here.
export function planFill(fields, { profile = {}, values = [] } = {}) {
  const plan = [];
  for (const f of fields || []) {
    if (!FILLABLE.has(f.type) || f.current || SENSITIVE.test(`${f.label || ""} ${f.hint || ""}`)) continue;
    const kind = f.type === "radio" ? null : detailOf(f);
    let value = errandValueFor(f, values) ?? (kind ? profileValue(kind, profile) : "");
    value = fillPlaceholders(String(value || ""), profile).trim();
    if (!value || unfilledPlaceholders(value).length) continue;
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    plan.push({ field_id: f.id, value, label: f.label || f.id });
  }
  return plan;
}
