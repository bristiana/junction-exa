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

// The run's status as the user sees it: an approved run is already submitting, a stop request already stopped,
// even before the browser worker picks the decision up.
export function runStatus(task) {
  const run = task?.execution;
  if (!run) return null;
  if (run.status === 'awaiting_approval' && run.approval_decision === 'approved') return 'submitting';
  if (LIVE_EXECUTION.has(run.status) && run.approval_decision === 'stopped') return 'stopped';
  return run.status;
}

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// A picture URL from the API (an Exa Contents page image): https only, else null.
export function httpsOnly(url) {
  const safe = safeUrl(url);
  return safe && safe.startsWith('https:') ? safe : null;
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
      image: httpsOnly(s.image),
    }));
  }
  const seen = new Map();
  for (const citation of list(output(task).grounding).flatMap((g) => list(g?.citations))) {
    const url = safeUrl(citation?.url);
    if (!url || seen.has(url)) continue;
    const domain = domainOf(url);
    seen.set(url, { n: seen.size + 1, url, title: String(citation.title || domain), domain, quote: '',
      official: isOfficial(domain), published: null, stale: false, image: null });
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
    // output.lead: Vali's own opening line when no page backs any claim; it is not a claim itself.
    const lead = output(task).lead ? [{ text: String(output(task).lead), sources: [], supported: true }] : [];
    return lead.concat(given.map((c) => ({ text: String(c.text), sources: list(c.sources).filter((n) => known.has(n)), supported: c.supported !== false })));
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

// Prefer a prepared form action, otherwise the first action with a web address.
export function primaryAction(task) {
  const actions = list(structured(task).actions);
  const formIndex = actions.findIndex((a) => ['fill', 'book', 'apply'].includes(a?.type) && safeUrl(a?.url));
  const index = formIndex >= 0 ? formIndex : actions.findIndex((a) => safeUrl(a?.url));
  return index < 0 ? null : { index, url: safeUrl(actions[index].url), domain: domainOf(actions[index].url), label: String(actions[index].label || '') };
}

// Drafts Vali wrote for the user to send or paste: email and copy_text actions with a body.
export function draftsOf(task) {
  return list(structured(task).actions).filter((a) => ['email', 'copy_text'].includes(a?.type) && String(a?.body || '').trim())
    .map((a) => ({ type: a.type, label: String(a.label || ''), to: String(a.to || ''), subject: String(a.subject || ''), body: String(a.body).trim() }));
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

// ---------- the errands list ----------
const LETTER_TITLE = 'Uploaded letter';

// Where an errand came from: task.channel, else the older task.source; an uploaded letter counts as a letter.
export function channelOf(task) {
  if (task?.page?.title === LETTER_TITLE) return 'letter';
  const channel = String(task?.channel || task?.source || 'extension');
  if (channel === 'api') return 'web'; // made by a script or another client: shown as the web
  return channel === 'desktop' ? 'mac' : channel;
}

// One status word, a tone (working | you | done | failed) and one line of detail.
export function errandStatus(task) {
  const research = task?.research || {};
  const run = runStatus(task);
  const question = research.status === 'completed' ? null : questionOf(task); // a finished research's question is stale
  if (run === 'awaiting_approval') return { word: 'Waiting for your OK', tone: 'you', detail: task.execution.approval?.summary || '' };
  // A live run that asked something waits for you, so it sits under Needs you, not Working now.
  if (['starting', 'running'].includes(run) && task.execution.question?.text) return { word: 'Needs your answer', tone: 'you', detail: String(task.execution.question.text) };
  if (['starting', 'running', 'submitting'].includes(run)) return { word: 'Filling the form', tone: 'working', detail: lastStep(task) };
  if (question && !run) return { word: 'Needs your answer', tone: 'you', detail: question.text };
  if (!TERMINAL.has(research.status)) {
    const last = activityOf(task).at(-1);
    return { word: 'Working', tone: 'working', detail: last ? activityLine(last) : 'Starting the research' };
  }
  if (research.status === 'cancelled' || run === 'stopped') return { word: 'Stopped', tone: 'failed', detail: 'Nothing was sent.' };
  if (research.status === 'failed' || run === 'failed') {
    return { word: "Couldn't finish", tone: 'failed', detail: errorText(research.error) || errorText(task.execution?.error) };
  }
  if (structured(task).status === 'needs_info' && !run) return { word: 'Needs your answer', tone: 'you', detail: missingInfo(task)[0] || '' };
  return { word: 'Done', tone: 'done', detail: task.execution?.result || sentences(structured(task).answer)[0] || '' };
}

// An error is a sentence from the API; an object with a message is read for its message, never "[object Object]".
export function errorText(error) {
  if (!error) return '';
  return typeof error === 'object' ? String(error.message || error.detail || '') : String(error);
}

function lastStep(task) {
  return list(task?.execution?.steps).at(-1)?.text || '';
}

// Account counters: GET /v1/stats when the API has it, else counted from the errands on screen.
export function countersOf(stats, tasks) {
  if (stats && Number.isFinite(stats.total)) {
    return { errands: stats.total, searches: stats.exa?.searches ?? null, pages: stats.exa?.pages_read ?? null, cost: stats.cost_usd ?? null };
  }
  const found = tasks.map((task) => findStats(task, sourcesOf(task)));
  return {
    errands: tasks.length,
    searches: found.reduce((sum, f) => sum + f.searches, 0) || null, // older tasks rarely log searches: unknown, not zero
    pages: found.reduce((sum, f) => sum + f.pages, 0),
    cost: found.reduce((sum, f) => sum + (f.cost || 0), 0),
  };
}

// Every page Vali touched for one errand: read by Exa during research or the fill, or opened in the cloud browser.
export function pagesTouched(task) {
  const run = task?.execution || {};
  const read = [
    ...activityOf(task).filter((l) => l.kind === 'read').map((l) => l.url),
    ...sourcesOf(task).map((s) => s.url),
    ...list(run.sources).map((s) => s?.url ?? s),
    ...list(run.exa).filter((e) => e?.kind === 'read').map((e) => e.url),
  ];
  const pages = new Map();
  for (const url of [run.start_url, run.current_url].map(safeUrl).filter(Boolean)) pages.set(url, 'opened in the browser');
  for (const url of read.map(safeUrl).filter(Boolean)) if (!pages.has(url)) pages.set(url, 'read by Exa');
  return [...pages].map(([url, how]) => ({ url, domain: domainOf(url), how }));
}

// The mascot's pose for an errand (states of vendor/butler.js).
export function moodOf(task) {
  const run = runStatus(task);
  if (run === 'awaiting_approval') return 'needs_approval';
  if (['starting', 'running', 'submitting'].includes(run)) return 'working';
  if (questionOf(task)) return 'listening';
  const research = task?.research?.status;
  if (!TERMINAL.has(research)) return activityOf(task).length ? 'searching' : 'thinking';
  if (research === 'failed' || run === 'failed') return 'error';
  if (research === 'cancelled' || run === 'stopped') return 'idle';
  return 'success';
}

export function timeAgo(iso, now = Date.now()) {
  const seconds = (now - Date.parse(iso)) / 1000;
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

// Where an errand stands, for the state block on top of the errand page.
// stages: the path this errand takes; at: the stage it reached; next: what moves it on.
export function errandStage(task) {
  const research = task?.research || {};
  const run = task?.execution;
  const status = runStatus(task);
  const action = primaryAction(task);
  const raw = list(run?.steps).map((s) => String(s?.text || '')).filter(Boolean);
  const steps = raw.map(friendlyStep).filter(Boolean);
  const last = steps.at(-1) || '';
  const asked = String(run?.question?.text || ((raw.at(-1) || '').match(/^Asked you: (.+)/) || [])[1] || '');
  const site = domainOf(run?.current_url) || action?.domain || '';
  // Book, write and claim errands end on a form; find and check errands end on an answer with links.
  const wantsForm = ['book', 'write', 'claim'].includes(task?.mode)
    || list(structured(task).actions).some((a) => ['fill', 'book', 'apply'].includes(a?.type) && safeUrl(a?.url))
    || /^(?:(?:please|can you|could you|help me|I want to|I need to|I need you to)\s+)*(?:fill\b|book\b|apply\b)/i.test(String(task?.task || '').trim());
  const canFill = action && wantsForm;
  const stages = canFill || run ? ['Research', 'Fill', 'Your OK', 'Done'] : ['Research', 'Done'];
  const done = stages.length - 1;
  const out = (at, tone, line, next, extra = {}) => ({ stages, at, tone, line, next, site, ...extra });
  if (!TERMINAL.has(research.status)) return out(0, 'working', 'Vali is reading the web with Exa.', null);
  if (research.status === 'failed') return out(0, 'failed', research.error || 'The research did not finish.', { kind: 'retry' });
  if (research.status === 'cancelled' && !run) return out(0, 'stopped', 'You stopped this errand. Nothing was sent.', { kind: 'retry' });
  // A finished research's leftover question is stale: the answer came without it.
  const question = research.status === 'completed' ? null : questionOf(task);
  if (!run) {
    if (question) return out(0, 'you', `Vali needs one thing from you: ${question.text}`, { kind: 'answer', question: question.text });
    if (structured(task).status === 'needs_info' && missingInfo(task).length) {
      return out(0, 'you', `Vali needs one thing from you: ${missingInfo(task)[0]}`, { kind: 'answer', question: missingInfo(task).join(' ') });
    }
    if (canFill) return out(0, 'ready', `Vali found it. Next: fill the form on ${action.domain}.`, { kind: 'fill' });
    return out(done, 'done', 'Done. Pick an option or ask Vali something else.', { kind: 'done' });
  }
  if (status === 'starting') return out(1, 'working', `Opening ${site}.`, { kind: 'stop' });
  if (status === 'running') {
    if (run.question?.text) return out(1, 'you', `Vali is waiting for you on ${site}: ${run.question.text}`, { kind: 'reply', question: run.question.text });
    return out(1, 'working', last ? `On ${site}: ${last}` : `Filling the form on ${site}.`, { kind: 'stop' });
  }
  if (status === 'awaiting_approval') return out(2, 'you', `Everything is filled on ${site}. Nothing is sent until you approve.`, { kind: 'approve' });
  if (status === 'submitting') return out(2, 'working', `Sending it on ${site}.`, null);
  if (status === 'done' || status === 'completed') return out(done, 'done', sentences(run.result || '')[0] || 'Done.', { kind: 'done' });
  const reached = run.approval ? 2 : 1;
  if (status === 'stopped') {
    const where = asked ? `while Vali was asking “${asked.replace(/[?.]\s*$/, '')}?”` : last ? `after “${last.replace(/[“”"‘’]/g, '')}”.` : `on ${site}.`;
    return out(reached, 'stopped', `You stopped it ${where} Nothing was sent.`, { kind: 'refill', question: asked, hint: asked ? 'Answer and Vali picks up from there.' : 'Continue and Vali picks up from there.' });
  }
  return out(reached, 'failed', `Couldn't finish on ${site}${last ? ` after: ${last}` : ''}. ${run.error || ''}`.trim(), { kind: 'refill', question: asked, hint: 'Continue to let Vali try again from there, or open the site and finish it yourself.' });
}

// A browser step in words a non-technical person reads at a glance; '' for the browser's own bookkeeping.
const NOISE = /^(Action refused|Pressed\b|Scrolled\b|Read the page|Looked at the page|Waiting for your approval|Finished|Stopped|Hovered\b|Waited\b|Error\b)/i;
export function friendlyStep(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || NOISE.test(t) || /--\s*(make a choice|valitse)/i.test(t) || /timeout|locator|data-vali-ref/i.test(t)) return '';
  const clean = (v) => v.replace(/[*:]+$/, '').trim();
  let m;
  if ((m = /^(?:Opened|Navigated to)\s+(\S+)/i.exec(t)) && domainOf(m[1])) return `Opened ${domainOf(m[1])}`;
  if ((m = /^Chose "(.+?)" in ".*"$/.exec(t))) return `Chose ${clean(m[1])}`;
  if ((m = /^Clicked "(.+)"$/.exec(t))) return `Chose ${clean(m[1])}`;
  if ((m = /^Set (.+?) to "(.+)"$/.exec(t))) return `Set ${clean(m[1].replace(/^"|"$/g, ''))} to ${m[2]}`;
  if ((m = /^Filled "(.+?)"(?: with (.+))?$/.exec(t))) {
    const mine = !m[2] || /^(your\b|\{\{)/i.test(m[2]);
    return `Filled in ${mine ? 'your ' : ''}${clean(m[1]).toLowerCase()}${mine ? '' : `: ${m[2]}`}`;
  }
  return t.replace(/"([^"]+)"/g, '“$1”');
}

// Friendly browser steps, with repeated consecutive descriptions collapsed.
export function friendlySteps(task) {
  return list(task?.execution?.steps).map((s) => friendlyStep(s?.text)).filter(Boolean)
    .filter((text, i, steps) => i === 0 || text !== steps[i - 1]);
}

// Detail names only: never include the values typed into a form.
export function detailsOf(task) {
  const known = list(task?.research?.known_details).map(String);
  const filled = friendlySteps(task).flatMap((text) => {
    const match = /^Filled in (?:your )?([^:]+)(?::.*)?$/i.exec(text);
    return match ? [match[1].trim().toLowerCase()] : [];
  });
  return [...new Set([...known, ...filled])];
}

// What Vali did on the web for this errand, as one plain sentence.
// Where the research is, for the three steps on the working screen: 0 searching, 1 reading pages, 2 checking quotes.
export function researchStage(task) {
  const trail = activityOf(task);
  if (trail.some((l) => /^(Checking|Research finished|Answer ready)/.test(l.text))) return 2;
  if (trail.some((l) => l.kind === 'read')) return 1;
  return 0;
}

// What Exa did for one errand, for "How Vali found this": the searches, the pages read, the sentences checked.
export function exaTrail(task) {
  const trail = activityOf(task);
  const searches = [...new Set(trail.filter((l) => l.kind === 'search').map((l) => l.text))];
  const seen = new Set();
  const pages = trail.filter((l) => l.kind === 'read' && l.url && !seen.has(l.url) && seen.add(l.url))
    .map((l) => ({ url: l.url, domain: domainOf(l.url) || l.text }));
  const claims = list(output(task).claims).filter((c) => c && !c.own && typeof c.supported === 'boolean');
  return { searches, pages, checked: claims.length, backed: claims.filter((c) => c.supported).length,
    reused: Boolean(task?.research?.reused_from), fill: list(task?.execution?.exa).length };
}

export function webWork(task) {
  const trail = list(task?.research?.activity);
  const searches = trail.filter((e) => e?.kind === 'search').length;
  const pages = new Set(trail.filter((e) => ['read', 'source'].includes(e?.kind)).map((e) => e.url || e.text)).size;
  const claims = list(output(task).claims).filter((c) => c && !c.own && typeof c.supported === 'boolean');
  const parts = [];
  if (task?.research?.reused_from) return 'Used an answer it had already checked.';
  if (searches) parts.push(searches === 1 ? 'searched the web once' : `searched the web ${searches} times`);
  if (pages) parts.push(`read ${pages} ${pages === 1 ? 'page' : 'pages'}`);
  if (claims.length) parts.push(`confirmed ${claims.filter((c) => c.supported).length} of ${claims.length} facts on the page`);
  const fill = list(task?.execution?.exa).length;
  if (fill) parts.push(`looked up ${fill} ${fill === 1 ? 'detail' : 'details'} for the form`);
  if (!parts.length) return '';
  const line = parts.join(', ');
  return line[0].toUpperCase() + line.slice(1) + '.';
}

// The links Vali prepared for this errand, for the buttons under a finished errand: [{label, url, domain}].
export function linkActions(task, n = 3) {
  return list(structured(task).actions).map((a) => ({ label: String(a?.label || '').trim(), url: safeUrl(a?.url) }))
    .filter((a) => a.url && a.label).slice(0, n).map((a) => ({ ...a, domain: domainOf(a.url) }));
}

// ---------- one row of the errands list, shaped by what kind of errand it is ----------
// answer: find and check errands; booking: a form Vali fills (book, claim, or any run); watch: a daily Exa Monitor;
// draft: a write errand that ended on text for you to send.
export function errandKind(task) {
  const mode = String(task?.mode || '');
  if (mode === 'watch' || task?.research?.watch_id || task?.research?.kind === 'monitor') return 'watch';
  if (mode === 'write' && !task?.execution) return 'draft';
  if (['book', 'write', 'claim'].includes(mode) || task?.execution) return 'booking';
  return 'answer';
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_RE = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

// "22 Nov 2026 17:30", "2026-11-22T17:30" or "Sunday 22 November at 17:30" as "Sun 22 Nov 17:30"; '' when no day.
export function shortWhen(text, year = new Date().getFullYear()) {
  const s = String(text || '');
  const time = (/(?<![\d:.])([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d|\.\d)/.exec(s.replace(/\d{4}-\d{2}-\d{2}/, '')) || []).slice(1);
  const clock = time.length ? ` ${time[0].padStart(2, '0')}:${time[1]}` : '';
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  let date = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!date && (m = new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONTH_RE})[a-z]*\\.?(?:\\s+(\\d{4}))?`, 'i').exec(s))) {
    date = new Date(Date.UTC(+(m[3] || year), MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()), +m[1]));
  }
  if (!date && (m = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(s))) date = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  if (date && !Number.isNaN(date.getTime())) return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${clock}`;
  const day = /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i.exec(s);
  return day ? `${day[1].slice(0, 3)[0].toUpperCase()}${day[1].slice(1, 3).toLowerCase()}${clock}` : '';
}

// "kulttuurisauna.fi" as "Kulttuurisauna": the site's own name, for a booking row.
export function siteName(url) {
  const parts = domainOf(url).split('.');
  const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  if (!name) return '';
  return name.length <= 3 ? name.toUpperCase() : name[0].toUpperCase() + name.slice(1); // dvv.fi as DVV
}

// Place and time of a booking: the site Vali fills, and the time it filled in, else the time asked for.
export function bookingWhere(task) {
  const run = task?.execution || {};
  const place = siteName(run.start_url || run.current_url || primaryAction(task)?.url);
  const filled = list(run.approval?.filled).concat(list(run.filled));
  const slot = filled.filter((f) => /date|time|when|day|aika|päivä/i.test(String(f?.label || '')) && f?.value)
    .map((f) => String(f.value)).join(' '); // one "Date/time" field, or a "Date" and a "Time"
  const year = new Date(Date.parse(task?.created_at) || Date.now()).getFullYear();
  const when = shortWhen(slot, year) || shortWhen(task?.task, year);
  return [place, when].filter(Boolean).join(', ');
}

// The kind as a short noun: a booking errand is a Booking, any other form (claim, write) is a Form.
export function kindLabel(task, kind = errandKind(task)) {
  if (kind === 'booking') return task?.mode === 'book' ? 'Booking' : 'Form';
  return { answer: 'Answer', watch: 'Watch', draft: 'Draft' }[kind] || 'Answer';
}

// The one status line of a row: {kind, label, word, detail}. Who acts next (errandStatus.tone) still sorts the list.
export function errandLine(task) {
  const kind = errandKind(task);
  const status = errandStatus(task);
  const run = runStatus(task);
  const research = task?.research || {};
  const said = sentences(String(structured(task).answer || '').replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, ''));
  const first = said[0] && said[0].length < 24 && said[1] ? `${said[0]} ${said[1]}` : said[0] || ''; // "Yes." says little alone
  const label = kindLabel(task, kind);
  const line = (word, detail) => ({ kind, label, word, detail: detail || '' });
  if (kind === 'booking' && run) {
    const where = bookingWhere(task);
    if (run === 'awaiting_approval') return line('Waiting for your OK', where);
    if (['starting', 'running', 'submitting'].includes(run)) {
      return task.execution.question?.text ? line('Needs your answer', task.execution.question.text) : line(run === 'submitting' ? 'Sending' : 'Filling the form', where);
    }
    if (run === 'done' || run === 'completed') return line('Booked', where);
    if (run === 'stopped') return line('Stopped, nothing sent', where);
    if (run === 'failed') return line("Couldn't finish", where);
  }
  if (status.tone === 'working' || status.tone === 'you' || status.tone === 'failed') return line(status.word, status.detail);
  if (kind === 'watch') {
    const latest = list(research.updates).at(-1);
    if (!latest) return line('Checks daily', 'no new matches yet');
    const title = list(latest.sources)[0]?.title || String(latest.text || '').replace(/^new:\s*/i, '');
    return line('New match', title);
  }
  if (kind === 'booking') return line(task?.mode === 'book' ? 'Ready to book' : 'Ready to fill', bookingWhere(task) || first);
  if (kind === 'draft') {
    const draft = draftsOf(task)[0];
    return line('Draft ready', draft ? draft.subject || draft.label || sentences(draft.body)[0] : first);
  }
  return first ? line('', first) : line(status.word, status.detail);
}

// ---------- the errand page's shape ----------
// Which card leads the errand page: a watch, a form Vali fills, a draft to send, or an answer.
export function pageKind(task) {
  if (task?.mode === 'watch' || task?.research?.watch_id) return 'watch';
  if (task?.execution || errandStage(task).stages.length > 2) return 'form';
  if (draftsOf(task).length && !['find', 'check'].includes(task?.mode)) return 'draft';
  return 'answer';
}

const WHEN_LABEL = /\b(date|time|when|slot|day|visit)\b|aika|päivä/i;

// When the booking is for: the date and time Vali filled, else the calendar entry it prepared, else a dated key fact.
export function bookingWhen(task) {
  const filled = list(task?.execution?.approval?.filled).filter((f) => f?.label && /\d/.test(f?.value || '') && WHEN_LABEL.test(f.label));
  if (filled.length) return filled.slice(0, 2).map((f) => String(f.value)).join(', ');
  const cal = list(structured(task).actions).find((a) => a?.type === 'calendar' && a.start);
  const at = cal ? new Date(cal.start) : null;
  if (at && !Number.isNaN(at.getTime())) {
    return at.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' });
  }
  if (task?.mode !== 'book') return '';
  const fact = list(structured(task).key_facts).find((f) => f?.label && /\d/.test(f?.value || '') && WHEN_LABEL.test(f.label) && !/response|processing|deadline/i.test(f.label));
  return fact ? String(fact.value).split(';')[0].trim() : '';
}

// Where it happens: the calendar entry's place, else the site Vali works on.
export function calendarWhere(task) {
  const cal = list(structured(task).actions).find((a) => a?.type === 'calendar' && a.location);
  return cal ? String(cal.location) : '';
}

// One status word for the booking card and its tone.
export function bookingStatus(task) {
  const run = runStatus(task);
  const sent = ['write', 'claim'].includes(task?.mode) ? 'Sent' : task?.mode === 'book' ? 'Booked' : 'Done';
  if (!run) return errandStage(task).stages.length > 2 ? { word: 'Ready to fill', tone: 'ready' } : { word: 'Not started', tone: 'stopped' };
  if (run === 'awaiting_approval') return { word: 'Waiting for your OK', tone: 'you' };
  if (['starting', 'running'].includes(run)) return { word: 'Filling', tone: 'working' };
  if (run === 'submitting') return { word: 'Sending', tone: 'working' };
  if (['done', 'completed'].includes(run)) {
    // A run that ended without your OK sent nothing: the answer is found, nothing is booked.
    return task.execution.approval_decision === 'approved' ? { word: sent, tone: 'done' } : { word: 'Not booked yet', tone: 'ready' };
  }
  if (run === 'stopped') return { word: 'Stopped', tone: 'stopped' };
  return { word: "Couldn't finish", tone: 'failed' };
}

// Today's matches for a watch: its key facts with the link Vali kept for each, without the "Watching for" line.
export function watchMatches(task) {
  const links = list(structured(task).actions).filter((a) => safeUrl(a?.url));
  const used = new Set();
  return list(structured(task).key_facts).filter((f) => f?.label && f?.value && f.label !== 'Watching for').map((f) => {
    const i = links.findIndex((a, j) => !used.has(j) && a.label === f.label);
    if (i >= 0) used.add(i);
    return { label: String(f.label), value: String(f.value), url: i >= 0 ? safeUrl(links[i].url) : null };
  });
}

export function watchCriteria(task) {
  const fact = list(structured(task).key_facts).find((f) => f?.label === 'Watching for' && f.value);
  return String(fact?.value || task?.task || '');
}

// What Exa did for a form errand: the research before it (exaTrail) and the lookups made while filling.
// lookups: execution.exa [{kind: 'search'|'read', query|url}]; used: execution.sources [{url, title}].
export function formExa(task) {
  const trail = exaTrail(task);
  const run = task?.execution || {};
  const lookups = list(run.exa).filter((e) => e && ['search', 'read'].includes(e.kind)).map((e) => ({
    kind: e.kind, text: e.kind === 'search' ? String(e.query || '') : domainOf(e.url) || String(e.url || ''),
    url: safeUrl(e.url), failed: Boolean(e.error),
  })).filter((e) => e.text);
  const seen = new Set();
  const used = list(run.sources).map((s) => safeUrl(s?.url ?? s)).filter((url) => url && !seen.has(url) && seen.add(url))
    .map((url) => ({ url, domain: domainOf(url) }));
  return { ...trail, lookups, used };
}

// What Vali typed or picked on the form: the approval's list, else the run's own, with field labels cleaned up.
// Picker labels such as "-- Make a choice -- NAINEN / WOMAN MIES / MAN" read as "Choice".
export function filledOf(task) {
  const run = task?.execution || {};
  const given = list(run.approval?.filled).length ? run.approval.filled : list(run.filled);
  return given.filter((f) => f?.label && f.value != null && String(f.value) !== '').map((f) => {
    let label = String(f.label).replace(/[*:]+\s*$/, '').trim();
    if (/^--/.test(label) || label.length > 40) label = 'Choice';
    const value = String(f.value) === 'checked' ? 'Yes' : String(f.value);
    return { label, value };
  }).slice(0, 8);
}

const BRING = /\b(bring|documents?|attachments?|proof|what to take|take with)\b/i;

// What the errand still needs from the person, as a short checklist: the open question, missing details, what to bring.
// missing: [{key, label}] from profile.missingDetails, passed in so this stays free of storage.
export function needsOf(task, missing = []) {
  const stage = errandStage(task);
  const items = [];
  const ask = stage.next?.kind;
  if (['answer', 'reply'].includes(ask) || (ask === 'refill' && stage.next.question)) {
    items.push({ kind: 'question', text: String(stage.next.question || '') });
  } else if (structured(task).status === 'needs_info') {
    for (const text of missingInfo(task).slice(0, 3)) items.push({ kind: 'question', text });
  }
  const run = runStatus(task);
  if (missing.length && !['done', 'completed', 'submitting', 'awaiting_approval'].includes(run) && stage.stages.length > 2) {
    items.push({ kind: 'details', text: missing.map((d) => d.label.toLowerCase()).join(', '), missing });
  }
  const bring = list(structured(task).key_facts).find((f) => f?.label && f?.value && BRING.test(f.label) && !/not (required|needed)/i.test(f.value));
  if (bring) items.push({ kind: 'bring', text: shorten(String(bring.value), 140), label: String(bring.label) });
  return items.filter((item) => item.text);
}

// A long value cut at a sentence or word end, for a fact read at a glance.
export function shorten(text, n = 120) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (stop > n * 0.4 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '') + '…');
}

// Why a browser run could not finish, in plain words; null when it did not fail.
const TECHNICAL = /timeout|locator|playwright|net::|ERR_|exception|traceback|selector|\bnull\b|undefined/i;
export function failReason(task) {
  const run = task?.execution;
  if (runStatus(task) !== 'failed') return null;
  const error = String(run?.error || '').trim();
  const last = friendlySteps(task).at(-1) || '';
  const url = safeUrl(run?.current_url || run?.start_url);
  if (error && !TECHNICAL.test(error)) return { text: shorten(error, 160), url };
  if (error) return { text: `The site was too slow or changed while Vali was filling it${last ? `, after: ${last}` : ''}.`, url };
  if (/^Opened\b/.test(last)) return { text: 'The site stopped Vali right after the form opened. Open it yourself:', url };
  if (last) return { text: `Vali got stuck after: ${last.replace(/\.$/, '')}. Open it yourself:`, url };
  return { text: 'The site stopped Vali before the form opened. Open it yourself:', url };
}

// A draft with {{placeholders}} filled from your saved details, else a readable blank such as "[your name]".
export function fillBlanks(text, profile = {}) {
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => profile[key.toLowerCase()] || `[your ${key.toLowerCase().replaceAll('_', ' ')}]`);
}

// Which form this is, in a few words: the approval's first sentence, else the prepared action's label, else the site.
export function formTitle(task) {
  const summary = sentences(task?.execution?.approval?.summary || '')[0];
  if (summary) return shorten(summary, 90);
  const action = primaryAction(task);
  if (action?.label) return action.label;
  const site = domainOf(task?.execution?.current_url || task?.execution?.start_url) || action?.domain;
  return site ? `Form on ${site}` : '';
}

// The errand's own words with web addresses shown as their site, so a pasted link does not fill the title.
export function readableTitle(text) {
  return String(text || '').replace(/https?:\/\/[^\s)]+/g, (url) => domainOf(url.replace(/[.,;:]+$/, '')) || url).replace(/:\s*$/, '');
}
