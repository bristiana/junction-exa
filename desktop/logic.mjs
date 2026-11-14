import { redactText } from './vendor/lib/redact.js';
import { executionView } from './vendor/lib/execution.js';
const ACTIVE = new Set(['starting', 'running', 'awaiting_approval', 'submitting']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
// A finished answer is only "waiting for your OK" when something prepared is there to approve, or the errand
// (claim / book / write) is to be done. A plain answer to a find / check errand is just done.
const DO_IT = new Set(['claim', 'book', 'write']);
export function hasNextStep(t) {
  const s = t?.output?.structured;
  return s?.status === 'ready_to_approve' && !!(s.actions?.length || s.form_fill?.length || DO_IT.has(t.mode));
}
const inResearch = t => taskState(t) === 'working' && !t.execution?.status;
export function taskState(t) {
  if (!t) return 'idle';
  const e = t.execution;
  if (e?.status === 'failed') return 'error';
  if (e?.status === 'stopped') return 'idle';
  if (e?.status === 'done') return 'success';
  if (e?.question || (e?.status === 'awaiting_approval' && !e.approval_decision)) return 'needs_approval';
  if (ACTIVE.has(e?.status)) return 'working';
  if (t.status === 'failed') return 'error';
  if (!TERMINAL.has(t.status)) return 'working';
  if (t.status === 'completed') {
    const status = t.output?.structured?.status;
    if (status === 'needs_info' || hasNextStep(t)) return 'needs_approval';
    if (status === 'not_possible') return 'error';
    return 'success';
  }
  return 'idle';
}
// Same order as the extension panel header: something for you, then a browser run, then research (the searching pose).
export function mascotState(tasks, paused = false) {
  if (paused) return 'idle';
  const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  const mine = sorted.find(t => taskState(t) === 'needs_approval');
  if (mine) return 'needs_approval';
  const busy = sorted.filter(t => taskState(t) === 'working');
  if (busy.length) return busy.every(inResearch) ? 'searching' : 'working';
  return taskState(sorted[0]);
}
export function notificationEvents(previous, next) {
  // First poll establishes a baseline: no flood of old completed errands.
  if (!previous) return [];
  const out = [];
  const p = previous.execution || {}, e = next.execution || {};
  if (e.status === 'awaiting_approval' && !e.approval_decision &&
      (p.status !== e.status || p.approval_decision || JSON.stringify(p.approval) !== JSON.stringify(e.approval))) out.push('approval');
  if (e.question && JSON.stringify(e.question) !== JSON.stringify(p.question)) out.push('question');
  if (e.status === 'done' && p.status !== 'done') out.push('done');
  else if (!e.status && next.status === 'completed' && previous.status !== 'completed') {
    const result = next.output?.structured?.status;
    out.push(hasNextStep(next) ? 'approval' : result === 'needs_info' ? 'question' : 'done');
  }
  return out;
}

// ---------- easy input (pure, shared by main and the quick box) ----------

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const httpUrl = u => { try { const x = new URL(String(u || '')); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };

// The quick box text plus its context chips -> the POST /v1/tasks body. Page text is redacted like the extension does
// (lib/backend.js backendPage). Without a page URL the server ignores page.selection, so the selection goes inline.
export function buildErrand({ text = '', selection = '', page = null } = {}) {
  let task = String(text).trim();
  const sel = clip(selection, 2500);
  if (!task && sel) task = 'Explain this and tell me what I need to do.';
  if (!task) throw new Error('Tell Vali what to take care of.');
  const url = httpUrl(page?.url);
  if (url) {
    const out = { url, title: redactText(clip(page.title, 300)) };
    if (sel) out.selection = redactText(sel);
    return { task, page: out };
  }
  if (sel) task += `\n\nAbout this text:\n"""${redactText(sel)}"""`;
  return { task, page: null };
}

const GENERAL = [
  'Find a public sauna in Helsinki for this Saturday evening',
  'My flight was delayed by more than 3 hours. Claim compensation.',
  'Register my change of address',
  'Which Kela benefits can I get as a student, and how do I apply?',
  'My landlord wants to raise my rent. Is that allowed? Draft a reply.',
  'Book a time at the DVV service point',
];
const WITH_TEXT = ['Explain this in plain English', 'What do I need to do about this?', 'Draft a reply to this'];
const WITH_PAGE = ['Help me fill in the form on this page', 'What is this page asking me to do?'];
const WITH_LETTER = ['What does this letter say and what do I need to do?', 'Draft a reply to this letter'];

// Spotlight-style suggestions: the context first, then matches for what was typed (every word must match).
export function suggest(query = '', { selection = false, page = false, letter = false } = {}, limit = 5) {
  const pool = [...(letter ? WITH_LETTER : []), ...(selection ? WITH_TEXT : []), ...(page ? WITH_PAGE : []), ...GENERAL];
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? pool.filter(s => words.every(w => s.toLowerCase().includes(w))) : pool;
  return [...new Set(hits)].filter(s => s.toLowerCase() !== String(query).trim().toLowerCase()).slice(0, limit);
}

// `lsappinfo visibleProcessList` lists apps front to back ("Google_Chrome" etc.). The browser counts only when it is
// the frontmost app other than Vali itself, so a Chrome window behind Finder is never attached.
const BROWSERS = { 'Google Chrome': 'chrome', Safari: 'safari', Arc: 'chrome', 'Brave Browser': 'chrome', 'Microsoft Edge': 'chrome' };
export function frontBrowser(list, skip = ['Vali', 'Electron']) {
  const names = [...String(list || '').matchAll(/"([^"]+)"/g)].map(m => m[1].replace(/_/g, ' ').replace(/[‎‏]/g, '').trim());
  const front = names.find(n => !skip.includes(n));
  return front && BROWSERS[front] ? front : null;
}
export function tabScript(app) {
  const tab = BROWSERS[app] === 'safari' ? 'current tab of front window' : 'active tab of front window';
  const esc = app.replace(/"/g, '');
  return `if application "${esc}" is running then\ntell application "${esc}"\nif (count of windows) is 0 then return ""\nset t to ${tab}\nreturn (URL of t) & linefeed & (${BROWSERS[app] === 'safari' ? 'name' : 'title'} of t)\nend tell\nend if\nreturn ""`;
}
export function parseTab(stdout) {
  const [url = '', ...title] = String(stdout || '').trim().split('\n');
  const href = httpUrl(url.trim());
  return href ? { url: href, title: title.join(' ').trim().slice(0, 300) } : null;
}

// The new endpoints may not be deployed yet. A missing route answers FastAPI's bare 404 "Not Found" (or 405/501): that
// means "coming soon". A 404 with its own message ("Link code not found or expired") is a real answer.
export const comingSoon = e => [405, 501].includes(e?.status) || (e?.status === 404 && /^not found$/i.test(String(e?.message || '').trim()));

// POST /v1/voice answers {text} or a task plus text: either {task: {...}, text} or the task itself with a text field.
export function voiceOutcome(json) {
  if (!json || typeof json !== 'object') return { text: '', task: null };
  if (json.task && typeof json.task === 'object') return { text: String(json.text || json.task.task || ''), task: json.task };
  if (json.id && json.research) return { text: String(json.text || json.task || ''), task: json };
  return { text: String(json.text || ''), task: null };
}

// What POST /v1/letters accepts (backend/vali_api/uploads.py): JPEG, PNG, WebP, HEIC and PDF up to 10 MB.
const LETTER_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp' };
export const MAX_LETTER_BYTES = 10 * 1024 * 1024;
// A dropped file -> its MIME type, or an error message in plain words.
export function letterType({ name = '', type = '', size = 0 } = {}) {
  const mime = Object.values(LETTER_TYPES).includes(type) ? type : LETTER_TYPES[String(name).toLowerCase().split('.').pop()];
  if (!mime) return { error: 'Drop a photo or a PDF of the letter.' };
  if (size > MAX_LETTER_BYTES) return { error: 'That file is too big. Try a photo under 10 MB.' };
  return { mime };
}
// What main accepts from the quick box's recorder (POST /v1/voice takes longer clips, but nobody talks that long).
export const MAX_VOICE_BYTES = 25 * 1024 * 1024;

// ---------- local secrets (token and profile are encrypted with the macOS keychain) ----------
export function sealConfig(config, encrypt) {
  const out = { ...config };
  delete out.backendToken; delete out.profile; delete out.connectionError;
  if (config.backendToken) out.encryptedToken = encrypt(config.backendToken);
  const profile = Object.fromEntries(Object.entries(config.profile || {}).filter(([, v]) => String(v || '').trim()));
  if (Object.keys(profile).length) out.encryptedProfile = encrypt(JSON.stringify(profile));
  return out;
}
export function openConfig(saved, decrypt) {
  const out = { ...saved };
  delete out.encryptedToken; delete out.encryptedProfile;
  if (saved.encryptedToken) out.backendToken = decrypt(saved.encryptedToken);
  out.profile = saved.encryptedProfile ? JSON.parse(decrypt(saved.encryptedProfile)) : saved.profile || {};
  return out;
}

// ---------- the glance list beside the mascot ----------
// One plain line per errand, in the same words as the extension panel (extension/lib/panel-state.js):
// Waiting for your OK (only with something to approve), New answer, Needs your answer, Needs login, Needs you, Working, Done, Stopped, Couldn't finish.
// needsYou: Vali waits on the user.
export function plainStatus(t) {
  const x = t?.execution, v = executionView(t);
  const you = (label, needsYou = true, active = false, attention = 'handoff') => ({ label, tone: 'you', needsYou, active, attention });
  if (v?.question && !v.question.answered) return you('Needs your answer', true, true, 'question');
  if (v?.phase === 'approval' && !x.approval_decision) return you('Waiting for your OK', true, true, 'approval');
  if (v?.phase === 'blocked') {
    if (v.blocker.kind === 'suspicious') return { label: 'Couldn’t finish', tone: 'bad', needsYou: false, active: false };
    return you(['login', 'suomifi'].includes(v.blocker.kind) ? 'Needs login' : 'Needs you', !t.seen);
  }
  if (v?.live) return { label: 'Working', tone: 'busy', needsYou: false, active: true };
  if (x?.status === 'done') return { label: 'Done', tone: 'done', needsYou: false, active: false };
  if (x?.status === 'stopped') return { label: 'Stopped', tone: 'quiet', needsYou: false, active: false };
  if (x?.status) return { label: 'Couldn’t finish', tone: 'bad', needsYou: false, active: false };
  if (t?.status === 'queued' || t?.status === 'running') return { label: 'Working', tone: 'busy', needsYou: false, active: true };
  if (t?.status === 'cancelled') return { label: 'Stopped', tone: 'quiet', needsYou: false, active: false };
  const s = t?.output?.structured?.status;
  if (t?.status === 'failed' || s === 'not_possible') return { label: 'Couldn’t finish', tone: 'bad', needsYou: false, active: false };
  if (s === 'needs_info') return you('Needs your answer', !t.seen, false, 'question');
  if (hasNextStep(t)) return you('Waiting for your OK', !t.seen, false, 'approval');
  return { label: t.seen ? 'Done' : 'New answer', tone: 'done', needsYou: false, active: false };
}

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
// Everything at once: what needs you first, then what is running, then what finished today.
// A finished result or a blocked run needs you until its card has been opened (seen).
export function glanceItems(tasks = [], now = Date.now()) {
  const rank = s => s.needsYou ? 0 : s.active ? 1 : 2;
  return tasks
    .map(t => ({ t, s: plainStatus(t) }))
    .filter(({ t, s }) => s.needsYou || s.active || sameDay(t.completedAt || t.createdAt, now))
    .sort((a, b) => rank(a.s) - rank(b.s) || b.t.createdAt - a.t.createdAt);
}

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// The newest Exa call of one errand as a short bubble line (<= 60 chars): the browser run's lookups (execution.exa)
// first, else the research progress. Only the task's own query / question / url fields are shown, a url as its host.
export function exaLine(t) {
  const call = (Array.isArray(t?.execution?.exa) ? t.execution.exa : []).filter(e => e?.kind === 'search' || e?.kind === 'read').at(-1);
  const step = (Array.isArray(t?.progress) ? t.progress : []).filter(p => p?.text).at(-1);
  const search = call ? call.kind === 'search' && String(call.query || '') : step?.kind === 'search' && String(step.text);
  const page = call ? call.kind === 'read' && (hostOf(call.url) || String(call.question || '')) : step?.kind === 'source' && (hostOf(step.text) || String(step.text));
  if (search) return clip(`Searching with Exa: ${search.trim()}`, 59);
  if (page && call?.url) return clip(`Reading ${page}`, 59);
  if (page && call) return clip(`Looking up ${page.replace(/[?.!]+$/, '')} with Exa`, 59);
  return page ? clip(`Reading ${page}`, 59) : '';
}

// Everything at once: counts, whether something needs you (and what), and what Exa is doing right now.
export function badgeOf(tasks = []) {
  const all = tasks.map(plainStatus);
  const attention = all.find(s => s.needsYou)?.attention;
  const exa = tasks.filter((t, i) => all[i].active && !all[i].needsYou).map(exaLine).find(Boolean);
  return { count: all.filter(s => s.active).length, needsYou: !!attention, ...(attention ? { attention } : {}), ...(exa ? { exa } : {}) };
}

// Console lines forwarded to stderr: tokens in query strings, Bearer headers and token fields are cut out.
export const redactSecrets = s => String(s ?? '').replace(/((?:[?&](?:t|token|conversation_token)=)|(?:Bearer\s+)|(?:"?(?:token|conversation_token|secret__vali_session)"?\s*[:=]\s*"?))[^\s&"',}]+/gi, '$1[redacted]');

// ---------- Talk to Vali (live voice with the ElevenLabs agent) ----------
// POST /v1/voice/session failed -> one plain sentence. 503: the server has no voice agent configured yet.
export function talkError(e) {
  if (comingSoon(e)) return 'Talking with Vali is coming soon. Type your errand for now.';
  if (e?.status === 503) return 'Talking is not set up on the server yet. Type your errand for now.';
  if (e?.status === 429) return 'That was a lot of talking. Try again in a few minutes.';
  if (e?.status === 502) return 'The voice service did not answer. Try again in a moment.';
  return String(e?.message || 'Could not start talking. Try again.');
}
// Microphone failures from getUserMedia (also inside the ElevenLabs client) -> what to do about it, or '' if not one.
export function micError(e) {
  const what = `${e?.name || ''} ${e?.message || ''}`;
  if (/NotAllowed|Permission|denied/i.test(what)) return 'Vali needs the microphone. Allow it in System Settings > Privacy & Security > Microphone.';
  if (/NotFound|DevicesNotFound|no audio input|Requested device not found/i.test(what)) return 'No microphone found. Connect one and try again.';
  if (/NotReadable|TrackStart|Could not start audio source/i.test(what)) return 'Another app is using the microphone. Close it and try again.';
  return '';
}
// The agent's last line for the caption bubble: audio tags like [laughs] removed, long lines keep their end.
export function caption(text, max = 140) {
  const s = String(text || '').replace(/\[[^\]]{1,30}\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const tail = s.slice(-max), cut = tail.search(/[.!?]\s+\S/);
  return '…' + (cut >= 0 && cut < max / 2 ? tail.slice(cut + 1).trim() : tail.slice(tail.indexOf(' ') + 1));
}
// The call's state in plain words, for the chip above Vali. 'ended' shows for a moment after hanging up.
const TALK_STATUS = { connecting: 'Connecting…', listening: 'Listening', speaking: 'Vali is speaking', ended: 'Call ended' };
export const talkStatus = mode => TALK_STATUS[mode] || '';
// The caption under Vali during a call: the user's words while they are the newest line (and for at least `hold` ms,
// so they are readable before Vali's answer replaces them), otherwise Vali's last line, otherwise a hint.
export function talkCaption({ mode = '', agent = '', agentAt = 0, user = '', userAt = 0, now = Date.now(), hold = 2500 } = {}) {
  if (user && (userAt >= agentAt || now - userAt < hold)) return { who: 'you', text: user };
  if (agent) return { who: 'vali', text: agent };
  return { who: 'vali', text: mode === 'connecting' ? 'One moment…' : 'I’m listening. Tell me the errand.' };
}
