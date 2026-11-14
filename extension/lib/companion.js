// The page companion: which pages Vali offers a tip on, what it sends about them, and the per-URL cache.
// Only the site and first path segment, the title, headings and language are sent, redacted. Never the selection
// (that goes only with an explicit "Ask Vali about this"), form values, inputs, cookies or the page body. Pure, so test/companion.test.mjs runs it in Node.

import { redactText } from "./redact.js";

export const TIP_TTL_MS = 6 * 60 * 60 * 1000; // one request per URL per 6 h
export const RETRY_MS = 15 * 60 * 1000; // after a failed request (no server, endpoint not deployed yet)
const MAX_CACHED = 300;
const MAX_HEADINGS = 12;

// Sites where a newcomer in Finland usually has an errand: public services, studying, housing, travel, shops, bookings.
const HELPFUL_SITES = [
  "suomi.fi", "kela.fi", "migri.fi", "vero.fi", "dvv.fi", "poliisi.fi", "infopankki.fi", "tyomarkkinatori.fi",
  "te-palvelut.fi", "traficom.fi", "kkv.fi", "kuluttajariita.fi", "posti.fi", "hel.fi", "espoo.fi", "vantaa.fi",
  "tampere.fi", "turku.fi", "ouka.fi", "jyvaskyla.fi", "hus.fi", "europa.eu",
  "studyinfo.fi", "opintopolku.fi", "studyinfinland.fi", "helsinki.fi", "aalto.fi", "tuni.fi", "utu.fi", "oulu.fi",
  "jyu.fi", "lut.fi", "uef.fi", "abo.fi", "hanken.fi", "uniarts.fi", "metropolia.fi", "haaga-helia.fi", "laurea.fi",
  "hyy.fi", "ayy.fi",
  "hoas.fi", "tys.fi", "toas.fi", "psoas.fi", "lumo.fi", "sato.fi", "vuokraovi.com", "oikotie.fi", "kodit.fi",
  "vr.fi", "hsl.fi", "finnair.com", "matkahuolto.fi", "onnibus.com", "finavia.fi", "nysse.fi", "foli.fi",
  "vikingline.com", "tallink.com", "booking.com", "airbnb.com", "airbnb.fi",
  "verkkokauppa.com", "gigantti.fi", "power.fi", "s-kaupat.fi", "k-ruoka.fi", "tokmanni.fi", "ikea.com", "zalando.fi",
  "elisa.fi", "dna.fi", "telia.fi", "helen.fi", "if.fi", "lahitapiola.fi", "fennia.fi",
];
const HELPFUL_HOST = /(\.gov(\.[a-z]{2})?$|\.edu$|\.ac\.[a-z]{2}$|yliopisto|university|ammattikorkeakoulu)/;
// The allowlist above is the main gate. Beyond it, only an address or title that names a specific errand, as a whole
// word (Finnish words may take endings): korvaushakemus, ilmoittautuminen, oleskeluluvan.
const ERRAND_WORDS = /(?<![\p{L}\p{N}])(?:refunds?|compensation|complaints?|residence permits?|parking permits?|visa application|tenancy agreement|hakemus\p{L}*|korvaus\p{L}*|ilmoittautu\p{L}*|muuttoilmoitu\p{L}*|oleskelulu\p{L}*|vuokrasopimu\p{L}*)(?![\p{L}\p{N}])/iu;

const siteOf = (host) => String(host || "").toLowerCase().replace(/^www\d?\./, "").replace(/\.$/, "");
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

// The page address without the query and fragment, which can carry personal data. "" for non-web pages.
export function cacheKey(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin + u.pathname : "";
  } catch (_) {
    return "";
  }
}

// What the server sees of the address: the site and the first path segment (deeper paths can carry ids).
export function sentUrl(url) {
  const key = cacheKey(url);
  if (!key) return "";
  const u = new URL(key);
  return u.origin + "/" + (u.pathname.split("/")[1] || "");
}

export function helpfulPage(url, title = "") {
  const key = cacheKey(url);
  if (!key) return false;
  const host = siteOf(new URL(key).hostname);
  if (HELPFUL_SITES.some((d) => host === d || host.endsWith("." + d)) || HELPFUL_HOST.test(host)) return true;
  let path = new URL(key).pathname;
  try { path = decodeURIComponent(path); } catch (_) {}
  return ERRAND_WORDS.test(`${path.replace(/[-_/]+/g, " ")} ${title}`);
}

// What POST /v1/companion gets. raw comes from the content script; everything is clipped and redacted again here,
// and only these four fields are kept.
export function companionPayload(raw) {
  const url = sentUrl(raw?.url);
  if (!url) return null;
  const headings = (Array.isArray(raw.headings) ? raw.headings : []).map((h) => redactText(clip(h, 120))).filter(Boolean).slice(0, MAX_HEADINGS);
  return { url, title: redactText(clip(raw.title, 200)), headings, lang: clip(raw.lang, 12).toLowerCase() };
}

const httpUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol) ? new URL(u).href : ""; } catch (_) { return ""; } };

// The server's tip, checked: text, up to 3 sources on different sites (with the quote that backs it), an optional
// errand to start.
export function cleanTip(tip) {
  const text = clip(tip?.text, 400);
  if (!text) return null;
  const sources = (Array.isArray(tip.sources) ? tip.sources : [])
    .map((s) => ({ url: httpUrl(s?.url), title: clip(s?.title, 120), quote: clip(s?.quote, 300) }))
    .filter((s) => s.url)
    .map((s) => ({ ...s, domain: siteOf(new URL(s.url).hostname) }))
    .filter((s, i, all) => all.findIndex((x) => x.domain === s.domain) === i) // one link per site
    .slice(0, 3);
  const task = clip(tip.action?.task, 2000);
  const action = task ? { label: clip(tip.action.label, 40) || "Do it", task } : null;
  return { text, sources, action };
}

// The cache entry for a page, or null when it has to be asked again.
export function cachedEntry(cache, key, now = Date.now()) {
  const e = cache?.[key];
  if (!e) return null;
  return now - e.at < (e.failed ? RETRY_MS : TIP_TTL_MS) ? e : null;
}

// The cache with this page's entry set, expired entries dropped and at most MAX_CACHED kept (newest).
export function remember(cache, key, entry, now = Date.now()) {
  const all = { ...(cache || {}), [key]: { ...entry, at: now } };
  const kept = Object.entries(all)
    .filter(([k]) => cachedEntry(all, k, now))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_CACHED);
  return Object.fromEntries(kept);
}
