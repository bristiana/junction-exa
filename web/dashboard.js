// "Your errands": every errand of this account from every channel, newest first, with account counters on top.
import { h, show } from './dom.js';
import { channelOf, countersOf, errandStatus, timeAgo } from './model.js';

export const CHANNELS = {
  web: ['Web', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.9 9h-3.9a15 15 0 0 0-2-6.6A8 8 0 0 1 19.9 11ZM12 4.3A13 13 0 0 1 14 11h-4a13 13 0 0 1 2-6.7ZM4.1 13h3.9a15 15 0 0 0 2 6.6A8 8 0 0 1 4.1 13Zm3.9-2H4.1A8 8 0 0 1 10 4.4 15 15 0 0 0 8 11Zm4 8.7A13 13 0 0 1 10 13h4a13 13 0 0 1-2 6.7Zm2 0a15 15 0 0 0 2-6.7h3.9a8 8 0 0 1-5.9 6.7Z'],
  extension: ['Browser extension', 'M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5Z'],
  mac: ['Mac app', 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10H4V5Zm-2 12h20v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1Z'],
  voice: ['Voice', 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1a7 7 0 0 0 6-6.9h-2Z'],
  letter: ['Letter', 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 7.2L4 7.5V17h16V7.5l-8 4.7Z'],
  whatsapp: ['WhatsApp', 'M12 2a10 10 0 0 0-8.7 14.9L2 22l5.3-1.3A10 10 0 1 0 12 2Z'],
  imessage: ['iMessage', 'M12 3C6.5 3 2 6.6 2 11c0 2.5 1.4 4.7 3.7 6.2L5 21l4-2.3c1 .2 2 .3 3 .3 5.5 0 10-3.6 10-8s-4.5-8-10-8Z'],
};

// Vali works in the background, so the list is grouped by who acts next: you, Vali, or nobody.
const GROUPS = [
  ['you', 'Needs you', 'Vali is waiting for your answer or your OK.'],
  ['working', 'Working now', 'Vali is on it in the background. You can close this page.'],
  ['done', 'Done', null],
];
const DONE_SHOWN = 6;

export function hasWorking(tasks) {
  return tasks.some((task) => errandStatus(task).tone === 'working');
}

export function renderDashboard(tasks, stats) {
  const counters = countersOf(stats, tasks);
  const rows = tasks.map((task) => ({ task, status: errandStatus(task) }));
  const groups = GROUPS.map(([tone, title, note]) => ({ tone, title, note,
    items: rows.filter((r) => (tone === 'done' ? ['done', 'failed'].includes(r.status.tone) : r.status.tone === tone)) }));
  show('errands',
    h('div', { class: 'errands-head' },
      h('h2', { class: 'section-title' }, 'Your errands'),
      h('dl', { class: 'counters' },
        counter(counters.errands, counters.errands === 1 ? 'errand' : 'errands'),
        counter(counters.searches, 'Exa searches'),
        counter(counters.pages, 'pages read'),
        counter(counters.cost == null ? null : `$${counters.cost.toFixed(2)}`, 'Exa cost'))),
    tasks.length
      ? groups.filter((g) => g.items.length).map(group)
      : h('p', { class: 'muted empty' }, 'No errands yet. Ask Vali above, or message it on WhatsApp.'));
}

function group({ tone, title, note, items }) {
  const many = tone === 'done' && items.length > DONE_SHOWN;
  const list = h('ul', { class: 'errand-list' }, items.map((r, i) => row(r.task, r.status, many && i >= DONE_SHOWN)));
  const more = many ? h('button', { type: 'button', class: 'btn quiet more', onclick: (e) => {
    for (const li of list.querySelectorAll('li[hidden]')) li.hidden = false;
    e.currentTarget.remove();
  } }, `Show all ${items.length}`) : null;
  return h('section', { class: `errand-group ${tone}` },
    h('h3', { class: 'group-title' }, title, h('span', { class: 'group-count' }, String(items.length))),
    note ? h('p', { class: 'group-note' }, note) : null,
    list, more);
}

function counter(value, label) {
  return value == null ? null : h('div', {}, h('dt', {}, String(value)), h('dd', {}, label));
}

function row(task, status, hidden) {
  const [label, path] = CHANNELS[channelOf(task)] || CHANNELS.extension;
  return h('li', { hidden: hidden || null },
    h('a', { class: `errand ${status.tone}`, href: `#/t/${encodeURIComponent(task.id)}` },
      h('span', { class: 'channel', title: label }, icon(path), h('span', { class: 'sr-only' }, label)),
      h('span', { class: 'errand-text' },
        h('span', { class: 'errand-name' }, task.task),
        h('span', { class: 'errand-status' }, h('b', {}, status.word), status.detail ? ` · ${status.detail}` : '')),
      h('span', { class: 'errand-when' }, timeAgo(task.created_at))));
}

export function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}
