// Keys in the errand list (pure, shared by the list window and the tests). One key press is at most one action on one
// errand. Approve and Stop only exist when that errand shows the button, so a key can never do more than a click.
// ctx: { index (-1 = none), count, hasApprove, hasStop, field (typing in an input), onButton (a button has focus) }
export function glanceKeyAction(key, { index = -1, count = 0, hasApprove = false, hasStop = false, field = false, onButton = false } = {}) {
  if (key === 'Escape') return { type: 'close' };
  if (field || !count) return null;
  const k = String(key).toLowerCase();
  if (k === 'arrowdown') return { type: 'move', index: Math.min(count - 1, index + 1) };
  if (k === 'arrowup') return { type: 'move', index: Math.max(0, index - 1) };
  if (index < 0) return null;
  if (k === 'enter') return onButton ? null : { type: 'open' };
  if (k === 'a') return hasApprove ? { type: 'approve' } : null;
  if (k === 's') return hasStop ? { type: 'stop' } : null;
  return null;
}
