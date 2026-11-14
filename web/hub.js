// "Your first weeks in Finland": the student services timeline, filtered by who you are, with done ticks,
// live facts from the official page, offices with today's hours, and the landlord check. Choices stay in this browser.
import { api } from './api.js';
import { h, show } from './dom.js';
import { citePill } from './cite.js';
import { canFill, errandFor, factSources, helpLabel, officeQuery, timeline } from './hub-model.js';
import { renderOffices } from './offices.js';
import { landlordBox } from './landlord.js';

const ABOUT_KEY = 'vali.hub.about';
const DONE_KEY = 'vali.hub.done';
// details: the open card's detail node, kept across redraws so loaded facts, offices and their sort survive.
const state = { catalog: null, about: load(ABOUT_KEY, {}), done: new Set(load(DONE_KEY, [])), open: null, facts: new Map(), details: new Map(), onAsk: null };

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not remembered in a private window */ }
}

// Loads the catalog once per page visit, then draws from memory.
export async function openHub({ onAsk }) {
  state.onAsk = onAsk;
  if (!state.catalog) {
    show('hub', h('p', { class: 'muted hub-loading' }, 'Loading your first weeks…'));
    try {
      state.catalog = await api.services();
    } catch (error) {
      return show('hub', back(), h('p', { class: 'notice' }, `Couldn't load the services: ${error.message}`),
        h('button', { type: 'button', class: 'btn', onclick: () => openHub({ onAsk }) }, 'Try again'));
    }
  }
  draw();
}

// Redraws for a filter or an opened card, then puts focus back on the control that was used.
function draw() {
  const focused = document.activeElement?.dataset?.focus;
  const phases = timeline(state.catalog, state.about);
  show('hub',
    back(),
    h('h1', { class: 'hub-title' }, 'Your first weeks in Finland'),
    h('p', { class: 'sub' }, 'What a new student sets up, in order. Tick what’s done; open a step for today’s facts from the official page.'),
    aboutRow(),
    h('p', { class: 'hub-progress', id: 'hub-progress' }),
    phases.map((phase) => h('section', { class: 'phase' },
      h('h2', { class: 'section-title' }, phase.title),
      h('div', { class: 'svc-list' }, phase.services.map(card)))),
    landlordBox());
  progress();
  if (focused) document.querySelector(`#hub [data-focus="${CSS.escape(focused)}"]`)?.focus();
}

// "3 of 18 done" for the steps that apply, updated in place when a box is ticked.
function progress() {
  const ids = [...document.querySelectorAll('#hub .svc')].map((node) => node.dataset.id);
  const done = ids.filter((id) => state.done.has(id)).length;
  document.getElementById('hub-progress').replaceChildren(h('b', {}, `${done} of ${ids.length}`), ' done');
}

function back() {
  return h('a', { class: 'back', href: '#/' }, '← Home');
}

// Two small toggles; tapping the chosen one again clears it.
function aboutRow() {
  const toggle = (key, value, label) => h('button', {
    type: 'button', class: 'seg', 'aria-pressed': String(state.about[key] === value), 'data-focus': `about-${key}-${value}`,
    onclick: () => { state.about = { ...state.about, [key]: state.about[key] === value ? null : value }; save(ABOUT_KEY, state.about); draw(); },
  }, label);
  return h('div', { class: 'about', role: 'group', 'aria-label': 'About you' },
    h('div', { class: 'segs' }, toggle('citizenship', 'eu', 'EU/EEA citizen'), toggle('citizenship', 'non_eu', 'Non-EU')),
    h('div', { class: 'segs' }, toggle('study', 'degree', 'Degree student'), toggle('study', 'exchange', 'Exchange')));
}

function card(service) {
  const open = state.open === service.id;
  const done = state.done.has(service.id);
  const box = h('input', { type: 'checkbox', checked: done, 'aria-label': `Done: ${service.name}` });
  const node = h('article', { class: `svc card${done ? ' done' : ''}${open ? ' open' : ''}`, 'data-id': service.id },
    h('div', { class: 'svc-head' },
      h('label', { class: 'tick' }, box),
      h('button', { type: 'button', class: 'svc-open', 'aria-expanded': String(open), 'data-focus': `open-${service.id}`, onclick: () => toggle(service.id) },
        h('span', { class: 'svc-name' }, service.name),
        h('span', { class: 'svc-org' }, service.organisation))),
    h('div', { class: 'svc-tags' },
      service.needsBankId ? h('span', { class: 'tag stale' }, 'needs Finnish bank ID') : null,
      h('span', { class: 'tag help' }, helpLabel(service))),
    open ? detail(service) : null);
  box.addEventListener('change', () => {
    if (box.checked) state.done.add(service.id); else state.done.delete(service.id);
    save(DONE_KEY, [...state.done]);
    node.classList.toggle('done', box.checked);
    progress();
  });
  return node;
}

function toggle(id) {
  state.open = state.open === id ? null : id;
  draw();
}

// The open card: live facts (fetched once per page visit), actions, and offices. Built once, then reused.
function detail(service) {
  if (!state.details.has(service.id)) state.details.set(service.id, buildDetail(service));
  return state.details.get(service.id);
}

function buildDetail(service) {
  const facts = h('div', { class: 'svc-facts' });
  const fill = (result) => facts.replaceChildren(factList(result));
  const cached = state.facts.get(service.id);
  if (cached) fill(cached);
  else {
    facts.append(h('p', { class: 'muted' }, 'Reading the official page with Exa…'));
    api.service(service.id).then((entry) => entry.live_facts, () => ({ available: false })).then((result) => {
      state.facts.set(service.id, result);
      fill(result);
    });
  }
  const offices = officeQuery(service) ? h('div', { class: 'svc-offices' }) : null;
  if (offices) renderOffices(offices, officeQuery(service));
  return h('div', { class: 'svc-detail' },
    facts,
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => state.onAsk(errandFor(service, state.about)) }, 'Ask Vali'),
      canFill(service) ? h('button', { type: 'button', class: 'btn soft', onclick: () => state.onAsk(errandFor(service, state.about, true)) }, 'Fill it for me') : null,
      service.official_url ? h('a', { class: 'btn quiet', href: service.official_url, target: '_blank', rel: 'noopener noreferrer' }, 'Official page ↗') : null),
    offices);
}

function factList(result) {
  if (!result?.available) return h('p', { class: 'muted' }, 'Live facts are unavailable right now. The official page is linked below.');
  const { sources, quotes } = factSources(result.facts);
  if (!quotes.length) return h('p', { class: 'muted' }, 'The official page had no short quotes to show. Open it below.');
  return h('div', {},
    h('p', { class: 'eyebrow' }, result.cached ? 'From the official page, read in the last 6 h' : 'From the official page, read just now'),
    h('ul', { class: 'quotes' }, quotes.slice(0, 5).map((quote) =>
      h('li', {}, `“${quote.text}” `, citePill(null, sources.find((s) => s.n === quote.n))))));
}
