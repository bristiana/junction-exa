// Vali on the page: one Butler (vendor/butler.js, a copy of extension/lib/butler.js) that stands in the open view's
// slot, walks over to the ask box while you type, goes for a walk along the bottom when home is idle, and poses for
// the open errand. Whenever no slot is in view he stands on the corner button (ask-dock.js) that opens "Ask Vali".
// Without that button he wanders along the bottom, and on a phone he steps away so he never covers content.
import { h } from './dom.js';

const PALETTE_KEY = 'vali.palette';
const SIZE = 170;          // px, the hero size; elsewhere he is scaled down
const SPEED = 90;          // px per second when walking
const DOCK = 84;           // px, his height on the corner button
const DOCK_SPEED = 360;    // px per second to and from the corner button
const IDLE_MS = 20000;     // on home, this long without a click or key and he goes for a walk
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const narrow = matchMedia('(max-width: 600px)');
const tiny = matchMedia('(max-width: 480px)'); // a phone: a smaller Vali on a smaller corner button

export function createMascot() {
  const art = h('div', { class: 'buddy-art' });
  const wrap = h('div', { class: 'buddy', 'aria-hidden': 'true' }, art);
  document.body.append(wrap);
  const butler = window.Butler.create(art, { palette: loadPalette(), state: 'idle', reducedMotion: 'auto', trackPointer: true });
  let mood = 'idle', typingUntil = 0, lastInput = Date.now(), at = null, walking = false, wanderTimer = 0, settleTimer = 0;
  let dock = null, held = false, override = null;
  const pose = () => override || mood;

  // Where he should be now: by the ask box, in the view's slot, along the bottom, or away (phone, no slot in view).
  function target() {
    if (dock && held) return docked();
    const ask = document.getElementById('ask');
    if (Date.now() < typingUntil && ask?.offsetParent && !narrow.matches) {
      const box = ask.getBoundingClientRect(), scale = 0.5;
      return { mode: 'input', x: box.right - SIZE * scale * 0.9, y: box.top - SIZE * scale * 0.82, scale };
    }
    const slot = document.querySelector('.view:not([hidden]) [data-slot]');
    const box = slot?.getBoundingClientRect();
    const idle = slot?.dataset.slot === 'home' && Date.now() - lastInput > IDLE_MS && !reduceMotion.matches && !narrow.matches;
    const inView = box && box.bottom > 40 && box.top < innerHeight - 40;
    if (inView && !idle) return { mode: 'slot', x: box.left, y: box.top, scale: box.width / SIZE };
    if (dock && !inView) return docked();
    if (narrow.matches) return { mode: 'away' };
    const scale = innerWidth < 640 ? 0.42 : 0.56, size = SIZE * scale;
    const x = at?.mode === 'wander' ? at.x : reduceMotion.matches ? innerWidth - size - 16 : 16 + Math.random() * Math.max(0, innerWidth - size - 32);
    return { mode: 'wander', x, y: innerHeight - size - 6, scale };
  }

  // Standing on the corner button, feet on its pad.
  function docked() {
    dock.hidden = false;
    const size = tiny.matches ? 56 : DOCK;
    const pad = dock.querySelector('.dock-btn').getBoundingClientRect(), scale = size / SIZE;
    return { mode: 'dock', x: pad.left + (pad.width - size) / 2, y: pad.bottom - size - 4, scale };
  }

  // Walk there at a steady pace (a jump under Reduce motion, or when only the page scrolled).
  function go(next, instant = false) {
    if (dock) dock.hidden = next.mode !== 'dock';
    wrap.hidden = next.mode === 'away';
    if (wrap.hidden || at?.mode === 'away') at = null;
    if (wrap.hidden) return void (at = next);
    const distance = at ? Math.hypot(next.x - at.x, next.y - at.y) : 0;
    // To and from the corner he hurries on a computer and jumps on a phone, so he never lingers over content.
    const toDock = at && (at.mode === 'dock' || next.mode === 'dock');
    const seconds = instant || reduceMotion.matches || !at || (toDock && narrow.matches) ? 0
      : Math.max(0.35, distance / (toDock ? DOCK_SPEED : SPEED));
    wrap.style.transition = seconds ? `transform ${seconds}s linear` : 'none';
    wrap.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
    if (seconds && distance > 8) {
      walking = true;
      butler.lookAt(next.x > at.x ? 1e4 : -1e4, next.y);
      butler.setState('serving');
      clearTimeout(settleTimer);
      settleTimer = setTimeout(arrive, seconds * 1000);
    }
    at = next;
  }

  function arrive() {
    walking = false;
    butler.lookAt(null);
    butler.setState(pose());
    if (at?.mode === 'wander' && !reduceMotion.matches) {
      clearTimeout(wanderTimer);
      wanderTimer = setTimeout(stroll, 3000 + Math.random() * 5000);
    }
  }

  function stroll() {
    if (at?.mode !== 'wander' || walking) return;
    const size = SIZE * at.scale;
    go({ ...at, x: 16 + Math.random() * Math.max(0, innerWidth - size - 32) });
  }

  // Re-aim after layout changes; a slot that only scrolled is followed without walking.
  function update() {
    const next = target();
    if (walking && at && next.mode === at.mode) return;
    if (at && next.mode === at.mode && next.mode !== 'wander' && Math.abs(next.scale - at.scale) < 0.01) return go(next, true);
    if (!at || next.mode !== at.mode) go(next);
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', () => { at = null; schedule(); });
  for (const event of ['keydown', 'pointerdown']) addEventListener(event, () => { lastInput = Date.now(); schedule(); }, { passive: true });
  document.getElementById('errand')?.addEventListener('input', () => {
    typingUntil = Date.now() + 4000;
    if (!walking && !override) butler.setState('listening');
    schedule();
    setTimeout(schedule, 4100);
  });
  setInterval(schedule, 5000);
  wrap.style.width = wrap.style.height = SIZE + 'px';
  schedule();

  return {
    // The pose for the open errand or view; walking finishes before the new pose shows.
    setMood(name) {
      mood = name;
      if (!walking) butler.setState(pose());
      schedule();
    },
    // A pose that wins over the view's mood until pose(null), for the corner bubble's own errand.
    pose(name) {
      override = name || null;
      if (!walking) butler.setState(pose());
    },
    // The corner button he docks on; held keeps him there while its bubble is open.
    attachDock(node) {
      dock = node;
      at = null;
      schedule();
    },
    holdDock(on) {
      held = on;
      schedule();
    },
    relayout: schedule,
    butler,
  };
}

// The palette picker: one swatch button in the header that opens the four palettes; the choice stays in this browser.
export function mountPalettePicker(button, mascot) {
  const menu = h('div', { class: 'palettes', role: 'menu', hidden: true },
    window.Butler.PALETTES.map((name) => {
      const info = window.Butler.paletteInfo(name);
      const swatch = h('button', {
        type: 'button', class: 'swatch', role: 'menuitemradio', title: info.label, 'aria-label': info.label,
        onclick: () => { choose(name); menu.hidden = true; },
      });
      // Colours go through the CSSOM: the page's CSP allows no inline style attributes.
      swatch.style.setProperty('--c1', info.color);
      swatch.style.setProperty('--c2', info.color2);
      swatch.style.setProperty('--c3', info.color3);
      return swatch;
    }));
  button.after(menu);
  button.addEventListener('click', (event) => { event.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });

  function choose(name) {
    mascot.butler.setPalette(name);
    try { localStorage.setItem(PALETTE_KEY, name); } catch { /* not remembered in a private window */ }
    paint(name);
  }

  function paint(name) {
    const info = window.Butler.paletteInfo(name);
    button.style.setProperty('--c1', info.color);
    button.style.setProperty('--c2', info.color2);
    for (const swatch of menu.children) swatch.setAttribute('aria-checked', String(swatch.title === info.label));
  }
  paint(mascot.butler.getPalette());
}

function loadPalette() {
  try {
    const saved = localStorage.getItem(PALETTE_KEY);
    return window.Butler.PALETTES.includes(saved) ? saved : 'lilac';
  } catch { return 'lilac'; }
}
