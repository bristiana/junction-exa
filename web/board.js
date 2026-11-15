// The dashboard (#/dashboard): every errand from every channel and every Exa call behind them, refreshed every 5 s
// while the view is open and the tab is visible, so a WhatsApp message shows up here as it arrives.
// #/dashboard/<id> shows one errand as a chat with Vali, on the same refresh.
import { api } from './api.js';
import { h, show } from './dom.js';
import { timeAgo } from './model.js';
import { CHANNELS, icon } from './dashboard.js';
import { feedOf, pagesOpened, searchesOf, threadOf, totalsOf, watchesOf } from './board-model.js';
import { renderState } from './state.js';
import { primaryAction } from './model.js';
import { loadProfile } from './profile.js';

const POLL_MS = 5000;
const SHORT = { extension: 'Extension', mac: 'Mac', imessage: 'iMessage' };
const SEARCH_ICON = 'M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z';
const EYE_ICON = 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z';

let timer = 0, gen = 0, open = false, lastKey = '', seen = null, updatedAt = 0, failing = false;
let threadId = null, last = null; // the errand open as a chat; the newest data, so opening one draws at once

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && open && threadId && !document.querySelector('dialog[open]')) location.hash = '#/dashboard';
});

export function openBoard(id = null) {
  open = true;
  threadId = id;
  if (last) render(last);
  else show('board-content', h('p', { class: 'muted board-loading' }, 'Loading your activity…'));
  load();
}

export function closeBoard() {
  open = false;
  gen++;
  clearTimeout(timer);
}

// Called when the tab becomes visible again.
export function resumeBoard() {
  if (open) load();
}

async function load() {
  const mine = ++gen;
  clearTimeout(timer);
  if (!open || document.hidden) return;
  try {
    const [{ tasks }, stats, watches] = await Promise.all([
      api.tasks(), api.stats().catch(() => null), api.watches().then((r) => r.watches).catch(() => null)]);
    // An errand older than the newest 50 is fetched on its own.
    const want = threadId;
    const extra = want && !(tasks || []).some((t) => t.id === want) ? await api.task(want).catch(() => null) : null;
    if (mine !== gen || !open) return;
    failing = false;
    updatedAt = Date.now();
    last = { tasks: tasks || [], stats, watches, extra, checked: want };
    render(last);
  } catch (error) {
    if (mine !== gen || !open) return;
    failing = true;
    if (!last) show('board-content', h('p', { class: 'muted board-loading' }, `Couldn't load your activity: ${error.message}`));
  }
  stamp();
  if (mine === gen && open) timer = setTimeout(load, failing ? POLL_MS * 2 : POLL_MS);
}

// Redraw only when something changed, so focus and scroll survive the poll; the times update in place.
function render({ tasks, stats, watches, extra, checked }) {
  const key = JSON.stringify([threadId, tasks, stats, watches, extra]);
  if (key === lastKey && document.querySelector('#dashboard .board')) return ticks();
  lastKey = key;
  if (threadId) return renderThread(tasks.find((t) => t.id === threadId) || (extra?.id === threadId ? extra : null), checked === threadId);
  const fresh = seen ? new Set(tasks.map((t) => t.id).filter((id) => !seen.has(id))) : new Set();
  seen = new Set(tasks.map((t) => t.id));
  const focused = document.activeElement?.closest?.('#dashboard [data-key]')?.dataset.key;
  const totals = totalsOf(stats, tasks);
  const feed = feedOf(tasks);
  const searches = searchesOf(tasks);
  const rows = watchesOf(watches, tasks);
  show('board-content', h('div', { class: 'board' },
    h('div', { class: 'board-head' },
      h('div', {},
        h('h1', { class: 'board-title' }, 'Activity')),
      liveBadge()),
    tiles(totals),
    h('div', { class: 'board-grid' },
      h('section', { class: 'card panel feed-panel', 'aria-labelledby': 'feed-title' },
        panelHead('feed-title', 'Errands', feed.length),
        feed.length
          ? h('ul', { class: 'feed' }, feed.map((row) => feedRow(row, fresh.has(row.id))))
          : h('p', { class: 'muted empty' }, 'No errands yet. Message Vali on WhatsApp or ask here.')),
      h('div', { class: 'board-side' },
        h('section', { class: 'card panel', 'aria-labelledby': 'watch-title' },
          panelHead('watch-title', 'Watches', rows.length),
          rows.length
            ? h('ul', { class: 'watches' }, rows.map(watchRow))
            : h('p', { class: 'muted empty' }, 'No watches yet. Try “Watch for new HSL ticket prices”.')),
        h('section', { class: 'card panel', 'aria-labelledby': 'search-title' },
          panelHead('search-title', 'Searches', searches.length),
          searches.length
            ? h('ol', { class: 'searches', tabindex: '0', 'aria-label': 'Exa searches' }, searches.map(searchRow))
            : h('p', { class: 'muted empty' }, 'No searches yet.'))))));
  if (focused) document.querySelector(`#dashboard [data-key="${CSS.escape(focused)}"]`)?.focus();
}

function liveBadge() {
  return h('p', { class: 'live', id: 'board-live' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), h('span', { class: 'live-text' }));
}

// ---------- one errand as a chat ----------
function renderThread(task, checked) {
  const back = h('a', { class: 'back thread-back', href: '#/dashboard', 'data-key': 'back' }, '← Activity');
  if (!task) {
    show('board-content', h('div', { class: 'board thread-view' }, h('div', { class: 'thread-top' }, back, liveBadge()),
      h('p', { class: 'muted board-loading' }, checked ? 'This errand is not in this account.' : 'Loading the errand…')));
    return stamp();
  }
  const focused = document.activeElement?.closest?.('#dashboard [data-key]')?.dataset.key;
  const [row] = feedOf([task]);
  const pages = pagesOpened(task);
  show('board-content', h('div', { class: 'board thread-view' },
    h('div', { class: 'thread-top' }, back, liveBadge()),
    h('section', { class: 'card thread', 'aria-labelledby': 'thread-title' },
      h('header', { class: 'thread-head' },
        h('h1', { id: 'thread-title', class: 'sr-only' }, row.text),
        badge(row.channel),
        h('span', { class: `feed-meta tone-${row.tone}` }, h('b', {}, row.status), ', ', ago(row.at)),
        h('a', { class: 'thread-open', href: `#/t/${encodeURIComponent(task.id)}`, 'data-key': 'open' }, 'Open errand')),
      h('ol', { class: 'bubbles', 'aria-label': 'Conversation' }, threadOf(task).map(bubble)),
      h('div', { class: 'thread-state' }, renderState(task, threadHandlers(task))),
      pages.length ? h('section', { class: 'opened', 'aria-labelledby': 'opened-title' },
        panelHead('opened-title', 'Opened by Vali', pages.length),
        h('ul', { class: 'pages' }, pages.map(pageRow))) : null)));
  if (focused) document.querySelector(`#dashboard [data-key="${CSS.escape(focused)}"]`)?.focus();
  stamp();
}

// A failed action (the shared demo is view only, a 409, the network) shows in the line under the header.
function say(text) {
  const node = document.getElementById('notice');
  if (!node || (!text && node.classList.contains('quiet'))) return;
  node.textContent = text;
  node.hidden = !text;
  node.classList.remove('quiet');
}

// The same moves as on the errand page, straight from the chat: continue, answer, approve, stop.
// One action at a time, like the errand page: a double Enter on a follow-up or Try again starts one errand, not two.
let acting = false;
function threadHandlers(task) {
  const act = async (call, button) => {
    if (acting) return;
    acting = true;
    if (button) button.disabled = true;
    try { await call(); say(''); } catch (error) { say(error.message || 'That did not go through. Try again.'); } finally { acting = false; if (button) button.disabled = false; load(); }
  };
  const fill = (index, button) => act(() => api.execute(task.id, index, loadProfile()), button);
  return {
    onExecute: fill,
    onStop: (button) => act(() => api.stop(task.id), button),
    onApprove: (button) => act(() => api.approve(task.id), button),
    onReply: (text, button) => act(() => api.message(task.id, text), button),
    onResume: (answer, button) => act(() => api.resume(task.id, answer, loadProfile()).catch((error) => {
      const action = primaryAction(task);
      if (![404, 405].includes(error.status) || !action) throw error;
      return api.execute(task.id, action.index, loadProfile());
    }), button),
    onFollowUp: (text) => act(async () => {
      const next = await api.createTask(text, task.id);
      location.hash = `#/t/${encodeURIComponent(next.id)}`;
    }),
    onDetails: () => document.getElementById('to-details')?.click(),
  };
}

function bubble(b) {
  return h('li', { class: `bubble ${b.who}${b.tone ? ` tone-${b.tone}` : ''}` },
    h('span', { class: 'sr-only' }, b.who === 'me' ? 'You: ' : 'Vali: '),
    b.label ? h('span', { class: 'bubble-label' }, b.label) : null,
    h('p', { class: 'bubble-text' }, b.text),
    b.options?.length ? h('span', { class: 'bubble-options' }, b.options.map((o) => h('span', { class: 'tag' }, o))) : null,
    b.facts?.length ? h('dl', { class: 'bubble-facts' }, b.facts.map((f) => h('div', {}, h('dt', {}, f.label), h('dd', {}, f.value)))) : null,
    b.steps?.length ? h('ul', { class: 'bubble-steps' },
      b.more ? h('li', { class: 'more' }, `${b.more} earlier ${b.more === 1 ? 'step' : 'steps'}`) : null,
      b.steps.map((step) => h('li', {}, step))) : null,
    b.sources?.length ? h('ol', { class: 'bubble-sources', 'aria-label': 'Sources' }, b.sources.map((s) => h('li', {},
      h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', title: s.url }, h('b', {}, String(s.n)), s.domain)))) : null);
}

function pageRow(page) {
  const fallback = () => h('span', { class: `page-icon${page.pdf ? ' pdf' : ''}`, 'aria-hidden': 'true' },
    page.pdf ? 'PDF' : (page.domain[0] || '?').toUpperCase());
  const thumb = page.image
    ? h('img', { class: 'page-thumb', src: page.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer',
      onerror: (event) => event.currentTarget.replaceWith(fallback()) })
    : fallback();
  return h('li', {},
    h('a', { class: 'page', href: page.url, target: '_blank', rel: 'noopener noreferrer' },
      thumb,
      h('span', { class: 'page-main' },
        h('span', { class: 'page-title' }, page.title || page.domain),
        h('span', { class: 'page-meta' }, page.pdf && page.image ? h('span', { class: 'tag pdf' }, 'PDF') : null, page.domain, ' · ', page.how))));
}

function panelHead(id, title, count) {
  return h('div', { class: 'panel-head' }, h('h2', { id, class: 'section-title' }, title), h('span', { class: 'count' }, String(count)));
}

// The account in one sentence, numbers in ink; the channel split underneath.
function tiles(totals) {
  const n = (v) => h('b', { class: 'tally-num' }, String(v ?? 0));
  const cost = `$${Number(totals.cost || 0).toFixed(2)}`;
  return h('div', { class: 'tally' },
    h('p', { class: 'tally-line' },
      n(totals.errands), totals.errands === 1 ? ' errand. ' : ' errands. ',
      'Exa searched ', n(totals.searches), ' times, read ', n(totals.pages), ' pages and checked ', n(totals.quoted), ' quotes, for ', n(cost), '.'),
    h('p', { class: 'tally-channels' }, totals.channels.filter(([, c]) => c).map(([channel, c]) =>
      h('span', { class: `ch ch-${channel}` }, glyph(channel), `${label(channel)} ${c}`))));
}

function tile(name, value, note) {
  return h('div', { class: 'tile' }, h('dt', {}, name), h('dd', { class: 'tile-num' }, String(value ?? 0)), h('dd', { class: 'tile-note' }, note));
}

function feedRow(row, fresh) {
  return h('li', { class: fresh ? 'fresh' : null },
    h('a', { class: `feed-row tone-${row.tone}`, href: `#/t/${encodeURIComponent(row.id)}`, 'data-key': row.id },
      h('span', { class: 'feed-top' },
        badge(row.channel),
        h('span', { class: 'feed-meta' }, h('b', {}, row.status), ', ', ago(row.at))),
      h('span', { class: 'feed-text' }, row.text),
      row.exa ? h('span', { class: 'feed-exa' }, row.exa) : null,
      row.domains.length ? h('span', { class: 'domains' }, row.domains.map((d) => h('span', { class: 'domain' }, d))) : null));
}

function watchRow(watch) {
  return h('li', { class: 'watch' },
    h('div', { class: 'watch-top' },
      h('span', { class: 'watch-icon', 'aria-hidden': 'true' }, svg(EYE_ICON)),
      h('div', { class: 'watch-main' },
        watch.taskId
          ? h('a', { class: 'watch-criteria', href: `#/t/${encodeURIComponent(watch.taskId)}`, 'data-key': 'w' + watch.id }, watch.criteria)
          : h('span', { class: 'watch-criteria' }, watch.criteria),
        h('span', { class: 'watch-meta' },
          h('span', { class: watch.live ? 'monitor on' : 'monitor' }, watch.live ? 'Exa Monitor · daily' : 'Saved · not live'),
          h('span', {}, `${watch.when.label} `, ago(watch.when.at)))),
      watch.unseen ? h('span', { class: 'new-count' }, `${watch.unseen} new`) : null),
    watch.updates.length
      ? h('ul', { class: 'updates' }, watch.updates.map((u) => h('li', {},
        h('span', { class: 'update-text' }, u.text),
        h('span', { class: 'update-meta' },
          u.url ? h('a', { href: u.url, target: '_blank', rel: 'noopener noreferrer' }, u.domain) : null,
          u.at ? [u.url ? ' · ' : '', ago(u.at)] : null))))
      : h('p', { class: 'updates-none' }, 'No changes found yet.'));
}

function searchRow(search) {
  return h('li', { class: 'search' },
    h('a', { class: 'search-query', href: `#/t/${encodeURIComponent(search.taskId)}`, 'data-key': `s${search.taskId}${search.query}${search.at}` },
      `“${search.query}”`),
    h('span', { class: 'search-meta' },
      badge(search.channel, true),
      h('span', { class: 'search-errand' }, search.errand),
      search.where === 'Form fill' ? h('span', { class: 'tag fill' }, 'Form fill') : null,
      ago(search.at)));
}

function badge(channel, small = false) {
  return h('span', { class: `ch ch-${channel}${small ? ' sm' : ''}` }, glyph(channel), small ? h('span', { class: 'sr-only' }, label(channel)) : label(channel));
}

function label(channel) {
  return SHORT[channel] || (CHANNELS[channel] ? CHANNELS[channel][0] : channel);
}

function glyph(channel) {
  return svg((CHANNELS[channel] || CHANNELS.web)[1]);
}

function svg(path) {
  return icon(path);
}

function ago(iso) {
  return h('time', { class: 'ago', datetime: iso || null, 'data-ago': iso || '' }, timeAgo(iso));
}

function ticks() {
  for (const node of document.querySelectorAll('#dashboard [data-ago]')) node.textContent = timeAgo(node.dataset.ago);
}

function stamp() {
  const live = document.getElementById('board-live');
  if (!live) return;
  live.classList.toggle('off', failing);
  const at = updatedAt ? new Date(updatedAt).toTimeString().slice(0, 8) : '';
  live.querySelector('.live-text').textContent = failing ? 'Reconnecting' : 'Live';
}
