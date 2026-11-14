import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestEdge, edgeSpot, typingNear, nextPlace, restoreSpot, asleep, bubbleLine, contextLine, PEEK, PEEK_IN, SLEEP_MS } from '../valet.mjs';
const area = { x: 0, y: 25, width: 1440, height: 875 };
const box = (x, y) => ({ x, y, width: 210, height: 300 });

test('Vali steps aside to the nearest side, never the top', () => {
  assert.equal(nearestEdge(box(1210, 580), area), 'right');
  assert.equal(nearestEdge(box(20, 300), area), 'left');
  assert.equal(nearestEdge(box(600, 590), area), 'bottom');
  assert.equal(nearestEdge(box(100, 30), area), 'left', 'top-left corner goes left, not up');
});
test('tucked leaves 64 points on screen, peek 120, at the same height', () => {
  assert.deepEqual(edgeSpot(box(1210, 580), area, 'right'), { x: 1440 - PEEK, y: 580 });
  assert.deepEqual(edgeSpot(box(1210, 580), area, 'right', PEEK_IN), { x: 1440 - PEEK_IN, y: 580 });
  assert.deepEqual(edgeSpot(box(20, 300), area, 'left'), { x: PEEK - 210, y: 300 });
  assert.deepEqual(edgeSpot(box(600, 590), area, 'bottom'), { x: 600, y: 900 - PEEK });
  // A window half off screen is pulled back in along the edge.
  assert.deepEqual(edgeSpot(box(1300, 800), area, 'right'), { x: 1440 - PEEK, y: 600 });
});
test('typing near: input this second, pointer still and close', () => {
  const bounds = box(1210, 580), p = { x: 1100, y: 700 };
  assert.equal(typingNear({ idleSec: 0, pointer: p, lastPointer: { ...p }, bounds }), true);
  assert.equal(typingNear({ idleSec: 1, pointer: p, lastPointer: p, bounds }), false, 'no input');
  assert.equal(typingNear({ idleSec: 0, pointer: p, lastPointer: { x: 1090, y: 700 }, bounds }), false, 'the mouse moved');
  assert.equal(typingNear({ idleSec: 0, pointer: { x: 300, y: 300 }, lastPointer: { x: 300, y: 300 }, bounds }), false, 'far away');
  assert.equal(typingNear({ idleSec: 0, pointer: { x: 1300, y: 700 }, lastPointer: { x: 1300, y: 700 }, bounds }), true, 'over him');
  assert.equal(typingNear({ idleSec: 0, pointer: p, lastPointer: null, bounds }), false);
});
test('places: typing tucks, needing you peeks, hover brings him home', () => {
  assert.equal(nextPlace('home', {}), 'home');
  assert.equal(nextPlace('home', { needsYou: true }), 'home', 'at home the bell rings in place');
  assert.equal(nextPlace('home', { typing: true }), 'tucked');
  assert.equal(nextPlace('home', { typing: true, needsYou: true }), 'peek');
  assert.equal(nextPlace('tucked', { needsYou: true }), 'peek');
  assert.equal(nextPlace('peek', {}), 'tucked');
  assert.equal(nextPlace('tucked', { typing: true }), 'tucked');
  assert.equal(nextPlace('peek', { hovering: true }), 'home');
  assert.equal(nextPlace('home', { hovering: true }), 'home');
});
test('the saved spot comes back only on a display that is still there', () => {
  const size = { width: 210, height: 300 };
  assert.deepEqual(restoreSpot({ x: 100, y: 200 }, [area], size), { x: 100, y: 200 });
  assert.deepEqual(restoreSpot({ x: 1300, y: 200 }, [area], size), { x: 1230, y: 200 }, 'clamped inside');
  assert.equal(restoreSpot({ x: 3000, y: 200 }, [area], size), null, 'monitor unplugged');
  assert.deepEqual(restoreSpot({ x: 3000, y: 200 }, [area, { x: 1440, y: 0, width: 1920, height: 1080 }], size), { x: 3000, y: 200 });
  assert.equal(restoreSpot(undefined, [area], size), null);
  assert.equal(restoreSpot({ x: 'a', y: 1 }, [area], size), null);
});
test('sleeps after five quiet minutes, never while busy', () => {
  assert.equal(asleep({ busy: false, lastBusyAt: 0, now: SLEEP_MS - 1 }), false);
  assert.equal(asleep({ busy: false, lastBusyAt: 0, now: SLEEP_MS }), true);
  assert.equal(asleep({ busy: true, lastBusyAt: 0, now: SLEEP_MS * 2 }), false);
});
test('one first-person bubble line per state', () => {
  assert.equal(bubbleLine({ pose: 'working', badge: { count: 1 } }), 'I’m on it.');
  assert.equal(bubbleLine({ pose: 'working', badge: { count: 3 } }), 'I’m on 3 errands.');
  assert.equal(bubbleLine({ pose: 'needs_approval', badge: { needsYou: true } }), 'I need your OK on an errand.');
  assert.equal(bubbleLine({ pose: 'success' }), 'All done. Have a look.');
  assert.equal(bubbleLine({ pose: 'error' }), 'I couldn’t finish one. Have a look.');
  assert.equal(bubbleLine({ pose: 'idle', sleeping: true }), 'Resting. Hover to wake me.');
  assert.equal(bubbleLine({ pose: 'working', paused: true, badge: { needsYou: true } }), 'I’m paused. Errands in the cloud keep going.');
  assert.equal(bubbleLine({ sleeping: true, badge: { needsYou: true } }), 'I need your OK on an errand.', 'needing you beats sleep');
  assert.equal(bubbleLine(), 'At your service.');
});
test('the tab offer names the site only', () => {
  assert.equal(contextLine({ url: 'https://www.kela.fi/opiskelijat?x=secret', title: 'Kela' }), 'On kela.fi? I can help with this page.');
  assert.equal(contextLine(null), '');
  assert.equal(contextLine({ url: 'not a url' }), '');
});
import { openEdges } from '../valet.mjs';
test('Vali only steps off a side with no monitor next to it, else stays put', () => {
  const laptop = { x: 0, y: 0, width: 1440, height: 900 };
  assert.deepEqual(openEdges(laptop, []), ['right', 'left', 'bottom']);
  assert.deepEqual(openEdges(laptop, [{ x: 1440, y: -200, width: 1920, height: 1080 }]), ['left', 'bottom'], 'monitor on the right');
  assert.deepEqual(openEdges(laptop, [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 0, y: 900, width: 1440, height: 900 }]), ['right']);
  assert.deepEqual(openEdges(laptop, [{ x: 1440, y: 2000, width: 800, height: 600 }]), ['right', 'left', 'bottom'], 'touching only at a corner gap');
  assert.equal(nearestEdge(box(1210, 580), area, ['left', 'bottom']), 'bottom', 'right is taken: next closest');
  assert.equal(nearestEdge(box(1210, 580), area, []), null);
});

import { badgeOf } from '../logic.mjs';
const attentionTask = execution => ({ status: 'completed', execution });
const lineFor = tasks => bubbleLine({ badge: badgeOf(tasks) });
test('bubble distinguishes approval, question and research requests', () => {
  const approval = attentionTask({ status: 'awaiting_approval' });
  const question = attentionTask({ status: 'running', question: { text: 'When?' } });
  assert.equal(lineFor([approval]), 'I need your OK on an errand.');
  assert.equal(lineFor([question]), 'I have a question about an errand.');
  assert.equal(lineFor([{ ...approval, execution: { ...approval.execution, question: { text: 'When?' } } }]), 'I have a question about an errand.');
  for (const [status, line] of [['ready_to_approve', 'I need your OK on an errand.'], ['needs_info', 'I have a question about an errand.']]) {
    assert.equal(lineFor([{ status: 'completed', mode: 'claim', output: { structured: { status } } }]), line);
  }
  assert.equal(lineFor([question, approval]), 'I have a question about an errand.');
  assert.equal(lineFor([approval, question]), 'I need your OK on an errand.');
});
test('bubble asks for a step on login, captcha and payment hand-offs', () => {
  for (const kind of ['login', 'captcha', 'payment']) {
    const blocked = attentionTask({ status: 'failed', result: `needs ${kind}: finish by hand at https://example.com` });
    assert.equal(lineFor([blocked]), 'I need you to finish a step.');
    assert.equal(lineFor([{ ...blocked, seen: true }]), 'At your service.');
  }
});
test('stale questions and accepted approvals do not ask for attention', () => {
  for (const status of ['done', 'failed', 'stopped']) {
    assert.equal(badgeOf([attentionTask({ status, question: { text: 'When?' } })]).needsYou, false);
  }
  assert.equal(badgeOf([attentionTask({ status: 'awaiting_approval', approval_decision: 'approved' })]).needsYou, false);
});
