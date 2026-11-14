// The welcome card on first run: what Vali does, the three ways to give him an errand, a sample errand and linking
// with the extension. Main decides when it shows (welcome.mjs); this only draws it and passes on the clicks.
import { keyLabel } from '../welcome.mjs';
const $ = id => document.getElementById(id);

export function showWelcome(s) {
  const on = !!s?.welcome;
  $('welcome').hidden = !on; $('box').classList.toggle('welcoming', on);
  if (!on) return;
  $('welcomeType').textContent = keyLabel(s.shortcuts?.quick, 'Alt+Space');
  $('welcomeTalk').textContent = keyLabel(s.shortcuts?.voice, 'Alt+Shift+Space');
}
$('welcomeSample').onclick = () => window.vali.call('welcome', 'sample');
$('welcomeLink').onclick = () => window.vali.call('welcome', 'link');
$('welcomeClose').onclick = () => window.vali.call('welcome', 'close');
