// The sign-in page (#/login): email and password, the demo account from a shared link,
// continue on this browser, or link WhatsApp with a one-time code.
import { api, session } from './api.js';
import { h, show } from './dom.js';
import { openWhatsapp } from './whatsapp.js';

// Setting the hash to the one already open fires no hashchange, so the route runs by hand.
function goTo(next) {
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = next;
}

export function renderLogin(next = '#/dashboard') {
  const go = () => { session.markSignedIn(); goTo(next); };
  const choice = (title, detail, onclick, primary = false) =>
    h('button', { type: 'button', class: `login-choice${primary ? ' primary' : ''}`, onclick },
      h('span', { class: 'login-choice-title' }, title), h('span', { class: 'login-choice-detail' }, detail));

  const email = h('input', { type: 'email', class: 'login-input', autocomplete: 'email', placeholder: 'Email', 'aria-label': 'Email', required: true });
  const password = h('input', { type: 'password', class: 'login-input', autocomplete: 'current-password', placeholder: 'Password (8 or more characters)', 'aria-label': 'Password', minlength: '8', required: true });
  const error = h('p', { class: 'login-error', role: 'alert', hidden: true });
  const fail = (text) => { error.textContent = text; error.hidden = false; };
  const submit = async (event, create) => {
    event.preventDefault();
    error.hidden = true;
    if (!email.value.trim() || password.value.length < 8) return fail('Enter your email and a password of 8 or more characters.');
    const button = event.submitter || event.target;
    button.disabled = true;
    try {
      if (create) {
        if (session.hasDemo() || !session.hasAccount()) { session.reset(); await session.ensureAccount(); }
        await api.register(email.value.trim(), password.value);
      } else {
        const { token } = await api.login(email.value.trim(), password.value);
        session.useToken(token);
      }
      go();
    } catch (err) {
      fail(err.message || 'Something went wrong. Try again.');
    } finally {
      button.disabled = false;
    }
  };
  const create = h('button', { type: 'button', class: 'btn quiet', onclick: (e) => submit(e, true) }, 'Create account');
  const form = h('form', { class: 'login-form', onsubmit: (e) => submit(e, false) },
    email, password, error,
    h('div', { class: 'login-buttons' }, h('button', { type: 'submit', class: 'btn' }, 'Sign in'), create));

  const others = [];
  if (session.hasDemo()) {
    others.push(choice('Open the demo account', 'Bogdan, a student from Romania, just landed for Junction. See what Vali did for him.', () => { session.useDemo(); go(); }, true));
  } else if (session.hasAccount()) {
    others.push(choice('Continue on this browser', 'Your errands so far, no sign-in needed.', go));
  }
  others.push(choice('Continue with WhatsApp', 'Get a code, send it to Vali, and your chats show up here.', async () => {
    await session.ensureAccount();
    session.markSignedIn();
    document.getElementById('whatsapp').addEventListener('close', () => goTo(next), { once: true });
    openWhatsapp();
  }));

  show('login',
    h('div', { class: 'login card' },
      h('div', { class: 'hero-slot login-slot', 'data-slot': 'login' }),
      h('h1', { class: 'login-title' }, 'Sign in to Vali'),
      h('p', { class: 'muted login-sub' }, 'Your valet for life in Finland.'),
      session.hasDemo() ? h('div', { class: 'login-choices' }, others.shift()) : null,
      form,
      h('p', { class: 'login-or' }, 'or'),
      h('div', { class: 'login-choices' }, others)));
}
