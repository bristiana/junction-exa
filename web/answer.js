// The answer view: cited claims, key facts, next steps, the sources Vali read and how it found them.
import { h, show } from './dom.js';
import { claimsOf, detailsOf, draftsOf, pageKind, errandStage, exaTrail, factsOf, fillBlanks, needsOf, plainError, quoteUrl, readableTitle, shorten, sourcesOf, stepsOf } from './model.js';
import { bookingCard, exaHelped, needsBlock, watchCard, watchMatchList } from './kinds.js';
import { citePill } from './cite.js';
import { renderState } from './state.js';
import { loadProfile, missingDetails } from './profile.js';

// One errand, shaped by what it is: the card that matters most on top, the research below it, the plan folded.
// Answers lead with the answer; bookings and forms with the booking; watches with the watch; drafts with the draft.
export function renderAnswer(task, handlers) {
  const research = task.research || {};
  if (research.status !== 'completed') return show('answer', back(), unfinished(task, handlers));
  const kind = pageKind(task);
  const sources = sourcesOf(task);
  const claims = claimsOf(task, sources);
  const pill = (n) => citePill(task, sources.find((s) => s.n === n));
  const [first, ...rest] = claims;
  const allFacts = factsOf(task, sources);
  const head = [h('h1', { class: 'errand-title' }, readableTitle(task.task)), meta(task)];
  const asking = errandStage(task).next?.kind === 'answer'; // the needs block holds the answer box, so Now drops it
  const needs = needsBlock(task, handlers, { inline: kind !== 'form' });
  const needed = needs ? needsOf(task, missingDetails(task, loadProfile())) : [];
  const blocking = needed.some((item) => item.kind !== 'bring');
  // A question in the needs block is answered there only; the state block below keeps just its buttons.
  if (needed.some((item) => item.kind === 'question')) handlers = { ...handlers, askedAbove: true };
  let body;
  if (kind === 'form') {
    body = [
      blocking ? needs : null,
      bookingCard(task, handlers),
      blocking ? null : needs,
      exaHelped(task),
      h('section', { class: 'found-short' },
        h('h2', { class: 'section-title' }, 'Good to know'),
        first ? h('p', { class: 'headline small' }, claimText(first, pill)) : null,
        facts(allFacts.slice(0, 3))),
      drafts(draftsOf(task)),
      steps(stepsOf(task))];
  } else if (kind === 'watch') {
    const found = claims.filter((c) => c.sources.length);
    body = [
      watchCard(task),
      needs,
      watchMatchList(task),
      found.length ? h('p', { class: 'claims' }, found.map((claim) => [claimText(claim, pill), ' '])) : null,
      howFound(task),
      steps(stepsOf(task))];
  } else {
    const draftFirst = kind === 'draft';
    body = [
      blocking ? needs : null,
      asking ? null : now(task, handlers),
      draftFirst ? drafts(draftsOf(task)) : null,
      first ? h('p', { class: draftFirst ? 'headline small' : 'headline big' }, claimText(first, pill)) : null,
      rest.length ? h('p', { class: 'claims' }, rest.map((claim) => [claimText(claim, pill), ' '])) : null,
      facts(allFacts.slice(0, 5)),
      blocking ? null : needs,
      draftFirst ? null : drafts(draftsOf(task)),
      howFound(task),
      nextErrand(task, handlers),
      steps(stepsOf(task))];
  }
  show('answer', back(), h('div', { class: `answer-main kind-${kind}`, lang: task.lang || null }, head, body));
}

// Where an answer stands, without the two-step track: one status word, the links, a follow-up.
// A booking errand that ended on an answer says so: the answer is found, nothing is booked.
function now(task, handlers) {
  const stage = errandStage(task);
  const booking = ['book', 'write', 'claim'].includes(task.mode);
  const word = stage.tone === 'done' ? (booking ? 'Answer found, not booked' : 'Answered') : null;
  const line = stage.tone === 'done' && booking ? 'Nothing was booked or sent. Use the link to do it yourself, or ask Vali.' : null;
  const state = renderState(task, handlers);
  const head = word ? h('div', { class: 'now-head' }, h('span', { class: `kind-badge ${booking ? 'tone-ready' : 'tone-done'}` }, word),
    line ? h('span', { class: 'now-line' }, line) : null) : null;
  if (head && state.prepend) state.prepend(head);
  return h('div', { class: 'kind-now' }, state);
}

// One small line under the title: the channel and time it came in, the page, the saved details shared, answers given.
function meta(task) {
  const via = { whatsapp: 'WhatsApp', web: 'Web', api: 'Web', extension: 'Chrome', voice: 'Call' }[task.channel || task.source] || 'Web';
  const when = task.created_at ? new Date(task.created_at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const known = detailsOf(task);
  const answered = task.research?.question?.answer ? [task.research.question.text, task.research.question.answer] : null;
  const page = task.page && (task.page.title || task.page.url);
  const item = (label, value) => h('span', { class: 'meta-item' }, h('span', { class: 'meta-k' }, label), h('span', {}, value));
  return h('p', { class: 'errand-meta' },
    h('span', { class: 'meta-item' }, `${via}${when ? `, ${when}` : ''}`),
    page ? item('Page', page) : null,
    known.length ? item('Your details', known.join(', ')) : null,
    answered ? item(answered[0], answered[1]) : null);
}



function back() {
  return h('a', { class: 'back', href: '#/' }, '← Your errands');
}

function unfinished(task, { onFollowUp }) {
  const cancelled = task.research?.status === 'cancelled';
  return h('div', { class: 'card unfinished' },
    h('p', { class: 'eyebrow' }, task.task),
    h('h1', { class: 'headline' }, cancelled ? 'Stopped. Nothing was sent.' : "Couldn't finish this one."),
    h('p', { class: 'muted' }, cancelled ? 'You stopped this errand before Vali answered.' : plainError(task.research?.error) || 'The research service did not answer.'),
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
    const profile = loadProfile();
    const text = fillBlanks([draft.subject ? `Subject: ${draft.subject}` : '', draft.body].filter(Boolean).join('\n\n'), profile);
    const copy = h('button', { type: 'button', class: 'btn soft' }, 'Copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
    });
    const pre = h('pre', { class: text.length > 360 ? 'draft-text folded' : 'draft-text' }, text);
    const more = text.length > 360 ? h('button', { type: 'button', class: 'btn quiet' }, 'Show all') : null;
    more?.addEventListener('click', () => { pre.classList.remove('folded'); more.remove(); });
    return h('div', { class: 'draft card' },
      h('p', { class: 'draft-label' }, draft.label || (draft.type === 'email' ? 'Email draft' : 'Message')),
      draft.to ? h('p', { class: 'draft-to' }, `To: ${fillBlanks(draft.to, profile)}`) : null,
      pre,
      h('div', { class: 'actions' }, copy, more));
  }));
}

function facts(items) {
  if (!items.length) return null;
  return h('dl', { class: 'facts' }, items.map((fact) => h('div', { class: 'fact' },
    h('dt', {}, fact.label),
    h('dd', {}, foldable(fact.value), fact.source ? [' ', h('a', { class: 'fact-source', href: quoteUrl(fact.source.url, fact.source.quote) || fact.source.url, target: '_blank', rel: 'noopener noreferrer' }, fact.source.domain)] : null))));
}

// A long value shows its first sentence; the rest folds behind More.
export function foldable(text) {
  const short = shorten(text, 130);
  if (short === text) return text;
  return h('details', { class: 'fold' }, h('summary', {}, short, h('span', { class: 'fold-more' }, 'More')), h('span', { class: 'fold-full' }, text));
}

// What Exa did for this answer, in plain words: the searches, the pages it read, the sentences it checked.
function howFound(task) {
  const t = exaTrail(task);
  if (t.reused) return h('p', { class: 'exa-line' }, 'Used an answer Vali had already checked a few minutes ago.');
  if (!t.searches.length && !t.pages.length && !t.checked) return null;
  const sites = [];  // one link per site, with how many of its pages were read
  for (const page of t.pages) {
    const site = sites.find((x) => x.domain === page.domain);
    if (site) site.n += 1; else sites.push({ ...page, n: 1 });
  }
  const shown = sites.slice(0, 8);
  return h('section', { class: 'how card', 'aria-label': 'How Vali found this' },
    h('h2', { class: 'section-title' }, 'How Vali found this'),
    h('ol', { class: 'how-steps' },
      t.searches.length ? h('li', {},
        h('span', { class: 'how-what' }, `Searched the live web with Exa ${t.searches.length === 1 ? 'once' : `${t.searches.length} times`}`),
        h('span', { class: 'how-detail' }, t.searches.slice(0, 3).map((q) => `“${q}”`).join(', ') + (t.searches.length > 3 ? ', …' : ''))) : null,
      t.pages.length ? h('li', {},
        h('span', { class: 'how-what' }, `Read ${t.pages.length} ${t.pages.length === 1 ? 'page' : 'pages'} with Exa`),
        h('span', { class: 'how-detail' }, shown.map((p, i) => [i ? ', ' : '', h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.domain), p.n > 1 ? ` (${p.n})` : '']),
          sites.length > shown.length ? ` and ${sites.length - shown.length} more sites` : '')) : null,
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
