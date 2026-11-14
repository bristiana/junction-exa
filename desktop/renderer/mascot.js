// The mascot: a badge with the number of running errands, a ring and a bell when one needs you, a speech bubble with
// one line, hover or click for the list of everything, Talk for a live voice conversation, and a drop target for a
// photo or PDF of a letter. Where he stands and when he sleeps comes from main (stage.mjs, valet.mjs).
import { letterType, talkCaption, talkStatus } from '../logic.mjs';
import { bubbleLine, contextLine } from '../valet.mjs';
import { createTalk } from './talk.js';
window.__desktopErrors = [];
window.addEventListener('error', e => window.__desktopErrors.push(e.message));
const mascot = Butler.create(document.getElementById('mascot'), { palette: 'lilac', state: 'idle', reducedMotion: 'auto', trackPointer: true });
const $ = id => document.getElementById(id);
const wrap = $('wrap');
let current = null, override = '', overrideTimer = 0, talkMode = '';
// The call's last lines: Vali's and the user's, with when they arrived (see talkCaption).
let heard = { agent: '', agentAt: 0, user: '', userAt: 0 }, heardTimer = 0, statusTimer = 0;
// Smoke and talk-check load this page with ?check=1; only then are the test hooks on window.
const testing = new URLSearchParams(location.search).has('check');

// Stop drawing when nothing moves: asleep, or standing still under Reduce motion (frames.js holds Butler's frames).
// Any change or pointer movement draws again for a second so he settles into the new pose.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let stillTimer = 0;
function settle() {
  window.ValiFrames.resume(); clearTimeout(stillTimer);
  const still = !talkMode && (wrap.classList.contains('sleep') || reduceMotion.matches);
  if (still) stillTimer = setTimeout(() => window.ValiFrames.pause(), 1000);
}
window.addEventListener('pointermove', () => { if (window.ValiFrames.paused) settle(); }, { passive: true });
reduceMotion.addEventListener('change', () => settle());

function line(text, action, who = '') {
  $('line').textContent = text; $('bubble').dataset.who = who;
  $('bubble').querySelector('.v-btn')?.remove();
  if (action) $('bubble').append(Object.assign(document.createElement('button'), { className: 'v-btn v-btn--quiet v-btn--sm', type: 'button', textContent: action[0], onclick: action[1] }));
}
// Talking wins over errands; a short message (say) wins over the errand line.
function poseNow(s) {
  if (talkMode === 'connecting') return 'thinking';
  if (talkMode === 'listening') return 'listening';
  if (talkMode === 'speaking') return 'idle';
  return s.valet?.sleeping ? 'idle' : s.pose;
}
function update(s) {
  current = s;
  const { count = 0, needsYou = false } = s.badge || {}, valet = s.valet || {};
  const you = needsYou && !s.paused, sleeping = !!valet.sleeping && !talkMode && !you;
  document.body.dataset.place = valet.place || 'home'; document.body.dataset.edge = valet.edge || 'right';
  wrap.classList.toggle('you', you); $('bell').toggleAttribute('hidden', !you);
  wrap.classList.toggle('sleep', sleeping); $('zzz').hidden = !sleeping;
  mascot.setReducedMotion(sleeping ? true : 'auto');
  // Walking to an edge: he looks where he is going.
  mascot.lookAt(valet.facing === 'left' ? -4000 : valet.facing === 'right' ? 4000 : null, 120);
  $('badge').hidden = !count && !needsYou; $('badge').textContent = count || '!'; $('badge').classList.toggle('you', needsYou);
  $('mascot').setAttribute('aria-label', `Show your errands${count ? `: ${count} running` : ''}${needsYou ? ', one needs you' : ''}`);
  settle();
  if (override) return;
  mascot.setState(poseNow(s));
  if (talkMode) { const c = talkCaption({ mode: talkMode, ...heard }); line(c.text, null, c.who); }
  else line(bubbleLine({ pose: s.pose, paused: s.paused, sleeping, welcome: s.welcome, badge: s.badge }));
}
function say(text, ms = 3000, pose, action) {
  override = text; line(text, action); if (pose) mascot.setState(pose); settle();
  clearTimeout(overrideTimer); if (ms) overrideTimer = setTimeout(() => { override = ''; if (current) update(current); }, ms);
}

// ---------- Talk to Vali ----------
function status(key) {
  clearTimeout(statusTimer);
  $('status').textContent = talkStatus(key); $('status').dataset.mode = key; $('status').hidden = !key;
}
// A new caption: the user's words stay up for a moment (talkCaption), then Vali's line takes over by itself.
function hear(text, who) {
  const now = Date.now();
  heard = who === 'you' ? { ...heard, user: text, userAt: now } : { ...heard, agent: text, agentAt: now };
  if (who === 'you') { clearTimeout(heardTimer); heardTimer = setTimeout(() => current && update(current), 2600); }
}
function ended() { status('ended'); statusTimer = setTimeout(() => { if (!talkMode) status(''); }, 3000); }
function setTalkMode(mode) {
  talkMode = mode; if (!mode) { heard = { agent: '', agentAt: 0, user: '', userAt: 0 }; clearTimeout(heardTimer); }
  status(mode);
  for (const c of ['talking', 'connecting', 'listening', 'speaking']) wrap.classList.toggle(c, c === 'talking' ? !!mode : mode === c);
  $('talk').classList.toggle('v-btn--danger', !!mode);
  $('talk').querySelector('span').textContent = mode ? 'Stop' : 'Talk';
  $('talk').setAttribute('aria-label', mode ? 'Stop talking' : 'Talk to Vali');
}
const level = v => wrap.style.setProperty('--level', v.toFixed(2));
function showTalk({ mode, caption, who = 'vali', ended: hungUp, error, mic }) {
  if (mode !== undefined) setTalkMode(mode);
  if (caption) hear(caption, who);
  if (hungUp) ended();
  if (error) { say(error, 8000, 'error', mic ? ['Open settings', () => window.vali.call('micSettings')] : null); return; }
  if (current) update(current);
}
const talk = createTalk({ expose: testing, level, show: showTalk });
$('talk').onclick = e => { e.stopPropagation(); talk.toggle(); };
window.vali.onTalk(action => (action === 'stop' ? talk.stop() : action === 'start' ? talk.start() : talk.toggle()));

// ---------- the list, the chat, context ----------
window.vali.onState(update);
window.vali.call('state').then(update);
$('mascot').onclick = () => window.vali.call('glance', 'toggle');
$('mascot').ondblclick = () => window.vali.call('chat');
// S3: on hover, one offer about the browser tab in front (its address only). Read at most every 10 s.
let tabAt = 0;
async function offerForTab() {
  if (talkMode || override || Date.now() - tabAt < 10000 || !['idle', 'success'].includes(current?.pose) || current?.badge?.needsYou) return;
  tabAt = Date.now();
  const text = contextLine(await window.vali.call('frontTab').catch(() => null));
  if (text && !talkMode) say(text, 5000);
}
wrap.onmouseenter = () => { window.vali.call('glance', 'hover'); offerForTab(); };
wrap.onmouseleave = () => window.vali.call('glance', 'leave');

// ---------- drop a letter on Vali ----------
let depth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); if (depth++ === 0) { wrap.classList.add('drop'); say('Drop the letter on me.', 0, 'listening'); } });
window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; wrap.classList.remove('drop'); override = ''; if (current) update(current); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); depth = 0; wrap.classList.remove('drop');
  const file = e.dataTransfer.files[0];
  if (!file) { say('Drop a photo or a PDF of the letter.'); return; }
  const { mime, error } = letterType(file);
  if (error) { say(error, 5000, 'error'); return; }
  say('Reading your letter…', 0, 'thinking');
  const r = await window.vali.call('letter', { bytes: await file.arrayBuffer(), mime, name: file.name });
  say(r.ok ? 'Got it. I’m on it.' : r.error, r.ok ? 3000 : 6000, r.ok ? 'working' : r.comingSoon ? 'idle' : 'error');
});

// Smoke only: feed the bubble what talk.js would (see showTalk), plus a voice level, without a network call.
if (testing) window.__smokeTalk = ({ level: v = 0, ...event }) => { showTalk(event); level(v); };
