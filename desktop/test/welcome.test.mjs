import { test } from 'node:test';
import assert from 'node:assert/strict';
import { welcomeStep, keyLabel, SAMPLE_ERRAND, WELCOME_LINE } from '../welcome.mjs';
import { bubbleLine } from '../valet.mjs';

test('a fresh install shows the welcome right away', () => {
  assert.equal(welcomeStep({ freshInstall: true }), 'show');
});
test('an account from before waits for its errands, then shows only if there are none', () => {
  assert.equal(welcomeStep({ freshInstall: false, polled: false }), 'wait');
  assert.equal(welcomeStep({ freshInstall: false, polled: true }), 'show');
  assert.equal(welcomeStep({ freshInstall: false, polled: true, taskCount: 3 }), 'done');
});
test('the first errand dismisses the welcome for good', () => {
  assert.equal(welcomeStep({ freshInstall: true, taskCount: 1 }), 'done');
  assert.equal(welcomeStep({ freshInstall: true, polled: true, taskCount: 1 }), 'done');
});
test('once dismissed (first errand or close) it never comes back', () => {
  for (const s of [{ freshInstall: true }, { polled: true }, { taskCount: 0 }, { taskCount: 4 }]) assert.equal(welcomeStep({ ...s, dismissed: true }), 'off');
});
test('shortcuts read like macOS menus, with a fallback when none is registered', () => {
  assert.equal(keyLabel('Alt+Space'), '⌥Space');
  assert.equal(keyLabel('Alt+Shift+Space'), '⌥⇧Space');
  assert.equal(keyLabel('Alt+V'), '⌥V');
  assert.equal(keyLabel('', 'Alt+Space'), '⌥Space');
  assert.equal(keyLabel(undefined), '');
});
test('the bubble welcomes on first run, but what needs you, pause and sleep come first', () => {
  assert.equal(bubbleLine({ welcome: true }), WELCOME_LINE);
  assert.equal(bubbleLine({ welcome: true, badge: { needsYou: true, attention: 'question' } }), 'I have a question about an errand.');
  assert.match(bubbleLine({ welcome: true, paused: true }), /paused/);
  assert.match(bubbleLine({ welcome: true, sleeping: true }), /Resting/);
  assert.equal(bubbleLine({}), 'At your service.');
});
test('the sample errand is the one the demo needs', () => {
  assert.equal(SAMPLE_ERRAND, 'Find a public sauna in Helsinki open on Saturday evening');
});
