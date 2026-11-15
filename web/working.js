// The working state: the errand, a running clock, the live list of what Exa is doing, and any question for the user.
import { h, show } from './dom.js';
import { activityLine, activityOf, clock, elapsedSeconds, exaTrail, questionOf, researchStage } from './model.js';

let announced = '';

export function renderWorking(task, { onReply, onCancel }) {
  const lines = activityOf(task).slice(-8);
  announce(lines.at(-1));
  show('working',
    h('div', { class: 'stage-slot', 'data-slot': 'working' }),
    h('p', { class: 'eyebrow' }, 'Working on'),
    h('h2', { class: 'errand-title' }, task.task),
    h('p', { class: 'clock', id: 'clock' }, timerText(task)),
    stages(task),
    h('p', { class: 'trail-label' }, 'Right now'),
    h('ol', { class: 'trail' },
      lines.length ? lines.map(trailItem) : h('li', { class: 'trail-item pending' }, 'Asking Exa where the official answer lives…')),
    questionBlock(questionOf(task), onReply),
    h('button', { type: 'button', class: 'btn quiet', onclick: (e) => onCancel(e.currentTarget) }, 'Stop this errand'));
}

// The three things Vali does before it answers, with the Exa feature behind each; the current one is lit.
const STAGES = [
  ['Search the web', 'Exa Search finds the official pages'],
  ['Read the pages', 'Exa Contents reads today’s version'],
  ['Check every sentence', 'Each sentence must match a quote'],
];

function stages(task) {
  const at = researchStage(task);
  const trail = exaTrail(task);
  const counts = [
    trail.searches.length ? `${trail.searches.length} ${trail.searches.length === 1 ? 'search' : 'searches'}` : '',
    trail.pages.length ? `${trail.pages.length} ${trail.pages.length === 1 ? 'page' : 'pages'}` : '',
    '',
  ];
  return h('ol', { class: 'stages', 'aria-label': 'What Vali is doing' }, STAGES.map(([title, detail], i) =>
    h('li', { class: `stage ${i < at ? 'done' : i === at ? 'now' : 'next'}`, 'aria-current': i === at ? 'step' : null },
      h('span', { class: 'stage-mark', 'aria-hidden': 'true' }, i < at ? '✓' : String(i + 1)),
      h('span', { class: 'stage-title' }, title),
      h('span', { class: 'stage-detail' }, counts[i] && i <= at ? `${detail} · ${counts[i]}` : detail))));
}

// Screen readers hear only the newest step, once, not the whole rebuilt list.
function announce(line) {
  const text = line ? activityLine(line) : '';
  if (!text || text === announced) return;
  announced = text;
  document.getElementById('announce').textContent = text;
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
  const submit = (text, button) => text.trim() && onReply(text.trim(), button);
  return h('div', { class: 'question card' },
    h('p', { class: 'question-text' }, question.text),
    question.options.length ? h('div', { class: 'chips' },
      question.options.map((option) => h('button', { type: 'button', class: 'chip', onclick: (e) => submit(option, e.currentTarget) }, option))) : null,
    h('form', { class: 'reply', onsubmit: (event) => { event.preventDefault(); submit(input.value, event.submitter); } },
      input, h('button', { type: 'submit', class: 'btn' }, 'Send')));
}
