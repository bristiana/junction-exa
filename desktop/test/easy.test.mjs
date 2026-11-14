import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildErrand, suggest, frontBrowser, tabScript, parseTab, comingSoon, voiceOutcome, letterType, sealConfig, openConfig, plainStatus, glanceItems, badgeOf } from '../logic.mjs';
import { grabSelection } from '../mac.mjs';
import { makeApi } from '../api.mjs';

test('errand with a page keeps context in page; selection alone goes inline; personal data is redacted', () => {
  const withPage = buildErrand({ text: 'What is this?', selection: 'Call me on 040 123 4567', page: { url: 'https://kela.fi/x', title: 'Kela' } });
  assert.equal(withPage.task, 'What is this?');
  assert.equal(withPage.page.url, 'https://kela.fi/x');
  assert.ok(!withPage.page.selection.includes('040 123 4567'));
  const inline = buildErrand({ text: '', selection: 'Eräpäivä 30.11.' });
  assert.equal(inline.page, null);
  assert.match(inline.task, /^Explain this.*\n\nAbout this text:\n"""Eräpäivä 30\.11\."""$/s);
  assert.equal(buildErrand({ text: 'x', page: { url: 'file:///etc/passwd' } }).page, null);
  assert.throws(() => buildErrand({ text: '  ' }), /Tell Vali/);
});

test('suggestions put the context first and match every typed word', () => {
  assert.match(suggest('', { selection: true })[0], /Explain this/);
  assert.match(suggest('', { letter: true })[0], /letter/);
  assert.deepEqual(suggest('sauna saturday'), ['Find a public sauna in Helsinki for this Saturday evening']);
  assert.equal(suggest('').length, 5);
  assert.deepEqual(suggest('Register my change of address'), []);
});

test('only a browser in front (other than Vali) gives page context', () => {
  assert.equal(frontBrowser('ASN:0x0-1-"Electron": ASN:0x0-2-"Google_Chrome": ASN:0x0-3-"Finder":'), 'Google Chrome');
  assert.equal(frontBrowser('ASN:0x0-1-"Finder": ASN:0x0-2-"Safari":'), null);
  assert.equal(frontBrowser('ASN:0x0-1-"Safari":'), 'Safari');
  assert.equal(frontBrowser(null), null);
  assert.match(tabScript('Safari'), /current tab of front window[\s\S]*name of t/);
  assert.match(tabScript('Google Chrome'), /if application "Google Chrome" is running/);
  assert.deepEqual(parseTab('https://kela.fi/a\nKela – students\n'), { url: 'https://kela.fi/a', title: 'Kela – students' });
  assert.equal(parseTab('chrome://settings\nSettings'), null);
  assert.equal(parseTab(''), null);
});

test('missing endpoints read as coming soon; voice answers in either shape', () => {
  assert.ok(comingSoon({ status: 404, message: 'Not Found' }) && comingSoon({ status: 405 }) && !comingSoon({ status: 500 }) && !comingSoon(null));
  assert.ok(!comingSoon({ status: 404, message: 'Link code not found or expired' }));
  assert.deepEqual(voiceOutcome({ text: 'hi' }), { text: 'hi', task: null });
  const task = { id: 't1', research: {}, task: 'Book a sauna' };
  assert.equal(voiceOutcome({ task, text: 'Book a sauna' }).task, task);
  assert.equal(voiceOutcome({ ...task, text: 'Book a sauna' }).task.id, 't1');
  assert.deepEqual(voiceOutcome(null), { text: '', task: null });
});

test('letters: photos and PDFs only, by type or extension, up to 15 MB', () => {
  assert.equal(letterType({ name: 'a.pdf', type: '', size: 10 }).mime, 'application/pdf');
  assert.equal(letterType({ name: 'IMG_1.HEIC', type: '', size: 10 }).mime, 'image/heic');
  assert.equal(letterType({ name: 'x', type: 'image/png', size: 10 }).mime, 'image/png');
  assert.match(letterType({ name: 'a.docx', type: 'application/msword' }).error, /photo or a PDF/);
  assert.match(letterType({ name: 'a.jpg', size: 11 * 1024 * 1024 }).error, /too big/);
  assert.match(letterType({ name: 'a.gif', type: 'image/gif' }).error, /photo or a PDF/);
});

test('token and profile are only stored encrypted', () => {
  const enc = s => 'E(' + Buffer.from(s).toString('base64') + ')', dec = s => Buffer.from(s.slice(2, -1), 'base64').toString();
  const config = { backendUrl: 'https://x', backendToken: 'secret-token', profile: { name: 'Testi Henkilö', personal_id: '010101-123N', email: '' }, connectionError: 'x' };
  const sealed = sealConfig(config, enc);
  const text = JSON.stringify(sealed);
  assert.ok(!text.includes('secret-token') && !text.includes('Testi') && !text.includes('010101') && !('connectionError' in sealed));
  const opened = openConfig(sealed, dec);
  assert.equal(opened.backendToken, 'secret-token');
  assert.deepEqual(opened.profile, { name: 'Testi Henkilö', personal_id: '010101-123N' });
  assert.deepEqual(openConfig({ backendUrl: 'https://x' }, dec).profile, {});
  assert.ok(!('encryptedProfile' in sealConfig({ profile: {} }, enc)));
});

test('glance: plain words, what needs you first, finished today only; badge counts running errands', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const approval = { id: 'a', task: 'Book', createdAt: now - 1000, status: 'completed', execution: { status: 'awaiting_approval', approval: { summary: 'OK?' } } };
  const question = { id: 'q', task: 'Claim', createdAt: now - 2000, status: 'completed', execution: { status: 'running', question: { text: 'When?', at: 'x' } } };
  const research = { id: 'r', task: 'Find', createdAt: now - 500, status: 'running' };
  const doneToday = { id: 'd', task: 'Done', createdAt: now - 3000, completedAt: now - 2500, status: 'completed', seen: true, output: { structured: { status: 'info_only' } } };
  const old = { id: 'o', task: 'Old', createdAt: now - 3 * 86400000, completedAt: now - 3 * 86400000, status: 'completed', seen: true };
  const blocked = { id: 'b', task: 'Login', createdAt: now - 4000, status: 'completed', seen: false, execution: { status: 'failed', result: 'needs login: finish by hand at https://x.fi' } };
  assert.equal(plainStatus(approval).label, 'Waiting for your OK');
  assert.equal(plainStatus(question).label, 'Needs your answer');
  assert.equal(plainStatus(research).label, 'Working');
  assert.equal(plainStatus(blocked).label, 'Needs login');
  assert.equal(plainStatus({ ...research, status: 'failed' }).label, 'Couldn’t finish');
  assert.equal(plainStatus({ ...blocked, seen: true }).needsYou, false);
  assert.equal(plainStatus({ ...approval, execution: { ...approval.execution, approval_decision: 'approved' } }).needsYou, false);
  const ids = glanceItems([old, doneToday, research, approval, question, blocked], now).map(x => x.t.id);
  assert.deepEqual(ids, ['a', 'q', 'b', 'r', 'd']);
  assert.deepEqual(badgeOf([old, doneToday, research, approval, question]), { count: 3, needsYou: true, attention: 'approval' });
  assert.deepEqual(badgeOf([doneToday]), { count: 0, needsYou: false });
});

test('selection grab restores the clipboard and falls back to the clipboard without Accessibility', async () => {
  const fake = (text, onCopy) => {
    let clip = { text };
    return { clip: () => clip, readText: () => clip.text || '', readHTML: () => clip.html || '', readRTF: () => '', readImage: () => ({ isEmpty: () => true }), writeText: t => { clip = { text: t }; }, write: v => { clip = { ...v }; }, clear: () => { clip = {}; }, copy: () => onCopy && (clip = { text: onCopy }) };
  };
  const cb = fake('old clipboard', 'selected words');
  const got = await grabSelection({ clipboard: cb, trusted: true, keystroke: async () => cb.copy() });
  assert.deepEqual(got, { text: 'selected words', via: 'selection' });
  assert.equal(cb.clip().text, 'old clipboard');
  const none = fake('old', null);
  assert.deepEqual(await grabSelection({ clipboard: none, trusted: true, keystroke: async () => {} }), { text: '', via: 'none' });
  assert.equal(none.clip().text, 'old');
  assert.deepEqual(await grabSelection({ clipboard: fake('from clipboard'), trusted: false }), { text: 'from clipboard', via: 'clipboard' });
});

test('API client posts uploads as multipart and link codes as JSON', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return new Response(JSON.stringify({ text: 'hello', token: 'new' }), { status: 200 }); };
  const api = makeApi({ baseUrl: 'https://vali.test', token: 'tok', fetchImpl });
  await api.voice(new Uint8Array([1, 2, 3]).buffer, 'audio/webm', { create: true });
  const form = calls[0].opts.body;
  assert.equal(calls[0].url, 'https://vali.test/v1/voice');
  assert.equal(form.get('create'), '1');
  assert.equal((await form.get('audio').arrayBuffer()).byteLength, 3);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
  assert.ok(!('Content-Type' in calls[0].opts.headers));
  await api.letter(new Uint8Array([9]), 'application/pdf', 'letter.pdf', 'what is this?');
  assert.equal(calls[1].opts.body.get('note'), 'what is this?');
  await makeApi({ baseUrl: 'https://vali.test', fetchImpl }).link('123 456');
  assert.equal(calls[2].opts.body, '{"code":"123456"}');
  assert.ok(!calls[2].opts.headers.Authorization);
  const notFound = makeApi({ baseUrl: 'https://vali.test', token: 't', fetchImpl: async () => new Response('{"detail":"Not Found"}', { status: 404 }) });
  await assert.rejects(notFound.linkCode(), e => e.status === 404 && comingSoon(e));
  const badCode = makeApi({ baseUrl: 'https://vali.test', fetchImpl: async () => new Response('{"detail":"Link code not found or expired"}', { status: 404 }) });
  await assert.rejects(badCode.link('123456'), e => e.status === 404 && !comingSoon(e));
});
