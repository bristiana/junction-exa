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

const POLL_MS = 1500;
const DASHBOARD_MS = 10000;
let followed = null; // { id, task, timer, clock }
let dashboardTimer = 0;
const mascot = window.Butler ? createMascot() : null;
if (mascot) mountPalettePicker($('palette'), mascot);

function showView(name) {
  for (const id of ['home', 'working', 'answer']) $(id).hidden = id !== name;
  window.scrollTo({ top: 0 });
  mascot?.relayout();
}

function notice(text) {
  const node = $('notice');
  node.textContent = text;
  node.hidden = !text;
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
    notice(error.status === 429 ? 'Vali has done a lot of errands today. Try again in a little while.' : `Couldn't start the errand: ${error.message}`);
  } finally {
    $('ask').classList.remove('busy');
  }
}

$('ask').addEventListener('submit', (event) => { event.preventDefault(); ask($('errand').value); });
for (const chip of document.querySelectorAll('#examples .chip')) chip.addEventListener('click', () => ask(chip.textContent));
startMic($('mic'), { onText: (text) => { $('errand').value = text; $('errand').focus(); }, onError: notice });

// ---------- one errand ----------
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
    poll();
  } catch (error) {
    notice(error.message);
  }
}

// Redraw only when the errand changed, so a half-typed reply or an open citation survives the poll.
function render(task) {
  const same = followed.task && followed.task.updated_at === task.updated_at
    && followed.task.research?.status === task.research?.status;
  followed.task = task;
  if (same) return;
  mascot?.setMood(moodOf(task));
  const researching = !TERMINAL.has(task.research?.status);
  if (researching) renderWorking(task, handlers);
  else renderAnswer(task, handlers);
  const view = researching ? 'working' : 'answer';
  if ($(view).hidden) showView(view);
}

async function poll() {
  const current = followed;
  clearTimeout(current.timer);
  try {
    const task = await api.task(current.id);
    if (followed !== current) return;
    render(task);
    if (isActive(task)) current.timer = setTimeout(poll, POLL_MS);
  } catch (error) {
    if (followed !== current) return;
    notice(error.status === 404 ? 'That errand is not on this device.' : `Lost touch with Vali: ${error.message}`);
    if (error.status !== 404) current.timer = setTimeout(poll, POLL_MS * 3);
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
// Refreshes while the home view is open; /v1/stats is optional until the API ships it.
async function loadDashboard() {
  clearTimeout(dashboardTimer);
  try {
    const [{ tasks }, stats] = await Promise.all([api.tasks(), api.stats().catch(() => null)]);
    if (!$('home').hidden) renderDashboard(tasks, stats);
  } catch { /* the list stays as it was; the next refresh tries again */ }
  if (!$('home').hidden) dashboardTimer = setTimeout(loadDashboard, DASHBOARD_MS);
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
route();
