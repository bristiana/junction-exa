// Vali in the corner: a fixed button at the bottom right that opens a small "Ask Vali anything" bubble. The errand
// starts through the same call as the home ask box; the bubble follows it and shows the first sentences of the answer
// with a link to the full answer view. The mascot (mascot.js) walks onto the button whenever he is not in a slot.
import { api } from './api.js';
import { h } from './dom.js';
import { TERMINAL, activityLine, activityOf, claimsOf, errandStatus, moodOf, questionOf, sentences, sourcesOf, structured } from './model.js';

const POLL_MS = 1500;
const SEND_ICON = 'M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z';
const CHAT_ICON = 'M12 3C6.5 3 2 6.6 2 11c0 2.5 1.4 4.7 3.7 6.2L5 21l4-2.3c1 .2 2 .3 3 .3 5.5 0 10-3.6 10-8s-4.5-8-10-8Z';

export function createAskDock({ start, mascot }) {
  const input = h('input', { id: 'dock-input', type: 'text', maxlength: '2000', autocomplete: 'off', enterkeyhint: 'send', placeholder: 'Ask Vali anything' });
  const send = h('button', { type: 'submit', class: 'dock-send', 'aria-label': 'Ask' }, svg(SEND_ICON));
  const form = h('form', { class: 'dock-ask' }, h('label', { class: 'sr-only', for: 'dock-input' }, 'Ask Vali anything'), input, send);
  const body = h('div', { class: 'dock-body', 'aria-live': 'polite' });
  const close = h('button', { type: 'button', class: 'dock-close', 'aria-label': 'Close' }, '×');
  const bubble = h('div', { id: 'dock-bubble', class: 'dock-bubble', role: 'dialog', 'aria-labelledby': 'dock-title', hidden: true },
    h('div', { class: 'dock-head' }, h('p', { id: 'dock-title', class: 'dock-title' }, 'Ask Vali'), close),
    form, body);
  const button = h('button', { type: 'button', class: 'dock-btn', 'aria-label': 'Ask Vali anything', 'aria-expanded': 'false', 'aria-controls': 'dock-bubble' },
    h('span', { class: 'dock-pad', 'aria-hidden': 'true' }), h('span', { class: 'dock-glyph', 'aria-hidden': 'true' }, svg(CHAT_ICON)));
  const dock = h('div', { class: mascot ? 'dock has-buddy' : 'dock', hidden: !!mascot }, bubble, button);
  document.body.append(dock);
  mascot?.attachDock(dock);

  let current = null; // { id, timer, done }

  function openBubble() {
    bubble.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    mascot?.holdDock(true);
    if (!current || current.done) mascot?.pose('listening');
    input.focus();
  }

  function closeBubble(restoreFocus = true) {
    if (bubble.hidden) return;
    bubble.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    mascot?.holdDock(false);
    if (!current || current.done) mascot?.pose(null);
    if (restoreFocus && !dock.hidden) button.focus();
  }

  button.addEventListener('click', () => (bubble.hidden ? openBubble() : closeBubble()));
  close.addEventListener('click', () => closeBubble());
  dock.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); closeBubble(); }
  });
  document.addEventListener('pointerdown', (event) => { if (!dock.contains(event.target)) closeBubble(false); });
  addEventListener('hashchange', () => closeBubble(false));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || form.classList.contains('busy')) return;
    stop();
    form.classList.add('busy');
    mascot?.pose('thinking');
    thinking('Starting your errand');
    try {
      const task = await start(text);
      input.value = '';
      current = { id: task.id, timer: 0, done: false };
      show(task);
    } catch (error) {
      mascot?.pose(null);
      body.replaceChildren(h('p', { class: 'dock-error' }, `Couldn't start: ${error.message}`));
    } finally {
      form.classList.remove('busy');
    }
  });

  function stop() {
    if (current) clearTimeout(current.timer);
    current = null;
  }

  async function poll(followed) {
    if (current !== followed) return;
    try {
      show(await api.task(followed.id));
    } catch (error) {
      if (current !== followed) return;
      followed.timer = setTimeout(() => poll(followed), error.status === 429 ? (error.retryAfter || 10) * 1000 : POLL_MS * 2);
    }
  }

  // Thinking while the research runs; the first one or two sentences once it is done, or what it waits for.
  function show(task) {
    const followed = current;
    if (!followed || followed.id !== task.id) return;
    const research = task.research || {};
    const question = questionOf(task);
    if (!TERMINAL.has(research.status) && !question) {
      mascot?.pose(moodOf(task));
      const last = activityOf(task).at(-1);
      thinking(last ? activityLine(last) : 'Reading the official pages');
      followed.timer = setTimeout(() => poll(followed), POLL_MS);
      return;
    }
    followed.done = true;
    mascot?.pose(bubble.hidden ? null : moodOf(task));
    const link = h('a', { class: 'dock-open', href: `#/t/${encodeURIComponent(task.id)}` }, 'Open');
    if (question) return answer(question.text, link, 'Needs your answer');
    if (research.status !== 'completed') {
      const status = errandStatus(task);
      return answer(status.detail || 'The research service did not answer.', link, status.word);
    }
    const claims = claimsOf(task, sourcesOf(task)).map((c) => c.text);
    const lines = (claims.length ? claims : sentences(structured(task).answer)).slice(0, 2).join(' ');
    answer(lines || 'Done. The full answer is ready.', link, 'Answer');
  }

  function thinking(line) {
    body.replaceChildren(h('div', { class: 'dock-thinking' },
      h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', {}, h('b', {}, 'Vali is on it. '), h('span', { class: 'dock-step' }, line))));
  }

  function answer(text, link, word) {
    body.replaceChildren(h('div', { class: 'dock-answer' },
      h('p', { class: 'dock-word' }, word),
      h('p', { class: 'dock-text' }, text),
      link));
  }

  return { open: openBubble, close: closeBubble };
}

function svg(path) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  node.append(shape);
  return node;
}
