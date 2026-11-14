// "Check a landlord or company": a lookup in the Finnish trade register (PRH / YTJ) with one verdict line.
import { api } from './api.js';
import { h } from './dom.js';
import { companyVerdict, registerUrl } from './hub-model.js';

export function landlordBox() {
  const input = h('input', { type: 'text', class: 'reply-input', maxlength: '200', placeholder: 'Company name, e.g. YIT Oyj', 'aria-label': 'Company name' });
  const button = h('button', { type: 'submit', class: 'btn' }, 'Check');
  const out = h('div', { class: 'verdict-out', 'aria-live': 'polite' });
  const check = async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name || button.disabled) return;
    button.disabled = true;
    out.replaceChildren(h('p', { class: 'muted' }, 'Checking the trade register…'));
    try {
      out.replaceChildren(result(companyVerdict(await api.company(name), name)));
    } catch (error) {
      out.replaceChildren(h('p', { class: 'muted' }, error.status === 429 ? 'Vali is busy. Try again in a few seconds.' : `Couldn't check: ${error.message}`));
    } finally {
      button.disabled = false;
    }
  };
  return h('section', { class: 'landlord card' },
    h('h2', { class: 'section-title' }, 'Check a landlord or company'),
    h('p', { class: 'muted' }, 'Renting from a company? See if it is in the Finnish trade register before you pay a deposit.'),
    h('form', { class: 'reply', onsubmit: check }, input, button),
    out);
}

function result(verdict) {
  return h('div', {},
    h('p', { class: `verdict ${verdict.tone}` }, verdict.line),
    verdict.matches.length ? h('ul', { class: 'matches' }, verdict.matches.map((m) => h('li', {},
      h('a', { href: registerUrl(m.id), target: '_blank', rel: 'noopener noreferrer' }, `${m.name} · ${m.id}`),
      h('span', { class: 'muted' }, m.ceased ? ` · ceased ${m.ceased}` : ' · registered')))) : null,
    h('p', { class: 'fine' }, 'Source: PRH / Finnish Business Information System (YTJ). A match does not prove someone owns the flat, and no match is not proof of fraud.'));
}
