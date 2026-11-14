// Vali on the page: one Butler (vendor/butler.js, a copy of extension/lib/butler.js) that stands in the open view's
// slot, walks over to the ask box while you type, wanders along the bottom when idle, and poses for the open errand.
import { h } from './dom.js';

const PALETTE_KEY = 'vali.palette';
const SIZE = 170;          // px, the hero size; elsewhere he is scaled down
const SPEED = 90;          // px per second when walking
const IDLE_MS = 20000;     // on home, this long without a click or key and he goes for a walk
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function createMascot() {
  const art = h('div', { class: 'buddy-art' });
  const wrap = h('div', { class: 'buddy', 'aria-hidden': 'true' }, art);
  document.body.append(wrap);
  const butler = window.Butler.create(art, { palette: loadPalette(), state: 'idle', reducedMotion: 'auto', trackPointer: true });
  let mood = 'idle', typingUntil = 0, lastInput = Date.now(), at = null, walking = false, wanderTimer = 0, settleTimer = 0;

  // Where he should be now: by the ask box, in the view's slot, or somewhere along the bottom.
  function target() {
    const ask = document.getElementById('ask');
    if (Date.now() < typingUntil && ask?.offsetParent) {
      const box = ask.getBoundingClientRect(), scale = 0.5;
      return { mode: 'input', x: box.right - SIZE * scale * 0.9, y: box.top - SIZE * scale * 0.82, scale };
    }
    const slot = document.querySelector('.view:not([hidden]) [data-slot]');
    const box = slot?.getBoundingClientRect();
    const idle = slot?.dataset.slot === 'home' && Date.now() - lastInput > IDLE_MS && !reduceMotion.matches;
    if (box && box.bottom > 40 && box.top < innerHeight - 40 && !idle) return { mode: 'slot', x: box.left, y: box.top, scale: box.width / SIZE };
    const scale = innerWidth < 640 ? 0.42 : 0.56, size = SIZE * scale;
    const x = at?.mode === 'wander' ? at.x : reduceMotion.matches ? innerWidth - size - 16 : 16 + Math.random() * Math.max(0, innerWidth - size - 32);
    return { mode: 'wander', x, y: innerHeight - size - 6, scale };
  }

  // Walk there at a steady pace (a jump under Reduce motion, or when only the page scrolled).
  function go(next, instant = false) {
    const distance = at ? Math.hypot(next.x - at.x, next.y - at.y) : 0;
    const seconds = instant || reduceMotion.matches || !at ? 0 : Math.max(0.35, distance / SPEED);
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
    butler.setState(mood);
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
    if (walking && next.mode === at.mode) return;
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
    if (!walking) butler.setState('listening');
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
      if (!walking) butler.setState(name);
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
      return h('button', {
        type: 'button', class: 'swatch', role: 'menuitemradio', title: info.label, 'aria-label': info.label,
        style: `--c1:${info.color};--c2:${info.color2};--c3:${info.color3}`,
        onclick: () => { choose(name); menu.hidden = true; },
      });
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
