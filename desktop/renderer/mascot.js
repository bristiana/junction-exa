// The mascot: a badge with the number of running errands, an amber ring when one needs you, hover or click for the
// list of everything, and a drop target for a photo or PDF of a letter.
import { letterType } from '../logic.mjs';
window.__desktopErrors = [];
window.addEventListener('error', e => window.__desktopErrors.push(e.message));
const mascot = Butler.create(document.getElementById('mascot'), { palette: 'lilac', state: 'idle', reducedMotion: 'auto', trackPointer: true });
const words = { idle: 'At your service', working: 'Taking care of it', needs_approval: 'Waiting for your OK', success: 'All taken care of', error: 'Something needs a look' };
const $ = id => document.getElementById(id);
let current = null, override = '', overrideTimer = 0;
function update(s) {
  current = s;
  const { count = 0, needsYou = false } = s.badge || {};
  $('wrap').classList.toggle('you', needsYou && !s.paused);
  $('badge').hidden = !count && !needsYou; $('badge').textContent = count || '!'; $('badge').classList.toggle('you', needsYou);
  $('mascot').setAttribute('aria-label', `Show your errands${count ? `: ${count} running` : ''}${needsYou ? ', one needs you' : ''}`);
  if (!override) { mascot.setState(s.pose); $('status').textContent = s.paused ? 'Paused' : needsYou ? 'Needs you' : words[s.pose]; }
}
function say(text, ms = 3000, pose) {
  override = text; $('status').textContent = text; if (pose) mascot.setState(pose);
  clearTimeout(overrideTimer); if (ms) overrideTimer = setTimeout(() => { override = ''; if (current) update(current); }, ms);
}
window.vali.onState(update);
window.vali.call('state').then(update);
$('mascot').onclick = () => window.vali.call('glance', 'toggle');
$('mascot').ondblclick = () => window.vali.call('chat');
$('wrap').onmouseenter = () => window.vali.call('glance', 'hover');
$('wrap').onmouseleave = () => window.vali.call('glance', 'leave');
// Drop a letter on Vali.
let depth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); if (depth++ === 0) { $('wrap').classList.add('drop'); say('Drop the letter on me', 0, 'listening'); } });
window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('wrap').classList.remove('drop'); override = ''; if (current) update(current); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); depth = 0; $('wrap').classList.remove('drop');
  const file = e.dataTransfer.files[0];
  if (!file) { say('Drop a photo or a PDF of the letter.'); return; }
  const { mime, error } = letterType(file);
  if (error) { say(error, 5000, 'error'); return; }
  say('Reading your letter…', 0, 'thinking');
  const r = await window.vali.call('letter', { bytes: await file.arrayBuffer(), mime, name: file.name, size: file.size });
  say(r.ok ? 'Got it. On it now.' : r.error, r.ok ? 3000 : 6000, r.ok ? 'working' : r.comingSoon ? 'idle' : 'error');
});
