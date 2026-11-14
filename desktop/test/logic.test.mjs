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
import { talkError, micError, caption, MAX_VOICE_BYTES, letterType } from '../logic.mjs';
test('talk session errors read plainly', () => {
  assert.match(talkError({ status: 503, message: 'Voice agent is not configured' }), /not set up/);
  assert.match(talkError({ status: 429 }), /few minutes/);
  assert.match(talkError({ status: 502 }), /did not answer/);
  assert.match(talkError({ status: 404, message: 'Not Found' }), /coming soon/);
  assert.equal(talkError({ status: 0, message: "Can't reach the Vali server." }), "Can't reach the Vali server.");
});
test('microphone failures say what to do', () => {
  assert.match(micError({ name: 'NotAllowedError', message: 'Permission denied' }), /System Settings/);
  assert.match(micError({ name: 'NotFoundError' }), /No microphone/);
  assert.match(micError({ name: 'NotReadableError' }), /Another app/);
  assert.equal(micError(new Error('socket closed')), '');
});
test('captions drop audio tags and keep the end of long lines', () => {
  assert.equal(caption('[warmly] Hei!  I am   Vali.'), 'Hei! I am Vali.');
  const long = 'First I looked at every sauna in Helsinki for you. ' + 'Kotiharju is open until ten tonight and costs fifteen euros. Shall I book it?';
  const out = caption(long, 100);
  assert.ok(out.startsWith('…') && out.endsWith('Shall I book it?') && out.length <= 101, out);
});
test('voice and letter limits are checked on the real byte count', () => {
  assert.equal(MAX_VOICE_BYTES, 25 * 1024 * 1024);
  assert.ok(letterType({ name: 'a.pdf', size: 11 * 1024 * 1024 }).error);
});
import { redactSecrets } from '../logic.mjs';
test('console lines lose tokens before they reach stderr', () => {
  const out = redactSecrets('GET https://x/v1/tasks/a/live.jpg?t=abc123&n=1 Authorization: Bearer eyJ.x {"conversation_token":"q.w","secret__vali_session":"u.1.h"} token=zz');
  assert.ok(!/abc123|eyJ|q\.w|u\.1\.h|zz/.test(out), out);
  assert.match(out, /n=1/);
});
import { talkStatus, talkCaption } from '../logic.mjs';
test('the call state reads in plain words', () => {
  assert.equal(talkStatus('connecting'), 'Connecting…');
  assert.equal(talkStatus('listening'), 'Listening');
  assert.equal(talkStatus('speaking'), 'Vali is speaking');
  assert.equal(talkStatus('ended'), 'Call ended');
  assert.equal(talkStatus(''), '');
});
test('captions show the user briefly, then Vali, and a hint before anyone spoke', () => {
  assert.deepEqual(talkCaption({ mode: 'connecting' }), { who: 'vali', text: 'One moment…' });
  assert.match(talkCaption({ mode: 'listening' }).text, /listening/);
  const user = { user: 'Find a sauna', userAt: 1000 };
  assert.deepEqual(talkCaption({ ...user, now: 1500 }), { who: 'you', text: 'Find a sauna' });
  // Vali answers right away: the user's words stay up for the hold, then his line takes over.
  const both = { ...user, agent: 'Kotiharju is open.', agentAt: 1200 };
  assert.equal(talkCaption({ ...both, now: 2000 }).who, 'you');
  assert.deepEqual(talkCaption({ ...both, now: 3600 }), { who: 'vali', text: 'Kotiharju is open.' });
  // The user's newest words stay until Vali says something after them.
  assert.equal(talkCaption({ agent: 'Hei!', agentAt: 500, ...user, now: 9000 }).who, 'you');
});
