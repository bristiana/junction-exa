import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, Notification, shell, safeStorage } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, normalizeBaseUrl, toLocalTask, isActive } from './vendor/lib/backend.js';
import { mascotState, notificationEvents } from './logic.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_URL = 'https://bogdan-c-2206--vali-web.us-east.modal.run';
const smoke = process.argv.includes('--smoke');
// Smoke never touches the user's account or credentials.
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), `vali-smoke-${process.pid}`));
app.setName('Vali');
let config = { backendUrl: DEFAULT_URL, effort: 'low', profile: {} }, session = {}, tasks = [], paused = false, polling = false, quitting = false;
let mascot, chat, quick, tray, shortcut = '', pollTimer, configFile;
let persistChain = Promise.resolve();
const windows = () => [mascot, chat, quick].filter(w => w && !w.isDestroyed());
const state = () => ({ pose: mascotState(tasks, paused), paused, shortcut });
function publish() { for (const w of windows()) w.webContents.send('vali:state', state()); }
function changes(values, old, area = 'local') {
  const diff = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(old[k])).map(([k, v]) => [k, { oldValue: old[k], newValue: v }]));
  if (Object.keys(diff).length) for (const w of windows()) w.webContents.send('vali:change', diff, area);
}
async function save() {
  const snapshot = { ...config };
  if (snapshot.backendToken) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure token storage is unavailable. Unlock your login keychain and retry.');
    snapshot.encryptedToken = safeStorage.encryptString(snapshot.backendToken).toString('base64');
  }
  delete snapshot.backendToken;
  persistChain = persistChain.catch(() => {}).then(() => writeFile(configFile, JSON.stringify(snapshot), { mode: 0o600 }));
  await persistChain;
}
async function setConfig(values) {
  const before = { ...config };
  config = { ...config, ...values };
  try { await save(); } catch (e) { config = before; throw e; }
  changes(values, before);
}
const apiFetch = (url, opts) => fetch(url, { ...opts, redirect: 'error', signal: AbortSignal.timeout(20000) });
const client = () => createClient({ baseUrl: config.backendUrl, token: config.backendToken, fetchImpl: apiFetch });
async function connect(retry = true) {
  if (smoke) return;
  const baseUrl = normalizeBaseUrl(config.backendUrl || DEFAULT_URL);
  if (!config.backendToken || config.backendTokenUrl !== baseUrl) {
    const user = await createClient({ baseUrl, fetchImpl: apiFetch }).createUser();
    if (!user?.token) throw new Error('The server did not return a token.');
    await setConfig({ backendUrl: baseUrl, backendToken: user.token, backendTokenUrl: baseUrl, backendUserId: user.user_id });
  }
  try { await client().me(); } catch (e) {
    if (e.status !== 401 || !retry) throw e;
    await setConfig({ backendToken: '' });
    await connect(false);
  }
}
function notify(previous, next) {
  if (smoke || !Notification.isSupported()) return;
  for (const event of notificationEvents(previous, next)) {
    const titles = { approval: 'Vali needs your approval', question: 'Vali has a question', done: 'Vali finished your errand' };
    const n = new Notification({ title: titles[event], body: event === 'question' ? next.execution?.question?.text || String(next.execution?.question || next.output?.structured?.missing_info?.join(' ') || next.task) : next.task, silent: false });
    n.on('click', () => openChat(next.id)); n.show();
  }
}
function updateTasks(next) {
  const old = tasks;
  tasks = next.sort((a, b) => b.createdAt - a.createdAt);
  changes({ tasks }, { tasks: old }); publish();
}
async function poll() {
  if (paused || polling || smoke || !config.backendToken || config.backendTokenUrl !== config.backendUrl) return;
  polling = true;
  try {
    const result = await client().listTasks(50);
    const remote = Array.isArray(result) ? result : result.tasks || [];
    const listed = new Set(remote.map(t => t.id));
    for (const t of tasks.filter(t => isActive(t) && !listed.has(t.remoteId))) {
      try { remote.push(await client().getTask(t.remoteId)); } catch (e) { if (e.status !== 404) throw e; }
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
async function handleMessage(m) {
  try {
    if (m.type === 'poll') { await poll(); return { ok: true }; }
    if (m.type === 'start') {
      if (smoke) throw new Error('Smoke mode does not send errands.');
      const text = String(m.task || '').trim();
      if (!text || text.length > 12000) throw new Error('Enter an errand of up to 12,000 characters.');
      await connect();
      const remote = await client().createTask({ task: text, effort: config.effort, previous_task_id: m.parentId });
      const t = toLocalTask(remote); updateTasks([t, ...tasks.filter(x => x.id !== t.id)]);
      return { ok: true, data: t };
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
    if (m.type === 'cancel') remote = await client().cancel(t.remoteId);
    else if (m.type === 'approve') remote = await client().approve(t.remoteId);
    else if (m.type === 'stop') remote = await client().stop(t.remoteId);
    else if (m.type === 'execute') remote = await client().execute(t.remoteId, { action_index: m.actionIndex ?? m.action_index, start_url: m.startUrl, goal: m.goal, profile: config.profile });
    else if (m.type === 'answer' || m.type === 'message') {
      const text = String(m.text || '').trim();
      if (!text) throw new Error('Enter an answer.');
      const res = await fetch(`${config.backendUrl}/v1/tasks/${encodeURIComponent(t.remoteId)}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${config.backendToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20000) });
      remote = await res.json(); if (!res.ok) throw new Error(remote.detail || 'Could not send your answer.');
    } else throw new Error('This browser-only action is unavailable on desktop. Open the website in your browser.');
    const next = toLocalTask(remote, t); updateTasks(tasks.map(x => x.id === t.id ? next : x));
    return { ok: true, data: next };
  } catch (e) { return { ok: false, error: e.message, status: e.status }; }
}
const allowedKeys = new Set(['backendUrl', 'backendToken', 'backendTokenUrl', 'backendUserId', 'profile', 'effort', 'presence', 'exaKey']);
ipcMain.handle('vali', async (event, op, arg) => {
  if (!windows().some(w => w.webContents.id === event.sender.id)) throw new Error('Unknown window.');
  if (op === 'state') return state();
  if (op === 'chat') { openChat(); return; }
  if (op === 'hideQuick') { quick.hide(); return; }
  if (op === 'storage:get') {
    const data = arg.area === 'session' ? session : { ...config, tasks };
    const keys = arg.keys == null ? Object.keys(data) : typeof arg.keys === 'string' ? [arg.keys] : Array.isArray(arg.keys) ? arg.keys : Object.keys(arg.keys);
    return Object.fromEntries(keys.map(k => [k, data[k] ?? (typeof arg.keys === 'object' && !Array.isArray(arg.keys) ? arg.keys[k] : undefined)]));
  }
  if (op === 'storage:set') {
    if (arg.area === 'session') { const before = { ...session }; Object.assign(session, arg.values); changes(arg.values, before, 'session'); }
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
    const baseUrl = normalizeBaseUrl(arg.url), token = String(arg.token || '').trim();
    const who = await createClient({ baseUrl, token, fetchImpl: apiFetch }).me();
    await setConfig({ backendUrl: baseUrl, backendTokenUrl: baseUrl, backendToken: token, backendUserId: who.user_id || who.id, hiddenTasks: [] });
    updateTasks([]); return;
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
function makeWindow(options) {
  const w = new BrowserWindow({ show: false, ...options, webPreferences: { preload: path.join(root, 'bridge.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  w.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.error('Renderer:', e.message); });
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?:|mailto:|tel:)/i.test(url)) shell.openExternal(url).catch(() => {}); return { action: 'deny' }; });
  w.webContents.on('will-navigate', e => e.preventDefault());
  return w;
}
function openChat(id) {
  if (!chat) return;
  if (id) { const before = { ...session }; session.focusTask = id; changes({ focusTask: id }, before, 'session'); }
  if (chat.isMinimized()) chat.restore(); chat.show(); chat.focus();
}
function positionQuick() {
  const b = mascot.getBounds(), a = screen.getDisplayMatching(b).workArea;
  quick.setPosition(Math.max(a.x, Math.min(b.x - 420, a.x + a.width - 420)), Math.max(a.y, Math.min(b.y + 20, a.y + a.height - 190)));
}
function showQuick() { positionQuick(); quick.show(); quick.focus(); }
function trayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open chat', click: () => openChat() },
    { label: 'New errand', accelerator: shortcut || undefined, click: showQuick },
    { label: paused ? 'Resume' : 'Pause', type: 'checkbox', checked: paused, click: () => { paused = !paused; publish(); trayMenu(); if (!paused) poll().catch(() => {}); } },
    { type: 'separator' }, { label: 'Quit Vali', click: () => app.quit() }
  ]));
}
async function runSmoke() {
  const out = process.env.SMOKE_OUT;
  if (!out) throw new Error('--smoke requires SMOKE_OUT.');
  await mkdir(out, { recursive: true });
  openChat('smoke-approval');
  await chat.webContents.executeJavaScript(`new Promise((resolve, reject) => { const deadline = Date.now() + 8000; const check = () => document.querySelector('.exec-approval') ? resolve() : Date.now() > deadline ? reject(new Error(JSON.stringify({errors:window.__desktopErrors, text:document.body.innerText.slice(0,2000)}))) : setTimeout(check, 50); check(); })`);
  await chat.webContents.executeJavaScript(`new Promise((resolve, reject) => { const deadline = Date.now() + 8000; const check = () => { const img = document.querySelector('.live.has-frame img'); if (img?.complete && img.naturalWidth > 0) resolve(); else if (Date.now() > deadline) reject(new Error('Smoke browser frame did not decode')); else setTimeout(check, 50); }; check(); })`);
  const controls = await chat.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.exec button')).map(b => b.textContent)`);
  if (!controls.includes('Stop') || !controls.some(t => t.startsWith('Approve'))) throw new Error('Approval controls are missing.');
  for (const [name, w] of [['mascot', mascot], ['chat', chat]]) {
    const errors = await w.webContents.executeJavaScript('window.__desktopErrors || []');
    if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
    const image = await w.webContents.capturePage(); if (image.isEmpty()) throw new Error(`${name} capture is empty`);
    await writeFile(path.join(out, `${name}.png`), image.toPNG());
  }
  // Exercise the question renderer as well as the approval view, without network writes.
  updateTasks(tasks.map(t => ({ ...t, execution: { ...t.execution, status: 'running', question: { text: 'Which time works for you?', at: 'smoke-question' } } })));
  await chat.webContents.executeJavaScript(`new Promise((resolve, reject) => { const deadline = Date.now() + 5000; const check = () => document.querySelector('.answer-box') ? resolve() : Date.now() > deadline ? reject(new Error('Question answer box missing')) : setTimeout(check, 50); check(); })`);
  await chat.webContents.executeJavaScript(`document.querySelector('.exec-question').scrollIntoView({block:'center'}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await writeFile(path.join(out, 'chat-question.png'), (await chat.webContents.capturePage()).toPNG());
  showQuick();
  await writeFile(path.join(out, 'quick.png'), (await quick.webContents.capturePage()).toPNG());
  console.log(`Smoke captures: ${out}/mascot.png and ${out}/chat.png (also chat-question.png and quick.png)`);
  app.quit();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => openChat());
  app.whenReady().then(async () => {
    configFile = path.join(app.getPath('userData'), 'settings.json');
    await mkdir(app.getPath('userData'), { recursive: true });
    try { const saved = JSON.parse(await readFile(configFile, 'utf8')); const encrypted = saved.encryptedToken; delete saved.encryptedToken; config = { ...config, ...saved }; if (encrypted) config.backendToken = safeStorage.decryptString(Buffer.from(encrypted, 'base64')); }
    catch (e) { if (e.code !== 'ENOENT') config.connectionError = 'Could not unlock saved settings. Connect again in Settings.'; }
    if (smoke) {
      config.backendToken = 'smoke-fixture'; config.backendTokenUrl = config.backendUrl;
      tasks = [{ id: 'smoke-approval', remoteId: 'smoke-approval', task: 'Book a public sauna in Helsinki for Saturday', createdAt: Date.now() - 45000, status: 'completed', backend: true, seen: true,
        output: { structured: { answer: 'I found an evening sauna booking. Please check the details before I confirm it.', key_facts: [{ label: 'When', value: 'Saturday at 18:00' }, { label: 'Group', value: '8 people' }] } },
        execution: { status: 'awaiting_approval', approval: { summary: 'Confirm the sauna booking for 8 people at 18:00.', url: 'https://example.com/booking' }, steps: [{ text: 'Selected your requested time and group size.' }] } }];
    }
    const area = screen.getPrimaryDisplay().workArea;
    mascot = makeWindow({ width: 210, height: 240, x: area.x + area.width - 230, y: area.y + area.height - 260, transparent: true, frame: false, resizable: false, alwaysOnTop: true, hasShadow: false, skipTaskbar: true });
    mascot.setAlwaysOnTop(true, 'floating'); mascot.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    chat = makeWindow({ width: 640, height: Math.min(850, area.height - 60), minWidth: 420, minHeight: 450, title: 'Vali', backgroundColor: '#f7f7fb' });
    chat.on('close', e => { if (!quitting) { e.preventDefault(); chat.hide(); } });
    quick = makeWindow({ width: 420, height: 190, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true });
    quick.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const pixels = Buffer.alloc(18 * 18 * 4);
    for (let y = 3; y < 15; y++) for (let x = 2; x < 16; x++) {
      if (Math.abs(x - (3 + (y - 3) / 2)) < 1.5 || Math.abs(x - (14 - (y - 3) / 2)) < 1.5) pixels[(y * 18 + x) * 4 + 3] = 255;
    }
    const trayImage = nativeImage.createFromBitmap(pixels, { width: 18, height: 18 });
    trayImage.setTemplateImage(true);
    if (trayImage.isEmpty()) throw new Error('Tray icon could not be created.');
    tray = new Tray(trayImage.resize({ width: 18, height: 18 })); tray.setToolTip('Vali'); tray.on('click', () => openChat());
    for (const key of ['Alt+Space', 'Alt+V']) if (globalShortcut.register(key, showQuick)) { shortcut = key; break; }
    trayMenu();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Vali', submenu: [{ label: 'Open chat', click: () => openChat() }, { role: 'quit' }] }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    await Promise.all([mascot.loadFile(path.join(root, 'renderer/mascot.html')), chat.loadFile(path.join(root, 'vendor/panel/panel.html')), quick.loadFile(path.join(root, 'renderer/quick.html'))]);
    mascot.showInactive(); publish();
    if (smoke) { setTimeout(() => { console.error('Smoke timed out.'); app.exit(1); }, 20000).unref(); await runSmoke(); }
    else {
      openChat();
      connect().then(() => poll()).catch(e => { config.connectionError = e.message; changes({ connectionError: e.message }, {}); });
      pollTimer = setInterval(() => poll().catch(() => {}), 4000);
    }
  }).catch(e => { console.error(e.message); app.exit(1); });
}
app.on('activate', () => openChat());
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; clearInterval(pollTimer); globalShortcut.unregisterAll(); });
