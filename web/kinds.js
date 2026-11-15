// The card on top of an errand page, shaped by what the errand is: a booking or form, or a daily watch.
import { api } from './api.js';
import { h } from './dom.js';
import { bookingStatus, bookingWhen, calendarWhere, domainOf, failReason, formTitle, filledOf, formExa, friendlySteps, needsOf, safeUrl, timeAgo, watchCriteria, watchMatches } from './model.js';
import { runFrame } from './execution.js';
import { fillPlaceholders, loadProfile, missingDetails } from './profile.js';
import { renderState } from './state.js';

// A booking or form: what, where, when and where it stands, with the one action that moves it on and the form as Vali left it.
export function bookingCard(task, handlers) {
  const run = task.execution;
  const status = bookingStatus(task);
  const site = domainOf(run?.current_url || run?.start_url) || renderStateSite(task);
  const siteUrl = safeUrl(run?.current_url || run?.start_url);
  const when = bookingWhen(task);
  const title = when || formTitle(task);
  const where = calendarWhere(task);
  const summary = run?.approval?.summary || '';
  const profile = loadProfile(); // placeholders show your own values, on this page only
  const filled = filledOf(task);
  const steps = friendlySteps(task);
  const shot = runFrame(task);
  const failed = failReason(task);
  return h('section', { class: `booking card tone-${status.tone}`, 'aria-label': 'The booking' },
    h('div', { class: 'booking-head' },
      h('span', { class: `kind-badge tone-${status.tone}` }, status.word),
      site ? (siteUrl
        ? h('a', { class: 'booking-site', href: siteUrl, target: '_blank', rel: 'noopener noreferrer' }, site)
        : h('span', { class: 'booking-site' }, site)) : null),
    h('div', { class: shot ? 'booking-grid' : 'booking-grid single' },
      h('div', { class: 'booking-info' },
        title ? h('p', { class: when ? 'booking-when' : 'booking-when form-name' }, title) : null,
        where ? h('p', { class: 'booking-where' }, where) : null,
        failed ? h('p', { class: 'booking-reason' }, failed.text, failed.url ? [' ', h('a', { href: failed.url, target: '_blank', rel: 'noopener noreferrer' }, domainOf(failed.url))] : null) : null,
        summary && when && status.tone !== 'done' ? h('p', { class: 'booking-summary' }, fillPlaceholders(summary, profile)) : null,
        filled.length ? h('div', { class: 'booking-filled' },
          h('h3', { class: 'booking-label' }, 'Vali filled'),
          h('dl', { class: 'filled' }, filled.map((f) => h('div', {}, h('dt', {}, f.label), h('dd', {}, fillPlaceholders(f.value, profile)))))) : null,
        renderState(task, handlers)),
      shot ? h('figure', { class: 'booking-shot' }, shot,
        h('figcaption', {}, 'Private cloud browser on Modal')) : null),
    steps.length ? h('details', { class: 'booking-steps' },
      h('summary', {}, `What Vali did, ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`),
      h('ol', { class: 'run-steps' }, steps.map((step) => h('li', {}, fillPlaceholders(step, profile))))) : null);
}

function renderStateSite(task) {
  const action = (task.research?.output?.structured?.actions || []).find((a) => safeUrl(a?.url));
  return action ? domainOf(action.url) : '';
}

// A daily watch: what it looks for, how often, when it last looked, what it found, and Check now.
let watchCache = null; // the last GET /v1/watches, so a redraw does not flash an empty card
const EYE = 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z';

export function watchCard(task) {
  const id = task.research?.watch_id;
  const live = task.research?.monitor_stubbed === false;
  const body = h('div', { class: 'watch-live' });
  const card = h('section', { class: 'watch-card card', 'aria-label': 'The watch' },
    h('div', { class: 'booking-head' },
      h('span', { class: `kind-badge ${live ? 'tone-done' : 'tone-stopped'}` },
        eye(), live ? 'Watching' : 'Saved, not live'),
      h('span', { class: 'booking-site' }, 'Exa Monitor')),
    h('p', { class: 'watch-for' }, watchCriteria(task)),
    h('p', { class: 'watch-line' }, live ? 'Checking daily. Vali messages you when something new appears.' : 'Saved, not checking yet.'),
    body);
  const fill = (row) => body.replaceChildren(...watchBody(task, row, live).filter(Boolean));
  fill(watchCache?.find((w) => w.id === id) || null);
  if (id) {
    api.watches().then((r) => {
      watchCache = Array.isArray(r?.watches) ? r.watches : watchCache;
      if (card.isConnected) fill(watchCache?.find((w) => w.id === id) || null);
    }).catch(() => {});
  }
  return card;
}

function eye() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'kind-icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', EYE);
  svg.append(path);
  return svg;
}

function watchBody(task, watch, live) {
  const updates = (watch?.updates || []).filter((u) => u?.text);
  const unseen = Number(watch?.unseen_count) || 0;
  const last = updates.map((u) => u.at).filter(Boolean).sort().at(-1) || watch?.check_requested_at || null;
  const since = watch?.created_at || task.created_at;
  const check = live && task.research?.watch_id ? h('button', { type: 'button', class: 'btn soft' }, 'Check now') : null;
  const note = h('p', { class: 'watch-note', role: 'status' });
  check?.addEventListener('click', async () => {
    check.disabled = true;
    try { await api.checkWatch(task.research.watch_id); note.textContent = 'Checking now. New matches show up here.'; }
    catch (error) { note.textContent = error.message || 'Could not check now.'; check.disabled = false; }
  });
  const first = watchMatches(task)[0];
  const latest = updates[0] ? { text: String(updates[0].text).replace(/^new:\s*/i, ''), url: safeUrl(updates[0].sources?.[0]?.url) }
    : first ? { text: `${first.label}: ${first.value}`, url: first.url } : null;
  return [
    latest ? h('div', { class: 'watch-latest' }, h('span', { class: 'need-k' }, updates[0] ? 'Latest finding' : 'Best match today'),
      latest.url ? h('a', { href: latest.url, target: '_blank', rel: 'noopener noreferrer' }, latest.text) : latest.text) : null,
    h('dl', { class: 'watch-facts' },
      h('div', {}, h('dt', {}, last ? 'Last check' : 'Watching since'), h('dd', {}, timeAgo(last || since) || '')),
      h('div', {}, h('dt', {}, 'Updates'), h('dd', {}, updates.length ? `${updates.length}${unseen ? `, ${unseen} new` : ''}` : 'None yet'))),
    updates.length > 1 ? h('ul', { class: 'watch-updates' }, updates.slice(1, 3).map((u) => {
      const url = safeUrl(u.sources?.[0]?.url);
      return h('li', {}, String(u.text).replace(/^new:\s*/i, ''),
        url ? [' ', h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'fact-source' }, domainOf(url))] : null);
    })) : null,
    check ? h('div', { class: 'actions' }, check) : null,
    note,
  ];
}

// What the watch found on its first look today: each match with the page it came from.
export function watchMatchList(task) {
  const items = watchMatches(task);
  if (!items.length) return null;
  return h('section', { class: 'watch-matches' },
    h('h2', { class: 'section-title' }, 'Today’s matches'),
    h('dl', { class: 'facts' }, items.map((m) => h('div', { class: 'fact' },
      h('dt', {}, m.url ? h('a', { href: m.url, target: '_blank', rel: 'noopener noreferrer' }, m.label) : m.label),
      h('dd', {}, m.value)))));
}

// "How Exa helped" right under the form: the research that found the form, then the lookups made while filling it.
export function exaHelped(task) {
  const t = formExa(task);
  const sites = [];
  for (const page of t.pages) {
    const site = sites.find((x) => x.domain === page.domain);
    if (site) site.n += 1; else sites.push({ ...page, n: 1 });
  }
  const link = (url, text) => url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : text;
  const quoted = (items) => items.slice(0, 3).map((q) => `“${q}”`).join(', ') + (items.length > 3 ? ', …' : '');
  const searches = t.lookups.filter((l) => l.kind === 'search');
  const reads = t.lookups.filter((l) => l.kind === 'read');
  const item = (what, detail) => h('li', {}, h('span', { class: 'how-what' }, what), detail ? h('span', { class: 'how-detail' }, detail) : null);
  const rows = [
    t.reused ? item('Reused a check Vali made a few minutes ago', 'Same errand, same pages, no new search needed.') : null,
    t.searches.length ? item(`Found the form with ${t.searches.length} Exa ${t.searches.length === 1 ? 'search' : 'searches'}`, quoted(t.searches)) : null,
    sites.length ? item(`Read ${t.pages.length} ${t.pages.length === 1 ? 'page' : 'pages'} to check the details`,
      [sites.slice(0, 6).map((p, i) => [i ? ', ' : '', link(p.url, p.domain), p.n > 1 ? ` (${p.n})` : '']), sites.length > 6 ? ` and ${sites.length - 6} more` : '']) : null,
    t.checked ? item(`Checked ${t.checked} ${t.checked === 1 ? 'sentence' : 'sentences'} against the page`, `${t.backed} of ${t.checked} match a quote from today’s page.`) : null,
    searches.length ? item(`Searched ${searches.length === 1 ? 'once' : `${searches.length} times`} while filling`, quoted(searches.map((l) => l.text))) : null,
    reads.length ? item(`Read ${reads.length} ${reads.length === 1 ? 'page' : 'pages'} while filling`, reads.slice(0, 5).map((l, i) => [i ? ', ' : '', link(l.url, l.text)])) : null,
    t.used.length ? item(`Used ${t.used.length} ${t.used.length === 1 ? 'page' : 'pages'} for the answers it typed`, t.used.slice(0, 5).map((u, i) => [i ? ', ' : '', link(u.url, u.domain)])) : null,
  ].filter(Boolean);
  if (!rows.length) return null;
  return h('section', { class: 'how card exa-helped', 'aria-label': 'How Exa helped' },
    h('h2', { class: 'section-title' }, 'How Exa helped'),
    h('ol', { class: 'how-steps' }, rows));
}

// "What Vali needs from you": a short checklist, each item with the one action that provides it. Nothing needed, no block.
// Every question is answered right here; the answer moves the errand on (see send below).
export function needsBlock(task, handlers, { inline = false } = {}) {
  const items = needsOf(task, missingDetails(task, loadProfile()));
  if (!items.length) return null;
  const { onFollowUp, onDetails, onReply, onResume } = handlers;
  const title = items.some((item) => item.kind !== 'bring') ? 'What Vali needs from you' : 'Before you go';
  // An answer goes where it moves the errand on: a running form hears it, a stopped one continues with it,
  // anything else starts the follow-up errand.
  const run = task?.execution?.status;
  const send = (question, text, button) => {
    const reply = `${question} ${text}`;
    if (['starting', 'running', 'awaiting_approval'].includes(run) && onReply) return onReply(text, button);
    if (['stopped', 'failed', 'done'].includes(run) && onResume) return onResume(reply, button);
    return onFollowUp?.(reply);
  };
  return h('section', { class: `needs card ${title === 'Before you go' ? 'soft' : ''}`.trim(), 'aria-label': title },
    h('h2', { class: 'section-title' }, title),
    h('ul', { class: 'needs-list' }, items.map((item) => {
      if (item.kind === 'question') {
        return h('li', { class: 'need' },
          h('span', { class: 'need-text' }, item.text),
          askBox((text, button) => send(item.text, text, button)));
      }
      if (item.kind === 'details') {
        return h('li', { class: 'need' },
          h('span', { class: 'need-text' }, h('span', { class: 'need-k' }, 'Your details for the form'), item.text),
          h('button', { type: 'button', class: 'btn soft need-act', onclick: () => onDetails?.(item.missing) }, 'Add details'));
      }
      return h('li', { class: 'need' }, h('span', { class: 'need-text' }, h('span', { class: 'need-k' }, item.label), item.text));
    })));
}

function askBox(send) {
  const input = h('input', { type: 'text', class: 'reply-input', maxlength: '2000', placeholder: 'Your answer', 'aria-label': 'Your answer' });
  return h('form', { class: 'reply need-reply', onsubmit: (event) => { event.preventDefault(); const text = input.value.trim(); if (text) send(text, event.submitter); } },
    input, h('button', { type: 'submit', class: 'btn' }, 'Send'));
}
