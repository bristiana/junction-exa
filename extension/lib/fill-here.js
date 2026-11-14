// "Fill it here": fill the form on the tab the user is on (often behind their own login) from the details saved in this
// browser and the errand's own values. This file only plans; page-scripts.js fillPage() fills, highlights each field and
// never submits. Nothing here leaves the device. Pure, so test/fill-here.test.mjs runs it in Node.

import { fillPlaceholders, unfilledPlaceholders } from "./actions.js";

export const PAGE_CHANGED = "The page changed. Open it again and retry."; // also inlined in page-scripts.js fillPage()

// True when both are the same web page (origin and path), so a fill never lands on a page the user did not choose.
export function samePage(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    return /^https?:$/.test(x.protocol) && x.origin === y.origin && x.pathname === y.pathname;
  } catch (_) {
    return false;
  }
}

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
// Whole words only (Finnish words may take endings), so "company name" or "filename" never look like a name.
const word = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, "iu");
const WORDS = [
  ["email", word("e-?mail|sähköposti\\p{L}*")],
  ["phone", word("phone|telephone|tel|mobile|gsm|puhelin\\p{L}*|matkapuhelin\\p{L}*")],
  ["postal_code", word("postal code|post code|postcode|zip|zip code|postinumero")],
  ["city", word("city|town|kaupunki|postitoimipaikka|kotikunta")],
  ["country", word("country|maa|valtio")],
  ["date_of_birth", word("date of birth|birth date|birthday|syntymäaika|syntymäpäivä")],
  ["nationality", word("nationality|citizenship|kansalaisuus")],
  ["address", word("address|street address|home address|street|katuosoite|lähiosoite|osoite")],
  ["first_name", word("first name|given names?|etunimi|etunimet")],
  ["last_name", word("last name|family name|surname|sukunimi")],
];
// The full name only for a field that is plainly asking for it.
const NAME_LABEL = /^(?:(?:full|your|customer|contact|applicant) )?name$|^(?:koko )?nimi$/;

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
  const kind = (WORDS.find(([, re]) => re.test(text)) || [])[0];
  return kind || (NAME_LABEL.test(norm(field.label)) ? "name" : null);
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
  const hit = values.find((v) => norm(v.label) === label); // same label only: "address" is not "email address"
  return hit ? String(hit.value) : null;
}

// fields: capturePage().fields. Returns [{ field_id, value, label }] for the fields Vali can fill here.
export function planFill(fields, { profile = {}, values = [] } = {}) {
  const plan = [];
  for (const f of fields || []) {
    if (!FILLABLE.has(f.type) || f.filled || SENSITIVE.test(`${f.label || ""} ${f.hint || ""}`)) continue;
    const kind = f.type === "radio" ? null : detailOf(f);
    let value = errandValueFor(f, values) ?? (kind ? profileValue(kind, profile) : "");
    value = fillPlaceholders(String(value || ""), profile).trim();
    if (!value || unfilledPlaceholders(value).length) continue;
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    plan.push({ field_id: f.id, value, label: f.label || f.id });
  }
  return plan;
}
