// The browser run behind "Fill it for me": the live frame, its steps, and Approve / Stop when it waits for you.
import { api } from './api.js';
import { h } from './dom.js';
import { domainOf, friendlySteps, runStatus } from './model.js';
import { questionBlock } from './working.js';
import { fillPlaceholders, loadProfile } from './profile.js';

const STATUS = {
  starting: 'Opening the page', running: 'Filling the form', awaiting_approval: 'Waiting for your OK',
  submitting: 'Submitting', done: 'Done', failed: "Couldn't finish", stopped: 'Stopped. Nothing was sent.',
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
      quiet ? null : h('span', { class: `badge ${live ? 'live' : status}` }, STATUS[status] || status),
      run.current_url ? h('span', { class: 'run-url' }, domainOf(run.current_url)) : null),
    frame(task, live),
    steps.length ? h('ol', { class: 'run-steps' }, steps.map((step) => h('li', {}, fillPlaceholders(step, profile)))) : null,
    run.question?.text && !quiet ? questionBlock({ text: run.question.text, options: [] }, onReply) : null,
    waiting ? approval(run.approval, profile, onApprove, onStop, quiet) : null,
    run.result && !live && !quiet ? h('p', { class: 'run-result' }, run.result) : null,
    run.error && !(quiet && status === 'stopped') ? h('p', { class: 'run-error' }, run.error) : null,
    live && !waiting && !quiet ? h('button', { type: 'button', class: 'btn quiet', onclick: (e) => onStop(e.currentTarget) }, 'Stop') : null);
}

// While the run is live, the frame reloads every 1.2 s; afterwards it shows the last screenshot.
// A run that typed your details keeps no picture after that point, so it says so instead.
function frame(task, live) {
  if (!live && task.execution.private_view) return h('p', { class: 'muted' }, 'No picture: the page showed your details.');
  const shots = task.execution.shots || [];
  const last = shots[shots.length - 1];
  const lastShot = last && Number.isInteger(last.n) ? shotSrc(task, last.n) : null;
  const src = live ? api.imageUrl(`/v1/tasks/${encodeURIComponent(task.id)}/live.jpg`) : lastShot;
  if (!src) return null;
  const img = h('img', { class: 'run-frame', alt: 'What the browser Vali drives shows now', src: src + (live ? `&ts=${Date.now()}` : '') });
  img.addEventListener('error', () => { if (lastShot) img.src = lastShot; else img.hidden = true; }, { once: true });
  if (live) frameTimer = setInterval(() => { if (img.isConnected && !document.hidden) img.src = src + `&ts=${Date.now()}`; }, 1200);
  return img;
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
