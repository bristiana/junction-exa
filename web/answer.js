// The answer view: cited claims, key facts, next steps, the sources Vali read and how it found them.
import { h, show } from './dom.js';
import { claimsOf, factsOf, runStatus, findStats, missingInfo, primaryAction, publishedStamp, readStamp, sourcesOf, stepsOf } from './model.js';
import { renderExecution } from './execution.js';
import { citePill } from './cite.js';

export function renderAnswer(task, handlers) {
  const research = task.research || {};
  if (research.status !== 'completed') return show('answer', back(), unfinished(task, handlers));
  const sources = sourcesOf(task);
  const claims = claimsOf(task, sources);
  const pill = (n) => citePill(task, sources.find((s) => s.n === n));
  const [first, ...rest] = claims;
  show('answer',
    back(),
    h('div', { class: 'answer-grid' },
      h('div', { class: 'answer-main', lang: task.lang || null },
        h('p', { class: 'eyebrow' }, task.task),
        first ? h('h1', { class: 'headline' }, claimText(first, pill)) : null,
        rest.length ? h('p', { class: 'claims' }, rest.map((claim) => [claimText(claim, pill), ' '])) : null,
        followUp(missingInfo(task), handlers.onFollowUp),
        facts(factsOf(task, sources)),
        steps(stepsOf(task)),
        actions(task, handlers),
        renderExecution(task, handlers)),
      h('aside', { class: 'answer-side' },
        sourceList(task, sources),
        howFound(findStats(task, sources)))));
}

function back() {
  return h('a', { class: 'back', href: '#/' }, '← New errand');
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

function followUp(questions, onFollowUp) {
  if (!questions.length) return null;
  const input = h('input', { type: 'text', class: 'reply-input', maxlength: '2000', placeholder: 'Your answer', 'aria-label': 'Your answer' });
  const send = () => input.value.trim() && onFollowUp(`${questions.join(' ')} Answer: ${input.value.trim()}`);
  return h('div', { class: 'question card' },
    h('p', { class: 'question-text' }, 'Vali needs to know'),
    h('ul', { class: 'question-list' }, questions.map((q) => h('li', {}, q))),
    h('form', { class: 'reply', onsubmit: (event) => { event.preventDefault(); send(); } },
      input, h('button', { type: 'submit', class: 'btn' }, 'Refine')));
}

function facts(items) {
  if (!items.length) return null;
  return h('section', { class: 'facts' }, items.map((fact) => h('div', { class: 'fact card' },
    h('p', { class: 'fact-label' }, fact.label),
    h('p', { class: 'fact-value' }, fact.value),
    fact.source ? h('a', { class: 'fact-source', href: fact.source.url, target: '_blank', rel: 'noopener noreferrer' },
      `${fact.source.n} · ${fact.source.domain}`) : null)));
}

function steps(items) {
  if (!items.length) return null;
  return h('section', { class: 'next' },
    h('h2', { class: 'section-title' }, 'What happens next'),
    h('ol', { class: 'steps' }, items.map((step) => h('li', { class: 'step' },
      h('span', { class: `who ${step.by.toLowerCase()}` }, step.by),
      h('div', {},
        h('p', { class: 'step-title' }, step.url
          ? h('a', { href: step.url, target: '_blank', rel: 'noopener noreferrer' }, step.title) : step.title),
        step.detail ? h('p', { class: 'step-detail' }, step.detail) : null)))));
}

// Fill it for me runs the browser agent on the prepared page; it always stops for your OK before the last step.
function actions(task, { onExecute }) {
  const action = primaryAction(task);
  if (!action) return null;
  const busy = ['starting', 'running', 'awaiting_approval', 'submitting'].includes(runStatus(task));
  return h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'btn', disabled: busy, onclick: (e) => onExecute(action.index, e.currentTarget) }, 'Fill it for me'),
    h('a', { class: 'btn soft', href: action.url, target: '_blank', rel: 'noopener noreferrer' }, `Open ${action.domain}`));
}

function sourceList(task, sources) {
  if (!sources.length) return null;
  return h('section', { class: 'side card' },
    h('h2', { class: 'section-title' }, 'Sources, read today'),
    h('ol', { class: 'sources' }, sources.map((source) => h('li', { class: 'source', id: `source-${source.n}` },
      h('span', { class: 'num' }, String(source.n)),
      h('div', {},
        h('a', { class: 'source-title', href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.title),
        h('p', { class: 'source-meta' },
          source.domain,
          source.official ? h('span', { class: 'tag official' }, 'official') : null,
          source.stale ? h('span', { class: 'tag stale' }, 'may be outdated') : null,
          publishedStamp(source.published) ? h('span', { class: 'stamp' }, publishedStamp(source.published)) : null,
          h('span', { class: 'stamp' }, readStamp(task, source))))))));
}

function howFound(stats) {
  const parts = [
    stats.searches ? [stats.searches, stats.searches === 1 ? 'Exa search' : 'Exa searches'] : null,
    [stats.pages, stats.pages === 1 ? 'page read' : 'pages read'],
    [`${stats.seconds} s`, 'start to answer'],
    stats.cost == null ? null : [`$${stats.cost.toFixed(3)}`, 'Exa cost'],
  ].filter(Boolean);
  return h('section', { class: 'side card' },
    h('h2', { class: 'section-title' }, 'How Vali found this'),
    h('dl', { class: 'found' }, parts.map(([value, label]) => h('div', {}, h('dt', {}, String(value)), h('dd', {}, label)))));
}
