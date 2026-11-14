// Show returned evidence only. Missing counts stay unknown, rather than becoming zero.
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sourceList(task) {
  const out = task.output || {};
  const research = task.research || {};
  const list = [...asArray(out.grounding).flatMap((g) => asArray(g?.citations)),
    ...asArray(out.sources), ...asArray(out.citations), ...asArray(research.sources),
    ...asArray(research.citations), ...asArray(task.execution?.sources)];
  const sources = new Map();
  for (const item of list) {
    try {
      const u = new URL(typeof item === "string" ? item : item?.url);
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) continue;
      u.hash = "";
      if (!sources.has(u.href)) sources.set(u.href, { url: u.href, title: item.title || u.hostname, host: u.hostname.replace(/^www\./, "") });
    } catch (_) {}
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
  const usage = task.execution?.usage;
  const searches = count(usage, ["exa_searches", "exa_search_calls", "exa_search"]) ?? count(usage?.exa, ["searches", "search"]);
  const contents = count(usage, ["exa_contents", "exa_contents_calls", "exa_read_calls", "exa_reads", "exa_read"]) ?? count(usage?.exa, ["contents", "reads"]);
  const parts = [];
  if (searches !== null) parts.push(`${searches} search${searches === 1 ? "" : "es"}`);
  if (contents !== null) parts.push(`${contents} page read${contents === 1 ? "" : "s"}`);
  parts.push(`${sources.length} source${sources.length === 1 ? "" : "s"}`);
  const mode = task.mode;
  const method = mode === "find" ? "Found with Exa search on the live web."
    : ["check", "claim", "write"].includes(mode) || task.research?.kind === "agent" ? "Checked with Exa research, which searched and read these sources."
    : mode === "execute" ? "Vali can use Exa search and page contents while filling the form."
    : "Vali uses Exa to find and read sources for this errand.";
  // The queries Exa ran, as the research progress reported them (the newest few, not a count).
  const queries = [...new Set(asArray(task.progress).filter((p) => p?.kind === "search" && p.text).map((p) => String(p.text)))];
  return { summary: `Exa: ${parts.join(", ")}`, method, sources, queries,
    note: searches === null && contents === null ? (sources.length || queries.length ? "" : "Exa call counts were not returned.")
      : mode === "execute" ? "Counts cover form filling; research call counts were not returned." : "" };
}
