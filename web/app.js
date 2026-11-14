// The page controller: routes (#/ home, #/t/<id> one errand), the ask box, and polling the open errand.
import { api } from './api.js';
import { $ } from './dom.js';
import { TERMINAL, isActive } from './model.js';
import { renderWorking, tickClock } from './working.js';
import { renderAnswer } from './answer.js';
import { startMic } from './mic.js';

const POLL_MS = 1500;
let followed = null; // { id, task, timer, clock }

function showView(name) {
  for (const id of ['home', 'working', 'answer']) $(id).hidden = id !== name;
  window.scrollTo({ top: 0 });
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

// ---------- routes ----------
function route() {
  notice('');
  const match = location.hash.match(/^#\/t\/([\w-]+)$/);
  if (match) return follow(match[1]);
  unfollow();
  showView('home');
}

window.addEventListener('hashchange', route);
route();
