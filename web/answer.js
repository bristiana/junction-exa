// The answer view: cited claims, key facts, next steps, the sources Vali read and how it found them.
import { h, show } from './dom.js';
import { claimsOf, detailsOf, draftsOf, exaTrail, factsOf, sourcesOf, stepsOf } from './model.js';
import { renderExecution } from './execution.js';
import { citePill } from './cite.js';
import { renderState } from './state.js';

// One errand as a short story: what you asked, what Vali found, what it did, and where it stands now.
export function renderAnswer(task, handlers) {
  const research = task.research || {};
  if (research.status !== 'completed') return show('answer', back(), unfinished(task, handlers));
  const sources = sourcesOf(task);
  const claims = claimsOf(task, sources);
  const pill = (n) => citePill(task, sources.find((s) => s.n === n));
  const [first, ...rest] = claims;
  const run = task.execution;
  show('answer',
    back(),
    h('div', { class: 'answer-main', lang: task.lang || null },
      h('h1', { class: 'errand-title' }, task.task),
      h('ol', { class: 'story' },
        chapter('You asked', asked(task)),
        chapter('Vali found', [
          first ? h('p', { class: 'headline' }, claimText(first, pill)) : null,
          rest.length ? h('p', { class: 'claims' }, rest.map((claim) => [claimText(claim, pill), ' '])) : null,
          facts(factsOf(task, sources)),
          drafts(draftsOf(task)),
          howFound(task),
          nextErrand(task, handlers),
          run ? null : steps(stepsOf(task))]),
        run ? chapter('Vali did', [renderExecution(task, { ...handlers, quiet: true }),
          h('p', { class: 'exa-line' }, 'In a private cloud browser on Modal, one errand at a time.')]) : null,
        chapter('Now', renderState(task, handlers), 'now'))));
}

function chapter(title, body, cls = '') {
  return h('li', { class: `chapter ${cls}`.trim() }, h('h2', { class: 'chapter-title' }, title), h('div', { class: 'chapter-body' }, body));
}

// The request and the context it came with: channel, the page it was asked from, saved details shared, answers given.
function asked(task) {
  const via = { whatsapp: 'WhatsApp', web: 'the web', extension: 'Chrome', voice: 'a call' }[task.channel || task.source] || 'the web';
  const when = task.created_at ? new Date(task.created_at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const known = detailsOf(task);
  const answered = task.research?.question?.answer ? [task.research.question.text, task.research.question.answer] : null;
  const page = task.page && (task.page.title || task.page.url);
  return h('dl', { class: 'context' },
    row('From', `${via}${when ? `, ${when}` : ''}`),
    page ? row('Page', task.page.title || task.page.url) : null,
    known.length ? row('Your details', known.join(', ')) : null,
    answered ? row(answered[0], answered[1]) : null);
}

function row(label, value) {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value));
}

function exaLine(task, sources) {
  const lines = (task.research?.activity || task.research?.progress || []);
  const searches = lines.filter((l) => l?.kind === 'search').length;
  const pages = new Set(lines.filter((l) => ['read', 'source'].includes(l?.kind)).map((l) => l.url || l.text)).size;
  const parts = [searches ? `${searches} Exa ${searches === 1 ? 'search' : 'searches'}` : null, pages ? `${pages} pages read` : null, `${sources.length} ${sources.length === 1 ? 'source' : 'sources'} quoted`].filter(Boolean);
  return parts.join(', ') + '.';
}

function back() {
  return h('a', { class: 'back', href: '#/dashboard' }, '← Dashboard');
}

function unfinished(task, { onFollowUp }) {
  const cancelled = task.research?.status === 'cancelled';
  return h('div', { class: 'card unfinished' },
    h('p', { class: 'eyebrow' }, task.task),
    h('h1', { class: 'headline' }, cancelled ? 'Stopped. Nothing was sent.' : "Couldn't finish this one."),
    h('p', { class: 'muted' }, cancelled ? 'You stopped this errand before Vali answered.' : task.research?.error || 'The research service did not answer.'),
    h('button', { type: 'button', class: 'btn', onclick: () => onFollowUp(task.task) }, 'Try again'));
}

// A claim with its numbered source pills; a claim no quote backs is marked as such.
function claimText(claim, pill) {
  return h('span', { class: claim.supported ? 'claim' : 'claim unsupported', title: claim.supported ? null : 'No quote on the cited pages backs this.' },
    claim.text, claim.sources.map((n) => [' ', pill(n)]));
}

// The drafted email or message itself, ready to copy; placeholders such as {{name}} stay for the user to fill.
function drafts(items) {
  if (!items.length) return null;
  return h('section', { class: 'drafts' }, items.map((draft) => {
    const text = [draft.subject ? `Subject: ${draft.subject}` : '', draft.body].filter(Boolean).join('\n\n');
    const copy = h('button', { type: 'button', class: 'btn soft' }, 'Copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
    });
    return h('div', { class: 'draft card' },
      h('p', { class: 'fact-label' }, draft.label || (draft.type === 'email' ? 'Email draft' : 'Message')),
      draft.to ? h('p', { class: 'muted' }, `To: ${draft.to}`) : null,
      h('pre', { class: 'draft-text' }, text),
      copy);
  }));
}

function facts(items) {
  if (!items.length) return null;
  return h('dl', { class: 'facts' }, items.map((fact) => h('div', { class: 'fact' },
    h('dt', {}, fact.label),
    h('dd', {}, fact.value, fact.source ? [' ', h('a', { class: 'fact-source', href: fact.source.url, target: '_blank', rel: 'noopener noreferrer' }, fact.source.domain)] : null))));
}

// What Exa did for this answer, in plain words: the searches, the pages it read, the sentences it checked.
function howFound(task) {
  const t = exaTrail(task);
  if (t.reused) return h('p', { class: 'exa-line' }, 'Used an answer Vali had already checked a few minutes ago.');
  if (!t.searches.length && !t.pages.length && !t.checked) return null;
  const shown = t.pages.slice(0, 8);
  return h('section', { class: 'how card', 'aria-label': 'How Vali found this' },
    h('h2', { class: 'section-title' }, 'How Vali found this'),
    h('ol', { class: 'how-steps' },
      t.searches.length ? h('li', {},
        h('span', { class: 'how-what' }, `Searched the live web with Exa ${t.searches.length === 1 ? 'once' : `${t.searches.length} times`}`),
        h('span', { class: 'how-detail' }, t.searches.slice(0, 3).map((q) => `“${q}”`).join(', ') + (t.searches.length > 3 ? ', …' : ''))) : null,
      t.pages.length ? h('li', {},
        h('span', { class: 'how-what' }, `Read ${t.pages.length} ${t.pages.length === 1 ? 'page' : 'pages'} with Exa`),
        h('span', { class: 'how-detail' }, shown.map((p, i) => [i ? ', ' : '', h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.domain)]),
          t.pages.length > shown.length ? ` and ${t.pages.length - shown.length} more` : '')) : null,
      t.checked ? h('li', {},
        h('span', { class: 'how-what' }, `Checked ${t.checked} ${t.checked === 1 ? 'sentence' : 'sentences'} against the page`),
        h('span', { class: 'how-detail' }, `${t.backed} of ${t.checked} match a quote from today’s page. The numbers link to it.`)) : null,
      t.fill ? h('li', {},
        h('span', { class: 'how-what' }, `Looked up ${t.fill} ${t.fill === 1 ? 'detail' : 'details'} for the form`),
        h('span', { class: 'how-detail' }, 'Exa search from inside the cloud browser.')) : null));
}

function steps(items) {
  if (!items.length) return null;
  return h('details', { class: 'next plan' },
    h('summary', { class: 'section-title' }, `The plan, ${items.length} ${items.length === 1 ? 'step' : 'steps'}`),
    h('ol', { class: 'steps' }, items.map((step) => h('li', { class: 'step' },
      h('span', { class: `who ${step.by.toLowerCase()}` }, step.by),
      h('div', {},
        h('p', { class: 'step-title' }, step.url
          ? h('a', { href: step.url, target: '_blank', rel: 'noopener noreferrer' }, step.title) : step.title),
        step.detail ? h('p', { class: 'step-detail' }, step.detail) : null)))));
}


// The one most useful next errand for this person, from the research; one tap starts it.
function nextErrand(task, { onFollowUp }) {
  const text = String(task.research?.output?.structured?.next_errand || '').trim();
  if (!text) return null;
  return h('button', { type: 'button', class: 'next-errand', onclick: () => onFollowUp(text) },
    h('span', { class: 'next-errand-label' }, 'Next for you'), h('span', { class: 'next-errand-text' }, text));
}
