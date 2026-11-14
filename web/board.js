// The dashboard (#/dashboard): every errand from every channel and every Exa call behind them, refreshed every 5 s
// while the view is open and the tab is visible, so a WhatsApp message shows up here as it arrives.
import { api } from './api.js';
import { h, show } from './dom.js';
import { timeAgo } from './model.js';
import { CHANNELS, icon } from './dashboard.js';
import { feedOf, searchesOf, totalsOf, watchesOf } from './board-model.js';

const POLL_MS = 5000;
const SHORT = { extension: 'Extension', mac: 'Mac', imessage: 'iMessage' };
const SEARCH_ICON = 'M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z';
const EYE_ICON = 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z';

let timer = 0, gen = 0, open = false, lastKey = '', seen = null, updatedAt = 0, failing = false;

export function openBoard() {
  open = true;
  if (!lastKey) show('dashboard', h('p', { class: 'muted board-loading' }, 'Loading your dashboard…'));
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
    if (mine !== gen || !open) return;
    failing = false;
    updatedAt = Date.now();
    render(tasks || [], stats, watches);
  } catch (error) {
    if (mine !== gen || !open) return;
    failing = true;
    if (!lastKey) show('dashboard', h('p', { class: 'muted board-loading' }, `Couldn't load the dashboard: ${error.message}`));
  }
  stamp();
  if (mine === gen && open) timer = setTimeout(load, failing ? POLL_MS * 2 : POLL_MS);
}

// Redraw only when something changed, so focus and scroll survive the poll; the times update in place.
function render(tasks, stats, watches) {
  const key = JSON.stringify([tasks, stats, watches]);
  if (key === lastKey && document.querySelector('#dashboard .board')) return ticks();
  lastKey = key;
  const fresh = seen ? new Set(tasks.map((t) => t.id).filter((id) => !seen.has(id))) : new Set();
  seen = new Set(tasks.map((t) => t.id));
  const focused = document.activeElement?.closest?.('#dashboard [data-key]')?.dataset.key;
  const totals = totalsOf(stats, tasks);
  const feed = feedOf(tasks);
  const searches = searchesOf(tasks);
  const rows = watchesOf(watches, tasks);
  show('dashboard', h('div', { class: 'board' },
    h('div', { class: 'board-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Exa at work'),
        h('h1', { class: 'board-title' }, 'Dashboard')),
      h('p', { class: 'live', id: 'board-live' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), h('span', { class: 'live-text' }))),
    tiles(totals),
    h('div', { class: 'board-grid' },
      h('section', { class: 'card panel feed-panel', 'aria-labelledby': 'feed-title' },
        panelHead('feed-title', 'Activity', feed.length),
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

function panelHead(id, title, count) {
  return h('div', { class: 'panel-head' }, h('h2', { id, class: 'section-title' }, title), h('span', { class: 'count' }, String(count)));
}

function tiles(totals) {
  return h('dl', { class: 'tiles' },
    h('div', { class: 'tile tile-errands' },
      h('dt', {}, 'Errands'), h('dd', { class: 'tile-num' }, String(totals.errands)),
      h('dd', { class: 'tile-channels' }, totals.channels.map(([channel, n]) =>
        h('span', { class: `ch ch-${channel}${n ? '' : ' zero'}`, title: `${n} from ${label(channel)}` },
          glyph(channel), label(channel), h('b', {}, String(n)))))),
    tile('Exa searches', totals.searches, 'Search · Agent · Form fill'),
    tile('Pages read', totals.pages, 'Agent · Contents'),
    tile('Quotes checked', totals.quoted, 'Exa Contents'),
    tile('Exa cost', `$${Number(totals.cost || 0).toFixed(2)}`, totals.today == null ? 'All errands' : `$${totals.today.toFixed(2)} today`));
}

function tile(name, value, note) {
  return h('div', { class: 'tile' }, h('dt', {}, name), h('dd', { class: 'tile-num' }, String(value ?? 0)), h('dd', { class: 'tile-note' }, note));
}

function feedRow(row, fresh) {
  return h('li', { class: fresh ? 'fresh' : null },
    h('a', { class: `feed-row tone-${row.tone}`, href: `#/t/${encodeURIComponent(row.id)}`, 'data-key': row.id },
      h('span', { class: 'feed-top' },
        badge(row.channel),
        h('span', { class: 'feed-meta' }, row.mode, ' · ', h('b', {}, row.status), ' · ', ago(row.at))),
      h('span', { class: 'feed-text' }, row.text),
      row.exa ? h('span', { class: 'feed-exa' }, svg(SEARCH_ICON), h('span', {}, row.exa)) : null,
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
  live.querySelector('.live-text').textContent = failing ? 'Reconnecting' : `Live · ${at}`;
}
