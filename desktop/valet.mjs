// Vali on screen, the decisions only (pure, shared by main.mjs, the mascot window and the tests): where he stands,
// when he steps aside, when he sleeps, and the one line in his speech bubble. stage.mjs moves the window.
// Rectangles are {x, y, width, height} in screen points; `area` is a display's work area.
import { WELCOME_LINE } from './welcome.mjs';

export const PEEK = 64;        // what still shows when Vali has stepped aside
export const PEEK_IN = 120;    // what shows when he peeks back in with the bell
export const NEAR = 160;       // typing this close to Vali makes him step aside
export const SLEEP_MS = 5 * 60 * 1000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The sides of a display (its full bounds) with no other display next to them: only there can Vali step off screen
// (past a shared side he would just walk onto the next monitor). Never the top, where the menu bar is.
export function openEdges(display, others = []) {
  const overlapsY = o => o.y < display.y + display.height && o.y + o.height > display.y;
  const overlapsX = o => o.x < display.x + display.width && o.x + o.width > display.x;
  const taken = {
    right: others.some(o => o.x === display.x + display.width && overlapsY(o)),
    left: others.some(o => o.x + o.width === display.x && overlapsY(o)),
    bottom: others.some(o => o.y === display.y + display.height && overlapsX(o)),
  };
  return ['right', 'left', 'bottom'].filter(e => !taken[e]);
}

// The closest of the allowed sides of the work area, or null when none is allowed (then Vali stays put).
export function nearestEdge(b, area, edges = ['right', 'left', 'bottom']) {
  const gap = { right: area.x + area.width - (b.x + b.width), left: b.x - area.x, bottom: area.y + area.height - (b.y + b.height) };
  return edges.reduce((best, k) => (best === null || gap[k] < gap[best] ? k : best), null);
}

// The window position with only `show` points of Vali left on screen at that edge.
export function edgeSpot(b, area, edge, show = PEEK) {
  const x = clamp(b.x, area.x, area.x + area.width - b.width), y = clamp(b.y, area.y, area.y + area.height - b.height);
  if (edge === 'left') return { x: area.x + show - b.width, y };
  if (edge === 'right') return { x: area.x + area.width - show, y };
  return { x, y: area.y + area.height - show };
}

const distance = (p, b) => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.width)), Math.max(b.y - p.y, 0, p.y - (b.y + b.height)));

// Typing near Vali: there was input in the last second but the pointer did not move (so it was the keyboard), and the
// pointer (where the user clicked into the text) is close to him. No keylogging: only the system idle time is read.
export function typingNear({ idleSec, pointer, lastPointer, bounds, near = NEAR }) {
  if (idleSec > 0 || !pointer || !lastPointer || pointer.x !== lastPointer.x || pointer.y !== lastPointer.y) return false;
  return distance(pointer, bounds) <= near;
}

// home -> tucked when the user types near him; tucked <-> peek while something needs the user; hover brings him home.
export function nextPlace(place, { typing = false, needsYou = false, hovering = false } = {}) {
  if (hovering && place !== 'home') return 'home';
  if (place === 'home') return typing ? (needsYou ? 'peek' : 'tucked') : 'home';
  return needsYou ? 'peek' : 'tucked';
}

// The saved spot, if it still fits on a connected display (a monitor may have been unplugged since).
export function restoreSpot(saved, areas, size) {
  if (!Number.isFinite(saved?.x) || !Number.isFinite(saved?.y)) return null;
  const cx = saved.x + size.width / 2, cy = saved.y + size.height / 2;
  const area = areas.find(a => cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height);
  if (!area) return null;
  return { x: clamp(saved.x, area.x, area.x + area.width - size.width), y: clamp(saved.y, area.y, area.y + area.height - size.height) };
}

// Asleep after five quiet minutes: nothing running, nothing waiting for the user, no talking, no hover.
export function asleep({ busy, lastBusyAt, now = Date.now() }) {
  return !busy && now - lastBusyAt >= SLEEP_MS;
}

// The speech bubble: one first-person line for what Vali is doing (shared/README.md, rule 8).
export function bubbleLine({ pose = 'idle', paused = false, sleeping = false, welcome = false, badge = {} } = {}) {
  const { count = 0, needsYou = false } = badge;
  if (paused) return 'I’m paused. Errands in the cloud keep going.';
  if (needsYou) {
    if (badge.attention === 'question') return 'I have a question about an errand.';
    if (badge.attention === 'handoff') return 'I need you to finish a step.';
    return 'I need your OK on an errand.';
  }
  if (sleeping) return 'Resting. Hover to wake me.';
  if (welcome) return WELCOME_LINE;
  if (['working', 'thinking', 'searching'].includes(pose)) return badge.exa || (count > 1 ? `I’m on ${count} errands.` : 'I’m on it.');
  if (pose === 'success') return 'All done. Have a look.';
  if (pose === 'error') return 'I couldn’t finish one. Have a look.';
  if (pose === 'listening') return 'I’m listening.';
  return 'At your service.';
}

// S3: with a browser tab in front, one offer about it (only the site, never the page content).
export function contextLine(tab) {
  try {
    const host = new URL(tab?.url).hostname.replace(/^www\./, '');
    return host ? `On ${host}? I can help with this page.` : '';
  } catch { return ''; }
}
