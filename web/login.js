// The sign-in page (#/login): email and password, the demo account from a shared link,
// continue on this browser, or link WhatsApp with a one-time code.
import { api, session } from './api.js';
import { h, show } from './dom.js';

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
  const form = h('form', { class: 'login-form', onsubmit: (e) => submit(e, false) },
    email, password, error,
    h('div', { class: 'login-buttons' }, h('button', { type: 'submit', class: 'btn' }, 'Sign in')));

  const others = [];
  if (session.hasDemo()) {
    others.push(choice('Open the demo account', 'Bogdan, a master’s student at Aalto, settling in and at Junction. See what Vali did for him. View only.', () => { session.useDemo(); go(); }, true));
  }

  show('login',
    h('div', { class: 'login card' },
      h('div', { class: 'hero-slot login-slot', 'data-slot': 'login' }),
      h('h1', { class: 'login-title' }, 'Sign in to Vali'),
      h('p', { class: 'muted login-sub' }, 'Your valet for life in Finland.'),
      session.hasDemo() ? h('div', { class: 'login-choices' }, others.shift()) : null,
      form,
      h('p', { class: 'muted login-sub' }, 'Vali is closed while the judges try it. Sign in with the account you were sent.'),
      h('p', { class: 'muted login-sub' },
        h('a', { href: '/vali-extension.zip', download: 'vali-extension.zip' }, 'Get the Chrome extension'),
        ': unzip it, open chrome://extensions, turn on Developer mode, choose Load unpacked, then sign in from its settings with the same account.')));
}
