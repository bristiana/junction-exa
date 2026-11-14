// Moves the mascot window: steps aside to the nearest edge when the user types near it, peeks back in when an
// errand needs the user, comes home on hover, and remembers where the user dragged it. Decisions live in valet.mjs.
import { nearestEdge, openEdges, edgeSpot, typingNear, nextPlace, PEEK, PEEK_IN } from './valet.mjs';

const WALK_MS = 420;
// Sustained typing: four ticks (1.6 s) of input with a still pointer. A click only keeps the idle time at 0 for
// under a second, so clicking Vali never sends him away.
const TYPING_TICKS = 4, ENGAGED_MS = 5000;

export function createStage({ win, screen, powerMonitor, reducedMotion, onHome, onChange }) {
  let place = 'home', edge = 'right', home = win.getBounds(), needsYou = false;
  let lastPointer = null, typingTicks = 0, timer = null, target = null, engagedUntil = 0;
  const area = () => screen.getDisplayMatching(home).workArea;
  // Only toward a side with no monitor next to it.
  function freeEdge(b) {
    const display = screen.getDisplayMatching(b);
    const others = screen.getAllDisplays().filter(d => d.id !== display.id).map(d => d.bounds);
    return nearestEdge(b, display.workArea, openEdges(display.bounds, others));
  }

  function walkTo({ x, y }, done) {
    clearInterval(timer);
    const from = win.getBounds(), start = Date.now(), ms = reducedMotion() ? 0 : WALK_MS;
    target = { x: Math.round(x), y: Math.round(y) };
    const step = () => {
      const k = ms ? Math.min(1, (Date.now() - start) / ms) : 1, ease = 1 - (1 - k) ** 3;
      win.setPosition(Math.round(from.x + (target.x - from.x) * ease), Math.round(from.y + (target.y - from.y) * ease));
      if (k >= 1) { clearInterval(timer); timer = null; done?.(); }
    };
    timer = setInterval(step, 16); step();
  }
  function go(next) {
    if (next === place) return;
    if (place === 'home') {
      const b = win.getBounds(), free = freeEdge(b);
      if (!free) return; // every side touches another monitor: stay put
      home = b; edge = free;
    }
    const from = win.getBounds().x;
    place = next;
    const spot = next === 'home' ? home : edgeSpot(home, area(), edge, next === 'peek' ? PEEK_IN : PEEK);
    onChange({ place, edge, facing: spot.x < from ? 'left' : spot.x > from ? 'right' : '' });
    walkTo(spot, () => onChange({ place, edge, facing: '' }));
  }
  // Every 400 ms: is the user typing near Vali? `hold` (typing into Vali's own windows, talking) never counts,
  // and neither does the first few seconds after the user hovered or clicked him.
  function tick({ hold = false } = {}) {
    const pointer = screen.getCursorScreenPoint();
    const typing = !hold && Date.now() > engagedUntil &&
      typingNear({ idleSec: powerMonitor.getSystemIdleTime(), pointer, lastPointer, bounds: place === 'home' ? win.getBounds() : home });
    lastPointer = pointer;
    typingTicks = typing ? typingTicks + 1 : 0;
    go(nextPlace(place, { typing: typingTicks >= TYPING_TICKS, needsYou }));
  }
  // A move that is not ours is the user dragging Vali: that spot becomes home and is remembered.
  win.on('moved', () => {
    const b = win.getBounds();
    if (timer || (target && b.x === target.x && b.y === target.y)) return;
    home = b; target = null;
    if (place !== 'home') { place = 'home'; onChange({ place, edge, facing: '' }); }
    onHome({ x: b.x, y: b.y });
  });
  return {
    tick,
    hover() { engagedUntil = Date.now() + ENGAGED_MS; if (!typingTicks) go(nextPlace(place, { hovering: true })); },
    setNeedsYou(value) { needsYou = value; if (place !== 'home') go(nextPlace(place, { needsYou })); },
    go,
    get place() { return place; },
    get edge() { return edge; },
    get home() { return { ...home }; },
  };
}
