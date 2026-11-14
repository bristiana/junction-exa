// Which Exa capabilities one errand used, with counts, read only from fields the task JSON already has.
// Works on the API's Task (web) and on the extension's local copy of it. No DOM here.
// Edit shared/exa-uses.js; `npm run sync-shared` copies it to extension/shared/ and web/.

const list = (value) => (Array.isArray(value) ? value : []);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// Everything Vali uses Exa for, as plain labels: a static list for settings and the about area.
export const EXA_USES = [
  ["Agent research", "Checks, claims, drafts"],
  ["Search", "Find errands"],
  ["Contents", "Quote check"],
  ["Monitors", "Watches"],
  ["Fast search", "Page tips"],
  ["Form fill", "Search and page reads"],
  ["Live facts", "Service catalog"],
];

// [{ key, label, detail }] for the Exa calls this errand made; empty when none are recorded.
export function exaUses(task) {
  const research = task?.research || {};
  const output = research.output || task?.output || {};
  const trail = list(research.activity);
  const searches = trail.filter((e) => e?.kind === "search").length;
  const pages = trail.filter((e) => e?.kind === "read").length;
  const rows = [];
  const add = (key, label, detail) => rows.push({ key, label, detail });

  if (research.reused_from) {
    add("reuse", "Reuse", "earlier answer, no new calls");
  } else {
    // research.kind: "agent" (check, claim, write), "search" (find), "monitor" (watch, plus a find for today).
    // A local errand from the extension's direct mode has no research.kind, only the Exa run id.
    if (research.kind === "agent" || (!research.kind && task?.runId)) {
      const cited = new Set(list(output.grounding).flatMap((g) => list(g?.citations)).map((c) => c?.url).filter(Boolean)).size;
      add("agent", "Agent research", trail.length ? `${plural(searches, "search", "searches")}, ${plural(pages, "page")}`
        : cited ? `${plural(cited, "page")} cited` : "1 run");
    }
    if ((research.kind === "search" || research.kind === "monitor") && searches) {
      add("search", "Search", `${plural(searches, "query", "queries")}, ${plural(pages, "result")}`);
    }
    if (research.kind === "monitor" && research.watch_id) {
      add("monitor", "Monitor", research.monitor_stubbed === false ? "webhook on" : "saved, not live");
    }
    // The quote check reads the cited pages with Exa Contents; a judged sentence has supported true or false.
    const claims = list(output.claims).filter((c) => c && !c.own);
    const checked = claims.filter((c) => typeof c.supported === "boolean");
    const quoted = list(output.sources).filter((s) => s?.quote).length;
    if (checked.length) {
      add("contents", "Contents", `${checked.filter((c) => c.supported).length} of ${plural(checked.length, "sentence")} quoted`);
    } else if (quoted) {
      add("contents", "Contents", `${plural(quoted, "quote")} found`);
    }
  }

  // The cloud browser's own Exa calls while it filled the form (execution.exa).
  const calls = list(task?.execution?.exa);
  const fillSearches = calls.filter((c) => c?.kind === "search").length;
  const fillReads = calls.filter((c) => c?.kind === "read").length;
  if (fillSearches || fillReads) {
    add("fill", "Form fill", [fillSearches ? plural(fillSearches, "search", "searches") : "",
      fillReads ? plural(fillReads, "page read") : ""].filter(Boolean).join(", "));
  }
  return rows;
}
