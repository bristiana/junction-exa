// First run, the decisions only (pure, shared by main.mjs, the list window and the tests): when the welcome card beside
// the mascot shows, when it goes away for good, and how the shortcuts read on it.

export const SAMPLE_ERRAND = 'Find a public sauna in Helsinki open on Saturday evening';
export const WELCOME_LINE = 'Hei! I’m Vali. Give me an errand.';

// 'off': already dismissed. 'done': an errand exists, so dismiss it for good. 'show': show the card.
// 'wait': an account from before, not yet listed; its errands may still arrive (then it is 'done', not a flash of 'show').
export function welcomeStep({ dismissed = false, freshInstall = false, polled = false, taskCount = 0 } = {}) {
  if (dismissed) return 'off';
  if (taskCount > 0) return 'done';
  return freshInstall || polled ? 'show' : 'wait';
}

// 'Alt+Shift+Space' -> '⌥⇧Space', the way macOS menus write it. Empty (not registered) -> the fallback.
export function keyLabel(accelerator, fallback = '') {
  const keys = String(accelerator || fallback).split('+').filter(Boolean);
  const mods = { Alt: '⌥', Option: '⌥', Shift: '⇧', Cmd: '⌘', Command: '⌘', CommandOrControl: '⌘', Ctrl: '⌃', Control: '⌃' };
  return keys.map(k => mods[k] || k).join('');
}
