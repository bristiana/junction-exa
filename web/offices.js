// Offices for a service from the Helsinki service map, with today's hours and a public-holiday warning.
// "Closest to me" asks for your location only when pressed; it stays in this browser and only sorts the list.
import { api } from './api.js';
import { h } from './dom.js';
import { distanceKm, officeLine } from './hub-model.js';

const cache = new Map(); // query -> Promise of the /v1/places answer, once per page visit

export function renderOffices(node, query) {
  node.replaceChildren(h('p', { class: 'muted' }, 'Finding offices in Helsinki…'));
  if (!cache.has(query)) cache.set(query, api.places(query).catch(() => ({ available: false, places: [] })));
  cache.get(query).then((result) => {
    if (!node.isConnected) return;
    const offices = (result.available ? result.places : []).map((place) => officeLine(place)).filter((o) => o.name);
    node.replaceChildren(offices.length ? officeList(offices) : h('p', { class: 'muted' }, 'No offices listed on the Helsinki service map.'));
  });
}

function officeList(offices) {
  const list = h('ul', { class: 'offices' });
  const draw = (items) => list.replaceChildren(...items.slice(0, 3).map(officeItem));
  draw(offices);
  const closest = h('button', { type: 'button', class: 'link-btn', onclick: () => sortByDistance(offices, draw, closest) }, 'Closest to me');
  return h('div', {},
    h('div', { class: 'offices-head' }, h('p', { class: 'eyebrow' }, 'Offices in Helsinki'), navigator.geolocation ? closest : null),
    list,
    h('p', { class: 'fine' }, 'Hours from the Helsinki service map. Check the office page before you go.'));
}

function officeItem(office) {
  return h('li', { class: 'office' },
    h('p', { class: 'office-name' }, office.name, office.km == null ? null : h('span', { class: 'muted' }, ` · ${office.km.toFixed(1)} km`)),
    office.address ? h('p', { class: 'muted' }, office.address) : null,
    h('p', { class: `office-hours ${office.tone}` }, office.hours));
}

function sortByDistance(offices, draw, button) {
  button.disabled = true;
  navigator.geolocation.getCurrentPosition((position) => {
    const here = [position.coords.longitude, position.coords.latitude];
    draw(offices.map((o) => ({ ...o, km: o.coords ? distanceKm(here, o.coords) : null }))
      .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity)));
    button.hidden = true;
  }, () => { button.disabled = false; button.textContent = 'Location is off'; }, { maximumAge: 600000, timeout: 8000 });
}
