// Pure reads for the student hub: the catalog from GET /v1/services, office hours from /v1/places and register
// matches from /v1/company. No DOM here.
import { domainOf, safeUrl } from './model.js';

export const PHASES = {
  before_arrival: 'Before you arrive',
  first_week: 'First week',
  first_month: 'First month',
  ongoing: 'Ongoing',
};

const HELP = {
  'answer': 'Vali answers with sources',
  'fill in the cloud browser': 'Vali fills the form, you approve',
  'fill in your own tab': 'Vali helps in your own tab',
  'guide only': 'Vali guides you step by step',
};

export const BANK_ID = 'Finnish bank ID or mobile ID';

// Office searches on the Helsinki service map, for services people visit in person.
const OFFICES = {
  'residence-permit': 'Maahanmuuttovirasto', 'eu-registration': 'Maahanmuuttovirasto', 'permit-extension': 'Maahanmuuttovirasto',
  'dvv-registration': 'Digi- ja väestötietovirasto', 'municipality': 'Digi- ja väestötietovirasto',
  'kela-coverage': 'Kela', 'student-aid': 'Kela', 'housing-supplement': 'Kela', 'meal-subsidy': 'Kela', 'european-health-card': 'Kela',
  'find-doctor': 'terveysasema',
};

export const officeQuery = (service) => OFFICES[service.id] || null;
export const helpLabel = (service) => HELP[service.vali_help] || 'Vali guides you step by step';
export const canFill = (service) => service.vali_help === 'fill in the cloud browser';

// Who the reader is: { citizenship: 'eu'|'non_eu'|null, study: 'degree'|'exchange'|null }; null shows everything.
export function appliesTo(service, about) {
  const audience = service.applies_to || {};
  const fits = (key) => !about[key] || !Array.isArray(audience[key]) || audience[key].includes(about[key]);
  return fits('citizenship') && fits('study');
}

// The timeline: phases in order, each with the services that apply, empty phases dropped.
export function timeline(catalog, about) {
  const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
  return groups.map((group) => ({
    id: group.id, title: PHASES[group.id] || group.id,
    services: (Array.isArray(group.services) ? group.services : []).filter((s) => s?.id && appliesTo(s, about)),
  })).filter((group) => group.services.length);
}

// Live facts as numbered sources (one per page) and quotes that point at them.
export function factSources(facts) {
  const sources = new Map();
  const quotes = [];
  for (const fact of Array.isArray(facts) ? facts : []) {
    const url = safeUrl(fact?.url);
    const quote = String(fact?.quote || '').replace(/\s+/g, ' ').trim();
    if (!url || !quote) continue;
    if (!sources.has(url)) {
      sources.set(url, { n: sources.size + 1, url, domain: domainOf(url), title: String(fact.title || domainOf(url)), quote, official: true });
    }
    if (!quotes.some((q) => q.text === quote)) quotes.push({ text: quote, n: sources.get(url).n });
  }
  return { sources: [...sources.values()], quotes };
}

// The errand text "Ask Vali" starts for a service, with what the reader told us about themselves.
export function errandFor(service, about, fill = false) {
  const who = [about.citizenship === 'eu' ? 'EU' : about.citizenship === 'non_eu' ? 'non-EU' : '',
    about.study ? `${about.study} student` : 'student'].filter(Boolean).join(' ');
  return fill
    ? `Fill in the ${service.name} form (${service.organisation}) for me as a ${who} in Finland, starting from ${service.official_url}. Stop before submitting.`
    : `${service.name} (${service.organisation}): what do I need to do as a ${who} in Finland? Start from ${service.official_url}`;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Today's hours from service-map text like "open Mon-Fri 09-16"; null when the text can't be read safely.
export function todayHours(text, date = new Date()) {
  const match = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:-\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*)?\s+(\d{1,2})(?:[.:](\d{2}))?\s*-\s*(\d{1,2})(?:[.:](\d{2}))?/i.exec(text || '');
  if (!match) return null;
  const from = DAYS.indexOf(match[1].toLowerCase()), to = DAYS.indexOf((match[2] || match[1]).toLowerCase());
  const today = date.getDay();
  const open = from <= to ? today >= from && today <= to : today >= from || today <= to;
  const time = (h, m) => `${h.padStart(2, '0')}:${m || '00'}`;
  return open ? `Open today ${time(match[3], match[4])}–${time(match[5], match[6])}` : 'Closed today';
}

// Service-map fields come as { fi, sv, en }; English first.
export const pick = (value) => (value && typeof value === 'object' ? value.en || value.fi || value.sv || '' : String(value || ''));

export function officeLine(place, date = new Date()) {
  const hours = (Array.isArray(place.opening_hours) ? place.opening_hours : []).map(pick).filter(Boolean);
  const today = hours.map((h) => todayHours(h, date)).find(Boolean);
  return {
    name: pick(place.name),
    address: [pick(place.street_address), place.address_zip].filter(Boolean).join(', '),
    hours: place.is_public_holiday ? `${place.public_holiday}: offices are generally closed` : today || hours[0] || 'Opening hours not listed',
    tone: place.is_public_holiday ? 'holiday' : today?.startsWith('Open') ? 'open' : 'closed',
    coords: Array.isArray(place.location?.coordinates) ? place.location.coordinates : null,
  };
}

// Great-circle distance in km between [lon, lat] points.
export function distanceKm([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// ---------- the register check ----------
const english = (descriptions) => (descriptions || []).find((d) => d.languageCode === '3')?.description || '';

function companyName(company) {
  const names = Array.isArray(company.names) ? company.names : [];
  return (names.find((n) => !n.endDate) || names[0] || {}).name || '';
}

function summary(company) {
  return {
    name: companyName(company),
    id: company.businessId?.value || '',
    since: company.businessId?.registrationDate || '',
    form: english(company.companyForms?.find((f) => !f.endDate)?.descriptions || company.companyForms?.[0]?.descriptions),
    ceased: company.endDate || null,
  };
}

const normal = (s) => String(s).toLowerCase().replace(/\b(oy|oyj|ab|ky|ltd|sr|ry)\b|[^a-z0-9åäö]+/g, ' ').trim();

// One verdict line and the matches that back it: the closest name first, active companies before ceased ones.
export function companyVerdict(result, query) {
  if (!result?.available) return { tone: 'unknown', line: 'The trade register did not answer. Try again in a moment.', matches: [] };
  const wanted = normal(query);
  const matches = (Array.isArray(result.companies) ? result.companies : []).map(summary).filter((c) => c.name)
    .map((c) => ({ ...c, exact: normal(c.name) === wanted }))
    .sort((a, b) => (b.exact - a.exact) || (!!a.ceased - !!b.ceased));
  const best = matches[0];
  if (!best) return { tone: 'none', line: `No company named “${query}” in the Finnish trade register. That alone is not proof of fraud: ask for their business ID.`, matches };
  if (!best.exact) return { tone: 'none', line: `No exact match for “${query}”. Closest registered names below; compare the business ID they give you.`, matches: matches.slice(0, 3) };
  return best.ceased
    ? { tone: 'bad', line: `${best.name} (${best.id}) is in the register but ceased on ${best.ceased}.`, matches: matches.slice(0, 3) }
    : { tone: 'good', line: `${best.name} (${best.id}) is a registered ${best.form ? best.form.toLowerCase() : 'company'} since ${best.since}.`, matches: matches.slice(0, 3) };
}

export const registerUrl = (id) => `https://tietopalvelu.ytj.fi/yritys/${encodeURIComponent(id)}`;
