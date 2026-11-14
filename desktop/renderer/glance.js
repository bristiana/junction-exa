// The list beside the mascot: every errand that is running, waiting for you or done today, with Approve / Stop /
// Answer right here, and the live browser view of the run in progress.
import { glanceItems } from '../logic.mjs';
import { executionView, LIVE } from '../vendor/lib/execution.js';
window.__desktopErrors = [];
window.addEventListener('error', e => window.__desktopErrors.push(e.message));
window.addEventListener('unhandledrejection', e => window.__desktopErrors.push(String(e.reason)));
const $ = id => document.getElementById(id);
let tasks = [], shortcut = 'Alt+Space', pending = false;
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

function item(t, s) {
  const v = executionView(t);
  const li = el('li', { class: `item tone-${s.tone}${s.needsYou ? ' you' : ''}` },
    el('div', { class: 'row' }, el('i', { class: 'dot' }), el('span', { class: 'status', text: s.label }),
      el('span', { class: 'task', text: t.task.split('\n')[0], title: 'Open in chat', onclick: () => open(t) })));
  if (v?.question && answered.get(t.id) !== v.question.at) {
    const input = el('input', { type: 'text', placeholder: 'Your answer', 'aria-label': 'Your answer to Vali' });
    input.value = drafts.get(t.id) || '';
    input.oninput = () => drafts.set(t.id, input.value);
    const go = async () => {
      if (!input.value.trim()) { input.focus(); return; }
      if (await send({ type: 'message', taskId: t.id, text: input.value.trim() }, 'Answer sent.')) { answered.set(t.id, v.question.at); drafts.delete(t.id); input.blur(); render(); }
    };
    input.onkeydown = e => { if (e.key === 'Enter') go(); };
    li.append(el('p', { class: 'detail', text: v.question.text }), el('div', { class: 'answer' }, input, el('button', { class: 'btn', type: 'button', text: 'Send', onclick: go })));
  } else if (v?.phase === 'approval' && !t.execution.approval_decision) {
    li.append(v.summary ? el('p', { class: 'detail', text: v.summary }) : null,
      el('div', { class: 'btns' }, button('Stop', 'ghost', { type: 'stop', taskId: t.id }, 'Stopped. Nothing was sent.'),
        button('Approve', 'approve', { type: 'approve', taskId: t.id }, 'Approved. Vali sends it once.')));
  } else if (v?.live) {
    li.append(el('div', { class: 'btns' }, button('Stop', 'ghost', { type: 'stop', taskId: t.id }, 'Stopped.')));
  } else if (t.status === 'queued' || t.status === 'running') {
    li.append(el('div', { class: 'btns' }, button('Stop', 'ghost', { type: 'cancel', taskId: t.id }, 'Stopped.')));
  } else {
    if (v?.blocker?.reason) li.append(el('p', { class: 'detail', text: v.blocker.reason }));
    else if (s.tone === 'done' && (v?.result || t.output?.structured?.answer)) li.append(el('p', { class: 'detail', text: String(v?.result || t.output.structured.answer).slice(0, 160) }));
    if (s.needsYou) li.append(el('div', { class: 'btns' }, el('button', { class: 'btn', type: 'button', text: 'Open', onclick: () => open(t) })));
  }
  return li;
}
function render() {
  const focused = document.activeElement?.closest?.('.item');
  if (focused && document.activeElement.tagName === 'INPUT') { pending = true; return; }
  pending = false;
  const list = glanceItems(tasks);
  $('list').replaceChildren(...list.map(({ t, s }) => item(t, s)));
  $('empty').hidden = list.length > 0;
  $('empty').textContent = `Nothing running. Press ${shortcut.replace('Alt', '⌥').replace('+', '')} or drop a letter on Vali to hand off an errand.`;
  refreshLive();
}
// The live view follows the newest run in the browser.
let liveId = null, loading = false;
async function refreshLive() {
  const t = tasks.find(x => x.backend && LIVE.has(x.execution?.status));
  $('live').hidden = !t; liveId = t?.remoteId || null;
  if (!t) return;
  $('liveStep').textContent = executionView(t)?.step || 'Opening the page…';
  if (loading || document.hidden) return;
  loading = true;
  try {
    const frame = await window.vali.call('liveFrame', t.remoteId);
    if (frame && liveId === t.remoteId) $('live').querySelector('img').src = `data:${frame.mime};base64,${frame.base64}`;
  } finally { loading = false; }
}
setInterval(() => { if (liveId) refreshLive(); }, 1500);
document.addEventListener('focusout', () => setTimeout(() => { if (pending) render(); }));
window.vali.onChange((changes, area) => { if (area === 'local' && changes.tasks) { tasks = changes.tasks.newValue || []; render(); } });
window.vali.onState(s => { shortcut = s.shortcut || shortcut; });
window.vali.call('state').then(s => { shortcut = s.shortcut || shortcut; });
window.vali.call('storage:get', { area: 'local', keys: ['tasks'] }).then(s => { tasks = s.tasks || []; render(); });
$('new').onclick = () => window.vali.call('newErrand');
$('chat').onclick = () => window.vali.call('chat');
document.body.onmouseenter = () => window.vali.call('glance', 'hover');
document.body.onmouseleave = () => window.vali.call('glance', 'leave');
window.addEventListener('keydown', e => { if (e.key === 'Escape') window.vali.call('glance', 'hide'); });
new ResizeObserver(() => window.vali.call('glanceSize', $('box').offsetHeight + 20)).observe($('box'));
