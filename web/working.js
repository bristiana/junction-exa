// The working state: the errand, a running clock, the live list of what Exa is doing, and any question for the user.
import { h, show } from './dom.js';
import { activityLine, activityOf, clock, elapsedSeconds, questionOf } from './model.js';

export function renderWorking(task, { onReply, onCancel }) {
  const lines = activityOf(task).slice(-8);
  show('working',
    h('div', { class: 'stage-slot', 'data-slot': 'working' }),
    h('p', { class: 'eyebrow' }, 'Working on'),
    h('h2', { class: 'errand-title' }, task.task),
    h('p', { class: 'clock', id: 'clock' }, timerText(task)),
    h('ol', { class: 'trail', 'aria-live': 'polite' },
      lines.length ? lines.map(trailItem) : h('li', { class: 'trail-item pending' }, 'Asking Exa where the official answer lives…')),
    questionBlock(questionOf(task), onReply),
    h('button', { type: 'button', class: 'btn quiet', onclick: onCancel }, 'Stop this errand'));
}

// The clock ticks between polls without redrawing the list.
export function tickClock(task) {
  const node = document.getElementById('clock');
  if (node) node.textContent = timerText(task);
}

function timerText(task) {
  return `${clock(elapsedSeconds(task))} · usually under 30 s`;
}

function trailItem(line) {
  return h('li', { class: `trail-item ${line.kind}` }, h('span', { class: 'dot', 'aria-hidden': 'true' }), activityLine(line));
}

// Quick replies plus a free text box; both go to POST /v1/tasks/{id}/messages.
export function questionBlock(question, onReply) {
  if (!question) return null;
  const input = h('input', { type: 'text', class: 'reply-input', maxlength: '2000', placeholder: 'Type your answer', 'aria-label': 'Your answer' });
  const submit = (text) => text.trim() && onReply(text.trim());
  return h('div', { class: 'question card' },
    h('p', { class: 'question-text' }, question.text),
    question.options.length ? h('div', { class: 'chips' },
      question.options.map((option) => h('button', { type: 'button', class: 'chip', onclick: () => submit(option) }, option))) : null,
    h('form', { class: 'reply', onsubmit: (event) => { event.preventDefault(); submit(input.value); } },
      input, h('button', { type: 'submit', class: 'btn' }, 'Send')));
}
