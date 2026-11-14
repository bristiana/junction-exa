const ACTIVE = new Set(['starting', 'running', 'awaiting_approval', 'submitting']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
export function taskState(t) {
  if (!t) return 'idle';
  const e = t.execution;
  if (e?.status === 'failed') return 'error';
  if (e?.status === 'stopped') return 'idle';
  if (e?.status === 'done') return 'success';
  if (e?.question || (e?.status === 'awaiting_approval' && !e.approval_decision)) return 'needs_approval';
  if (ACTIVE.has(e?.status)) return 'working';
  if (t.status === 'failed') return 'error';
  if (!TERMINAL.has(t.status)) return 'working';
  if (t.status === 'completed') {
    const status = t.output?.structured?.status;
    if (['ready_to_approve', 'needs_info'].includes(status)) return 'needs_approval';
    if (status === 'not_possible') return 'error';
    return 'success';
  }
  return 'idle';
}
export function mascotState(tasks, paused = false) {
  if (paused) return 'idle';
  const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  return taskState(sorted.find(t => ['working', 'needs_approval'].includes(taskState(t))) || sorted[0]);
}
export function notificationEvents(previous, next) {
  // First poll establishes a baseline: no flood of old completed errands.
  if (!previous) return [];
  const out = [];
  const p = previous.execution || {}, e = next.execution || {};
  if (e.status === 'awaiting_approval' && !e.approval_decision &&
      (p.status !== e.status || p.approval_decision || JSON.stringify(p.approval) !== JSON.stringify(e.approval))) out.push('approval');
  if (e.question && JSON.stringify(e.question) !== JSON.stringify(p.question)) out.push('question');
  if (e.status === 'done' && p.status !== 'done') out.push('done');
  else if (!e.status && next.status === 'completed' && previous.status !== 'completed') {
    const result = next.output?.structured?.status;
    out.push(result === 'ready_to_approve' ? 'approval' : result === 'needs_info' ? 'question' : 'done');
  }
  return out;
}
