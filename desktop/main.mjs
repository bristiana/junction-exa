import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, Notification, shell, safeStorage, systemPreferences, session as electronSession, clipboard, powerMonitor, nativeTheme } from 'electron';
import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBaseUrl, toLocalTask, isActive } from './vendor/lib/backend.js';
import { makeApi } from './api.mjs';
import { frontTab, grabSelection } from './mac.mjs';
import { mascotState, notificationEvents, buildErrand, comingSoon, voiceOutcome, letterType, sealConfig, openConfig, badgeOf, MAX_VOICE_BYTES, talkError, redactSecrets } from './logic.mjs';
import { asleep, restoreSpot } from './valet.mjs';
import { createStage } from './stage.mjs';
import { makeMessageBridge } from './imessage/runtime.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_URL = 'https://bogdan-c-2206--vali-web.us-east.modal.run';
const smoke = process.argv.includes('--smoke');
// --talk-check starts one real voice conversation with Chromium's fake microphone (a tone), on a throwaway account.
const talkCheck = process.argv.includes('--talk-check');
if (talkCheck && !process.env.VALI_USER_DATA) { console.error('--talk-check needs VALI_USER_DATA (a throwaway folder).'); process.exit(1); }
if (talkCheck) for (const s of ['use-fake-device-for-media-stream', 'use-fake-ui-for-media-stream']) app.commandLine.appendSwitch(s);
// Smoke never touches the user's account or credentials. VALI_USER_DATA runs a separate, throwaway instance.
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), `vali-smoke-${process.pid}`));
else if (process.env.VALI_USER_DATA) app.setPath('userData', process.env.VALI_USER_DATA);
app.setName('Vali');
let config = { backendUrl: DEFAULT_URL, effort: 'low', profile: {} }, session = {}, tasks = [], paused = false, polling = false, quitting = false;
let mascot, chat, quick, glance, tray, pollTimer, configFile, lastTab = null, glanceTimer, stage, stageTimer;
const shortcuts = { quick: '', voice: '', ask: '', talk: '' };
// Talk to Vali runs in the mascot window; it reports '', 'connecting', 'listening' or 'speaking'.
let talking = '', facing = '', sleeping = false, lastBusyAt = Date.now();
let persistChain = Promise.resolve();
let imessage;
const imessageView = () => imessage?.view() || { enabled: false, status: 'off', mode: 'open', allowed: [], linked: [] };
// Saved settings that could not be decrypted stay untouched on disk until the user links an account on purpose.
const LOCKED = 'Could not unlock saved settings. Unlock your login keychain and restart Vali, or link again in Settings.';
let settingsLocked = false;
const windows = () => [mascot, chat, quick, glance].filter(w => w && !w.isDestroyed());
const state = () => ({ pose: mascotState(tasks, paused), paused, shortcut: shortcuts.quick, shortcuts, badge: badgeOf(tasks), talking,
  valet: { place: stage?.place || 'home', edge: stage?.edge || 'right', facing, sleeping } });
function publish() {
  const badge = badgeOf(tasks);
  stage?.setNeedsYou(badge.needsYou && !paused);
  for (const w of windows()) w.webContents.send('vali:state', state());
}
// Vali sleeps after five quiet minutes; anything running, waiting, talking or a hover wakes him.
function wakeCheck() {
  const badge = badgeOf(tasks), busy = badge.count > 0 || badge.needsYou || !!talking;
  if (busy) lastBusyAt = Date.now();
  const next = asleep({ busy, lastBusyAt });
  if (next !== sleeping) { sleeping = next; publish(); }
}
function wake() { lastBusyAt = Date.now(); wakeCheck(); }
function changes(values, old, area = 'local') {
  const diff = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(old[k])).map(([k, v]) => [k, { oldValue: old[k], newValue: v }]));
  if (Object.keys(diff).length) for (const w of windows()) w.webContents.send('vali:change', diff, area);
}
function setSession(values) { const before = { ...session }; Object.assign(session, values); changes(values, before, 'session'); }
// The token and the profile are encrypted with the login keychain (safeStorage); settings.json is mode 0600.
async function save() {
  if (settingsLocked) throw new Error(LOCKED);
  const needsKey = config.backendToken || Object.keys(config.profile || {}).length;
  if (needsKey && !safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable. Unlock your login keychain and retry.');
  const snapshot = sealConfig(config, s => safeStorage.encryptString(s).toString('base64'));
  // Atomic: a crash mid-write leaves the old file, never half a file.
  const temp = `${configFile}.${process.pid}.tmp`;
  persistChain = persistChain.catch(() => {}).then(() => writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 })).then(() => rename(temp, configFile));
  await persistChain;
}
async function setConfig(values) {
  const before = { ...config };
  config = { ...config, ...values };
  try { await save(); } catch (e) { config = before; throw e; }
  changes(values, before);
}
const apiFetch = (url, opts = {}) => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), ...opts });
const api = (baseUrl = config.backendUrl, token = config.backendToken) => makeApi({ baseUrl, token, fetchImpl: apiFetch });
// One connect at a time: every caller shares the same attempt, so two windows never create two accounts.
let connecting = null;
function connect() {
  if (smoke) return Promise.resolve();
  return (connecting ||= ensureAccount().finally(() => { connecting = null; }));
}
// A token the server rejects (401) stays saved until the new account exists.
async function ensureAccount() {
  const baseUrl = normalizeBaseUrl(config.backendUrl || DEFAULT_URL);
  if (config.backendToken && config.backendTokenUrl === baseUrl) {
    try { await api().me(); return; } catch (e) { if (e.status !== 401) throw e; }
  }
  if (settingsLocked) throw new Error(LOCKED);
  const user = await api(baseUrl, '').createUser();
  if (!user?.token) throw new Error('The server did not return a token.');
  await setConfig({ backendUrl: baseUrl, backendToken: user.token, backendTokenUrl: baseUrl, backendUserId: user.user_id, hiddenTasks: [] });
  setSession({ newAccount: true });
}
function notify(previous, next) {
  if (smoke || !Notification.isSupported()) return;
  for (const event of notificationEvents(previous, next)) {
    const titles = { approval: 'Vali needs your OK', question: 'Vali has a question', done: 'Vali finished your errand' };
    const n = new Notification({ title: titles[event], body: event === 'question' ? next.execution?.question?.text || String(next.execution?.question || next.output?.structured?.missing_info?.join(' ') || next.task) : next.task, silent: false });
    n.on('click', () => showGlance({ focus: true })); n.show();
  }
}
function updateTasks(next) {
  const old = tasks;
  tasks = next.sort((a, b) => b.createdAt - a.createdAt);
  changes({ tasks }, { tasks: old }); publish();
}
function addTask(remote) {
  const t = toLocalTask(remote); updateTasks([t, ...tasks.filter(x => x.id !== t.id)]); return t;
}
async function poll() {
  if (paused || polling || smoke || !config.backendToken || config.backendTokenUrl !== config.backendUrl) return;
  polling = true;
  try {
    const result = await api().listTasks(50);
    const remote = Array.isArray(result) ? result : result.tasks || [];
    const listed = new Set(remote.map(t => t.id));
    for (const t of tasks.filter(t => isActive(t) && !listed.has(t.remoteId))) {
      try { remote.push(await api().getTask(t.remoteId)); } catch (e) { if (e.status !== 404) throw e; }
    }
    const next = remote.filter(t => !(config.hiddenTasks || []).includes(t.id)).map(r => {
      const previous = tasks.find(t => t.remoteId === r.id);
      const t = toLocalTask(r, previous); notify(previous, t); return t;
    });
    updateTasks(next);
    changes({ connectionError: '' }, { connectionError: config.connectionError }); config.connectionError = '';
  } catch (e) {
    changes({ connectionError: e.message }, { connectionError: config.connectionError }); config.connectionError = e.message;
    throw e;
  } finally { polling = false; }
}
const fail = (e, soon) => ({ ok: false, error: comingSoon(e) && soon ? soon : e.message, status: e.status, comingSoon: comingSoon(e) && !!soon });
async function startErrand({ text, selection, page }) {
  const body = buildErrand({ text, selection, page });
  if (body.task.length > 12000) throw new Error('Keep the errand under 12,000 characters.');
  await connect();
  return addTask(await api().createTask({ task: body.task, page: body.page || undefined, effort: config.effort }));
}
// Approve, execute and stop go out once per errand, even when two windows (chat and list) press at the same time.
const ONCE = new Set(['approve', 'execute', 'stop']), inFlight = new Set();
async function handleMessage(m) {
  const key = ONCE.has(m?.type) ? `${m.taskId}:${m.type}` : '';
  if (key && inFlight.has(key)) return { ok: false, error: 'Vali is already on it. One moment.' };
  if (key) inFlight.add(key);
  try {
    if (m.type === 'poll') { await poll(); return { ok: true }; }
    if (m.type === 'start') {
      if (smoke) throw new Error('Smoke mode does not send errands.');
      // From the chat composer: "Use this page" means the browser tab that was in front (see the tabs shim).
      const page = m.context?.page || (m.usePage && m.tabId === 'front' ? lastTab : null);
      const selection = m.context?.selection || m.selection || '';
      if (m.parentId) {
        await connect();
        const text = String(m.task || '').trim();
        if (!text || text.length > 12000) throw new Error('Enter an errand of up to 12,000 characters.');
        return { ok: true, data: addTask(await api().createTask({ task: text, effort: config.effort, previous_task_id: m.parentId })) };
      }
      return { ok: true, data: await startErrand({ text: m.task, selection, page }) };
    }
    const t = tasks.find(t => t.id === m.taskId);
    if (!t) throw new Error('This errand is no longer available. Refresh the task list.');
    if (m.type === 'seen') { updateTasks(tasks.map(x => x.id === t.id ? { ...x, seen: true } : x)); return { ok: true }; }
    if (m.type === 'remove') {
      await setConfig({ hiddenTasks: [...(config.hiddenTasks || []), t.remoteId].slice(-200) });
      updateTasks(tasks.filter(x => x.id !== t.id)); return { ok: true };
    }
    if (smoke) throw new Error('Smoke mode does not change errands.');
    let remote;
    if (m.type === 'cancel') remote = await api().cancel(t.remoteId);
    else if (m.type === 'approve') remote = await api().approve(t.remoteId);
    else if (m.type === 'stop') remote = await api().stop(t.remoteId);
    // Same as the extension: the saved profile goes along only at execute time, to fill {{placeholders}}.
    else if (m.type === 'execute') remote = await api().execute(t.remoteId, { action_index: m.actionIndex ?? m.action_index, start_url: m.startUrl, goal: m.goal, profile: config.profile });
    else if (m.type === 'answer' || m.type === 'message') {
      const text = String(m.text || '').trim();
      if (!text) throw new Error('Enter an answer.');
      remote = await api().message(t.remoteId, text);
    } else throw new Error('This browser-only action is unavailable on desktop. Open the website in your browser.');
    const next = toLocalTask(remote, t); updateTasks(tasks.map(x => x.id === t.id ? next : x));
    return { ok: true, data: next };
  } catch (e) { return fail(e); }
  finally { if (key) inFlight.delete(key); }
}
// Microphone: macOS asks once per app; Chromium's own prompt is answered by the permission handler below.
async function micAccess() {
  // Chromium's fake audio device (used to test the recording path) needs no microphone permission.
  if (process.platform !== 'darwin' || app.commandLine.hasSwitch('use-fake-device-for-media-stream')) return { granted: true };
  let status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'not-determined') status = (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied';
  return { granted: status === 'granted', status };
}
async function voice({ bytes, mime, context }) {
  if (smoke) throw new Error('Smoke mode does not send audio.');
  if (!bytes?.byteLength) throw new Error('I did not hear anything. Try again.');
  if (bytes.byteLength > MAX_VOICE_BYTES) throw new Error('That recording is too long. Say the errand in a minute or less.');
  await connect();
  const withContext = !!(context?.selection || context?.page);
  const out = voiceOutcome(await api().voice(bytes, mime || 'audio/webm', { create: !withContext }));
  if (out.task) return { ok: true, text: out.text, task: addTask(out.task) };
  if (withContext && out.text.trim()) return { ok: true, text: out.text, task: await startErrand({ text: out.text, ...context }) };
  return { ok: true, text: out.text };
}
async function letter({ bytes, mime, name, note }) {
  if (smoke) throw new Error('Smoke mode does not send letters.');
  if (!bytes?.byteLength) throw new Error('That file is empty.');
  const type = letterType({ name, type: mime, size: bytes.byteLength });
  if (type.error) throw new Error(type.error);
  await connect();
  const json = await api().letter(bytes, type.mime, name || 'letter', note);
  const remote = json?.id ? json : json?.task && typeof json.task === 'object' ? json.task : null;
  if (!remote) throw new Error('The server did not start an errand for this letter.');
  return { ok: true, task: addTask(remote) };
}
const allowedKeys = new Set(['backendUrl', 'backendToken', 'backendTokenUrl', 'backendUserId', 'profile', 'effort']);
// Linking or pasting a token is the user choosing an account on purpose: that may replace locked settings.
async function useAccount(baseUrl, token) {
  const who = await api(baseUrl, token).me();
  settingsLocked = false;
  await setConfig({ backendUrl: baseUrl, backendTokenUrl: baseUrl, backendToken: token, backendUserId: who.user_id || who.id, hiddenTasks: [] });
  setSession({ newAccount: false });
  updateTasks([]); poll().catch(() => {});
}
async function talkSession() {
  if (smoke) return { ok: false, error: 'Smoke mode does not talk.' };
  try { await connect(); return { ok: true, data: await api().voiceSession() }; }
  catch (e) { return { ok: false, error: talkError(e) }; }
}
const TALK_MODES = new Set(['', 'connecting', 'listening', 'speaking']);
function toggleTalk() { if (mascot && !mascot.isDestroyed()) mascot.webContents.send('vali:talk', talking ? 'stop' : 'start'); }
ipcMain.handle('vali', async (event, op, arg) => {
  if (!windows().some(w => w.webContents.id === event.sender.id)) throw new Error('Unknown window.');
  if (op === 'state') return state();
  if (op === 'imessageStatus') return imessageView();
  if (op === 'imessageSettings') {
    if (smoke || talkCheck) throw new Error('iMessage is unavailable in check mode.');
    return imessage.configure(arg);
  }
  if (op === 'imessageUnlink') {
    if (smoke || talkCheck) throw new Error('iMessage is unavailable in check mode.');
    return imessage.unlink(arg);
  }
  if (op === 'imessageToggle') {
    if (smoke || talkCheck) throw new Error('iMessage is unavailable in check mode.');
    return arg ? imessage.enable() : imessage.disable();
  }
  if (op === 'imessagePermissions') {
    const pane = imessageView().status === 'needs_automation' ? 'Privacy_Automation' : 'Privacy_AllFiles';
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + pane); return;
  }
  if (op === 'talkSession') return event.sender === mascot.webContents ? talkSession() : { ok: false, error: 'Talk from the mascot.' };
  if (op === 'talk') { if (event.sender !== mascot.webContents) throw new Error('Talk from the mascot.');
    if (TALK_MODES.has(arg) && arg !== talking) { talking = arg; wake(); trayMenu(); publish(); } return; }
  if (op === 'talkToggle') { toggleTalk(); return; }
  if (op === 'chat') { openChat(arg); return; }
  if (op === 'hideQuick') { quick.hide(); return; }
  if (op === 'newErrand') { showQuick(); return; }
  if (op === 'quickSize') { const [w] = quick.getSize(); quick.setSize(w, Math.max(90, Math.min(620, Math.round(arg)))); return; }
  if (op === 'glance') { if (arg === 'hover' || arg === 'toggle') { wake(); stage?.hover(); }
    if (arg === 'hover') hoverGlance(true); else if (arg === 'leave') hoverGlance(false); else if (arg === 'toggle') toggleGlance(); else if (arg === 'hide') glance.hide(); return; }
  if (op === 'glanceSize') { const [w] = glance.getSize(); glance.setSize(w, Math.max(120, Math.min(screen.getDisplayMatching(mascot.getBounds()).workArea.height - 40, Math.round(arg)))); positionGlance(); return; }
  if (op === 'storage:get') {
    const data = arg.area === 'session' ? session : { ...config, tasks };
    const keys = arg.keys == null ? Object.keys(data) : typeof arg.keys === 'string' ? [arg.keys] : Array.isArray(arg.keys) ? arg.keys : Object.keys(arg.keys);
    return Object.fromEntries(keys.map(k => [k, data[k] ?? (typeof arg.keys === 'object' && !Array.isArray(arg.keys) ? arg.keys[k] : undefined)]));
  }
  if (op === 'storage:set') {
    if (arg.area === 'session') setSession(arg.values);
    else {
      const values = Object.fromEntries(Object.entries(arg.values).filter(([k]) => allowedKeys.has(k)));
      if ('backendUrl' in values) { values.backendUrl = normalizeBaseUrl(values.backendUrl); if (!values.backendUrl) throw new Error('A Vali server URL is required.'); }
      await setConfig(values);
    }
    return;
  }
  if (op === 'storage:remove') {
    const keys = Array.isArray(arg.keys) ? arg.keys : [arg.keys];
    if (arg.area === 'session') { const before = { ...session }; const delta = {}; for (const k of keys) { delete session[k]; delta[k] = undefined; } changes(delta, before, 'session'); }
    else if (keys.includes('backendUrl')) throw new Error('Desktop requires a Vali server URL.');
    return;
  }
  if (op === 'useToken') {
    if (smoke) throw new Error('Smoke mode does not change accounts.');
    await useAccount(normalizeBaseUrl(arg.url), String(arg.token || '').trim()); return;
  }
  if (op === 'linkCode') {
    if (smoke) return { ok: false, error: 'Smoke mode does not change accounts.' };
    try { await connect(); return { ok: true, data: await api().linkCode() }; }
    catch (e) { return fail(e, 'Linking with a code is coming soon. Until then, paste the account token under Advanced.'); }
  }
  if (op === 'link') {
    if (smoke) return { ok: false, error: 'Smoke mode does not change accounts.' };
    try {
      const code = String(arg?.code || '').replace(/\D/g, '');
      if (code.length < 4) throw new Error('Type the code shown in the Vali extension.');
      const baseUrl = normalizeBaseUrl(config.backendUrl || DEFAULT_URL);
      const out = await api(baseUrl, config.backendTokenUrl === baseUrl ? config.backendToken : '').link(code);
      if (!out?.token) throw new Error('That code did not work. Show a new code in the extension.');
      await useAccount(baseUrl, out.token); return { ok: true };
    } catch (e) {
      if (e.status === 404 && !comingSoon(e)) return { ok: false, error: 'That code did not work or has expired. Show a new code in the extension.' };
      return fail(e, 'Linking with a code is coming soon. Until then, paste the account token under Advanced.');
    }
  }
  if (op === 'mic') return micAccess();
  if (op === 'micSettings') { await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'); return; }
  if (op === 'voice') { try { return await voice(arg); } catch (e) { return fail(e, 'Talking to Vali is coming soon. Type your errand for now.'); } }
  if (op === 'letter') {
    try { const r = await letter(arg); quick.hide(); showGlance({ flash: true }); return r; }
    catch (e) { return fail(e, 'Reading letters is coming soon. For now, type what the letter says.'); }
  }
  if (op === 'started') { quick.hide(); showGlance({ flash: true }); return; }
  if (op === 'frontTab') { if (!smoke) lastTab = await frontTab(); return lastTab; }
  if (op === 'liveFrame') {
    if (smoke) return { base64: (await readFile(path.join(root, 'renderer/smoke-frame.svg'))).toString('base64'), mime: 'image/svg+xml' };
    if (paused || !tasks.some(t => t.remoteId === arg)) return null;
    const jpeg = await api().liveFrame(arg);
    return jpeg ? { base64: jpeg.toString('base64'), mime: 'image/jpeg' } : null;
  }
  if (op === 'message') return handleMessage(arg);
  if (op === 'external') { const u = new URL(arg); if (!['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol)) throw new Error('Unsupported link.'); await shell.openExternal(u.href); return; }
  if (op === 'request') {
    if (smoke) {
      if (/\/(live|\d+)\.jpg(?:\?|$)/.test(arg.url)) return { status: 200, base64: (await readFile(path.join(root, 'renderer/smoke-frame.svg'))).toString('base64'), mime: 'image/svg+xml' };
      return { status: 200, body: JSON.stringify({ whatsapp_linked: false }) };
    }
    const u = new URL(arg.url);
    const imagePath = u.pathname.match(/\/v1\/tasks\/([^/]+)\/(live\.jpg|shots\/\d+\.jpg)$/);
    if (imagePath) {
      if (paused) return { status: 404, body: '' };
      if (!u.href.startsWith(config.backendUrl + '/') || !tasks.some(t => t.remoteId === decodeURIComponent(imagePath[1]))) throw new Error('Unknown task image.');
      u.searchParams.set('t', config.backendToken);
      const response = await fetch(u.href, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      return { status: response.status, base64: Buffer.from(await response.arrayBuffer()).toString('base64'), mime: 'image/jpeg' };
    }
    const index = u.pathname.lastIndexOf('/v1/');
    const baseUrl = normalizeBaseUrl(u.origin + u.pathname.slice(0, index));
    if (index < 0 || !['/v1/users', '/v1/me', '/v1/pair', '/v1/profile'].includes(u.pathname.slice(index)) || !['GET', 'POST', 'PUT'].includes(arg.method)) throw new Error('Unsupported API request.');
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (u.pathname.slice(index) !== '/v1/users' && baseUrl === config.backendTokenUrl && config.backendToken) headers.Authorization = `Bearer ${config.backendToken}`;
    const res = await fetch(u.href, { method: arg.method, headers, body: arg.body, redirect: 'error', signal: AbortSignal.timeout(20000) });
    return { status: res.status, body: await res.text() };
  }
  throw new Error('Unsupported desktop action.');
});
function makeWindow(options, web = {}) {
  const w = new BrowserWindow({ show: false, ...options, webPreferences: { preload: path.join(root, 'bridge.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, ...web } });
  // Our renderers' errors and warnings go to stderr; third-party bundles (the ElevenLabs client) stay quiet, and
  // anything that looks like a token is redacted.
  w.webContents.on('console-message', e => { if ((e.level === 'error' || e.level === 'warning') && !/vendor\/elevenlabs\//.test(e.sourceId || '')) console.error('Renderer:', redactSecrets(e.message)); });
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?:|mailto:|tel:)/i.test(url)) shell.openExternal(url).catch(() => {}); return { action: 'deny' }; });
  w.webContents.on('will-navigate', e => e.preventDefault());
  return w;
}
function openChat(id) {
  if (!chat) return;
  if (id) setSession({ focusTask: id });
  glance?.hide();
  if (chat.isMinimized()) chat.restore(); chat.show(); chat.focus();
}
// The quick box sits like Spotlight: centered on the screen with the pointer, a fifth of the way down.
function positionQuick() {
  const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, [w] = quick.getSize();
  quick.setPosition(Math.round(a.x + (a.width - w) / 2), Math.round(a.y + a.height * 0.2));
}
function showQuick(mode = 'type', context = {}) {
  positionQuick(); quick.show(); quick.focus(); app.focus({ steal: true });
  quick.webContents.send('vali:quick', { mode, context });
}
// Read the browser tab only when a browser is in front; send it to the box when it arrives (never blocks opening).
function quickWithPage(mode) {
  const pending = smoke ? Promise.resolve(null) : frontTab().catch(() => null);
  showQuick(mode, {});
  pending.then(tab => { lastTab = tab; if (tab) quick.webContents.send('vali:quick', { mode: 'context', context: { page: tab } }); });
}
let asking = false;
async function askAboutThis() {
  if (asking) return;
  asking = true;
  try { await askNow(); } finally { asking = false; }
}
async function askNow() {
  // Copy before Vali takes focus: Cmd+C has to reach the app the user selected text in.
  const trusted = process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : false;
  const [grab, tab] = await Promise.all([grabSelection({ clipboard, trusted }).catch(() => ({ text: '', via: 'none' })), frontTab().catch(() => null)]);
  lastTab = tab;
  showQuick('ask', { selection: grab.text.slice(0, 2500), page: tab, via: grab.via, needsAccess: !trusted });
  if (!trusted && process.platform === 'darwin' && !session.askedAccessibility) { session.askedAccessibility = true; systemPreferences.isTrustedAccessibilityClient(true); }
}
// The glance list opens beside the mascot: on hover (without stealing focus), on click, and briefly after a new errand.
function positionGlance() {
  const b = mascot.getBounds(), a = screen.getDisplayMatching(b).workArea, [w, h] = glance.getSize();
  const x = b.x - w + 20 >= a.x ? b.x - w + 20 : Math.min(b.x + b.width - 20, a.x + a.width - w);
  glance.setPosition(Math.round(x), Math.round(Math.max(a.y, Math.min(b.y + b.height - h, a.y + a.height - h))));
}
function showGlance({ focus = false, flash = false } = {}) {
  clearTimeout(glanceTimer);
  positionGlance();
  if (focus) { glance.show(); glance.focus(); } else if (!glance.isVisible()) glance.showInactive();
  if (flash) glanceTimer = setTimeout(() => { if (!glance.isFocused()) glance.hide(); }, 5000);
}
function hoverGlance(inside) {
  clearTimeout(glanceTimer);
  if (inside) glanceTimer = setTimeout(() => showGlance(), glance.isVisible() ? 0 : 350);
  else glanceTimer = setTimeout(() => { if (!glance.isFocused()) glance.hide(); }, 700);
}
function toggleGlance() { if (glance.isVisible() && glance.isFocused()) glance.hide(); else showGlance({ focus: true }); }
function trayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open chat', click: () => openChat() },
    { label: 'New errand', accelerator: shortcuts.quick || undefined, click: () => quickWithPage('type') },
    { label: talking ? 'Stop talking' : 'Talk to Vali', accelerator: shortcuts.talk || undefined, click: toggleTalk },
    { label: 'Say an errand', accelerator: shortcuts.voice || undefined, click: () => quickWithPage('voice') },
    { label: paused ? 'Resume' : 'Pause', type: 'checkbox', checked: paused, click: () => { paused = !paused; publish(); trayMenu(); if (!paused) poll().catch(() => {}); } },
    { label: `iMessage: ${imessageView().enabled ? imessageView().status === 'running' ? 'On' : 'Needs permission' : 'Off'}`, type: 'checkbox', checked: imessageView().enabled, enabled: !!imessage,
      click: () => (imessageView().enabled ? imessage.disable() : imessage.enable()).catch(() => openChat()) },
    { type: 'separator' }, { label: 'Quit Vali', click: () => app.quit() }
  ]));
}
const waitFor = (w, test, label, ms = 8000) => w.webContents.executeJavaScript(`new Promise((resolve, reject) => { const deadline = Date.now() + ${ms}; const check = () => (${test}) ? resolve() : Date.now() > deadline ? reject(new Error(${JSON.stringify(label)} + ' ' + JSON.stringify({errors: window.__desktopErrors || [], text: document.body.innerText.slice(0, 600)}))) : setTimeout(check, 50); check(); })`);
// The mascot may have stopped drawing (asleep): let it draw once more before the capture.
const frame = w => w.webContents.executeJavaScript('new Promise(r => { window.ValiFrames?.resume(); requestAnimationFrame(() => requestAnimationFrame(r)); })');
async function capture(w, out, name) {
  await frame(w);
  const errors = await w.webContents.executeJavaScript('window.__desktopErrors || []');
  if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
  const image = await w.webContents.capturePage(); if (image.isEmpty()) throw new Error(`${name} capture is empty`);
  await writeFile(path.join(out, `${name}.png`), image.toPNG());
}
// The same window in the light theme too (the OS theme otherwise decides), saved as <name>-light.png.
async function captureLight(w, out, name) {
  nativeTheme.themeSource = 'light'; await new Promise(r => setTimeout(r, 300));
  try { await capture(w, out, `${name}-light`); } finally { nativeTheme.themeSource = 'system'; await new Promise(r => setTimeout(r, 300)); }
}
async function runSmoke() {
  const out = process.env.SMOKE_OUT;
  if (!out) throw new Error('--smoke requires SMOKE_OUT.');
  await mkdir(out, { recursive: true });
  openChat('smoke-approval');
  await waitFor(chat, `document.querySelector('.exec-approval')`, 'Approval view missing');
  // The panel marks a loaded frame with .live.has-frame (older) or a .v-live without data-empty (current).
  await waitFor(chat, `(() => { const img = document.querySelector('.live.has-frame img, .v-live:not([data-empty]) img'); return img?.complete && img.naturalWidth > 0; })()`, 'Smoke browser frame did not decode');
  const controls = await chat.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#list button, #detail button, .exec button')).map(b => b.textContent.trim())`);
  if (!controls.includes('Stop') || !controls.some(t => t.startsWith('Approve'))) throw new Error('Approval controls are missing.');
  await waitFor(mascot, `document.getElementById('line').textContent === 'I need your OK on an errand.'`, 'Approval bubble missing');
  await capture(mascot, out, 'mascot');
  await capture(chat, out, 'chat');
  // The compact list beside the mascot, with inline Approve / Stop and the live frame.
  showGlance({ focus: true });
  await waitFor(glance, `document.querySelector('.item.you button.approve') && document.querySelector('.live img')?.naturalWidth > 0`, 'Glance list missing');
  await capture(glance, out, 'glance');
  // Exercise the question renderer as well as the approval view, without network writes.
  updateTasks(tasks.map(t => t.id === 'smoke-approval' ? { ...t, execution: { ...t.execution, status: 'running', question: { text: 'Which time works for you?', at: 'smoke-question' } } } : t));
  openChat('smoke-approval');
  await waitFor(chat, `document.querySelector('.answer-box')`, 'Question answer box missing');
  await chat.webContents.executeJavaScript(`document.querySelector('.exec-question').scrollIntoView({block:'center'})`);
  await capture(chat, out, 'chat-question');
  showGlance({ focus: true });
  await waitFor(glance, `document.querySelector('.item.you .answer input')`, 'Glance answer box missing');
  await waitFor(mascot, `document.getElementById('line').textContent === 'I have a question about an errand.'`, 'Question bubble missing');
  await capture(glance, out, 'glance-question');
  // Every kind of errand at once: waiting for your OK, needs your answer, running with the live view, needs login, done.
  const before = tasks;
  updateTasks(smokeAll());
  showGlance({ focus: true });
  await waitFor(glance, `document.querySelectorAll('.item').length >= 6 && document.querySelector('.live img')?.naturalWidth > 0`, 'Glance with every state missing');
  await capture(glance, out, 'glance-all'); await captureLight(glance, out, 'glance-all');
  updateTasks(before);
  openChat();
  await captureLight(chat, out, 'chat');
  // Settings: link with the extension, profile with the personal ID, advanced server settings folded away.
  await chat.webContents.executeJavaScript(`document.getElementById('settingsBtn').click()`);
  await waitFor(chat, `document.querySelector('.desktop-link') && document.querySelector('[data-k="personal_id"]')`, 'Settings link/profile missing');
  await chat.webContents.executeJavaScript(`window.scrollTo(0, 0)`);
  await capture(chat, out, 'settings');
  await chat.webContents.executeJavaScript(`document.querySelector('.desktop-link').scrollIntoView({block:'start'})`);
  await capture(chat, out, 'settings-profile');
  await chat.webContents.executeJavaScript(`document.querySelector('.desktop-imessage').scrollIntoView({block:'start'})`);
  await waitFor(chat, `document.querySelector('.desktop-imessage-policy')?.disabled && document.querySelector('[aria-label="iMessage sender policy"]').matches(':disabled') && document.querySelector('[aria-label="Allowed iMessage senders"]').matches(':disabled')`, 'Off iMessage policy is not disabled');
  await capture(chat, out, 'settings-imessage');
  // The quick box: empty, then typing with a suggestion picked by arrow key, then a dropped letter.
  showQuick('type', {});
  await waitFor(quick, `document.querySelectorAll('.suggestion').length > 0 && !document.querySelector('.chip')`, 'Empty quick box missing');
  await capture(quick, out, 'quick-empty');
  await quick.webContents.executeJavaScript(`(() => { const i = document.getElementById('errand'); i.value = 'sauna'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); })()`);
  await waitFor(quick, `document.querySelector('.suggestion[aria-selected=true]')`, 'Arrow key did not pick a suggestion');
  await capture(quick, out, 'quick-pick'); await captureLight(quick, out, 'quick-pick');
  await quick.webContents.executeJavaScript(`(() => { const d = new DataTransfer(); d.items.add(new File([new Uint8Array(2000)], 'kela-letter.pdf', { type: 'application/pdf' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: d, cancelable: true })); })()`);
  await waitFor(quick, `document.querySelector('.chip')?.textContent.includes('kela-letter.pdf')`, 'Letter chip missing');
  await capture(quick, out, 'quick-letter');
  // The quick box with page and selection context and suggestions, then the listening state.
  showQuick('ask', { selection: 'Eräpäivä 30.11. Maksa 45 € viitteellä 12345.', page: { url: 'https://www.kela.fi/opiskelijat', title: 'Kela: students', app: 'Safari' }, via: 'selection' });
  await waitFor(quick, `document.querySelectorAll('.chip').length >= 2 && document.querySelectorAll('.suggestion').length > 0`, 'Quick box context missing');
  await capture(quick, out, 'quick');
  await quick.webContents.executeJavaScript(`window.__smokeListening()`);
  await capture(quick, out, 'quick-listening');
  quick.hide(); glance.hide();
  await smokeValet(out);
  console.log(`Smoke captures in ${out}: ${(await readdir(out)).filter(f => f.endsWith('.png')).sort().join(', ')}`);
  app.quit();
}
// The mascot's reactions, the talking state and the walk to the edge (window positions are checked, not captured).
async function smokeValet(out) {
  const mascotHas = (test, label) => waitFor(mascot, test, label);
  const pose = () => new Promise(r => setTimeout(r, 1200)); // let the butler settle into the new pose
  await mascotHas(`!document.getElementById('bell').hasAttribute('hidden') && document.getElementById('line').textContent === 'I have a question about an errand.'`, 'Bell for question missing');
  const fixture = tasks;
  for (const kind of ['login', 'captcha', 'payment']) {
    updateTasks([{ ...fixture[0], seen: false, execution: { status: 'failed', result: `needs ${kind}: finish by hand at https://example.com` } }]);
    await mascotHas(`document.getElementById('line').textContent === 'I need you to finish a step.'`, `${kind} hand-off bubble missing`);
  }
  updateTasks(fixture);
  await mascot.webContents.executeJavaScript(`window.__smokeTalk('speaking', 'Hei! I found two saunas open on Saturday. Shall I book the one in Kallio?')`);
  await mascotHas(`document.getElementById('wrap').classList.contains('speaking') && document.getElementById('talk').textContent.includes('Stop')`, 'Talking state missing');
  await pose(); await capture(mascot, out, 'mascot-talk');
  await captureLight(mascot, out, 'mascot-talk');
  await mascot.webContents.executeJavaScript(`window.__smokeTalk('')`);
  updateTasks(fixture.filter(t => t.id === 'smoke-research'));
  await mascotHas(`document.getElementById('line').textContent.includes('on it')`, 'mascot-working line missing');
  await pose(); await capture(mascot, out, 'mascot-working'); await captureLight(mascot, out, 'mascot-working');
  for (const [name, keep, words] of [['mascot-done', 'smoke-done', 'All done'], ['mascot-error', 'smoke-done', 'couldn']]) {
    updateTasks(fixture.filter(t => t.id === keep).map(t => name === 'mascot-error' ? { ...t, status: 'failed' } : t));
    await mascotHas(`document.getElementById('line').textContent.includes(${JSON.stringify(words)})`, `${name} line missing`);
    await pose(); await capture(mascot, out, name);
  }
  lastBusyAt = 0; wakeCheck();
  await mascotHas(`!document.getElementById('zzz').hidden && document.getElementById('wrap').classList.contains('sleep')`, 'Sleep missing');
  await pose(); await mascotHas('window.ValiFrames.paused', 'Mascot still draws every frame while asleep');
  await capture(mascot, out, 'mascot-sleep');
  // Walk: home -> tucked (64 pt left on screen) -> peek (120 pt) -> home, all on the edge nearest to home.
  const home = mascot.getBounds(), area = screen.getDisplayMatching(home).workArea, settle = () => new Promise(r => setTimeout(r, 600));
  for (const [place, show] of [['tucked', 64], ['peek', 120]]) {
    stage.go(place); await settle();
    const b = mascot.getBounds(), visible = Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x);
    if (stage.edge !== 'bottom' && visible !== show) throw new Error(`${place}: ${visible} pt visible at the ${stage.edge} edge, expected ${show}`);
    console.log(`Valet ${place}: ${stage.edge} edge, x ${b.x}, ${visible} pt visible`);
  }
  stage.go('home'); await settle();
  const back = mascot.getBounds();
  if (back.x !== home.x || back.y !== home.y) throw new Error(`Valet did not come home: ${JSON.stringify(back)} vs ${JSON.stringify(home)}`);
  console.log(`Valet home again at ${back.x},${back.y}`);
}
// One real conversation on a throwaway account (VALI_USER_DATA), with Chromium's fake microphone: proves the session
// starts and the agent answers. It cannot prove speech recognition or what the user hears.
async function runTalkCheck() {
  await connect();
  console.log('Account ready; starting the conversation.');
  mascot.webContents.send('vali:talk', 'start');
  const log = () => mascot.webContents.executeJavaScript('window.__talk');
  const until = async (test, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const l = await log(); if (test(l)) return l; await new Promise(r => setTimeout(r, 300)); } return log(); };
  const l = await until(l => l.captions.length || l.errors.length && !talking, 40000);
  console.log('Modes:', l.modes.join(' > ') || '(none)');
  console.log('Agent said:', l.captions.join(' | ') || '(nothing)');
  if (l.errors.length) console.log('Errors:', l.errors.join(' | '));
  if (process.env.SMOKE_OUT) { await mkdir(process.env.SMOKE_OUT, { recursive: true }); await capture(mascot, process.env.SMOKE_OUT, 'talk-live').catch(e => console.error(e.message)); }
  mascot.webContents.send('vali:talk', 'stop');
  await until(() => !talking, 5000);
  const ok = l.captions.length > 0 && (l.modes.includes('listening') || l.modes.includes('speaking'));
  console.log(ok ? 'PASS talk session connected and the agent spoke' : 'FAIL talk session');
  app.exit(ok ? 0 : 1);
}
function smokeTasks() {
  const now = Date.now();
  return [{ id: 'smoke-approval', remoteId: 'smoke-approval', task: 'Book a public sauna in Helsinki for Saturday', createdAt: now - 45000, status: 'completed', backend: true, seen: true,
    output: { structured: { answer: 'I found an evening sauna booking. Please check the details before I confirm it.', key_facts: [{ label: 'When', value: 'Saturday at 18:00' }, { label: 'Group', value: '8 people' }] } },
    execution: { status: 'awaiting_approval', approval: { summary: 'Confirm the sauna booking for 8 people at 18:00.', url: 'https://example.com/booking' }, steps: [{ text: 'Selected your requested time and group size.' }] } },
  { id: 'smoke-research', remoteId: 'smoke-research', task: 'Which Kela benefits can I get as a student?', createdAt: now - 20000, status: 'running', backend: true, progress: [{ kind: 'search', text: 'Kela student financial aid' }] },
  { id: 'smoke-done', remoteId: 'smoke-done', task: 'Find a pharmacy open now near Kamppi', createdAt: now - 3600000, completedAt: now - 3500000, status: 'completed', backend: true, seen: true, output: { structured: { status: 'info_only', answer: 'Yliopiston Apteekki Kamppi is open until 22:00.' } } }];
}
// Every state the glance list can show, for one capture.
function smokeAll() {
  const now = Date.now(), [approval, research, done] = smokeTasks();
  return [approval, research, done,
    { id: 'smoke-ask', remoteId: 'smoke-ask', task: 'Report a pothole at Mannerheimintie 5 to the city', createdAt: now - 30000, status: 'completed', backend: true, seen: true,
      execution: { status: 'running', question: { text: 'Should the city reply by email or by phone?', at: 'smoke-ask-q' }, steps: [{ text: 'Filled in the location.' }] } },
    { id: 'smoke-live', remoteId: 'smoke-live', task: 'Buy 2 adult tickets for Allas Sea Pool on Sunday', createdAt: now - 10000, status: 'completed', backend: true, seen: true,
      execution: { status: 'running', steps: [{ text: 'Choosing 2 adult tickets for Sunday afternoon' }] } },
    { id: 'smoke-login', remoteId: 'smoke-login', task: 'Apply for Kela housing benefit', createdAt: now - 600000, status: 'completed', backend: true,
      execution: { status: 'failed', result: 'needs login: finish by hand at https://www.kela.fi/asiointi', current_url: 'https://www.kela.fi/asiointi' } }];
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => openChat());
  app.whenReady().then(async () => {
    configFile = path.join(app.getPath('userData'), 'settings.json');
    await mkdir(app.getPath('userData'), { recursive: true });
    try { config = { ...config, ...openConfig(JSON.parse(await readFile(configFile, 'utf8')), s => safeStorage.decryptString(Buffer.from(s, 'base64'))) }; }
    catch (e) { if (e.code !== 'ENOENT') { settingsLocked = true; config.connectionError = LOCKED; } }
    if (smoke) { config.backendToken = 'smoke-fixture'; config.backendTokenUrl = config.backendUrl; tasks = smokeTasks(); }
    // Only the quick box (dictation) and the mascot (Talk to Vali) may use the microphone, and only for audio.
    // Copy buttons may write the clipboard.
    const mayListen = wc => !!wc && (wc === quick?.webContents || wc === mascot?.webContents);
    electronSession.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) =>
      callback(permission === 'media' ? mayListen(wc) && (details.mediaTypes || []).every(t => t === 'audio') : permission === 'clipboard-sanitized-write'));
    electronSession.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media' ? mayListen(wc) : true);
    const area = screen.getPrimaryDisplay().workArea;
    // Vali stands where the user last put him (if that display is still there), else bottom right.
    const size = { width: 210, height: 300 };
    const spot = restoreSpot(config.mascotSpot, screen.getAllDisplays().map(d => d.workArea), size) || { x: area.x + area.width - 230, y: area.y + area.height - 320 };
    // Talk to Vali may start from a shortcut, without a click in this window: audio must play without a gesture.
    mascot = makeWindow({ ...size, ...spot, transparent: true, frame: false, resizable: false, alwaysOnTop: true, hasShadow: false, skipTaskbar: true, acceptFirstMouse: true }, { autoplayPolicy: 'no-user-gesture-required' });
    mascot.setAlwaysOnTop(true, 'floating'); mascot.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    stage = createStage({ win: mascot, screen, powerMonitor,
      reducedMotion: () => !!systemPreferences.getAnimationSettings?.().prefersReducedMotion,
      onHome: mascotSpot => { if (!smoke) setConfig({ mascotSpot }).catch(() => {}); },
      onChange: v => { facing = v.facing; publish(); if (!v.facing && glance?.isVisible()) positionGlance(); } });
    chat = makeWindow({ width: 640, height: Math.min(850, area.height - 60), minWidth: 420, minHeight: 450, title: 'Vali', backgroundColor: '#f7f7fb' });
    chat.on('close', e => { if (!quitting) { e.preventDefault(); chat.hide(); } });
    quick = makeWindow({ width: 640, height: 360, frame: false, resizable: false, transparent: true, hasShadow: false, alwaysOnTop: true, skipTaskbar: true });
    quick.setAlwaysOnTop(true, 'floating'); quick.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    glance = makeWindow({ width: 380, height: 420, frame: false, resizable: false, transparent: true, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, acceptFirstMouse: true });
    glance.setAlwaysOnTop(true, 'floating'); glance.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    glance.on('blur', () => { if (!smoke) glance.hide(); });
    mascot.on('moved', () => { if (glance.isVisible()) positionGlance(); });
    const pixels = Buffer.alloc(18 * 18 * 4);
    for (let y = 3; y < 15; y++) for (let x = 2; x < 16; x++) {
      if (Math.abs(x - (3 + (y - 3) / 2)) < 1.5 || Math.abs(x - (14 - (y - 3) / 2)) < 1.5) pixels[(y * 18 + x) * 4 + 3] = 255;
    }
    const trayImage = nativeImage.createFromBitmap(pixels, { width: 18, height: 18 });
    trayImage.setTemplateImage(true);
    if (trayImage.isEmpty()) throw new Error('Tray icon could not be created.');
    tray = new Tray(trayImage.resize({ width: 18, height: 18 })); tray.setToolTip('Vali'); tray.on('click', () => openChat());
    if (!smoke && !talkCheck) {
      for (const key of ['Alt+Space', 'Alt+V']) if (globalShortcut.register(key, () => quickWithPage('type'))) { shortcuts.quick = key; break; }
      // Hold to talk: the box records while the keys are held and sends when they come up (or on a second press).
      // Key repeat while held must not toggle: presses closer than 0.5 s apart count as one.
      let lastVoice = 0;
      const onVoice = () => {
        const repeat = Date.now() - lastVoice < 500; lastVoice = Date.now();
        if (repeat) return;
        if (quick.isVisible() && quick.isFocused()) quick.webContents.send('vali:quick', { mode: 'voice-toggle' }); else quickWithPage('voice');
      };
      if (globalShortcut.register('Alt+Shift+Space', onVoice)) shortcuts.voice = 'Alt+Shift+Space';
      if (globalShortcut.register('Alt+Shift+A', () => askAboutThis())) shortcuts.ask = 'Alt+Shift+A';
      let lastTalk = 0;
      const onTalk = () => { if (Date.now() - lastTalk > 500) toggleTalk(); lastTalk = Date.now(); };
      if (globalShortcut.register('Alt+Shift+V', onTalk)) shortcuts.talk = 'Alt+Shift+V';
    }
    if (!smoke && !talkCheck) imessage = makeMessageBridge({ getConfig: () => config, save, safeStorage, fetchImpl: apiFetch,
      onStatus: value => { for (const w of windows()) w.webContents.send('vali:imessage', value); trayMenu(); } });
    trayMenu();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Vali', submenu: [{ label: 'Open chat', click: () => openChat() }, { role: 'quit' }] }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    await Promise.all([mascot.loadFile(path.join(root, 'renderer/mascot.html'), smoke || talkCheck ? { query: { check: '1' } } : {}), chat.loadFile(path.join(root, 'vendor/panel/panel.html')), quick.loadFile(path.join(root, 'renderer/quick.html')), glance.loadFile(path.join(root, 'renderer/glance.html'))]);
    mascot.showInactive(); publish();
    if (smoke) { setTimeout(() => { console.error('Smoke timed out.'); app.exit(1); }, 60000).unref(); await runSmoke(); }
    else if (talkCheck) { setTimeout(() => { console.error('Talk check timed out.'); app.exit(1); }, 90000).unref(); await runTalkCheck(); }
    else {
      stageTimer = setInterval(() => { stage.tick({ hold: !!talking || glance.isVisible() || windows().some(w => w.isFocused()) }); wakeCheck(); }, 400);
      openChat();
      connect().then(async () => { if (config.imessage?.enabled) await imessage.enable(); await poll(); }).catch(e => { config.connectionError = e.message; changes({ connectionError: e.message }, {}); });
      pollTimer = setInterval(() => poll().catch(() => {}), 4000);
    }
  }).catch(e => { console.error(e.message); app.exit(1); });
}
app.on('activate', () => openChat());
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; imessage?.dispose(); clearInterval(pollTimer); clearInterval(stageTimer); globalShortcut.unregisterAll(); });
