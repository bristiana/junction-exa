// The state block on top of an errand: the path it takes, where it stands now, and the one thing that moves it on.
import { h } from './dom.js';
import { domainOf, errandStage, linkActions, primaryAction, safeUrl } from './model.js';

export function renderState(task, handlers) {
  const stage = errandStage(task);
  return h('section', { class: `state tone-${stage.tone}`, 'aria-label': 'Where this errand stands' },
    h('ol', { class: 'track' }, stage.stages.map((name, i) => h('li', {
      class: i < stage.at || (i === stage.at && stage.tone === 'done') ? 'past' : i === stage.at ? 'now' : null,
      'aria-current': i === stage.at ? 'step' : null,
    }, name))),
    h('p', { class: 'state-line' }, stage.line),
    stage.next?.hint ? h('p', { class: 'state-hint' }, stage.next.hint) : null,
    next(task, stage, handlers));
}

function next(task, stage, { onExecute, onStop, onApprove, onReply, onFollowUp, onDetails, onResume }) {
  const kind = stage.next?.kind;
  const action = primaryAction(task);
  const fill = (label, cls = 'btn') => action
    ? h('button', { type: 'button', class: cls, onclick: (e) => onExecute(action.index, e.currentTarget) }, label) : null;
  // The page where Vali stopped, so date, time and choices are already picked when the site keeps them in the address.
  const where = safeUrl(task.execution?.current_url) || action?.url;
  const site = where ? h('a', { class: 'btn quiet', href: where, target: '_blank', rel: 'noopener noreferrer' }, `Open ${domainOf(where)}`) : null;
  if (kind === 'fill') return h('div', { class: 'actions' }, fill('Fill it for me'), site);
  if (kind === 'stop') return h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn quiet', onclick: (e) => onStop(e.currentTarget) }, 'Stop'));
  if (kind === 'approve') {
    return h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: (e) => onApprove(e.currentTarget) }, 'Approve'),
      h('button', { type: 'button', class: 'btn quiet', onclick: (e) => onStop(e.currentTarget) }, 'Stop'));
  }
  if (kind === 'reply') return answerBox('Your answer', (text, button) => onReply(text, button));
  if (kind === 'answer') return answerBox('Your answer', (text) => onFollowUp(`${stage.next.question} Answer: ${text}`));
  if (kind === 'refill') {
    if (stage.next.question) return [answerBox('Your answer', (text, button) => onResume(text, button), 'Continue'), h('div', { class: 'actions' }, site)];
    return h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: (e) => onResume('', e.currentTarget) }, 'Continue'), site);
  }
  if (kind === 'done') {
    const links = linkActions(task);
    return [
      links.length ? h('ul', { class: 'options' }, links.map((link) => h('li', {},
        h('a', { class: 'option', href: link.url, target: '_blank', rel: 'noopener noreferrer' },
          h('span', { class: 'option-label' }, link.label), h('span', { class: 'option-site' }, link.domain))))) : null,
      answerBox('Ask a follow-up, e.g. “book the cheapest one”', (text) => onFollowUp(text), 'Ask'),
    ];
  }
  if (kind === 'retry') return h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => onFollowUp(task.task) }, 'Try again'));
  return null;
}

function answerBox(placeholder, send, label = 'Send') {
  const input = h('input', { type: 'text', class: 'reply-input', maxlength: '2000', placeholder, 'aria-label': placeholder });
  return h('form', { class: 'reply', onsubmit: (event) => { event.preventDefault(); const text = input.value.trim(); if (text) send(text, event.submitter); } },
    input, h('button', { type: 'submit', class: 'btn' }, label));
}
