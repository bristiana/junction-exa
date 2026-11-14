// "How Vali handles your details": the promises, and every page Vali touched for the errand that is open.
import { h, show } from './dom.js';
import { pagesTouched } from './model.js';

export function openTrust(task) {
  const sheet = document.getElementById('trust');
  const pages = task ? pagesTouched(task) : [];
  show('trust-body',
    h('ul', { class: 'promises' },
      promise('The AI sees placeholders, not you.', 'For what you save in Your details, the AI only sees placeholders like {{name}}. Your details stay in this browser. When you press Fill it for me, they go to Vali’s cloud browser for that one form and are not stored.'),
      promise('Errand text is not hidden.', 'What you type in an errand is sent as text to the AI and the search. Don’t type ID numbers there; save details in Your details instead.'),
      promise('Nothing goes out without your OK.', 'Vali prepares forms, emails and bookings, then stops. It never submits, pays or sends anything until you press Approve.'),
      promise('Your first-weeks choices stay here.', 'EU/non-EU, degree/exchange and your ticks are saved in this browser only. When you press Ask Vali on a step, those two choices are written into the errand text.'),
      promise('Every fact shows its page.', 'Each claim carries the number of the official page it came from, with the quote when Vali found one.')),
    h('h3', { class: 'section-title' }, task ? 'Pages Vali touched for this errand' : 'Pages Vali touched'),
    !task ? h('p', { class: 'muted' }, 'Open an errand to see every page Vali read or opened for it.')
      : pages.length ? h('ul', { class: 'touched' }, pages.map((page) => h('li', {},
        h('a', { href: page.url, target: '_blank', rel: 'noopener noreferrer' }, page.url.replace(/^https?:\/\/(www\.)?/, '')),
        h('span', { class: 'muted' }, ` · ${page.how}`))))
      : h('p', { class: 'muted' }, 'No pages yet.'));
  sheet.showModal();
}

function promise(title, detail) {
  return h('li', {}, h('p', { class: 'promise-title' }, title), h('p', { class: 'muted' }, detail));
}
