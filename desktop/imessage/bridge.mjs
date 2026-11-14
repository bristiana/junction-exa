import { openDb, readSince, attachments, maxRowId, messageText, appleToUnix, outgoingError } from './db.mjs';
import { createSender, runScript, ACCOUNT_SCRIPT, automationDenied } from './send.mjs';
import { readyAttachment, convertVoice, voiceBytes, readLetter } from './media.mjs';
import { ACTIVE, normalizeHandle, parseCommand, splitText, activeTask, renderResult, renderExecution, HELP, LINKED, LINK_FAILED } from './text.mjs';
import { notificationEvents } from '../logic.mjs';

export const PERMISSIONS = {
  needs_fda: 'Vali needs Full Disk Access to read messages sent to Vali. Open System Settings, Privacy & Security, Full Disk Access, turn on Vali, then restart Vali.',
  needs_automation: 'Vali needs permission to control Messages to send replies. Open System Settings, Privacy & Security, Automation, and turn on Messages under Vali.',
  needs_account: 'Messages has no active iMessage account. Sign in to the Vali Apple ID in Messages, Settings, iMessage.'
};
export function createBridge({ dbPath, settings = {}, save, api, encrypt, decrypt, open = openDb, script = runScript,
  send, outbox, voice = convertVoice, ready = readyAttachment, now = Date.now, onStatus = () => {}, log = () => {} }) {
  const s = settings;
  s.enabled ??= false; s.mode ??= 'open'; s.allowed ??= []; s.lastRowId ??= 0;
  s.links ??= {}; s.tasks ??= {}; s.helpSentAt ??= {};
  let status = 'off', error = '', busy = false, timer, generation = 0, following = false, lastCheck = 0, lastFollow = 0, disposed = false;
  const seen = new Set(), snapshots = new Map();
  const allowed = handle => s.mode !== 'allowlist' || s.allowed.map(normalizeHandle).includes(handle);
  function publish(next, message = '') { status = next; error = message || PERMISSIONS[next] || ''; onStatus(view()); }
  function view() { return { enabled: s.enabled, status, message: error, mode: s.mode, allowed: [...s.allowed], linked: Object.keys(s.links) }; }
  function withDb(fn) { const db = open(dbPath); try { return fn(db); } finally { db.close(); } }
  const sender = createSender({ run: script, outbox, now, canSend: handle => !disposed && s.enabled && status === 'running' && allowed(handle),
    onDenied: () => publish('needs_automation'), log,
    confirm: handle => { const code = withDb(db => outgoingError(db, handle)); if (code) log('delivery_failed', handle.slice(-4)); } });
  const deliver = send || ((...args) => sender.send(...args));
  async function reply(handle, text) {
    for (const part of splitText(text)) {
      if (disposed || !s.enabled || status !== 'running' || !allowed(handle)) return;
      await deliver(handle, part);
    }
  }
  function client(handle) { return api(decrypt(s.links[handle])); }
  async function check() {
    lastCheck = now();
    try { withDb(maxRowId); }
    catch (e) {
      if (/EACCES|EPERM|authorization|permission|unable to open/i.test(`${e.code} ${e.message}`)) publish('needs_fda');
      else publish('error', 'Could not open the Messages database. Sign in to Messages, check Full Disk Access, and restart Vali.');
      return false;
    }
    try {
      if (Number(String(await script(ACCOUNT_SCRIPT)).trim()) < 1) { publish('needs_account'); return false; }
      if (disposed || !s.enabled) return false;
      sender.resume(); publish('running'); return true;
    } catch (e) { publish(automationDenied(e) ? 'needs_automation' : 'needs_account'); return false; }
  }
  async function enable() {
    if (s.enabled && timer) return view();
    disposed = false; s.enabled = true; const epoch = ++generation;
    // Establish a new boundary every time: neither synced history nor disabled-time messages replay.
    s.startedAt = now();
    await sender.start();
    pruneHelp();
    const isReady = await check();
    if (epoch !== generation || !s.enabled) return view();
    if (isReady) s.lastRowId = Math.max(s.lastRowId, withDb(maxRowId));
    await save();
    if (epoch !== generation || !s.enabled) return view();
    timer = setInterval(() => tick().catch(() => publish('error', 'Could not save iMessage settings. Restart Vali.')), 3000);
    timer.unref?.(); return view();
  }
  async function disable() {
    s.enabled = false; generation++; clearInterval(timer); timer = null;
    publish('off'); await save(); return view();
  }
  async function track(handle, task) {
    if (!task?.id) throw new Error('No task returned.');
    s.tasks[handle] = [...new Set([...(s.tasks[handle] || []), task.id])];
    await save();
    await reply(handle, 'Vali is on it.');
    await update(handle, task);
  }
  async function update(handle, task) {
    const key = `${handle}:${task.id}`, previous = snapshots.get(key);
    const next = { status: task.research?.status, output: task.research?.output, execution: task.execution };
    const events = notificationEvents(previous || { status: 'queued' }, next);
    const e = task.execution;
    if (e?.question && (!e.question.answered) && (events.includes('question') || !previous)) {
      await reply(handle, typeof e.question === 'string' ? e.question : e.question.text || 'Vali has a question.');
    }
    if (e?.status === 'awaiting_approval' && !e.approval_decision && (events.includes('approval') || !previous)) {
      const frame = await client(handle).liveFrame(task.id);
      if (frame && !disposed && s.enabled && status === 'running' && allowed(handle)) await deliver(handle, frame, true);
      await reply(handle, renderExecution(task));
    } else if (e && ['done', 'failed', 'stopped'].includes(e.status) && previous?.execution?.status !== e.status) {
      await reply(handle, renderExecution(task));
    } else if (!e && ['completed', 'failed', 'cancelled'].includes(next.status) && previous?.status !== next.status) {
      await reply(handle, renderResult(task));
    }
    if (!s.links[handle] || disposed) return;
    snapshots.delete(key); snapshots.set(key, structuredClone(next));
    if (snapshots.size > 1000) snapshots.delete(snapshots.keys().next().value);
    if ((e && ['done', 'failed', 'stopped'].includes(e.status)) || (!e && ['completed', 'failed', 'cancelled'].includes(next.status))) {
      snapshots.delete(key);
      s.tasks[handle] = (s.tasks[handle] || []).filter(id => id !== task.id); await save();
    }
  }
  async function followTasks() {
    if (disposed || following || status !== 'running' || !s.enabled) return;
    following = true; lastFollow = now();
    try {
      for (const [handle, ids] of Object.entries(s.tasks)) {
        if (!allowed(handle) || !s.links[handle]) continue;
        for (const id of [...ids]) {
          if (status !== 'running' || !s.enabled) return;
          try { await update(handle, await client(handle).getTask(id)); }
          catch (e) {
            if (automationDenied(e)) { publish('needs_automation'); return; }
            if (e.status === 404) { snapshots.delete(`${handle}:${id}`); s.tasks[handle] = s.tasks[handle].filter(x => x !== id); await save(); }
            log('follow_failed', handle.slice(-4));
          }
        }
      }
    } finally { following = false; }
  }
  async function processMessage(row, media) {
    const handle = normalizeHandle(row.sender), text = messageText(row);
    // Media never enters the command parser, even if its caption says yes or link.
    const command = media.length ? { kind: 'media' } : parseCommand(text);
    if (command.kind === 'link') {
      try {
        const result = await api('').link(command.code);
        if (!result?.token) throw new Error('No token returned.');
        s.links[handle] = encrypt(result.token); s.tasks[handle] = []; await save(); onStatus(view());
        await reply(handle, LINKED);
      } catch (e) { if (e.status === 404) await reply(handle, LINK_FAILED); else throw e; }
      return;
    }
    if (!s.links[handle]) {
      if (s.helpSentAt[handle] === undefined || now() - s.helpSentAt[handle] >= 86400000) {
        s.helpSentAt[handle] = now(); pruneHelp(); await save(); await reply(handle, HELP);
      }
      return;
    }
    const a = client(handle);
    if (media.length) {
      const attachment = media[0];
      try {
        const file = await ready(attachment);
        if (row.is_audio_message || /\.(caf|amr)$/i.test(file) || attachment.mime_type?.startsWith('audio/')) {
          const result = await a.voice(voiceBytes(await voice(file)), 'audio/mp4', { create: true });
          if ('text' in result && !String(result.text || '').trim()) throw new Error('Empty transcript.');
          await track(handle, result);
        } else {
          const letter = await readLetter(file, attachment.mime_type);
          await track(handle, await a.letter(letter.bytes, letter.mime, 'letter', text));
        }
      } catch (e) {
        if (automationDenied(e)) throw e;
        await reply(handle, row.is_audio_message || attachment.mime_type?.startsWith('audio/') ? 'I could not hear that. Please type your errand.' : 'I could not read that. Please type your errand.');
      }
      return;
    }
    const result = await a.listTasks(100);
    const task = activeTask(Array.isArray(result) ? result : result.tasks || []), e = task?.execution || {};
    if (disposed || !s.enabled || status !== 'running' || !allowed(handle) || !s.links[handle]) return;
    const question = e.question && !e.question.answered;
    if (text && (['starting', 'running'].includes(e.status) || question) &&
      (!['stop', 'status'].includes(command.kind) || (question && ['no', 'nu', 'ei'].includes(text.toLowerCase().trim())))) {
      await a.message(task.id, text); await reply(handle, 'Message passed to your running errand.'); return;
    }
    if (command.kind === 'help' || !text) { await reply(handle, HELP); return; }
    if (['choose', 'approve', 'stop', 'status'].includes(command.kind)) {
      if (!task) { await reply(handle, 'No active errand. Send me an errand to get started.'); return; }
      if (command.kind === 'status') { await reply(handle, task.execution ? renderExecution(task) : renderResult(task)); return; }
      if (['approve', 'stop'].includes(command.kind) && e.status !== 'awaiting_approval') {
        await reply(handle, 'There is no submission awaiting your approval.'); return;
      }
      if (command.kind === 'choose') {
        const actions = task.research?.output?.structured?.actions || [];
        if (command.n > actions.length || ACTIVE.has(e.status) || task.research?.status !== 'completed') {
          await reply(handle, 'That action is not available. Reply status to see your choices.'); return;
        }
      }
      const updated = command.kind === 'choose' ? await a.execute(task.id, { action_index: command.n - 1 }) : await a[command.kind](task.id);
      s.tasks[handle] = [...new Set([...(s.tasks[handle] || []), task.id])]; await save();
      if (!['done', 'failed', 'stopped', 'awaiting_approval'].includes(updated.execution?.status)) await reply(handle, renderExecution(updated));
      await update(handle, updated); return;
    }
    if (ACTIVE.has(e.status)) { await a.message(task.id, text); await reply(handle, 'Message passed to your running errand.'); return; }
    await track(handle, await a.createTask({ task: text }));
  }
  function pruneHelp() {
    for (const [recipient, sentAt] of Object.entries(s.helpSentAt)) {
      if (!Number.isFinite(sentAt) || now() - sentAt >= 86400000) delete s.helpSentAt[recipient];
    }
    const oldest = Object.keys(s.helpSentAt).sort((a, b) => s.helpSentAt[a] - s.helpSentAt[b]);
    for (const recipient of oldest.slice(0, Math.max(0, oldest.length - 1000))) delete s.helpSentAt[recipient];
  }
  async function tick() {
    if (busy || disposed || !s.enabled) return;
    busy = true;
    try {
      pruneHelp();
      if (now() - lastCheck >= 60000 && !await check()) return;
      if (status !== 'running') return;
      const rows = withDb(db => readSince(db, s.lastRowId));
      for (const row of rows) {
        if (status !== 'running' || !s.enabled) break;
        s.lastRowId = Math.max(s.lastRowId, row.rowid); await save();
        const handle = normalizeHandle(row.sender);
        if (seen.has(row.guid) || row.style !== 45 || row.participants !== 1 || row.service !== 'iMessage' || row.associated_message_type !== 0 || row.item_type !== 0 ||
          appleToUnix(row.date) < s.startedAt || !handle || !allowed(handle)) continue;
        seen.add(row.guid);
        if (seen.size > 1000) seen.delete(seen.values().next().value);
        try { await handleRow(row); }
        catch (e) {
          if (automationDenied(e)) publish('needs_automation');
          else if (e.message?.startsWith('Vali could not send to ')) publish('error', e.message);
          else await reply(handle, 'Vali could not process this message. Please try again.').catch(() => {});
          log('handle_failed', row.rowid, handle.slice(-4));
        }
      }
      if (now() - lastFollow >= 10000) await followTasks();
    } catch (e) {
      if (/EACCES|EPERM|authorization|permission/i.test(`${e.code} ${e.message}`)) publish('needs_fda');
      else throw e;
    } finally { busy = false; }
  }
  const handleRow = row => processMessage(row, withDb(db => attachments(db, row.rowid)));
  return { enable, disable, tick, followTasks, view, check,
    async configure({ mode, allowed: handles }) {
      if (!['open', 'allowlist'].includes(mode) || !Array.isArray(handles)) throw new Error('Invalid iMessage settings.');
      s.mode = mode; s.allowed = [...new Set(handles.map(normalizeHandle).filter(Boolean))]; await save(); onStatus(view()); return view();
    },
    async unlink(value) {
      const recipient = normalizeHandle(value);
      delete s.links[recipient]; delete s.tasks[recipient]; delete s.helpSentAt[recipient];
      for (const key of snapshots.keys()) if (key.startsWith(`${recipient}:`)) snapshots.delete(key);
      await save(); onStatus(view()); return view();
    },
    dispose() { disposed = true; generation++; clearInterval(timer); timer = null; seen.clear(); snapshots.clear(); return sender.dispose(); }
  };
}
