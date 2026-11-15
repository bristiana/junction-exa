// "Your errands": every errand of this account from every channel, newest first, with account counters on top.
import { h, show } from './dom.js';
import { channelOf, countersOf, errandLine, errandStatus, readableTitle, timeAgo } from './model.js';

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
  ['failed', 'Stopped', 'Nothing was sent. Open one to try again.'],
];
const DONE_SHOWN = 6;

export function hasWorking(tasks) {
  return tasks.some((task) => errandStatus(task).tone === 'working');
}

export function renderDashboard(tasks, stats) {
  const counters = countersOf(stats, tasks);
  const rows = tasks.map((task) => ({ task, status: errandStatus(task) }));
  const groups = GROUPS.map(([tone, title, note]) => ({ tone, title, note,
    items: rows.filter((r) => r.status.tone === tone) }));
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

// What kind of errand a row is, as its main icon; the channel it came from is a small hint by the time.
export const KINDS = {
  answer: ['Answer', 'M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3.3 6.3-1.4 1.4L9 13.8l6.1-6.1-1.4-1.4L9 11 7.3 9.3Z'],
  booking: ['Booking', 'M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2Zm-2 8v9h14v-9H5Zm2 2h4v4H7v-4Z'],
  watch: ['Watch', 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z'],
  draft: ['Draft', 'M3 17.2V21h3.8L17.8 10 14 6.2 3 17.2ZM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8L19 8.8 20.7 7Z'],
};

function row(task, status, hidden) {
  const [label, path] = CHANNELS[channelOf(task)] || CHANNELS.extension;
  const line = errandLine(task);
  const [, kindPath] = KINDS[line.kind] || KINDS.answer;
  return h('li', { hidden: hidden || null },
    h('a', { class: `errand ${status.tone} kind-${line.kind}`, href: `#/t/${encodeURIComponent(task.id)}` },
      h('span', { class: 'channel kind-icon', title: line.label }, icon(kindPath), h('span', { class: 'sr-only' }, `${line.label}: `)),
      h('span', { class: 'errand-text' },
        h('span', { class: 'errand-name' }, readableTitle(task.task)),
        h('span', { class: 'errand-status' }, line.word ? h('b', {}, line.word) : null,
          line.word && line.detail ? ` · ${line.detail}` : line.detail || '')),
      h('span', { class: 'errand-meta' },
        h('span', { class: 'kind-label', 'aria-hidden': 'true' }, line.label),
        h('span', { class: 'errand-when' },
          h('span', { class: 'channel-hint', title: `From ${label}` }, icon(path), h('span', { class: 'sr-only' }, `From ${label}, `)),
          timeAgo(task.created_at)))));
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
