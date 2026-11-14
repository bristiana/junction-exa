// Show returned evidence only. Missing counts stay unknown, rather than becoming zero.
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// An http(s) URL without credentials or fragment, as { url, title, host, path }; null otherwise.
function safeSource(item) {
  try {
    const u = new URL(typeof item === "string" ? item : item?.url);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    u.hash = "";
    return { url: u.href, title: item?.title || u.hostname, host: u.hostname.replace(/^www\./, ""), path: u.pathname };
  } catch (_) {
    return null;
  }
}

// The Exa calls the browser agent made while filling the form (execution.exa), oldest first.
function fillingLookups(task) {
  return asArray(task.execution?.exa).filter((e) => e?.kind === "search" || e?.kind === "read").map((e) => {
    const page = e.kind === "read" ? safeSource(e.url) : null;
    const text = e.kind === "search" ? String(e.query || "") : e.question ? String(e.question) : page ? page.host + page.path : "";
    return { kind: e.kind, text, url: page?.url || null, failed: !!e.error,
      results: asArray(e.results).map(safeSource).filter(Boolean) };
  }).filter((e) => e.text);
}

function sourceList(task) {
  const out = task.output || {};
  const research = task.research || {};
  const list = [...asArray(out.grounding).flatMap((g) => asArray(g?.citations)),
    ...asArray(out.sources), ...asArray(out.citations), ...asArray(research.sources),
    ...asArray(research.citations), ...asArray(task.execution?.sources),
    ...asArray(task.execution?.exa).filter((e) => e?.kind === "read").flatMap((e) => asArray(e.results))];
  const sources = new Map();
  for (const item of list) {
    const source = safeSource(item);
    if (source && !sources.has(source.url)) sources.set(source.url, { url: source.url, title: source.title, host: source.host });
  }
  return [...sources.values()];
}

function count(usage, names) {
  for (const key of names) {
    const value = usage?.[key];
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

export function exaActivity(task) {
  const sources = sourceList(task);
  const filling = fillingLookups(task);
  const usage = task.execution?.usage;
  const recorded = (kind) => (filling.length ? filling.filter((e) => e.kind === kind).length : null);
  const searches = count(usage, ["exa_searches", "exa_search_calls", "exa_search"]) ?? count(usage?.exa, ["searches", "search"]) ?? recorded("search");
  const contents = count(usage, ["exa_contents", "exa_contents_calls", "exa_read_calls", "exa_reads", "exa_read"]) ?? count(usage?.exa, ["contents", "reads"]) ?? recorded("read");
  const parts = [];
  if (searches !== null) parts.push(`${searches} search${searches === 1 ? "" : "es"}`);
  if (contents !== null) parts.push(`${contents} page read${contents === 1 ? "" : "s"}`);
  parts.push(`${sources.length} source${sources.length === 1 ? "" : "s"}`);
  const mode = task.mode;
  const method = mode === "find" ? "Found with Exa search on the live web."
    : ["check", "claim", "write"].includes(mode) || task.research?.kind === "agent" ? "Checked with Exa research, which searched and read these sources."
    : mode === "execute" && filling.length ? "Vali looked up what the form needed with Exa search and page reads."
    : mode === "execute" ? "Vali can use Exa search and page contents while filling the form."
    : "Vali uses Exa to find and read sources for this errand.";
  // The queries Exa ran, as the research progress reported them (the newest few, not a count).
  const queries = [...new Set(asArray(task.progress).filter((p) => p?.kind === "search" && p.text).map((p) => String(p.text)))];
  return { summary: `Exa: ${parts.join(", ")}`, method, sources, queries, filling,
    note: searches === null && contents === null ? (sources.length || queries.length ? "" : "Exa call counts were not returned.")
      : mode === "execute" || filling.length ? "Counts cover form filling; research call counts were not returned." : "" };
}
