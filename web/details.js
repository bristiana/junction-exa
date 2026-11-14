// The "Your details" sheet: the profile Fill it for me sends with that one form. Kept in this browser only.
import { api } from './api.js';
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
      'Stays on this device. Vali asks before using it.'),
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
    status,
    situationForm());
  sheet.showModal();
  (inputs.find((label) => needed.some((d) => d.key === label.querySelector('input').name)) || inputs[0]).querySelector('input').focus();
}

// "Your situation": who Vali answers for. Saved on your account (nothing here identifies you), so WhatsApp uses it too.
const CHOICES = [
  ['citizenship', 'Citizenship', [['eu', 'EU or EEA'], ['nordic', 'Nordic'], ['non_eu', 'Outside the EU']]],
  ['student', 'Student', [[true, 'Yes'], [false, 'No']]],
  ['has_personal_id', 'Finnish personal ID', [[true, 'Yes'], [false, 'Not yet']]],
  ['has_bank', 'Finnish bank account', [[true, 'Yes'], [false, 'Not yet']]],
];
const TEXTS = [['country', 'Country', 'Romania'], ['school', 'School', 'Aalto University'], ['city', 'City in Finland', 'Espoo'], ['arrived', 'Arrived', '2026-09']];

function situationForm() {
  const state = {};
  const note = h('p', { class: 'muted details-status', role: 'status' });
  const groups = CHOICES.map(([key, label, options]) => h('fieldset', { class: 'situation-group' },
    h('legend', {}, label),
    h('div', { class: 'chips' }, options.map(([value, text]) => h('button', {
      type: 'button', class: 'chip', 'data-key': key, 'data-value': String(value), 'aria-pressed': 'false',
      onclick: (event) => {
        state[key] = value;
        for (const chip of event.currentTarget.parentNode.children) chip.setAttribute('aria-pressed', String(chip === event.currentTarget));
      },
    }, text)))));
  const inputs = TEXTS.map(([key, label, placeholder]) => h('label', { class: 'detail-field' }, h('span', {}, label),
    h('input', { type: key === 'arrived' ? 'month' : 'text', name: key, placeholder, maxlength: '60' })));
  const form = h('form', { class: 'details-form situation', onsubmit: async (event) => {
    event.preventDefault();
    const texts = Object.fromEntries(inputs.map((l) => l.querySelector('input')).filter((i) => i.value.trim()).map((i) => [i.name, i.value.trim()]));
    try {
      await api.saveSituation({ ...state, ...texts });
      note.textContent = 'Saved. Vali answers for your situation, here and on WhatsApp.';
    } catch (error) {
      note.textContent = error.message || 'Could not save. Try again.';
    }
  } }, groups, inputs, h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn' }, 'Save my situation')), note);
  api.me().then(({ situation }) => {
    for (const [key, value] of Object.entries(situation || {})) {
      state[key] = value;
      for (const chip of form.querySelectorAll(`[data-key="${key}"]`)) chip.setAttribute('aria-pressed', String(chip.dataset.value === String(value)));
      const input = form.querySelector(`input[name="${key}"]`);
      if (input) input.value = value;
    }
  }).catch(() => {});
  return h('section', { class: 'situation-section' },
    h('h3', { class: 'section-title' }, 'Your situation'),
    h('p', { class: 'muted details-intro' }, 'So every answer fits you: EU rules or not, student prices, life before a personal ID.'),
    form);
}
