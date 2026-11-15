// The browser run behind "Fill it for me": the live frame, its steps, and Approve / Stop when it waits for you.
import { api } from './api.js';
import { h } from './dom.js';
import { blockedRun, domainOf, friendlySteps, plainError, runStatus } from './model.js';
import { questionBlock } from './working.js';
import { fillPlaceholders, loadProfile } from './profile.js';

const STATUS = {
  starting: 'Opening the page', running: 'Filling the form', awaiting_approval: 'Waiting for your OK',
  submitting: 'Submitting', done: 'Done', failed: "Couldn't finish", stopped: 'Held, nothing sent',
};
const LIVE = new Set(['starting', 'running', 'awaiting_approval', 'submitting']);
let frameTimer = 0;

export function stopFrames() {
  clearInterval(frameTimer);
}

export function renderExecution(task, { onApprove, onStop, onReply, quiet = false }) {
  stopFrames();
  const run = task.execution;
  if (!run) return null;
  const status = runStatus(task);
  const live = LIVE.has(status);
  const waiting = status === 'awaiting_approval';
  const steps = friendlySteps(task).slice(-6);
  const profile = loadProfile(); // placeholders show your own values, on this page only
  return h('section', { class: quiet ? 'run quiet-run' : `run card ${waiting ? 'waiting' : ''}` },
    h('div', { class: 'run-head' },
      quiet ? null : blockedRun(task) ? h('span', { class: 'badge you' }, 'Handed to you') : h('span', { class: `badge ${live ? 'live' : status}` }, STATUS[status] || status),
      run.current_url ? h('span', { class: 'run-url' }, domainOf(run.current_url)) : null),
    frame(task, live),
    steps.length ? h('ol', { class: 'run-steps' }, steps.map((step) => h('li', {}, fillPlaceholders(step, profile)))) : null,
    run.question?.text && !quiet ? questionBlock({ text: run.question.text, options: [] }, onReply) : null,
    waiting ? approval(run.approval, profile, onApprove, onStop, quiet) : null,
    run.result && !live && !quiet ? h('p', { class: 'run-result' }, status === 'failed' ? plainError(run.result) : run.result) : null,
    run.error && !(quiet && status === 'stopped') ? h('p', { class: 'run-error' }, plainError(run.error)) : null,
    live && !waiting && !quiet ? h('button', { type: 'button', class: 'btn quiet', onclick: (e) => onStop(e.currentTarget) }, 'Stop') : null);
}

// While the run is live, the frame reloads every 1.2 s; afterwards it shows the last screenshot.
// A run that typed your details keeps no picture after that point, so it says so instead.
// One box per task survives the 2 s redraws: the same node moves into the new card, so the picture never blanks,
// and a new frame fades in over the old one only after it has loaded.
let held = null; // { id, box, shown, live }

function frame(task, live) {
  if (!live && task.execution.private_view) return h('p', { class: 'muted' }, 'No picture: the page showed your details.');
  const shots = task.execution.shots || [];
  const last = shots[shots.length - 1];
  const lastShot = last && Number.isInteger(last.n) ? shotSrc(task, last.n) : null;
  const src = live ? api.imageUrl(`/v1/tasks/${encodeURIComponent(task.id)}/live.jpg`) : lastShot;
  if (!src) return held && held.id === task.id && held.shown ? (held.box.classList.remove('is-live'), held.box) : null; // keep the last live picture
  if (!held || held.id !== task.id) {
    const box = h('div', { class: 'run-frame-box' }, h('span', { class: 'run-live', 'aria-hidden': 'true' }, 'Live'));
    held = { id: task.id, box, shown: '', live };
  }
  held.live = live;
  held.box.classList.toggle('is-live', live);
  const next = live ? `${src}&ts=${Date.now()}` : src;
  if (live || held.shown !== src) swap(held, next, lastShot);
  if (live) frameTimer = setInterval(() => { if (held?.box.isConnected && !document.hidden) swap(held, `${src}&ts=${Date.now()}`, lastShot); }, 1200);
  return held.box;
}

// Load the next picture off screen, then fade it in over the one on show; a failed load keeps the old picture.
function swap(state, src, fallback) {
  if (state.loading) return;
  state.loading = true;
  const img = h('img', { class: 'run-frame', alt: 'What the browser Vali drives shows now' });
  img.decoding = 'async';
  const done = () => { state.loading = false; };
  img.onload = () => {
    done();
    const old = [...state.box.querySelectorAll('img.run-frame')];
    state.shown = src.replace(/&ts=\d+$/, '');
    state.box.append(img);
    requestAnimationFrame(() => img.classList.add('shown'));
    setTimeout(() => old.forEach((o) => o.remove()), 260);
  };
  img.onerror = () => {
    done();
    if (fallback && src !== fallback && !state.box.querySelector('img.run-frame')) swap(state, fallback, null);
  };
  img.src = src;
}

// Screenshots always load from this API's own /v1 path (signed with ?t=), never from a URL inside the task.
function shotSrc(task, n) {
  return api.imageUrl(`/v1/tasks/${encodeURIComponent(task.id)}/shots/${n}.jpg`);
}

// filled: [{label, value, source}] from the agent; values hold placeholders, shown here with Your details.
function approval(details, profile, onApprove, onStop, quiet = false) {
  const filled = Array.isArray(details?.filled) ? details.filled.filter((f) => f?.label) : [];
  return h('div', { class: 'approval' },
    details?.summary ? h('p', { class: 'approval-summary' }, details.summary) : null,
    filled.length ? h('dl', { class: 'filled' }, filled.map((f) => h('div', {}, h('dt', {}, f.label), h('dd', {}, fillPlaceholders(f.value, profile))))) : null,
    quiet ? null : h('p', { class: 'muted' }, 'Nothing is sent until you approve.'),
    quiet ? null : h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: (e) => onApprove(e.currentTarget) }, 'Approve'),
      h('button', { type: 'button', class: 'btn quiet', onclick: (e) => onStop(e.currentTarget) }, 'Stop')));
}

// The run's picture on its own (live frame or last screenshot), for the booking card on top of the errand page.
export function runFrame(task) {
  stopFrames();
  return task?.execution ? frame(task, LIVE.has(runStatus(task))) : null;
}
