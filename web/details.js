// The "Your details" sheet: the profile Fill it for me sends with that one form. Kept in this browser only.
import { h, show } from './dom.js';
import { PROFILE_FIELDS, deleteProfile, loadProfile, saveProfile } from './profile.js';

const AUTOCOMPLETE = {
  name: 'name', email: 'email', phone: 'tel', address: 'street-address', postal_code: 'postal-code',
  city: 'address-level2', country: 'country-name', date_of_birth: 'bday',
};

export function openDetails(needed = []) {
  const sheet = document.getElementById('details');
  const profile = loadProfile();
  const status = h('p', { class: 'muted details-status', role: 'status' });
  const inputs = PROFILE_FIELDS.map(([key, label]) => h('label', { class: 'detail-field' },
    h('span', {}, label),
    h('input', { type: key === 'email' ? 'email' : 'text', name: key, value: profile[key] || '', autocomplete: AUTOCOMPLETE[key] || 'off', maxlength: '200' })));
  const values = () => Object.fromEntries(inputs.map((label) => {
    const input = label.querySelector('input');
    return [input.name, input.value];
  }));
  show('details-body',
    h('p', { class: 'muted details-intro' },
      'Saved only in this browser. Sent only when you press Fill it for me, for that one form, and not stored by Vali. The AI sees placeholders like {{name}}, not these values.'),
    needed.length ? h('p', { class: 'details-needed' }, `This form needs: ${needed.map((d) => d.label.toLowerCase()).join(', ')}.`) : null,
    h('form', { class: 'details-form', onsubmit: (event) => {
      event.preventDefault();
      status.textContent = saveProfile(values()) ? 'Saved in this browser.' : 'This browser can’t keep them (private window?).';
    } },
      inputs,
      h('div', { class: 'actions' },
        h('button', { type: 'submit', class: 'btn' }, 'Save'),
        h('button', { type: 'button', class: 'btn quiet', onclick: () => {
          deleteProfile();
          for (const label of inputs) label.querySelector('input').value = '';
          status.textContent = 'Deleted from this browser.';
        } }, 'Delete my details'))),
    status);
  sheet.showModal();
  (inputs.find((label) => needed.some((d) => d.key === label.querySelector('input').name)) || inputs[0]).querySelector('input').focus();
}
