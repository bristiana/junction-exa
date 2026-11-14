// The dashboard's numbers and lists, read from GET /v1/tasks, /v1/stats and /v1/watches. Pure, no DOM.
import { channelOf, domainOf, errandStatus, output, safeUrl, sourcesOf, structured } from './model.js';
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
      const channel = raw === 'desktop' ? 'mac' : raw;
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
      exa: exaUses(task).map((use) => `${use.label} ${use.detail}`).join(' · '),
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

const stamp = (iso) => Date.parse(iso) || 0;
function byNewest(a, b) {
  return stamp(b.at || b.created_at) - stamp(a.at || a.created_at);
}
