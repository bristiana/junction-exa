// The WhatsApp sheet: a one-time code that links this account to the WhatsApp chat with Vali.
import { api } from './api.js';
import { h, show } from './dom.js';

// The wa.me link that opens the chat with "link <code>" ready to send. Empty when no number is set.
export function whatsappUrl(number, code) {
  const digits = String(number || '').replace(/\D/g, '');
  return digits && code ? `https://wa.me/${digits}?text=${encodeURIComponent('link ' + code)}` : '';
}

export async function openWhatsapp() {
  const sheet = document.getElementById('whatsapp');
  show('whatsapp-body', h('p', { class: 'muted', role: 'status' }, 'Getting your code.'));
  sheet.showModal();
  try {
    const { code, whatsapp } = await api.pair();
    const url = whatsappUrl(whatsapp, code);
    show('whatsapp-body',
      h('p', { class: 'pair-code' }, code),
      h('p', {}, `Send this to Vali on WhatsApp: link ${code}`),
      url ? h('div', { class: 'actions' },
        h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open WhatsApp')) : null,
      h('p', { class: 'muted' }, 'The code works for 10 minutes.'),
      h('p', { class: 'muted' }, 'Write first: Vali can answer for 24 hours after your last message.'));
  } catch {
    show('whatsapp-body', h('p', { class: 'muted', role: 'alert' }, 'Could not get a code. Try again.'));
  }
}
