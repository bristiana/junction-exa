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
  const method = mode === "find" ? "Exa search finds pages for this errand."
    : ["check", "claim", "write"].includes(mode) || task.research?.kind === "agent" ? "Exa research checks sources for this errand."
    : mode === "execute" ? "Vali can use Exa search and page contents while filling the form."
    : "Vali uses Exa to find and read sources for this errand.";
  return { summary: `Exa: ${parts.join(", ")}`, method, sources,
    note: searches === null && contents === null ? "Exa call counts were not returned."
      : mode === "execute" ? "Counts cover form filling; research call counts were not returned." : "" };
}
