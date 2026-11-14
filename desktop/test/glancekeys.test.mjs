import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glanceKeyAction as act } from '../glancekeys.mjs';

test('arrows move one errand at a time and stop at the ends', () => {
  assert.deepEqual(act('ArrowDown', { index: -1, count: 3 }), { type: 'move', index: 0 });
  assert.deepEqual(act('ArrowDown', { index: 1, count: 3 }), { type: 'move', index: 2 });
  assert.deepEqual(act('ArrowDown', { index: 2, count: 3 }), { type: 'move', index: 2 });
  assert.deepEqual(act('ArrowUp', { index: 0, count: 3 }), { type: 'move', index: 0 });
  assert.deepEqual(act('ArrowUp', { index: 2, count: 3 }), { type: 'move', index: 1 });
});
test('A approves only when the errand shows Approve; S stops only when it shows Stop', () => {
  assert.equal(act('a', { index: 0, count: 2 }), null);
  assert.deepEqual(act('A', { index: 0, count: 2, hasApprove: true }), { type: 'approve' });
  assert.equal(act('s', { index: 0, count: 2 }), null);
  assert.deepEqual(act('s', { index: 0, count: 2, hasStop: true }), { type: 'stop' });
});
test('nothing acts before an errand is focused', () => {
  for (const key of ['Enter', 'a', 's']) assert.equal(act(key, { index: -1, count: 2, hasApprove: true, hasStop: true }), null);
});
test('Enter opens the errand, but leaves a focused button to do its own click', () => {
  assert.deepEqual(act('Enter', { index: 1, count: 2 }), { type: 'open' });
  assert.equal(act('Enter', { index: 1, count: 2, onButton: true }), null);
});
test('typing an answer never triggers a shortcut, except Esc closes', () => {
  assert.equal(act('a', { index: 0, count: 1, hasApprove: true, field: true }), null);
  assert.equal(act('ArrowDown', { index: 0, count: 2, field: true }), null);
  assert.deepEqual(act('Escape', { field: true }), { type: 'close' });
});
test('other keys and an empty list do nothing', () => {
  assert.equal(act('x', { index: 0, count: 1, hasApprove: true, hasStop: true }), null);
  assert.equal(act('ArrowDown', { count: 0 }), null);
});
