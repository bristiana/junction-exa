// The page controller: routes (#/ home, #/t/<id> one errand, #/dashboard, #/dashboard/<id> one errand as a chat),
// the ask box, and polling the open errand.
import { api, session } from './api.js';
import { renderLogin } from './login.js';
import { $, h } from './dom.js';
import { TERMINAL, isActive, moodOf, primaryAction } from './model.js';
import { renderWorking, tickClock } from './working.js';
import { renderAnswer } from './answer.js';
import { stopFrames } from './execution.js';
import { startMic } from './mic.js';
import { hasWorking, renderDashboard } from './dashboard.js';
import { createMascot, mountPalettePicker } from './mascot.js';
import { openTrust } from './trust.js';
import { openDetails } from './details.js';
import { openWhatsapp } from './whatsapp.js';
import { loadProfile } from './profile.js';
import { openHub } from './hub.js';
import { EXA_USES } from './exa-uses.js';
import { closeBoard, openBoard, resumeBoard } from './board.js';
import { createAskDock } from './ask-dock.js';
import { atWork, renderAtWork, renderFolder } from './folder.js';

const POLL_MS = 2000;
const BUSY_MS = 10000;
let followed = null; // { id, task, key, timer, clock }
const mascot = window.Butler ? createMascot() : null;
if (mascot) mountPalettePicker($('palette'), mascot);
$('exa-uses').replaceChildren(...EXA_USES.map(([label, detail]) => h('div', {}, h('dt', {}, label), h('dd', {}, detail))));

function showView(name) {
  for (const id of ['home', 'working', 'answer', 'hub', 'dashboard', 'login']) $(id).hidden = id !== name;
  document.body.classList.toggle('signed-in', session.signedIn());
  for (const link of document.querySelectorAll('.top [data-view]')) {
    if (link.dataset.view === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
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
// The one way an errand starts on this page: the home ask box, follow-ups and the corner bubble all call it.
function startErrand(errand, previousTaskId) {
  if (!session.signedIn()) {  // invite only: no new accounts, so sign in first
    location.hash = '#/login';
    return Promise.reject(Object.assign(new Error('Sign in first.'), { signInRequired: true }));
  }
  return api.createTask(errand, previousTaskId, Object.keys(loadProfile()));
}

async function ask(text, previousTaskId, form = $('ask'), input = $('errand')) {
  const errand = text.trim();
  if (!errand) return;
  notice('');
  if (form.classList.contains('busy')) return;
  form.classList.add('busy');
  try {
    const task = await startErrand(errand, previousTaskId);
    input.value = '';
    location.hash = '#/t/' + task.id;
  } catch (error) {
    if (!error.signInRequired) notice(`Couldn't start the errand: ${error.message}`);
  } finally {
    form.classList.remove('busy');
  }
}

$('ask').addEventListener('submit', (event) => { event.preventDefault(); ask($('errand').value); });
$('dashboard-ask').addEventListener('submit', (event) => {
  event.preventDefault();
  ask($('dashboard-errand').value, undefined, $('dashboard-ask'), $('dashboard-errand'));
});
for (const chip of document.querySelectorAll('#examples button.chip')) chip.addEventListener('click', () => ask(chip.textContent));
startMic($('mic'), { onText: (text) => { $('errand').value = text; $('errand').focus(); }, onError: notice });
createAskDock({ start: (text) => startErrand(text), mascot });
$('landing-try')?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('errand').focus({ preventScroll: true });
});

// ---------- one errand ----------
// Only the open errand is polled: every 2 s while it runs, never while the tab is hidden, and after a 429 it waits
// for Retry-After (or 10 s).
let pollGen = 0;     // only the newest poll may schedule the next one
let acting = false;  // one action request at a time: Approve, Stop and Fill it for me can't double-submit
let leaving = '';    // a note to show once the page is back home

const handlers = {
  onReply: (text, button) => act(() => api.message(followed.id, text), button),
  onCancel: (button) => act(() => api.cancel(followed.id), button),
  onFollowUp: (text) => ask(text, followed.id),
  onExecute: (index, button) => act(() => api.execute(followed.id, index, loadProfile()), button),
  onDetails: (needed) => openDetails(needed),
  onApprove: (button) => act(() => api.approve(followed.id), button),
  onStop: (button) => act(() => api.stop(followed.id), button),
  // Continue a stopped run from where it stopped; an API without /continue starts the same form again.
  onResume: (answer, button) => act(() => api.resume(followed.id, answer, loadProfile()).catch((error) => {
    const action = primaryAction(followed.task);
    if (![404, 405].includes(error.status) || !action) throw error;
    return api.execute(followed.id, action.index, loadProfile());
  }), button),
};

async function act(request, button) {
  if (acting) return;
  acting = true;
  if (button) button.disabled = true;
  try {
    render(await request());
    notice('');
    poll();
  } catch (error) {
    if (error.status === 429) notice(`Vali is busy. Try again in ${error.retryAfter || BUSY_MS / 1000} s.`, true);
    else notice(error.message);
  } finally {
    acting = false;
    if (button) button.disabled = false;
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
  const current = followed, gen = ++pollGen;
  if (!current) return;
  clearTimeout(current.timer);
  if (document.hidden) return;
  try {
    const task = await api.task(current.id);
    if (gen !== pollGen) return;
    if (!$('notice').hidden && $('notice').classList.contains('quiet')) notice('');
    render(task);
    if (isActive(task)) current.timer = setTimeout(poll, POLL_MS);
  } catch (error) {
    if (gen !== pollGen) return;
    if (error.status === 404) {
      leaving = 'That errand is not in this browser’s account.';
      location.hash = '#/';
    } else if (error.status === 429) {
      notice('Busy, retrying…', true);
      current.timer = setTimeout(poll, error.retryAfter ? error.retryAfter * 1000 : BUSY_MS);
    } else {
      notice(`Lost touch with Vali: ${error.message}`);
      current.timer = setTimeout(poll, BUSY_MS);
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
  pollGen++;
  clearTimeout(followed.timer);
  clearInterval(followed.clock);
  stopFrames();
  followed = null;
}

// ---------- your errands ----------
// Loaded when home opens and when the tab comes back, never on a timer; /v1/stats is optional until the API ships it.
// While an errand is working in the background, the list refreshes itself every few seconds.
let listTimer = 0;
async function loadDashboard() {
  clearTimeout(listTimer);
  if (!session.signedIn()) return;
  try {
    const [{ tasks }, stats] = await Promise.all([api.tasks(), api.stats().catch(() => null)]);
    if ($('home').hidden) return;
    renderDashboard(tasks, stats);
    renderFolder(tasks);
    // Vali at work: while an errand runs in the background he poses for it and says what he is doing.
    const work = atWork(tasks);
    mascot?.setMood(work ? work.mood : 'idle');
    renderAtWork(work);
    if (hasWorking(tasks) && !document.hidden) listTimer = setTimeout(loadDashboard, 4000);
  } catch { /* the list stays as it was until the next visit */ }
}


$('to-trust')?.addEventListener('click', () => openTrust(followed?.task));
$('trust').addEventListener('click', (event) => { if (event.target === $('trust')) $('trust').close(); });
$('to-details').addEventListener('click', () => openDetails());
$('to-whatsapp').addEventListener('click', () => openWhatsapp());
$('to-logout').addEventListener('click', () => { session.signOut(); location.hash = '#/'; showView('home'); });
$('whatsapp').addEventListener('click', (event) => { if (event.target === $('whatsapp')) $('whatsapp').close(); });
$('details').addEventListener('click', (event) => { if (event.target === $('details')) $('details').close(); });
// Saved or deleted details change the open answer's hint and approval values, so it redraws.
$('details').addEventListener('close', () => { if (followed?.task) { followed.key = null; render(followed.task); } });

// ---------- routes ----------
function route() {
  notice('');
  // Errands and the dashboard need a signed-in account; the landing page and sign-in do not.
  const gated = /^#\/(dashboard|t\/)/.test(location.hash);
  if (gated && !session.signedIn()) {
    closeBoard();
    unfollow();
    renderLogin(location.hash);
    return showView('login');
  }
  if (location.hash === '#/login') {
    closeBoard();
    unfollow();
    if (session.signedIn() && !session.hasDemo()) { location.hash = '#/'; return; }
    renderLogin('#/');
    return showView('login');
  }
  if ($('details').open) $('details').close();
  if ($('whatsapp').open) $('whatsapp').close();
  notice(leaving);
  leaving = '';
  const board = location.hash.match(/^#\/dashboard(?:\/([\w-]+))?$/);
  if (!board) closeBoard();
  const match = location.hash.match(/^#\/t\/([\w-]+)$/);
  if (match) return follow(match[1]);
  unfollow();
  if (board) {
    showView('dashboard');
    mascot?.setMood('idle');
    return openBoard(board[1] || null);
  }
  if (location.hash === '#/hub') {
    showView('hub');
    mascot?.setMood('idle');
    return openHub({ onAsk: (text) => ask(text) });
  }
  showView('home');
  mascot?.setMood('idle');
  loadDashboard();
}

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return clearTimeout(followed?.timer);
  if (followed) poll();
  else if (!$('home').hidden) loadDashboard();
  else if (!$('dashboard').hidden) resumeBoard();
});
route();
