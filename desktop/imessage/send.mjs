import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
const execute = promisify(execFile);
export const runScript = async (script, args = []) => (await execute('/usr/bin/osascript', ['-e', script, ...args], { timeout: 20000 })).stdout;
export const ACCOUNT_SCRIPT = 'tell application "Messages" to count of (accounts whose service type = iMessage and enabled is true)';
const textScript = `on run argv
  set theHandle to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set theAccount to 1st account whose service type = iMessage and enabled is true
    send theText to participant theHandle of theAccount
  end tell
end run`;
const imageScript = `on run argv
  set theHandle to item 1 of argv
  set theFile to POSIX file (item 2 of argv)
  tell application "Messages"
    set theAccount to 1st account whose service type = iMessage and enabled is true
    send theFile to participant theHandle of theAccount
  end tell
end run`;
export const automationDenied = error => /-1743|not authorized to send Apple events/i.test(String(error?.stderr || '') + String(error?.message || ''));
export function createSender({ run = runScript, outbox = path.join(homedir(), 'Pictures', 'Vali Outbox'), wait = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, onDenied = () => {}, canSend = () => true, confirm = () => {}, log = () => {} } = {}) {
  let queue = Promise.resolve(), last = 0, blocked = false, disposed = false;
  const timers = new Set();
  const counts = new Map();
  async function deliver(handle, value, image) {
    if (disposed || blocked || !canSend(handle)) return;
    for (const [recipient, times] of counts) {
      const active = times.filter(t => now() - t < 600000);
      if (active.length) counts.set(recipient, active); else counts.delete(recipient);
    }
    if (!counts.has(handle) && counts.size >= 1000) { log('rate_limited', handle.slice(-4)); return; }
    const recent = (counts.get(handle) || []).filter(t => now() - t < 600000);
    if (recent.length >= 20) { log('rate_limited', handle.slice(-4)); return; }
    recent.push(now()); counts.set(handle, recent);
    await wait(Math.max(0, 1500 - (now() - last)));
    if (disposed || blocked || !canSend(handle)) return;
    let file;
    try {
      if (image) {
        await mkdir(outbox, { recursive: true, mode: 0o700 });
        file = path.join(outbox, `${randomUUID()}.jpg`);
        await writeFile(file, value, { mode: 0o600 });
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await run(image ? imageScript : textScript, [handle, file || String(value)]); break; }
        catch (e) {
          if (automationDenied(e)) { blocked = true; onDenied(); throw e; }
          if (attempt) throw new Error(`Vali could not send to ${handle}. Check that Messages is signed in and online.`);
          await wait(1500);
        }
      }
      if (image) await wait(value.length > 1000000 ? 5000 : 3000);
      await confirm(handle);
    } finally {
      last = now();
      if (file) {
        const timer = setTimeout(() => { timers.delete(timer); rm(file, { force: true }).catch(() => {}); }, 120000);
        timers.add(timer); timer.unref();
      }
    }
  }
  async function sweep() {
    const entries = await readdir(outbox, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    await Promise.all(entries.filter(entry => entry.isFile() && /^[0-9a-f-]{36}\.jpg$/i.test(entry.name))
      .map(entry => rm(path.join(outbox, entry.name), { force: true })));
  }
  return {
    async start() { await queue.catch(() => {}); await sweep(); disposed = false; },
    async dispose() {
      disposed = true;
      await queue.catch(() => {});
      for (const timer of timers) clearTimeout(timer);
      timers.clear(); counts.clear(); await sweep();
    },
    send(handle, value, image = false) {
      const result = queue.catch(() => {}).then(() => deliver(handle, value, image));
      queue = result; return result;
    },
    resume() { blocked = false; },
    idle: () => queue.catch(() => {})
  };
}
