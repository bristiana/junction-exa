// macOS helpers for page context and "Ask Vali about this". Every helper fails quietly: no permission or no browser
// simply means no context. Nothing here launches an app (the scripts only talk to a browser that is running).
import { execFile } from 'node:child_process';
import { frontBrowser, tabScript, parseTab } from './logic.mjs';

export function run(cmd, args, timeout = 1500) {
  return new Promise(resolve => execFile(cmd, args, { timeout }, (error, stdout) => resolve(error ? null : String(stdout))));
}
const osascript = (script, timeout) => run('/usr/bin/osascript', ['-e', script], timeout);
const wait = ms => new Promise(r => setTimeout(r, ms));

// The frontmost Chrome-family or Safari tab, if a browser is the app in front (other than Vali). Needs the
// Automation permission for that browser; macOS asks once.
export async function frontTab({ exec = run } = {}) {
  if (process.platform !== 'darwin') return null;
  const app = frontBrowser(await exec('/usr/bin/lsappinfo', ['visibleProcessList']));
  if (!app) return null;
  const tab = parseTab(await exec('/usr/bin/osascript', ['-e', tabScript(app)], 2500));
  return tab ? { ...tab, app } : null;
}

// Copies the selection in the front app with a simulated Cmd+C, reads it and puts the old clipboard back.
// Needs Accessibility for Vali. Returns { text, via: 'selection' | 'clipboard' | 'none' }.
export async function grabSelection({ clipboard, trusted, keystroke = () => osascript('tell application "System Events" to keystroke "c" using command down', 2000) }) {
  const saved = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF() };
  const image = clipboard.readImage(); if (!image.isEmpty()) saved.image = image;
  if (!trusted) return saved.text.trim() ? { text: saved.text, via: 'clipboard' } : { text: '', via: 'none' };
  const sentinel = `vali-${Date.now()}-${Math.random()}`;
  clipboard.writeText(sentinel);
  let text = '';
  try {
    await wait(120); // let the shortcut's modifier keys come up first
    await keystroke();
    for (let i = 0; i < 12; i++) {
      const now = clipboard.readText();
      if (now !== sentinel) { text = now; break; }
      await wait(50);
    }
  } finally {
    const restore = Object.fromEntries(Object.entries(saved).filter(([, v]) => v && (typeof v === 'string' ? v : true)));
    if (Object.keys(restore).length) clipboard.write(restore); else clipboard.clear();
  }
  return text.trim() ? { text, via: 'selection' } : { text: '', via: 'none' };
}
