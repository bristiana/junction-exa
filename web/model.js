// Pure reads of the task JSON. Newer fields (research.activity, output.claims, output.sources) win;
// older tasks fall back to structured.answer, grounding citations and research.progress. No DOM here.
export const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const LIVE_EXECUTION = new Set(['starting', 'running', 'awaiting_approval', 'submitting']);

const list = (value) => (Array.isArray(value) ? value : []);
export const output = (task) => task?.research?.output || {};
export const structured = (task) => output(task).structured || {};

export function isActive(task) {
  return !TERMINAL.has(task?.research?.status) || LIVE_EXECUTION.has(task?.execution?.status);
}

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

// What Exa is doing, oldest first: [{kind: 'search'|'read'|..., text, url, t}].
export function activityOf(task) {
  const research = task?.research || {};
  const lines = list(research.activity).length ? research.activity : list(research.progress);
  return lines.filter((line) => line?.text).map((line) => ({
    kind: line.kind === 'source' ? 'read' : String(line.kind || 'note'),
    text: String(line.text),
    url: safeUrl(line.url),
    t: line.t ?? null,
  }));
}

export function activityLine(line) {
  if (line.kind === 'search') return `Searching “${line.text}”`;
  if (line.kind === 'read') {
    const domain = domainOf(line.url);
    return domain && domain !== line.text ? `Reading ${domain} · ${line.text}` : `Reading ${line.text}`;
  }
  return line.text;
}

// The open question the research is waiting on (research.question until it has an answer), with quick replies.
export function questionOf(task) {
  const question = task?.research?.question;
  if (!question?.text || question.answer != null) return null;
  return { text: String(question.text), options: list(question.options).map(String).filter(Boolean).slice(0, 6) };
}

export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function elapsedSeconds(task, now = Date.now()) {
  const start = Date.parse(task?.created_at);
  const end = isActive(task) ? now : Date.parse(task?.updated_at);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 1000) : 0;
}

// ---------- the answer ----------
const OFFICIAL = /(^|\.)(suomi|dvv|kela|migri|vero|hel|espoo|vantaa|tampere|turku|kkv|finlex|infofinland|oikeus|poliisi|traficom|tyomarkkinatori|te-palvelut|ely-keskus|kuluttajariita)\.fi$|(^|\.)europa\.eu$|\.gov(\.[a-z]{2})?$/;

export function isOfficial(domain) {
  return OFFICIAL.test(domain);
}

// Numbered sources: output.sources, else every grounding citation in first-use order.
export function sourcesOf(task) {
  const given = list(output(task).sources);
  if (given.length) {
    return given.filter((s) => safeUrl(s?.url)).map((s, i) => ({
      n: Number.isInteger(s.n) ? s.n : i + 1, url: safeUrl(s.url), title: String(s.title || domainOf(s.url)),
      domain: String(s.domain || domainOf(s.url)), quote: s.quote ? String(s.quote) : '',
      official: s.official ?? isOfficial(domainOf(s.url)), published: s.published || null, stale: !!s.stale,
    }));
  }
  const seen = new Map();
  for (const citation of list(output(task).grounding).flatMap((g) => list(g?.citations))) {
    const url = safeUrl(citation?.url);
    if (!url || seen.has(url)) continue;
    const domain = domainOf(url);
    seen.set(url, { n: seen.size + 1, url, title: String(citation.title || domain), domain, quote: '',
      official: isOfficial(domain), published: null, stale: false });
  }
  return [...seen.values()];
}

function citedIn(task, field, sources) {
  const byUrl = new Map(sources.map((s) => [s.url, s.n]));
  const group = list(output(task).grounding).find((g) => g?.field === field);
  return [...new Set(list(group?.citations).map((c) => byUrl.get(safeUrl(c?.url))).filter(Boolean))];
}

export function sentences(text) {
  return String(text || '').split(/(?<=[.!?;])\s+(?=[A-Z0-9“"(])/)
    .map((t) => t.trim().replace(/;$/, '.')).filter(Boolean);
}

// The answer as claims with source numbers: output.claims, else the answer's sentences citing its grounding.
export function claimsOf(task, sources) {
  const known = new Set(sources.map((s) => s.n));
  const given = list(output(task).claims).filter((c) => c?.text);
  if (given.length) {
    return given.map((c) => ({ text: String(c.text), sources: list(c.sources).filter((n) => known.has(n)), supported: c.supported !== false }));
  }
  const cited = citedIn(task, 'structured.answer', sources);
  return sentences(structured(task).answer).map((text) => ({ text, sources: cited, supported: true }));
}

export function factsOf(task, sources) {
  return list(structured(task).key_facts).filter((f) => f?.label && f?.value).map((fact, i) => {
    const n = citedIn(task, `structured.key_facts[${i}]`, sources)[0];
    return { label: String(fact.label), value: String(fact.value), source: sources.find((s) => s.n === n) || null };
  });
}

export function stepsOf(task) {
  return list(structured(task).steps).filter((s) => s?.title).map((step) => ({
    title: String(step.title), detail: String(step.detail || ''), url: safeUrl(step.url), by: step.done_by_hoida ? 'Vali' : 'You',
  }));
}

// The page Vali would open or fill: the first prepared action with a web address.
export function primaryAction(task) {
  const actions = list(structured(task).actions);
  const index = actions.findIndex((a) => safeUrl(a?.url));
  return index < 0 ? null : { index, url: safeUrl(actions[index].url), domain: domainOf(actions[index].url), label: String(actions[index].label || '') };
}

export function missingInfo(task) {
  return list(structured(task).missing_info).map(String).filter(Boolean);
}

// "How Vali found this": Exa searches, pages read, seconds and dollars for this errand.
export function findStats(task, sources) {
  const lines = activityOf(task);
  const reads = new Set(lines.filter((l) => l.kind === 'read').map((l) => l.url || l.text));
  const timed = lines.filter((l) => Number.isFinite(l.t));
  return {
    searches: lines.filter((l) => l.kind === 'search').length,
    pages: Math.max(reads.size, sources.length),
    seconds: Math.round(timed.length ? timed[timed.length - 1].t : elapsedSeconds(task)),
    cost: Number.isFinite(task?.research?.cost) ? task.research.cost : null,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// When a source was read: its activity time, else when the research finished. "read today 12:04" / "read 3 Nov".
export function readStamp(task, source, now = new Date()) {
  const start = Date.parse(task?.created_at);
  const line = activityOf(task).find((l) => l.kind === 'read' && l.url === source.url && Number.isFinite(l.t));
  const at = new Date(line && Number.isFinite(start) ? start + line.t * 1000 : Date.parse(task?.updated_at));
  if (Number.isNaN(at.getTime())) return '';
  const today = at.toDateString() === now.toDateString();
  return today ? `read today ${at.toTimeString().slice(0, 5)}` : `read ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

// "updated Mar 2026" from an ISO date; empty when unknown.
export function publishedStamp(published) {
  const match = /^(\d{4})-(\d{2})/.exec(published || '');
  return match ? `updated ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : '';
}
