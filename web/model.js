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
  if (line.kind === 'read') return `Reading ${domainOf(line.url) || 'a page'} · ${line.text}`;
  return line.text;
}

// One question the research is waiting on, with quick replies: research.question, else nothing.
export function questionOf(task) {
  const question = task?.research?.question;
  if (!question?.text) return null;
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
