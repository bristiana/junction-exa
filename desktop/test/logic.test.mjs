import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskState, mascotState, notificationEvents } from '../logic.mjs';
const task = (status, execution, createdAt = 1) => ({ id: 'one', status, execution, createdAt });
test('execution overrides completed research for every mascot state', () => {
  for (const status of ['starting', 'running', 'submitting']) assert.equal(taskState(task('completed', { status })), 'working');
  assert.equal(taskState(task('completed', { status: 'awaiting_approval' })), 'needs_approval');
  assert.equal(taskState(task('completed', { status: 'awaiting_approval', approval_decision: 'approved' })), 'working');
  assert.equal(taskState(task('completed', { status: 'running', question: { text: 'When?' } })), 'needs_approval');
  assert.equal(taskState(task('completed', { status: 'done' })), 'success');
  assert.equal(taskState(task('completed', { status: 'failed' })), 'error');
  assert.equal(taskState(task('completed', { status: 'stopped' })), 'idle');
});
test('research and empty states map correctly', () => {
  assert.equal(taskState(), 'idle');
  for (const s of ['queued', 'running']) assert.equal(taskState(task(s)), 'working');
  assert.equal(taskState(task('failed')), 'error');
  assert.equal(taskState(task('completed')), 'success');
  assert.equal(taskState(task('cancelled')), 'idle');
});
test('newest active errand wins over newer finished errands; pause rests', () => {
  const ts = [task('running', null, 5), task('completed', { status: 'awaiting_approval' }, 10), task('completed', null, 15)];
  assert.equal(mascotState(ts), 'needs_approval');
  assert.equal(mascotState(ts, true), 'idle');
  assert.equal(mascotState([]), 'idle');
  assert.equal(mascotState([task('failed', null, 5), task('completed', null, 10)]), 'success');
});
test('first poll and repeated snapshots never replay notifications', () => {
  const t = task('completed', { status: 'awaiting_approval', question: { text: 'When?', at: 'a' } });
  assert.deepEqual(notificationEvents(null, t), []);
  assert.deepEqual(notificationEvents(t, structuredClone(t)), []);
});
test('approval, new questions, and completion notify exactly at transitions', () => {
  const running = task('completed', { status: 'running' });
  const approval = task('completed', { status: 'awaiting_approval', approval: { summary: 'Book?' } });
  assert.deepEqual(notificationEvents(running, approval), ['approval']);
  assert.deepEqual(notificationEvents(approval, { ...approval, execution: { ...approval.execution, approval_decision: 'approved' } }), []);
  const q = task('completed', { status: 'running', question: { text: 'When?', at: 'a' } });
  assert.deepEqual(notificationEvents(running, q), ['question']);
  assert.deepEqual(notificationEvents(q, task('completed', { status: 'running', question: { text: 'When?', at: 'b' } })), ['question']);
  assert.deepEqual(notificationEvents(running, task('completed', { status: 'done' })), ['done']);
  assert.deepEqual(notificationEvents(task('running'), task('completed')), ['done']);
  assert.deepEqual(notificationEvents(task('running'), task('completed', { status: 'starting' })), []);
  assert.deepEqual(notificationEvents(running, task('completed', { status: 'failed' })), []);
});

test('prepared research and missing information draw attention', () => {
  const result = status => ({ ...task('completed'), output: { structured: { status } } });
  assert.equal(taskState(result('ready_to_approve')), 'needs_approval');
  assert.equal(taskState(result('needs_info')), 'needs_approval');
  assert.equal(taskState(result('not_possible')), 'error');
  assert.deepEqual(notificationEvents(task('running'), result('ready_to_approve')), ['approval']);
  assert.deepEqual(notificationEvents(task('running'), result('needs_info')), ['question']);
});
