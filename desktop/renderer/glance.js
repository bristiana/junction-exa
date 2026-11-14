// The list beside the mascot: every errand that is running, waiting for you or done today, with Approve / Stop /
// Answer right here, and the live browser view of the run in progress.
import { glanceItems } from '../logic.mjs';
import { executionView, LIVE } from '../vendor/lib/execution.js';
import { showWelcome } from './welcome.js';
import { glanceKeyAction } from '../glancekeys.mjs';
window.__desktopErrors = [];
window.addEventListener('error', e => window.__desktopErrors.push(e.message));
window.addEventListener('unhandledrejection', e => window.__desktopErrors.push(String(e.reason)));
const $ = id => document.getElementById(id);
let tasks = [], shortcut = 'Alt+Space', pending = false, focusId = null;
const drafts = new Map(), answered = new Map();

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  e.append(...kids.filter(Boolean)); return e;
}
function toast(text) { $('toast').textContent = text; setTimeout(() => { if ($('toast').textContent === text) $('toast').textContent = ''; }, 3000); }
async function send(msg, done) {
  const r = await window.vali.call('message', msg);
  if (!r.ok) { toast(r.error); return false; }
  if (done) toast(done); return true;
}
function button(text, cls, msg, done) {
  const b = el('button', { class: 'btn ' + cls, type: 'button', text });
  b.onclick = async () => { b.disabled = true; await send(msg, done); b.disabled = false; };
  return b;
}
const open = t => { if (!t.seen) send({ type: 'seen', taskId: t.id }); window.vali.call('chat', t.id); };
const liveBox = $('live'), liveImg = liveBox.querySelector('img'), liveStep = $('liveStep');
const liveTask = () => tasks.find(x => x.backend && LIVE.has(x.execution?.status));
const clip = (text, n = 140) => { const s = String(text || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const lastProgress = t => (Array.isArray(t.progress) && t.progress.length ? t.progress[t.progress.length - 1].text : '');

// One errand: title, one status line (<b>Status</b> · detail), and at most two actions. Only the first errand that
// needs the user gets the primary button; the rest are soft, so each view has one clear next step.
function item(t, s, primary, live) {
  const v = executionView(t);
  const asking = v?.question && answered.get(t.id) !== v.question.at;
  const approving = !asking && v?.phase === 'approval' && !t.execution.approval_decision;
  const running = !asking && !approving && (v?.live || t.status === 'queued' || t.status === 'running');
  const detail = asking ? v.question.text : approving ? v.summary : v?.blocker?.reason
    || (s.active ? v?.step || lastProgress(t) : s.tone === 'done' || s.needsYou ? v?.result || t.output?.structured?.answer : '');
  const main = el('div', { class: 'main' },
    el('button', { class: 'task', type: 'button', text: t.task.split('\n')[0], title: 'Open in chat', onclick: () => open(t) }),
    el('p', { class: 'status' }, el('b', { text: s.label }), detail ? ` · ${clip(detail)}` : ''));
  const row = el('div', { class: 'row' }, el('i', { class: 'dot' }), main);
  const li = el('li', { class: `item tone-${s.tone}${s.needsYou ? ' you' : ''}${t.id === focusId ? ' focus' : ''}`, 'data-id': t.id }, row, t === live ? liveBox : null);
  const actionClass = primary ? 'btn' : 'btn soft';
  if (asking) {
    const input = el('input', { type: 'text', placeholder: 'Your answer', 'aria-label': `Your answer: ${v.question.text}` });
    input.value = drafts.get(t.id) || '';
    input.oninput = () => drafts.set(t.id, input.value);
    const go = async () => {
      if (!input.value.trim()) { input.focus(); return; }
      if (await send({ type: 'message', taskId: t.id, text: input.value.trim() }, 'Answer sent.')) { answered.set(t.id, v.question.at); drafts.delete(t.id); input.blur(); render(); }
    };
    input.onkeydown = e => { if (e.key === 'Enter') go(); };
    li.append(el('div', { class: 'answer' }, input, el('button', { class: actionClass, type: 'button', text: 'Send', onclick: go })));
  } else if (approving) {
    li.append(el('div', { class: 'btns' }, button('Stop', 'quiet stop', { type: 'stop', taskId: t.id }, 'Stopped. Nothing was sent.'),
      button('Approve', actionClass + ' approve', { type: 'approve', taskId: t.id }, 'Approved. Vali sends it once.')));
  } else if (running) {
    row.append(button('Stop', 'quiet stop', { type: v?.live ? 'stop' : 'cancel', taskId: t.id }, 'Stopped.'));
  } else if (s.needsYou) {
    const url = v?.blocker?.url;
    li.append(el('div', { class: 'btns' }, url
      ? el('button', { class: actionClass, type: 'button', text: 'Open the site', onclick: () => { send({ type: 'seen', taskId: t.id }); window.vali.call('external', url); } })
      : el('button', { class: actionClass, type: 'button', text: 'Open', onclick: () => open(t) })));
  }
  return li;
}
function render() {
  const focused = document.activeElement?.closest?.('.item');
  if (focused && document.activeElement.tagName === 'INPUT') { pending = true; return; }
  pending = false;
  const list = glanceItems(tasks), live = liveTask();
  const first = list.find(x => x.s.needsYou);
  $('list').replaceChildren(...list.map(({ t, s }) => item(t, s, first?.t === t, live)));
  $('new').className = first ? 'btn soft' : 'btn';
  const count = test => list.filter(({ s }) => test(s)).length;
  const you = count(s => s.needsYou), busy = count(s => !s.needsYou && s.active), done = count(s => s.tone === 'done');
  $('summary').textContent = [you && `${you} need${you === 1 ? 's' : ''} you`, busy && `${busy} working`, done && `${done} done today`].filter(Boolean).join(' · ');
  $('empty').hidden = list.length > 0;
  $('emptyText').textContent = `Press ${shortcut.replace('Alt', '⌥').replace('+', '')} or drop a letter on Vali.`;
  if (document.hasFocus() && !items().some(li => li.dataset.id === focusId)) setFocus(0);
  refreshLive();
}
// Keyboard: a ring on one errand; Enter, A and S act on that errand only, through its own buttons.
const items = () => [...$('list').children];
function setFocus(i) {
  focusId = items()[i]?.dataset.id || null;
  items().forEach(li => li.classList.toggle('focus', li.dataset.id === focusId));
  $('list').querySelector('.focus')?.scrollIntoView({ block: 'nearest' });
}
function runKey(e) {
  const list = items(), index = list.findIndex(li => li.dataset.id === focusId), li = list[index];
  const ctx = { index, count: list.length, hasApprove: !!li?.querySelector('button.approve'), hasStop: !!li?.querySelector('button.stop'),
    field: e.target.tagName === 'INPUT', onButton: e.target.tagName === 'BUTTON' };
  const act = e.altKey || e.ctrlKey || e.metaKey ? null : glanceKeyAction(e.key, ctx);
  if (!act) return;
  e.preventDefault();
  if (act.type === 'close') window.vali.call('glance', 'hide');
  else if (act.type === 'move') setFocus(act.index);
  else if (act.type === 'open') open(tasks.find(t => t.id === focusId));
  else li.querySelector(act.type === 'approve' ? 'button.approve' : 'button.stop').click();
}
window.addEventListener('focus', () => { if (!items().some(li => li.dataset.id === focusId)) setFocus(0); });
// The live view follows the newest run in the browser.
let liveId = null, loading = false;
async function refreshLive() {
  const t = liveTask();
  liveBox.hidden = !t; liveId = t?.remoteId || null;
  if (!t) return;
  liveStep.textContent = executionView(t)?.step || 'Opening the page…';
  if (loading || document.hidden) return;
  loading = true;
  try {
    const frame = await window.vali.call('liveFrame', t.remoteId);
    if (frame && liveId === t.remoteId) liveImg.src = `data:${frame.mime};base64,${frame.base64}`;
  } finally { loading = false; }
}
setInterval(() => { if (liveId) refreshLive(); }, 1500);
document.addEventListener('focusout', () => setTimeout(() => { if (pending) render(); }));
window.vali.onChange((changes, area) => { if (area === 'local' && changes.tasks) { tasks = changes.tasks.newValue || []; render(); } });
const onState = s => { shortcut = s.shortcut || shortcut; showWelcome(s); };
window.vali.onState(onState);
window.vali.call('state').then(onState);
window.vali.call('storage:get', { area: 'local', keys: ['tasks'] }).then(s => { tasks = s.tasks || []; render(); });
$('new').onclick = () => window.vali.call('newErrand');
$('chat').onclick = () => window.vali.call('chat');
document.body.onmouseenter = () => window.vali.call('glance', 'hover');
document.body.onmouseleave = () => window.vali.call('glance', 'leave');
window.addEventListener('keydown', runKey);
new ResizeObserver(() => window.vali.call('glanceSize', $('box').offsetHeight + 20)).observe($('box'));
