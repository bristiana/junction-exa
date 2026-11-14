// The sign-in page (#/login): open the demo account from a shared link, continue on this browser,
// link WhatsApp with a one-time code, or start a new account. Nothing here asks for a password or an email.
import { api, session } from './api.js';
import { h, show } from './dom.js';
import { openWhatsapp } from './whatsapp.js';

export function renderLogin(next = '#/dashboard') {
  const go = () => { session.markSignedIn(); location.hash = next; };
  const choice = (title, detail, onclick, primary = false) =>
    h('button', { type: 'button', class: `login-choice${primary ? ' primary' : ''}`, onclick },
      h('span', { class: 'login-choice-title' }, title), h('span', { class: 'login-choice-detail' }, detail));
  const options = [];
  if (session.hasDemo()) {
    options.push(choice('Open the demo account', 'Ana just landed for Junction. See everything Vali did for her.', () => { session.useDemo(); go(); }, true));
  }
  if (session.hasAccount() && !session.hasDemo()) {
    options.push(choice('Continue', 'Your errands on this browser.', go, true));
  }
  options.push(choice('Continue with WhatsApp', 'Get a code, send it to Vali, and your chats show up here.', async () => {
    await session.ensureAccount();
    session.markSignedIn();
    const sheet = document.getElementById('whatsapp');
    sheet.addEventListener('close', () => { location.hash = next; }, { once: true });
    openWhatsapp();
  }));
  options.push(choice('New account', 'Start fresh. No email, no password.', async () => { session.reset(); await session.ensureAccount(); go(); }));
  show('login',
    h('div', { class: 'login card' },
      h('div', { class: 'hero-slot login-slot', 'data-slot': 'login' }),
      h('h1', { class: 'login-title' }, 'Sign in to Vali'),
      h('p', { class: 'muted login-sub' }, 'Your valet for life in Finland.'),
      h('div', { class: 'login-choices' }, options)));
}
