// The browser run behind "Fill it for me": the live frame, its steps, and Approve / Stop when it waits for you.
import { api } from './api.js';
import { h } from './dom.js';
import { domainOf } from './model.js';
import { questionBlock } from './working.js';

const STATUS = {
  starting: 'Opening the page', running: 'Filling the form', awaiting_approval: 'Waiting for your OK',
  submitting: 'Submitting', done: 'Done', failed: "Couldn't finish", stopped: 'Stopped. Nothing was sent.',
};
const LIVE = new Set(['starting', 'running', 'awaiting_approval', 'submitting']);
let frameTimer = 0;

export function renderExecution(task, { onApprove, onStop, onReply }) {
  clearInterval(frameTimer);
  const run = task.execution;
  if (!run) return null;
  const live = LIVE.has(run.status);
  const waiting = run.status === 'awaiting_approval';
  const steps = Array.isArray(run.steps) ? run.steps.slice(-6) : [];
  return h('section', { class: `run card ${waiting ? 'waiting' : ''}` },
    h('div', { class: 'run-head' },
      h('span', { class: `badge ${live ? 'live' : run.status}` }, STATUS[run.status] || run.status),
      run.current_url ? h('span', { class: 'run-url' }, domainOf(run.current_url)) : null),
    frame(task, live),
    steps.length ? h('ol', { class: 'run-steps' }, steps.map((step) => h('li', {}, step.text))) : null,
    run.question?.text ? questionBlock({ text: run.question.text, options: [] }, onReply) : null,
    waiting ? approval(run.approval, onApprove, onStop) : null,
    run.result && !live ? h('p', { class: 'run-result' }, run.result) : null,
    run.error ? h('p', { class: 'run-error' }, run.error) : null,
    live && !waiting ? h('button', { type: 'button', class: 'btn quiet', onclick: onStop }, 'Stop') : null);
}

// While the run is live, the frame reloads every 1.2 s; afterwards it shows the last screenshot.
function frame(task, live) {
  const shots = task.execution.shots || [];
  const last = shots[shots.length - 1];
  const src = live ? api.imageUrl(`/v1/tasks/${task.id}/live.jpg`) : last ? shotSrc(last.url) : null;
  if (!src) return null;
  const img = h('img', { class: 'run-frame', alt: 'What the browser Vali drives shows now', src: src + (live ? `&ts=${Date.now()}` : '') });
  img.addEventListener('error', () => { if (last) img.src = shotSrc(last.url); else img.hidden = true; }, { once: true });
  if (live) frameTimer = setInterval(() => { if (img.isConnected) img.src = src + `&ts=${Date.now()}`; }, 1200);
  return img;
}

// Screenshots are either API paths (signed with ?t=) or absolute image-host URLs.
function shotSrc(url) {
  return String(url).startsWith('/') ? api.imageUrl(url) : url;
}

// filled: [{label, value, source}] from the agent; values hold placeholders, never your real details.
function approval(details, onApprove, onStop) {
  const filled = Array.isArray(details?.filled) ? details.filled.filter((f) => f?.label) : [];
  return h('div', { class: 'approval' },
    details?.summary ? h('p', { class: 'approval-summary' }, details.summary) : null,
    filled.length ? h('dl', { class: 'filled' }, filled.map((f) => h('div', {}, h('dt', {}, f.label), h('dd', {}, String(f.value ?? ''))))) : null,
    h('p', { class: 'muted' }, 'Nothing is sent until you approve.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: onApprove }, 'Approve'),
      h('button', { type: 'button', class: 'btn quiet', onclick: onStop }, 'Stop')));
}
