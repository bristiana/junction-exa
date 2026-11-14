// The quick box: type, talk or drop a letter. Context (selected text, the browser tab) shows as chips you can remove.
import { suggest, letterType } from '../logic.mjs';
window.__desktopErrors = [];
window.addEventListener('error', e => window.__desktopErrors.push(e.message));
window.addEventListener('unhandledrejection', e => window.__desktopErrors.push(String(e.reason)));
const $ = id => document.getElementById(id);
const input = $('errand'), mic = $('mic');
let ctx = {}, letter = null, picked = -1, items = [], busy = false;
let rec = null; // { recorder, stream, audio, startedAt, hold, timer, cancelled }

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  e.append(...kids); return e;
}
function note(text, { error = false, action = null } = {}) {
  const n = $('note'); n.hidden = !text; n.className = 'note' + (error ? ' error' : ''); n.replaceChildren(text || '');
  if (action) n.append(el('button', { type: 'button', text: action[0], onclick: action[1] }));
}
function chips() {
  const list = [];
  const chip = (label, value, drop) => el('div', { class: 'chip' }, el('span', {}, el('b', { text: label + ' ' }), value), el('button', { type: 'button', 'aria-label': 'Remove ' + label, title: 'Remove', text: '×', onclick: () => { drop(); render(); input.focus(); } }));
  if (letter) list.push(chip('Letter', letter.name, () => { letter = null; }));
  if (ctx.selection) list.push(chip(ctx.via === 'clipboard' ? 'Clipboard' : 'Selected text', `“${ctx.selection.replace(/\s+/g, ' ').slice(0, 80)}”`, () => { ctx.selection = ''; }));
  if (ctx.page) list.push(chip(ctx.page.app || 'Page', ctx.page.title || ctx.page.url, () => { ctx.page = null; ctx.pageDismissed = true; }));
  $('chips').replaceChildren(...list); $('chips').hidden = !list.length;
}
function render() {
  chips();
  items = suggest(input.value, { selection: !!ctx.selection, page: !!ctx.page, letter: !!letter });
  if (picked >= items.length) picked = -1;
  $('suggestions').replaceChildren(...items.map((s, i) => el('li', { class: 'suggestion', role: 'option', 'aria-selected': String(i === picked), onmousedown: e => { e.preventDefault(); input.value = s; picked = -1; submit(); } }, el('span', { text: s }))));
}
function reset() { ctx = {}; letter = null; picked = -1; input.value = ''; note(''); render(); }
const close = () => { stopRecording(true); window.vali.call('hideQuick'); };

async function submit() {
  if (busy) return;
  const text = (picked >= 0 ? items[picked] : input.value).trim();
  if (!text && !letter && !ctx.selection) { input.focus(); return; }
  busy = true; note(letter ? 'Sending the letter to Vali…' : 'Sending…');
  try {
    const r = letter
      ? await window.vali.call('letter', { bytes: letter.bytes, mime: letter.mime, name: letter.name, size: letter.size, note: text })
      : await window.vali.call('message', { type: 'start', task: text, context: { selection: ctx.selection || '', page: ctx.page || null } });
    if (!r.ok) throw Object.assign(new Error(r.error), { soon: r.comingSoon });
    reset(); await window.vali.call('started');
  } catch (e) { note(e.message, { error: !e.soon }); }
  finally { busy = false; }
}

// ---------- voice: click the mic, or hold ⌥⇧Space (a quick tap keeps it listening until the next press) ----------
async function startRecording({ hold = false } = {}) {
  if (rec || busy) return;
  const access = await window.vali.call('mic');
  if (!access.granted) { note('Vali needs the microphone. Allow it in System Settings, then try again.', { error: true, action: ['Open settings', () => window.vali.call('micSettings')] }); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { note('Could not open the microphone.', { error: true }); return; }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  const chunks = [];
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec = { recorder, stream, startedAt: Date.now(), hold, cancelled: false };
  recorder.onstop = () => finishRecording(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' }));
  recorder.start(250);
  rec.timer = setTimeout(() => stopRecording(), 60000);
  meter(stream);
  listening(true);
}
function meter(stream) {
  try {
    const audio = new AudioContext(), analyser = audio.createAnalyser(), data = new Uint8Array(analyser.fftSize);
    audio.createMediaStreamSource(stream).connect(analyser); rec.audio = audio;
    const tick = () => { if (!rec || rec.audio !== audio) return; analyser.getByteTimeDomainData(data); let sum = 0; for (const v of data) sum += (v - 128) ** 2; $('level').firstChild.style.width = Math.min(100, Math.sqrt(sum / data.length) * 4) + '%'; requestAnimationFrame(tick); };
    tick();
  } catch { /* the meter is decoration */ }
}
function listening(on) {
  mic.classList.toggle('on', on); mic.setAttribute('aria-label', on ? 'Stop and send' : 'Talk to Vali');
  $('level').hidden = !on; input.placeholder = on ? (rec?.hold ? 'Listening… let go to send' : 'Listening… press again to send') : 'What should I take care of?';
  if (on) note('');
}
function stopRecording(cancel = false) {
  if (!rec) return;
  clearTimeout(rec.timer); rec.cancelled = cancel;
  if (rec.recorder.state !== 'inactive') rec.recorder.stop();
  rec.stream.getTracks().forEach(t => t.stop()); rec.audio?.close().catch(() => {});
}
async function finishRecording(blob) {
  const cancelled = rec?.cancelled; rec = null; listening(false);
  if (cancelled) return;
  if (blob.size < 1200) { note('I did not catch that. Hold the keys while you talk.'); return; }
  busy = true; note('Listening back…');
  try {
    const r = await window.vali.call('voice', { bytes: await blob.arrayBuffer(), mime: blob.type, context: { selection: ctx.selection || '', page: ctx.page || null } });
    if (!r.ok) { note(r.error, { error: !r.comingSoon }); return; }
    if (r.task) { note(`Got it: “${r.text}”`); setTimeout(() => { reset(); window.vali.call('started'); }, 900); return; }
    if (r.text?.trim()) { input.value = r.text.trim(); render(); note('Check the text, then press Enter.'); input.focus(); }
    else note('I did not catch that. Try again, a bit closer to the microphone.');
  } finally { busy = false; }
}
mic.onclick = () => rec ? stopRecording() : startRecording();
window.addEventListener('keyup', e => {
  // Hold to talk ends when the shortcut keys come up; a tap shorter than 0.4 s switches to press-again mode.
  if (!rec?.hold || ![' ', 'Alt', 'Shift'].includes(e.key)) return;
  if (Date.now() - rec.startedAt < 400) { rec.hold = false; listening(true); return; }
  stopRecording();
});

// ---------- keyboard ----------
input.addEventListener('input', () => { picked = -1; render(); });
input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (items.length) picked = e.key === 'ArrowDown' ? (picked + 1 >= items.length ? -1 : picked + 1) : (picked - 1 < -1 ? items.length - 1 : picked - 1); render(); }
  else if (e.key === 'Tab' && picked >= 0) { e.preventDefault(); input.value = items[picked]; picked = -1; render(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (rec) stopRecording(); else submit(); }
});
window.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); if (rec) { stopRecording(true); note(''); } else close(); } });
$('form').onsubmit = e => { e.preventDefault(); submit(); };
window.addEventListener('focus', () => input.focus());

// ---------- drop a letter ----------
let depth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); depth++; $('drop').hidden = false; });
window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); depth = 0; $('drop').hidden = true;
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const t = letterType(file);
  if (t.error) { note(t.error, { error: true }); return; }
  letter = { name: file.name, mime: t.mime, size: file.size, bytes: await file.arrayBuffer() };
  picked = -1; render(); note('Add a note if you like, then press Enter.'); input.focus();
});

// ---------- from the main process ----------
window.vali.onQuick(({ mode, context = {} }) => {
  if (mode === 'context') { if (!ctx.pageDismissed && !letter && context.page) { ctx.page = context.page; render(); } return; }
  if (mode === 'voice-toggle') { rec ? stopRecording() : startRecording(); return; }
  if (!rec && !busy) reset();
  if (context.page) ctx.page = context.page;
  if (context.selection) { ctx.selection = context.selection; ctx.via = context.via; }
  render();
  if (mode === 'ask' && context.needsAccess) note(context.selection ? 'Used your clipboard. To grab selected text directly, allow Vali in System Settings > Privacy & Security > Accessibility.' : 'Select some text first. Allow Vali in System Settings > Privacy & Security > Accessibility so it can copy the selection.');
  input.focus();
  if (mode === 'voice') startRecording({ hold: true });
});
window.__smokeListening = () => { rec = { hold: true, recorder: { state: 'inactive', stop() {} }, stream: { getTracks: () => [] } }; listening(true); $('level').firstChild.style.width = '45%'; rec = null; mic.classList.add('on'); $('level').hidden = false; input.placeholder = 'Listening… let go to send'; };
new ResizeObserver(() => window.vali.call('quickSize', $('box').offsetHeight + 20)).observe($('box'));
render();
