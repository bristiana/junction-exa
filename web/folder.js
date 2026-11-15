// "Your folder" on home: what Vali knows about you (situation on the account, the names of the details saved in this
// browser, never their values) and the files Vali saved across errands. Plus "Vali at work": the mascot's pose and one
// speech line while any errand works in the background. Built only from the errand list, the profile and /v1/me.
import { api } from './api.js';
import { $, h, show } from './dom.js';
import { activityLine, activityOf, domainOf, draftsOf, errandStatus, moodOf, readableTitle, sourcesOf, structured } from './model.js';
import { PROFILE_FIELDS, loadProfile } from './profile.js';
import { openDetails } from './details.js';
import { icon } from './dashboard.js';

const SHOWN = 8;
const ICONS = {
  email: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 7.2L4 7.5V17h16V7.5l-8 4.7Z',
  copy_text: 'M8 3h9l4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 7v2h8v-2H9Zm0 4v2h6v-2H9ZM3 7h2v13h11v2H5a2 2 0 0 1-2-2V7Z',
  answer: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7Z',
  form: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4v2h10V7H7Zm0 4v2h10v-2H7Zm0 4v2h6v-2H7Z',
};
const RUN_STATE = { done: 'sent', stopped: 'not sent', awaiting_approval: 'waiting for your OK', failed: 'not sent' };

let lastTasks = [];
let situation = null;   // a promise of /v1/me's situation, asked once per page and again after Details closes
let wired = false;

// ---------- Vali at work ----------
// The newest working errand: its pose for the mascot and what it is doing right now, in plain words.
export function atWork(tasks) {
  const working = (tasks || []).filter((task) => errandStatus(task).tone === 'working');
  if (!working.length) return null;
  const task = working[0];
  const mood = moodOf(task);
  return { mood: ['working', 'searching', 'thinking'].includes(mood) ? mood : 'working', line: nowLine(task), count: working.length, id: task.id };
}

function nowLine(task) {
  const run = task.execution;
  if (run && ['starting', 'running', 'submitting'].includes(run.status)) {
    const domain = domainOf(run.current_url || run.start_url);
    return domain ? `Filling the form on ${domain}` : 'Filling the form';
  }
  const last = activityOf(task).at(-1);
  if (!last) return 'Starting the research';
  const domain = domainOf(last.url);
  const text = last.kind === 'read' && domain ? `Reading ${domain}` : activityLine(last);
  return text.length > 64 ? text.slice(0, 61).trimEnd() + '…' : text;
}

// The speech line beside the mascot on home; hidden when nothing works.
export function renderAtWork(work) {
  const slot = document.querySelector('#home .hero-slot');
  if (!slot) return;
  let bubble = slot.querySelector('.vali-says');
  if (!bubble) {
    bubble = h('a', { class: 'vali-says', role: 'status', 'aria-live': 'polite' });
    slot.append(bubble);
  }
  bubble.hidden = !work;
  if (!work) return;
  bubble.href = `#/t/${encodeURIComponent(work.id)}`;
  bubble.replaceChildren(h('span', { class: 'vali-says-line' }, work.line));
  if (work.count > 1) bubble.append(h('span', { class: 'vali-says-more' }, `${work.count} errands working`));
}

// ---------- your folder ----------
export function renderFolder(tasks) {
  lastTasks = tasks || [];
  if (!wired) {
    wired = true;
    // Saved or deleted details change what Vali knows, so the folder redraws when the sheet closes.
    $('details')?.addEventListener('close', () => { situation = null; if (!$('home').hidden) renderFolder(lastTasks); });
  }
  situation ||= api.me().then((me) => me?.situation || {}).catch(() => ({}));
  const known = h('div', { class: 'folder-known' });
  situation.then((s) => paintKnown(known, s));
  show('folder',
    h('div', { class: 'folder-head' },
      h('h2', { class: 'section-title' }, 'Your folder'),
      h('p', { class: 'folder-note' }, 'What Vali keeps for your errands. Saved details stay in this browser.')),
    known,
    files(lastTasks));
}

function paintKnown(node, facts) {
  const chips = situationChips(facts);
  const saved = PROFILE_FIELDS.filter(([key]) => loadProfile()[key]).map(([, label]) => label);
  node.replaceChildren(
    h('div', { class: 'folder-row-head' },
      h('h3', { class: 'folder-sub' }, 'About you'),
      h('button', { type: 'button', class: 'link-btn folder-edit', onclick: () => openDetails() }, chips.length || saved.length ? 'Edit' : 'Add')),
    chips.length || saved.length
      ? h('ul', { class: 'folder-chips' },
        chips.map((text) => h('li', { class: 'fact' }, text)),
        saved.map((label) => h('li', { class: 'saved', title: 'Saved in this browser' }, label)))
      : h('p', { class: 'folder-empty' }, 'Nothing yet. Add your situation so answers fit you.'));
}

// The situation as short facts. These are choices about rules (EU or not, student), never contact details.
export function situationChips(s = {}) {
  const out = [];
  const citizen = { eu: 'EU citizen', nordic: 'Nordic citizen', non_eu: 'From outside the EU' }[s.citizenship];
  if (citizen) out.push(citizen);
  if (s.student === true) out.push('Student');
  if (s.school) out.push(String(s.school));
  if (s.city) out.push(String(s.city));
  if (s.country) out.push(`From ${s.country}`);
  if (s.has_personal_id === true) out.push('Personal ID');
  if (s.has_personal_id === false) out.push('No personal ID yet');
  if (s.has_bank === true) out.push('Finnish bank account');
  if (s.has_bank === false) out.push('No bank account yet');
  const arrived = /^(\d{4})-(\d{2})/.exec(s.arrived || '');
  if (arrived) out.push(`Arrived ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(arrived[2]) - 1]} ${arrived[1]}`);
  return out.filter(Boolean).map((text) => text.slice(0, 40));
}

// Everything Vali prepared, newest first: filled forms (their last screenshot), drafts, and answers with sources.
export function filesOf(tasks) {
  const out = [];
  for (const task of tasks || []) {
    const when = Date.parse(task.updated_at || task.created_at) || 0;
    const href = `#/t/${encodeURIComponent(task.id)}`;
    const run = task.execution;
    const shots = Array.isArray(run?.shots) ? run.shots.filter((s) => Number.isInteger(s?.n)) : [];
    const form = Boolean(run && shots.length);
    if (form) {
      const domain = domainOf(run.start_url || run.current_url);
      out.push({ kind: 'form', when, href, title: readableTitle(task.task), meta: ['Filled form', RUN_STATE[run.status]].filter(Boolean).join(', '),
        place: domain, shot: run.private_view ? null : shots.at(-1).n, id: task.id });
    }
    for (const draft of draftsOf(task)) {
      out.push({ kind: draft.type, when, href, title: draft.subject || draft.label || task.task,
        meta: draft.type === 'email' ? 'Email draft' : 'Text to copy', place: '' });
    }
    const sources = sourcesOf(task);
    if (!form && task.research?.status === 'completed' && String(structured(task).answer || '').trim() && sources.length) {
      out.push({ kind: 'answer', when, href, title: readableTitle(task.task), meta: `Answer, ${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`,
        place: sources[0].domain });
    }
  }
  return out.sort((a, b) => b.when - a.when);
}

function files(tasks) {
  const all = filesOf(tasks);
  const list = h('ul', { class: 'folder-files' }, all.map((file, i) => tile(file, i >= SHOWN)));
  const more = all.length > SHOWN ? h('button', { type: 'button', class: 'link-btn more', onclick: (e) => {
    for (const li of list.querySelectorAll('li[hidden]')) li.hidden = false;
    e.currentTarget.hidden = true;
  } }, `Show all ${all.length}`) : null;
  return h('div', { class: 'folder-saved' },
    h('div', { class: 'folder-row-head' },
      h('h3', { class: 'folder-sub' }, 'Files Vali saved', all.length ? h('span', { class: 'group-count' }, String(all.length)) : null)),
    all.length ? list : h('p', { class: 'folder-empty' }, 'Forms, drafts and answers Vali prepares show up here.'),
    more);
}

function tile(file, hidden) {
  const picture = file.kind === 'form' && file.shot != null
    ? h('img', { class: 'file-shot', alt: '', loading: 'lazy', src: api.imageUrl(`/v1/tasks/${encodeURIComponent(file.id)}/shots/${file.shot}.jpg`),
      onerror: (e) => { e.currentTarget.replaceWith(glyph(file.kind)); } })
    : glyph(file.kind);
  return h('li', { hidden: hidden || null },
    h('a', { class: `file ${file.kind}`, href: file.href },
      picture,
      h('span', { class: 'file-text' },
        h('span', { class: 'file-meta' }, file.meta),
        h('span', { class: 'file-title' }, file.title),
        file.place ? h('span', { class: 'file-place' }, file.place) : null)));
}

function glyph(kind) {
  return h('span', { class: `file-glyph ${kind}` }, icon(ICONS[kind] || ICONS.answer));
}
