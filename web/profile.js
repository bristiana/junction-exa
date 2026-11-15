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

// The demo account's details until you save your own: the demo name, everything else mock.
export const DEMO_PROFILE = {
  name: 'Bogdan Caraeane', email: 'demo@vali.demo', phone: '+358 40 123 4567', address: 'Otakaari 1',
  postal_code: '02150', city: 'Espoo', country: 'Finland', date_of_birth: '2000-01-01', nationality: 'Romanian',
};

export function loadProfile() {
  try {
    const saved = clean(JSON.parse(localStorage.getItem(STORE_KEY)));
    return Object.keys(saved).length ? saved : { ...DEMO_PROFILE };
  } catch { return { ...DEMO_PROFILE }; }
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
  const used = new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase().replace(/^(first|last|full)_name$/, 'name')));
  const named = (key) => new RegExp(`(?<!\\w)${key.replaceAll('_', '\\s*[_ ]\\s*')}(?!\\w)`, 'i').test(task?.task || '');
  return PROFILE_FIELDS.filter(([key]) => (used.has(key) || named(key)) && !profile[key]).map(([key, label]) => ({ key, label }));
}

// Placeholders in what the cloud browser filled, shown with your own values. Only on this page; nothing is sent.
// The cloud browser also types {{first_name}}, {{last_name}} and {{full_name}}, split from the full name the way the
// agent splits it (backend/vali_agent/scope.py with_name_parts): "Anna Maria Virtanen" -> "Anna Maria" + "Virtanen".
// What is still a {{placeholder}} after the profile pass reads as a blank to fill: {{application_date}} -> "[application date]".
export function readableBlanks(text) {
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => `[${key.toLowerCase().replaceAll('_', ' ')}]`);
}

export function fillPlaceholders(text, profile) {
  const words = String(profile?.name || '').trim().split(/\s+/).filter(Boolean);
  const parts = { full_name: words.join(' '), ...(words.length >= 2 ? { first_name: words.slice(0, -1).join(' '), last_name: words.at(-1) } : {}) };
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => profile?.[key.toLowerCase()] || parts[key.toLowerCase()] || m);
}
