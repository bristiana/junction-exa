// Desktop-only controls decorate the copied panel; upstream renderer remains intact.
window.__desktopErrors = [];
window.addEventListener('error', e => window.__desktopErrors.push(e.message));
window.addEventListener('unhandledrejection', e => window.__desktopErrors.push(String(e.reason)));
const $ = id => document.getElementById(id);
const banner = el('div', '', 'desktop-banner'); banner.hidden = true; banner.setAttribute('role', 'status'); document.body.prepend(banner);
function el(tag, text, className) { const e = document.createElement(tag); if (text) e.textContent = text; if (className) e.className = className; return e; }
function button(text, className, onclick) { const b = el('button', text, className); b.type = 'button'; b.onclick = onclick; return b; }
function showError(text) { banner.replaceChildren(text || ''); banner.hidden = !text; }
async function send(message) { const r = await window.vali.call('message', message); if (!r.ok) throw new Error(r.error); return r.data; }
function openSettings(target) {
  if ($('settings').hidden) $('settingsBtn').click();
  (target || $('settings')).scrollIntoView({ block: 'start' });
}
window.vali.onChange((changes, area) => {
  if (area === 'local' && changes.connectionError) showError(changes.connectionError.newValue ? `${changes.connectionError.newValue} Open Settings to reconnect.` : '');
  if (area === 'session' && changes.newAccount) welcome(changes.newAccount.newValue);
});
window.vali.onState(s => { if (s.paused) showError('Paused. Resume from the menu bar to refresh errands and notifications.'); else if (banner.textContent.startsWith('Paused.')) showError(''); });
window.vali.call('storage:get', { area: 'local', keys: ['connectionError'] }).then(s => showError(s.connectionError || ''));
window.vali.call('storage:get', { area: 'session', keys: ['newAccount'] }).then(s => welcome(s.newAccount));
// First run: a fresh account was made. Offer linking with the extension instead, once.
function welcome(isNew) {
  if (!isNew || !banner.hidden) return;
  banner.replaceChildren('Welcome to Vali. Already use Vali in Chrome? ', button('Link with the extension', 'v-btn v-btn--quiet', () => { showError(''); openSettings(document.querySelector('.desktop-link')); document.getElementById('linkInput')?.focus(); }),
    button('×', 'icon-btn', () => { showError(''); window.vali.call('storage:set', { area: 'session', values: { newAccount: false } }); }));
  banner.lastChild.setAttribute('aria-label', 'Dismiss'); banner.hidden = false;
}

// ---------- settings: plain and short. Browser-only controls hidden, server details under Advanced ----------
$('exaKey').closest('.field').hidden = true;
$('presence').closest('label').hidden = true;
$('backendUrl').required = true;
const serverHeading = $('backendUrl').closest('.field').previousElementSibling.previousElementSibling;
$('backendUrl').closest('.field').previousElementSibling.textContent = 'The server that runs your errands. Change it only for development.';
const credentials = el('div', '', 'desktop-credentials');
credentials.append(el('h3', 'Use an account token'), el('p', 'Paste the account token from another device to share its errands.', 'muted small'));
const token = el('input', '', 'v-input'); token.type = 'password'; token.autocomplete = 'off'; token.placeholder = 'Account token'; token.setAttribute('aria-label', 'Account token');
const useToken = button('Use account', 'v-btn v-btn--quiet', async () => { if (!token.value.trim()) return; useToken.disabled = true; try { await window.vali.call('useToken', { url: $('backendUrl').value, token: token.value.trim() }); token.value = ''; $('backendStatus').textContent = 'Connected to your account'; showError(''); await send({ type: 'poll' }); } catch (error) { showError(error.message.replace(/^Error invoking remote method 'vali': (Error: )?/, '')); } finally { useToken.disabled = false; } });
credentials.append(token, useToken);
const advanced = el('details', '', 'desktop-advanced'); advanced.append(el('summary', 'Advanced'));
for (const node of [serverHeading, serverHeading.nextElementSibling, $('backendUrl').closest('.field'), $('serverPresets')]) advanced.append(node);
advanced.append(credentials, $('effort').closest('.field'));
$('saveSettings').closest('.row').before(advanced);

// Link with the extension: type the extension's code here, or show this Mac's code to type there.
const link = el('div', '', 'desktop-link');
const linkInfo = el('p', '', 'muted small'); linkInfo.id = 'linkInfo'; linkInfo.setAttribute('role', 'status');
const code = el('input', '', 'v-input'); code.type = 'text'; code.id = 'linkInput'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 8; code.placeholder = 'Code from the extension'; code.setAttribute('aria-label', 'Code from the extension');
const linkBtn = button('Link', 'v-btn', async () => {
  linkBtn.disabled = true; linkInfo.textContent = 'Linking…';
  const r = await window.vali.call('link', { code: code.value });
  linkBtn.disabled = false;
  linkInfo.textContent = r.ok ? 'Linked. This Mac and the extension now share your errands.' : r.error;
  if (r.ok) { code.value = ''; $('backendStatus').textContent = 'Connected to your account'; showError(''); }
});
code.onkeydown = e => { if (e.key === 'Enter') linkBtn.click(); };
const showCode = button('Show this Mac’s code', 'v-btn v-btn--quiet', async () => {
  showCode.disabled = true; linkInfo.textContent = 'Getting a code…';
  const r = await window.vali.call('linkCode');
  showCode.disabled = false;
  if (!r.ok) { linkInfo.textContent = r.error; return; }
  const minutes = Math.max(1, Math.round((r.data.expires_in || 600) / 60));
  linkInfo.replaceChildren('Type ', el('code', r.data.code, 'link-code'), ` in the extension’s settings. It works for ${minutes} minute${minutes === 1 ? '' : 's'}.`);
});
const linkRow = el('div', '', 'row'); linkRow.append(code, linkBtn);
link.append(el('h3', 'Link with the extension'), el('p', 'Use one account in Chrome and on this Mac. In the extension, open Settings and show the link code, then type it here.', 'muted small'), linkRow, showCode, linkInfo);
$('pairBtn').closest('.field').before(link);

// Profile: kept on this Mac only (encrypted with the macOS keychain), filled in only when Vali does an errand for you.
const profileHeading = $('profileFields').previousElementSibling.previousElementSibling;
profileHeading.textContent = 'Profile';
$('profileFields').previousElementSibling.textContent = 'Stays on this Mac, locked with your keychain. Vali’s AI only sees placeholders like {{name}}. The real values go to the cloud browser only when you press Let Vali do it, to fill in the form.';
const PERSONAL_ID = ['personal_id', 'Personal ID (henkilötunnus)'];
async function addPersonalId() {
  const box = $('profileFields');
  if (!box.children.length || box.querySelector('[data-k="personal_id"]')) return;
  const { profile = {} } = await window.vali.call('storage:get', { area: 'local', keys: ['profile'] });
  if (box.querySelector('[data-k="personal_id"]')) return;
  const label = el('label'), input = el('input');
  input.type = 'password'; input.autocomplete = 'off'; input.dataset.k = PERSONAL_ID[0]; input.value = profile[PERSONAL_ID[0]] || ''; input.placeholder = 'Only for forms that ask for it';
  label.append(el('span', PERSONAL_ID[1]), input);
  const dob = box.querySelector('[data-k="date_of_birth"]')?.closest('label');
  dob ? dob.after(label) : box.append(label);
}
new MutationObserver(addPersonalId).observe($('profileFields'), { childList: true });
