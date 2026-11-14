import { numberSources, citesFor } from '../vendor/lib/actions.js';
export const ACTIVE = new Set(['starting', 'running', 'awaiting_approval', 'submitting']);
export const normalizeHandle = value => String(value || '').trim().toLowerCase();
export function parseCommand(text) {
  let value = String(text || '').trim().normalize('NFKC').toLowerCase().replace(/\uFE0F/g, '');
  if (value.includes('?') && /^[\p{P}]+$/u.test(value)) return { kind: 'status' };
  value = value.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
  const link = /^(?:link|linkki)\s+((?:[0-9]\s*){6})$/.exec(value);
  if (link) return { kind: 'link', code: link[1].replace(/\s/g, '') };
  if (['da', 'yes', 'ok', 'approve', 'kyllä', 'joo', '👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿'].includes(value)) return { kind: 'approve' };
  if (['nu', 'stop', 'no', 'cancel', 'ei', 'lopeta'].includes(value)) return { kind: 'stop' };
  if (/^[1-9]$/.test(value)) return { kind: 'choose', n: Number(value) };
  if (['status', 'tila'].includes(value)) return { kind: 'status' };
  if (['help', 'apua', 'hi', 'hello', 'moi', 'hei'].includes(value)) return { kind: 'help' };
  return { kind: 'new_errand', text: String(text || '').trim() };
}
export const HELP = 'Vali takes care of your errands. Open the Vali app, get your 6-digit link code, and send link 123456 (use your own code). Send an errand, voice note, or photo of a letter. Reply with an action number, yes to approve, stop to stop, or status.';
export const LINKED = 'Linked! Your Vali app and iMessage now share one task list. Send me an errand.';
export const LINK_FAILED = 'That pairing code is invalid or expired. Get a new 6-digit code from the Vali app and send link 123456 (use your own code).';
const plain = value => String(value || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, '‹$1›').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 – $2').replace(/\*([^*]+)\*/g, '$1');
export function splitText(text, limit = 1500) {
  const parts = [];
  text = plain(text);
  while (text.length > limit) {
    let cut = text.lastIndexOf('\n', limit - 1) + 1;
    if (cut < limit / 2) cut = limit;
    if (/[\uD800-\uDBFF]/.test(text[cut - 1])) cut--;
    parts.push(text.slice(0, cut)); text = text.slice(cut);
  }
  if (text) parts.push(text);
  return parts;
}
export function renderResult(task) {
  const r = task.research || {}, output = r.output || {}, s = output.structured || {};
  if (r.status === 'failed') return 'Research failed. ' + (r.error || 'Please try again.');
  if (r.status === 'cancelled') return 'Research stopped.';
  const { sources, byField } = numberSources(output.grounding || []);
  const suffix = field => {
    const c = citesFor(byField, field);
    return (c.confidence === 'low' ? ' (check)' : '') + c.nums.filter(n => n <= 8).map(n => ` [${n}]`).join('');
  };
  return [plain(s.answer || output.text || 'Vali is still researching this errand.') + suffix('answer'),
    ...(s.key_facts || []).slice(0, 5).map((f, i) => `• ${plain(f.label)}: ${plain(f.value)}${suffix(`key_facts[${i}]`)}`),
    ...(s.actions || []).slice(0, 9).map((a, i) => `Reply ${i + 1} to ${plain(a.label || 'continue')}${suffix(`actions[${i}]`)}`),
    ...(s.missing_info || []).map(q => `• ${plain(q)}`),
    ...sources.slice(0, 8).map(s => `[${s.n}] ${plain(s.title)} – ${s.url}`)].join('\n\n');
}
export function renderExecution(task) {
  const e = task.execution || {};
  if (e.status === 'awaiting_approval') return `Ready to submit: ${plain(e.approval?.summary || 'the prepared form')}.\n${(e.approval?.filled || []).map(f => `${plain(f.label)}: ${plain(f.value)}`).join('; ')}\nReply da or yes to submit, or stop.`;
  if (e.status === 'done') return plain(e.result || 'Done.');
  if (e.status === 'failed') return `Vali could not finish: ${plain(e.error || 'the page could not be completed')}\n${e.final_url || e.current_url || e.start_url || ''}`;
  if (e.status === 'stopped') return 'Stopped. Vali will not submit this errand.';
  if (e.status === 'submitting') return 'Submitting your approved errand.';
  return 'Working on it: ' + plain(e.steps?.at(-1)?.text || 'starting your errand');
}
export function activeTask(tasks) {
  return tasks.find(t => ACTIVE.has(t.execution?.status)) || tasks.find(t => t.research?.status === 'completed' && !t.execution) || tasks[0];
}
