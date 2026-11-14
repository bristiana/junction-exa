// "Your details": saved only in this browser and sent only with Fill it for me (the execute call), for that one form.
// The fields match the extension's profile (extension/lib/task.js) minus the answer language, which only the
// extension uses when it starts an errand.
export const PROFILE_FIELDS = [
  ['name', 'Full name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['address', 'Street address'],
  ['postal_code', 'Postal code'],
  ['city', 'City'],
  ['country', 'Country'],
  ['date_of_birth', 'Date of birth'],
  ['nationality', 'Nationality'],
];
const KEYS = new Set(PROFILE_FIELDS.map(([key]) => key));
const STORE_KEY = 'vali.profile';

// Only known fields with a value; anything else is dropped.
function clean(profile) {
  const out = {};
  for (const [key, value] of Object.entries(profile || {})) {
    const text = String(value ?? '').trim();
    if (KEYS.has(key) && text) out[key] = text;
  }
  return out;
}

export function loadProfile() {
  try { return clean(JSON.parse(localStorage.getItem(STORE_KEY))); } catch { return {}; }
}

// Returns false when this browser can't keep it (private window, storage off).
export function saveProfile(profile) {
  const value = clean(profile);
  try {
    if (Object.keys(value).length) localStorage.setItem(STORE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORE_KEY);
    return true;
  } catch { return false; }
}

export function deleteProfile() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* nothing was kept */ }
}

// The details the plan uses as {{placeholders}}, or the errand names ("my name and email", the cloud browser's own
// rule), that "Your details" does not hold yet.
export function missingDetails(task, profile) {
  const text = JSON.stringify([task?.task, task?.research?.output?.structured]);
  const used = new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase()));
  const named = (key) => new RegExp(`(?<!\\w)${key.replaceAll('_', '\\s*[_ ]\\s*')}(?!\\w)`, 'i').test(task?.task || '');
  return PROFILE_FIELDS.filter(([key]) => (used.has(key) || named(key)) && !profile[key]).map(([key, label]) => ({ key, label }));
}

// Placeholders in what the cloud browser filled, shown with your own values. Only on this page; nothing is sent.
export function fillPlaceholders(text, profile) {
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => profile[key.toLowerCase()] || m);
}
