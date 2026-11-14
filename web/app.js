// The page controller: routes (#/ home, #/t/<id> one errand), the ask box, and polling the open errand.
import { api } from './api.js';
import { $ } from './dom.js';
import { TERMINAL, isActive, moodOf } from './model.js';
import { renderWorking, tickClock } from './working.js';
import { renderAnswer } from './answer.js';
import { startMic } from './mic.js';
import { renderDashboard } from './dashboard.js';
import { createMascot, mountPalettePicker } from './mascot.js';
import { openTrust } from './trust.js';

const POLL_MS = 2000;
const BUSY_MS = 10000;
let followed = null; // { id, task, key, timer, clock }
const mascot = window.Butler ? createMascot() : null;
if (mascot) mountPalettePicker($('palette'), mascot);

function showView(name) {
  for (const id of ['home', 'working', 'answer']) $(id).hidden = id !== name;
  window.scrollTo({ top: 0 });
  mascot?.relayout();
}

// One line under the header; quiet for "Busy, retrying", amber for real problems.
function notice(text, quiet = false) {
  const node = $('notice');
  node.textContent = text;
  node.hidden = !text;
  node.classList.toggle('quiet', quiet);
}

// ---------- asking ----------
async function ask(text, previousTaskId) {
  const errand = text.trim();
  if (!errand) return;
  notice('');
  $('ask').classList.add('busy');
  try {
    const task = await api.createTask(errand, previousTaskId);
    $('errand').value = '';
    location.hash = '#/t/' + task.id;
  } catch (error) {
    notice(`Couldn't start the errand: ${error.message}`);
  } finally {
    $('ask').classList.remove('busy');
  }
}

$('ask').addEventListener('submit', (event) => { event.preventDefault(); ask($('errand').value); });
for (const chip of document.querySelectorAll('#examples .chip')) chip.addEventListener('click', () => ask(chip.textContent));
startMic($('mic'), { onText: (text) => { $('errand').value = text; $('errand').focus(); }, onError: notice });

// ---------- one errand ----------
// Only the open errand is polled: every 2 s while it runs, never while the tab is hidden, and after a 429 it waits
// for Retry-After (or 10 s).
const handlers = {
  onReply: (text) => act(() => api.message(followed.id, text)),
  onCancel: () => act(() => api.cancel(followed.id)),
  onFollowUp: (text) => ask(text, followed.id),
  onExecute: (index) => act(() => api.execute(followed.id, index)),
  onApprove: () => act(() => api.approve(followed.id)),
  onStop: () => act(() => api.stop(followed.id)),
};

async function act(request) {
  try {
    render(await request());
    notice('');
    poll();
  } catch (error) {
    notice(error.message);
  }
}

// Redraw only when the errand changed, so a half-typed reply or an open citation survives the poll.
function render(task) {
  const key = JSON.stringify(task);
  followed.task = task;
  if (key === followed.key) return;
  followed.key = key;
  mascot?.setMood(moodOf(task));
  const researching = !TERMINAL.has(task.research?.status);
  if (researching) renderWorking(task, handlers);
  else renderAnswer(task, handlers);
  const view = researching ? 'working' : 'answer';
  if ($(view).hidden) showView(view);
}

async function poll() {
  const current = followed;
  if (!current) return;
  clearTimeout(current.timer);
  if (document.hidden) return;
  try {
    const task = await api.task(current.id);
    if (followed !== current) return;
    if (!$('notice').hidden && $('notice').classList.contains('quiet')) notice('');
    render(task);
    if (isActive(task)) current.timer = setTimeout(poll, POLL_MS);
  } catch (error) {
    if (followed !== current) return;
    if (error.status === 429) {
      notice('Busy, retrying…', true);
      current.timer = setTimeout(poll, error.retryAfter ? error.retryAfter * 1000 : BUSY_MS);
    } else {
      notice(error.status === 404 ? 'That errand is not on this device.' : `Lost touch with Vali: ${error.message}`);
      if (error.status !== 404) current.timer = setTimeout(poll, BUSY_MS);
    }
  }
}

function follow(id) {
  unfollow();
  followed = { id, task: null, timer: 0, clock: setInterval(() => followed?.task && tickClock(followed.task), 1000) };
  poll();
}

function unfollow() {
  if (!followed) return;
  clearTimeout(followed.timer);
  clearInterval(followed.clock);
  followed = null;
}

// ---------- your errands ----------
// Loaded when home opens and when the tab comes back, never on a timer; /v1/stats is optional until the API ships it.
async function loadDashboard() {
  try {
    const [{ tasks }, stats] = await Promise.all([api.tasks(), api.stats().catch(() => null)]);
    if (!$('home').hidden) renderDashboard(tasks, stats);
  } catch { /* the list stays as it was until the next visit */ }
}

$('to-errands').addEventListener('click', () => {
  if (location.hash.startsWith('#/t/')) location.hash = '#/';
  requestAnimationFrame(() => $('errands').scrollIntoView({ behavior: 'smooth' }));
});

$('to-trust').addEventListener('click', () => openTrust(followed?.task));
$('trust').addEventListener('click', (event) => { if (event.target === $('trust')) $('trust').close(); });

// ---------- routes ----------
function route() {
  notice('');
  const match = location.hash.match(/^#\/t\/([\w-]+)$/);
  if (match) return follow(match[1]);
  unfollow();
  showView('home');
  mascot?.setMood('idle');
  loadDashboard();
}

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return clearTimeout(followed?.timer);
  if (followed) poll();
  else if (!$('home').hidden) loadDashboard();
});
route();
