// Desktop-only controls decorate the copied panel; upstream renderer remains intact.
window.__desktopErrors = [];
window.addEventListener('error', e => window.__desktopErrors.push(e.message));
window.addEventListener('unhandledrejection', e => window.__desktopErrors.push(String(e.reason)));
const $ = id => document.getElementById(id);
const banner = el('div', '', 'desktop-banner'); banner.hidden = true; banner.setAttribute('role', 'status'); document.body.prepend(banner);
function el(tag, text, className) { const e = document.createElement(tag); if (text) e.textContent = text; if (className) e.className = className; return e; }
function showError(text) { banner.textContent = text; banner.hidden = !text; }
async function send(message) { const r = await window.vali.call('message', message); if (!r.ok) throw new Error(r.error); return r.data; }
window.vali.onChange((changes, area) => {
  if (area === 'local' && changes.connectionError) showError(changes.connectionError.newValue ? `${changes.connectionError.newValue} Open Settings to reconnect.` : '');
});
window.vali.onState(s => { if (s.paused) showError('Paused. Resume from the menu bar to refresh errands and notifications.'); else if (banner.textContent.startsWith('Paused.')) showError(''); });
window.vali.call('storage:get', { area: 'local', keys: ['connectionError'] }).then(s => showError(s.connectionError || ''));
// Hide browser/direct-Exa controls. The existing profile and WhatsApp pairing stay available.
$('exaKey').closest('.field').hidden = true;
$('presence').closest('label').hidden = true;
$('backendUrl').required = true;
$('backendUrl').closest('.field').previousElementSibling.textContent = 'Your errands are shared with WhatsApp through this server.';
const credentials = el('div', '', 'desktop-credentials');
credentials.append(el('h3', 'Use an existing account'), el('p', 'Paste the same account token to see errands from your other devices. Leave this blank for a new account.', 'muted small'));
const token = el('input'); token.type = 'password'; token.autocomplete = 'off'; token.placeholder = 'Existing account token'; token.setAttribute('aria-label', 'Existing account token');
const useToken = el('button', 'Use account', 'btn ghost small'); useToken.type = 'button';
useToken.onclick = async () => { if (!token.value.trim()) return; useToken.disabled = true; try { await window.vali.call('useToken', { url: $('backendUrl').value, token: token.value.trim() }); token.value = ''; $('backendStatus').textContent = 'Connected to your account'; showError(''); await send({ type: 'poll' }); } catch (error) { showError(error.message); } finally { useToken.disabled = false; } };
credentials.append(token, useToken); $('backendUrl').closest('.field').after(credentials);
