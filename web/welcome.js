// "Start here" on home, only for the closed judging demo (/v1/me says demo): who the juror is, the three errands to
// open first and what to try. "Got it" hides it in this browser; "Show the guide" brings it back.
import { api } from './api.js';
import { $, h, show } from './dom.js';

const DISMISSED_KEY = 'vali.welcome.dismissed';
export const OPEN_FIRST = [
  ['t_a122a1ca4ed848e1b9bba58f68b7740f', 'Allas Sea Pool student ticket', 'A real form filled with Bogdan’s details. Press Continue to watch Vali fill it again.'],
  ['t_9affc60c17d549e3981d35796e98aa07', 'Bank account without a Finnish ID', 'Every sentence checked against today’s page.'],
  ['t_3975efb067c4432dafd51beb327de8e7', 'New HOAS flats under €700', 'Exa watches daily and reports only what is new.'],
];

let demo = null;  // a promise of /v1/me's demo flag, asked once per sign-in

// The links whose errand is in this account's list, so a juror never opens a missing one.
export function openFirst(tasks) {
  const ids = new Set((tasks || []).map((task) => task.id));
  return OPEN_FIRST.filter(([id]) => ids.has(id));
}

function dismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
}

function remember(value) {
  try {
    if (value) localStorage.setItem(DISMISSED_KEY, '1');
    else localStorage.removeItem(DISMISSED_KEY);
  } catch { /* the choice lasts for this page only */ }
}

export function resetWelcome() { demo = null; }

export function renderWelcome(tasks) {
  demo ||= api.me().then((me) => me?.demo === true).catch(() => { demo = null; return false; });
  return demo.then((on) => paint(on, tasks));
}

function paint(on, tasks) {
  const slot = $('welcome');
  if (!slot) return;
  slot.hidden = !on;
  if (!on) return;
  const again = () => { remember(false); paint(true, tasks); };
  if (dismissed()) {
    show('welcome', h('button', { type: 'button', class: 'link-btn welcome-again', onclick: again }, 'Show the guide'));
    return;
  }
  const links = openFirst(tasks);
  show('welcome',
    h('div', { class: 'welcome-card card' },
      h('div', { class: 'welcome-head' },
        h('h2', { class: 'section-title' }, 'Welcome to the demo'),
        h('button', { type: 'button', class: 'btn quiet welcome-close', onclick: () => { remember(true); paint(true, tasks); } }, 'Got it')),
      h('p', { class: 'welcome-who' }, 'You are Bogdan, a master’s student from Romania at Aalto, a few weeks into life in Espoo. Everything below is what Vali did for him this weekend.'),
      links.length && h('h3', { class: 'welcome-sub' }, 'Open these first'),
      links.length && h('ul', { class: 'welcome-links' }, links.map(([id, title, line]) =>
        h('li', {}, h('a', { href: `#/t/${encodeURIComponent(id)}` }, title), h('span', {}, line)))),
      h('h3', { class: 'welcome-sub' }, 'Try it yourself'),
      h('ul', { class: 'welcome-try' },
        h('li', {}, 'Ask anything in the box: Exa reads today’s pages, about 30 s.'),
        h('li', {}, 'On a form errand, press Fill it for me, then Approve. In this demo Vali stops right before sending, so nothing reaches the real site.'),
        h('li', {}, h('a', { href: '/vali-extension.zip', download: 'vali-extension.zip' }, 'Get the extension'), ' and sign in with the same account to see Vali on any page.')),
      h('p', { class: 'welcome-note' }, 'The WhatsApp side is in the video; it runs on a Meta test number.')));
}
