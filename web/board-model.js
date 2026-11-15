// The dashboard's numbers and lists, read from GET /v1/tasks, /v1/stats and /v1/watches. Pure, no DOM.
import { TERMINAL, activityOf, errorText, channelOf, domainOf, errandStatus, friendlySteps, webWork, missingInfo, output, runStatus, safeUrl, sentences, sourcesOf, structured } from './model.js';
import { exaUses } from './exa-uses.js';

const list = (value) => (Array.isArray(value) ? value : []);
export const MAIN_CHANNELS = ['whatsapp', 'web', 'extension', 'voice'];
const MODES = { search: 'Find', agent: 'Research', monitor: 'Watch' };

// Sentences the quote check judged against the cited pages (Exa Contents); else quotes found on the sources.
export function quotesChecked(task) {
  const out = output(task);
  const judged = list(out.claims).filter((c) => c && !c.own && typeof c.supported === 'boolean').length;
  return judged || list(out.sources).filter((s) => s?.quote).length;
}

// Up to n source domains, in citation order, else the pages the research read.
export function topDomains(task, n = 3) {
  const domains = sourcesOf(task).map((s) => s.domain);
  for (const line of list(task?.research?.activity)) if (line?.kind === 'read') domains.push(domainOf(line.url) || String(line.text || ''));
  return [...new Set(domains.filter(Boolean))].slice(0, n);
}

// Errands per channel: the API's by_channel when it has one, else counted from the list. Main four always shown.
export function channelCounts(stats, tasks) {
  const counts = new Map(MAIN_CHANNELS.map((c) => [c, 0]));
  if (stats?.by_channel && typeof stats.by_channel === 'object') {
    for (const [raw, n] of Object.entries(stats.by_channel)) {
      const channel = channelOf({ channel: raw });
      counts.set(channel, (counts.get(channel) || 0) + (Number(n) || 0));
    }
  } else {
    for (const task of tasks) counts.set(channelOf(task), (counts.get(channelOf(task)) || 0) + 1);
  }
  return [...counts].filter(([channel, n]) => n || MAIN_CHANNELS.includes(channel));
}

export function totalsOf(stats, tasks) {
  const sums = tasks.reduce((acc, task) => {
    const trail = list(task?.research?.activity);
    const fill = list(task?.execution?.exa);
    acc.searches += trail.filter((e) => e?.kind === 'search').length + fill.filter((e) => e?.kind === 'search').length;
    acc.pages += trail.filter((e) => e?.kind === 'read').length + fill.filter((e) => e?.kind === 'read').length;
    acc.cost += (Number(task?.research?.cost) || 0) + fill.reduce((sum, c) => sum + (Number(c?.cost_usd) || 0), 0);
    acc.quoted += quotesChecked(task);
    return acc;
  }, { searches: 0, pages: 0, cost: 0, quoted: 0 });
  const has = stats && Number.isFinite(stats.total);
  return {
    errands: has ? stats.total : tasks.length,
    searches: has && Number.isFinite(stats.exa?.searches) ? stats.exa.searches : sums.searches,
    pages: has && Number.isFinite(stats.exa?.pages_read) ? stats.exa.pages_read : sums.pages,
    quoted: sums.quoted,
    cost: has && Number.isFinite(stats.cost_usd) ? stats.cost_usd : sums.cost,
    channels: channelCounts(has ? stats : null, tasks),
    today: has && Number.isFinite(stats.today?.cost_usd) ? stats.today.cost_usd : null,
  };
}

// One feed row per errand, newest first.
export function feedOf(tasks) {
  return [...tasks].sort(byNewest).map((task) => {
    const status = errandStatus(task);
    return {
      id: task.id, text: String(task.task || ''), channel: channelOf(task), at: task.created_at,
      mode: MODES[task.mode] || MODES[task?.research?.kind] || 'Errand', status: status.word, tone: status.tone,
      exa: webWork(task),
      domains: topDomains(task),
    };
  });
}

// Every Exa search query Vali ran: the research trail's searches and the cloud browser's lookups, newest first.
export function searchesOf(tasks) {
  const rows = [];
  for (const task of tasks) {
    const start = Date.parse(task.created_at);
    const base = { taskId: task.id, errand: String(task.task || ''), channel: channelOf(task) };
    for (const line of list(task?.research?.activity)) {
      if (line?.kind !== 'search' || !line.text) continue;
      const at = Number.isFinite(start) && Number.isFinite(line.t) ? new Date(start + line.t * 1000).toISOString() : task.created_at;
      rows.push({ ...base, query: String(line.text), at, where: 'Research' });
    }
    for (const call of list(task?.execution?.exa)) {
      if (call?.kind !== 'search' || !call.query) continue;
      rows.push({ ...base, query: String(call.query), at: task.updated_at || task.created_at, where: 'Form fill' });
    }
  }
  return rows.sort(byNewest);
}

// Watches joined to their errand (research.watch_id). Without the watches list, the errands that hold a watch.
export function watchesOf(watches, tasks) {
  const byWatch = new Map(tasks.filter((t) => t?.research?.watch_id).map((t) => [t.research.watch_id, t]));
  const rows = Array.isArray(watches)
    ? watches.map((w) => ({ id: w.id, task: byWatch.get(w.id) || null, query: w.query, created: w.created_at,
      live: !!w.exa_monitor_id, checked: w.check_requested_at || null, updates: list(w.updates), unseen: Number(w.unseen_count) || 0 }))
    : [...byWatch].map(([id, task]) => ({ id, task, query: task.task, created: task.created_at,
      live: task.research.monitor_stubbed === false, checked: null, updates: list(task.research.updates), unseen: 0 }));
  return rows.map((row) => {
    const fact = list(structured(row.task).key_facts).find((f) => f?.label === 'Watching for' && f.value);
    const updates = [...row.updates].filter((u) => u?.text).sort(byNewest);
    const last = updates[0]?.at || null;
    return {
      id: row.id, taskId: row.task?.id || null, criteria: String(fact?.value || row.query || row.task?.task || ''),
      live: row.live, unseen: row.unseen, channel: row.task ? channelOf(row.task) : null,
      when: last ? { label: 'Last update', at: last } : row.checked ? { label: 'Last check', at: row.checked } : { label: 'Since', at: row.created },
      updates: updates.slice(0, 2).map((u) => {
        const url = safeUrl(list(u.sources)[0]?.url);
        return { text: String(u.text).replace(/^new:\s*/i, ''), at: u.at || null, url, domain: url ? domainOf(url) : '' };
      }),
    };
  });
}

// ---------- one errand as a conversation (#/dashboard/<id>) ----------
const RUN_WORD = {
  starting: 'Opening the page', running: 'Filling the form', awaiting_approval: 'Waiting for your OK',
  submitting: 'Submitting', completed: 'Done', done: 'Done', failed: "Couldn't finish", stopped: 'Stopped',
};

// "{{first_name}}" -> "your first name": the dashboard never shows saved details.
export function plainPlaceholders(text) {
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => `your ${key.toLowerCase().replaceAll('_', ' ')}`);
}

export function isPdf(url) {
  try { return /\.pdf$/i.test(new URL(url).pathname); } catch { return false; }
}

// The first n sentences of the answer; the research's own lead or claims when there is no answer text.
export function shortAnswer(task, n = 2) {
  const text = structured(task).answer || output(task).lead || list(output(task).claims).map((c) => c?.text).filter(Boolean).join(' ');
  return sentences(text).slice(0, n).join(' ');
}

// The browser steps worth reading, newest last: quiet steps dropped, "Opened <url>" shortened to its domain.
export function runSteps(task, n = 4) {
  const steps = friendlySteps(task).map(plainPlaceholders)
    .filter((text, i, all) => i === 0 || text !== all[i - 1]);
  return { steps: steps.slice(-n), more: Math.max(0, steps.length - n) };
}

// Every page Vali touched for this errand, sources first: [{url, domain, title, pdf, image, how}].
export function pagesOpened(task) {
  const pages = new Map();
  const add = (url, how, title = '', image = null) => {
    const safe = safeUrl(url);
    if (!safe) return;
    const known = pages.get(safe);
    if (known) {
      known.title ||= title;
      known.image ||= image;
      return;
    }
    pages.set(safe, { url: safe, domain: domainOf(safe), title: String(title || ''), pdf: isPdf(safe), image, how });
  };
  for (const s of sourcesOf(task)) add(s.url, `Source ${s.n}`, s.title !== s.domain ? s.title : '', s.image);
  for (const line of activityOf(task)) if (line.kind === 'read') add(line.url, 'Read by Exa', line.text !== domainOf(line.url) ? line.text : '');
  const run = task?.execution || {};
  for (const call of list(run.exa)) if (call?.kind === 'read') add(call.url, 'Read for the form');
  for (const step of list(run.steps)) {
    const opened = /^Opened\s+(\S+)/.exec(String(step?.text || ''));
    if (opened) add(opened[1], 'Opened in the browser');
  }
  add(run.start_url, 'Opened in the browser');
  return [...pages.values()];
}

// The errand as chat bubbles, oldest first. who: 'me' (right) or 'vali' (left). Every bubble has text; the rest is
// optional: label (small heading), facts [{label, value}], sources [{n, url, domain}], steps, more, tone, options.
export function threadOf(task) {
  const research = task?.research || {};
  const status = errandStatus(task);
  const bubbles = [{ who: 'me', text: String(task?.task || ''), at: task?.created_at || null }];
  const question = research.question;
  if (question?.text && (question.answer != null || !TERMINAL.has(research.status))) {
    const answered = question.answer != null;
    bubbles.push({ who: 'vali', text: String(question.text), tone: answered ? null : 'you',
      options: answered ? [] : list(question.options).map(String).filter(Boolean).slice(0, 6) });
    if (answered) bubbles.push({ who: 'me', text: String(question.answer) });
  }
  if (!TERMINAL.has(research.status)) {
    bubbles.push({ who: 'vali', text: status.detail || 'Working on it', label: 'Working', tone: 'working' });
  } else if (research.status === 'cancelled') {
    bubbles.push({ who: 'vali', text: 'Stopped. Nothing was sent.', tone: 'failed' });
  } else if (research.status === 'failed') {
    bubbles.push({ who: 'vali', text: errorText(research.error) || "I couldn't finish this one.", tone: 'failed' });
  } else {
    const facts = list(structured(task).key_facts).filter((f) => f?.label && f?.value).slice(0, 3)
      .map((f) => ({ label: String(f.label), value: String(f.value) }));
    const sources = sourcesOf(task).slice(0, 6).map((s) => ({ n: s.n, url: s.url, domain: s.domain }));
    const missing = structured(task).status === 'needs_info' ? missingInfo(task)[0] : '';
    bubbles.push({ who: 'vali', text: plainPlaceholders(shortAnswer(task) || missing || 'Done.'), facts, sources });
    if (missing && shortAnswer(task)) bubbles.push({ who: 'vali', text: missing, tone: 'you' });
  }
  return bubbles.concat(runBubbles(task));
}

function runBubbles(task) {
  const run = task?.execution;
  if (!run) return [];
  const state = runStatus(task);
  const { steps, more } = runSteps(task);
  const where = domainOf(run.current_url || run.start_url);
  const out = [{ who: 'vali', label: where ? `On ${where}` : 'On the site', text: RUN_WORD[state] || 'Working', steps, more,
    tone: ['starting', 'running', 'submitting'].includes(state) ? 'working' : null }];
  const talk = [];
  if (run.question?.text) talk.push({ who: 'vali', text: String(run.question.text), at: String(run.question.at || ''), tone: 'you' });
  for (const m of list(run.inbox)) if (m?.text) talk.push({ who: 'me', text: String(m.text), at: String(m.at || '') });
  out.push(...talk.map((b, i) => ({ ...b, i })).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.i - b.i)).map(({ i, ...b }) => b));
  const approval = run.approval;
  if (approval?.summary || state === 'awaiting_approval') {
    const fields = list(approval?.filled).map((f) => f?.label).filter(Boolean).map(String);
    out.push({ who: 'vali', label: 'Ready for your OK', text: plainPlaceholders(approval?.summary || 'The form is filled.'),
      steps: fields.length ? [`Filled: ${fields.join(', ')}`] : [], tone: state === 'awaiting_approval' ? 'you' : null });
  }
  if (run.approval_decision === 'approved') out.push({ who: 'me', text: 'Approve' });
  if (run.approval_decision === 'stopped') out.push({ who: 'me', text: 'Stop' });
  if (run.error) out.push({ who: 'vali', text: plainPlaceholders(errorText(run.error)), tone: 'failed' });
  else if (state === 'stopped') { /* the state block under the chat says where it stopped */ }
  else if (run.result) out.push({ who: 'vali', text: plainPlaceholders(run.result), tone: 'done' });
  return out;
}

const stamp = (iso) => Date.parse(iso) || 0;
function byNewest(a, b) {
  return stamp(b.at || b.created_at) - stamp(a.at || a.created_at);
}
