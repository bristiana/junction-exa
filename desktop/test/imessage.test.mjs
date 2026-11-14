import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir, symlink, truncate } from 'node:fs/promises';
import path from 'node:path';
import { fixture, blob } from './fixtures/chatdb.mjs';
import { openDb, readSince, messageText, decodeAttributedBody, maxRowId } from '../imessage/db.mjs';
import { createBridge, PERMISSIONS } from '../imessage/bridge.mjs';
import { createSender } from '../imessage/send.mjs';
import { convertVoice, readyAttachment, readLetter, voiceBytes } from '../imessage/media.mjs';
import { parseCommand, splitText, activeTask, renderResult } from '../imessage/text.mjs';
import { makeMessageBridge } from '../imessage/runtime.mjs';
import { MAX_VOICE_BYTES, MAX_LETTER_BYTES } from '../logic.mjs';
import { makeApi } from '../api.mjs';

const sender = 'judge@icloud.com';
const queued = id => ({ id, task: 'Find a sauna', research: { status: 'queued' }, execution: null });
const completed = id => ({ ...queued(id), research: { status: 'completed', output: { structured: { answer: 'Found a sauna.', actions: [{ label: 'Book', url: 'https://example.com' }] } } } });
const executing = status => ({ ...completed('t1'), execution: { status, approval: { summary: 'Book the sauna' } } });
async function harness(t, options = {}) {
  const f = fixture(); t.after(() => f.close());
  let clock = Date.now(), remote = [];
  const calls = [], sends = [], saves = [];
  const settings = { links: { [sender]: 'sealed:secret' }, ...options.settings };
  const api = {
    link: async code => { calls.push(['link', code]); return { token: 'new-token' }; },
    listTasks: async () => ({ tasks: remote }),
    createTask: async body => { calls.push(['create', body]); const task = queued('t1'); remote = [task]; return task; },
    getTask: async id => { calls.push(['get', id]); return remote.find(t => t.id === id); },
    approve: async id => { calls.push(['approve', id]); remote = [executing('submitting')]; return remote[0]; },
    stop: async id => { calls.push(['stop', id]); remote = [executing('stopped')]; return remote[0]; },
    execute: async (id, body) => { calls.push(['execute', id, body]); remote = [executing('running')]; return remote[0]; },
    message: async (id, text) => { calls.push(['message', id, text]); return remote[0]; },
    voice: async (...args) => { calls.push(['voice', ...args]); remote = [queued('voice-task')]; return remote[0]; },
    letter: async (...args) => { calls.push(['letter', ...args]); return queued('letter'); }, liveFrame: async () => Buffer.from('image'), ...options.api
  };
  const make = () => createBridge({ dbPath: f.file, outbox: path.join(f.dir, 'outbox'), settings, save: async () => saves.push(structuredClone(settings)),
    encrypt: token => 'sealed:' + token, decrypt: token => { assert.ok(token.startsWith('sealed:')); return token.slice(7); },
    api: token => { calls.push(['token', token]); return api; }, now: () => clock,
    script: options.script || (async () => '1'), send: options.send || (async (...args) => sends.push(args)),
    voice: options.voice, ready: options.ready });
  const b = make(); t.after(() => b.dispose());
  if (options.before) options.before(f);
  await b.enable();
  return { f, b, settings, calls, sends, saves, api, make,
    set tasks(value) { remote = value; }, advance(ms) { clock += ms; },
    async text(text, extra = {}) { const id = f.add({ text, ...extra }); await b.tick(); return id; }
  };
}

for (const [label, text, wide] of [['short', 'hello', false], ['long', 'a'.repeat(300), false], ['unicode', 'Hyvää yötä 👍', false], ['four-byte length', 'b'.repeat(400), true]]) {
  test(`attributed body: ${label}`, () => assert.equal(decodeAttributedBody(blob(text, wide)), text));
}
test('malformed bodies fail closed; text takes precedence; placeholder falls back', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('NSString+\x81'), Buffer.from('NSString+\x82\x01'), Buffer.from('NSString+\x7fno')]) assert.equal(decodeAttributedBody(bytes), '');
  assert.equal(messageText({ text: 'plain', attributedBody: blob('blob') }), 'plain');
  assert.equal(messageText({ text: '\uFFFC', attributedBody: blob('body') }), 'body');
  assert.equal(messageText({ text: '\uFFFC' }), '');
});
test('short-lived read-only reader picks up WAL rows and rejects writes', t => {
  const f = fixture(); t.after(() => f.close()); const id = f.add({ text: null, body: blob('new') });
  const db = openDb(f.file);
  try { assert.equal(maxRowId(db), id); assert.equal(messageText(readSince(db, 0)[0]), 'new'); assert.throws(() => db.exec("DELETE FROM message")); }
  finally { db.close(); }
});
test('enable skips existing history; new incoming rows create exactly one task', async t => {
  const h = await harness(t, { before: f => f.add() });
  await h.b.tick(); assert.equal(h.calls.filter(c => c[0] === 'create').length, 0);
  await h.text('Book a sauna'); await h.b.tick();
  assert.deepEqual(h.calls.find(c => c[0] === 'create'), ['create', { task: 'Book a sauna' }]);
  assert.deepEqual(h.settings.tasks[sender], ['t1']);
  assert.equal(h.calls.filter(c => c[0] === 'create').length, 1);
  assert.ok(h.saves.some(s => s.lastRowId === 2 && !s.tasks[sender]));
});
test('persisted ROWID and duplicate GUID prevent replay across ticks and restart', async t => {
  const h = await harness(t); await h.text('First', { guid: 'same' });
  await h.text('Duplicate', { guid: 'same' });
  assert.equal(h.calls.filter(c => c[0] === 'create').length, 1);
  await h.b.dispose(); const b = h.make(); t.after(() => b.dispose()); await b.enable(); await b.tick();
  assert.equal(h.calls.filter(c => c[0] === 'create').length, 1);
});
test('groups, SMS, sent messages, tapbacks, events and old synced rows are ignored', async t => {
  const h = await harness(t);
  for (const extra of [{ chat: h.f.addChat(43) }, { service: 'SMS' }, { from: 1 }, { associated: 2000 }, { item: 1 }, { date: 1 }]) {
    h.f.add({ text: null, body: blob('secret'), ...extra });
  }
  await h.b.tick(); assert.equal(h.sends.length, 0); assert.equal(h.calls.length, 0);
});
test('open unknown sender gets help once per day; allowlist blocks link too', async t => {
  const h = await harness(t, { settings: { links: {} } });
  await h.text('Hi'); await h.text('Hi again'); assert.equal(h.sends.length, 1);
  h.advance(86400001); await h.text('Hi'); assert.equal(h.sends.length, 2);
  await h.b.configure({ mode: 'allowlist', allowed: ['OTHER@icloud.com'] });
  await h.text('link 123456'); assert.equal(h.calls.length, 0); assert.equal(h.sends.length, 2);
});
test('link flow redeems spaced code anonymously and persists only encrypted token', async t => {
  const h = await harness(t, { settings: { links: {} } });
  await h.text('Linkki 123 456');
  assert.deepEqual(h.calls.slice(0, 2), [['token', ''], ['link', '123456']]);
  assert.equal(h.settings.links[sender], 'sealed:new-token');
  assert.match(h.sends[0][1], /Linked!/);
  await h.text('Find a dentist'); assert.ok(h.calls.some(c => c[0] === 'token' && c[1] === 'new-token'));
});
test('expired link stores nothing', async t => {
  const h = await harness(t, { settings: { links: {} }, api: { link: async () => { throw Object.assign(new Error(), { status: 404 }); } } });
  await h.text('link 123456'); assert.deepEqual(h.settings.links, {}); assert.match(h.sends[0][1], /invalid or expired/);
});
test('sender tokens stay separate and unlink removes ownership', async t => {
  const h = await harness(t, { settings: { links: { [sender]: 'sealed:first', 'other@icloud.com': 'sealed:second' } } });
  await h.text('Find coffee', { handle: h.f.addHandle('OTHER@icloud.com') });
  assert.ok(h.calls.some(c => c[0] === 'token' && c[1] === 'second'));
  assert.ok(!h.calls.some(c => c[0] === 'token' && c[1] === 'first'));
  await h.b.unlink('OTHER@icloud.com'); assert.equal(h.settings.links['other@icloud.com'], undefined);
});
test('research result follows only owned task and is sent once', async t => {
  const h = await harness(t); await h.text('Find a sauna'); h.tasks = [completed('t1')];
  await h.b.followTasks(); await h.b.followTasks();
  assert.equal(h.sends.filter(s => s[1].includes('Found a sauna')).length, 1);
  assert.deepEqual(h.settings.tasks[sender], []);
});
for (const word of ['yes', 'da', 'ok', 'stop', 'nu']) {
  test(`${word} changes execution only while waiting for approval`, async t => {
    const h = await harness(t); h.tasks = [completed('t1')]; await h.text(word);
    assert.ok(!h.calls.some(c => ['approve', 'stop', 'create'].includes(c[0])));
    h.tasks = [executing('awaiting_approval')]; await h.text(word);
    assert.equal(h.calls.filter(c => c[0] === (['stop', 'nu'].includes(word) ? 'stop' : 'approve')).length, 1);
  });
}
test('short yes answers running task; nu answers open question; stop cannot stop running task', async t => {
  const h = await harness(t); h.tasks = [executing('running')]; await h.text('yes');
  h.tasks = [{ ...executing('awaiting_approval'), execution: { status: 'awaiting_approval', question: { text: 'Include breakfast?' } } }];
  await h.text('nu'); h.tasks = [executing('running')]; await h.text('stop');
  assert.deepEqual(h.calls.filter(c => c[0] === 'message').map(c => c[2]), ['yes', 'nu']);
  assert.ok(!h.calls.some(c => c[0] === 'stop' || c[0] === 'approve'));
});
test('active selection prioritizes older running task over newer research', () => {
  assert.equal(activeTask([completed('new'), executing('running')]).id, 't1');
  assert.equal(activeTask([queued('new'), completed('ready')]).id, 'ready');
});
test('number chooses available completed action and tracks execution', async t => {
  const h = await harness(t); h.tasks = [completed('t1')]; await h.text('1');
  assert.deepEqual(h.calls.find(c => c[0] === 'execute'), ['execute', 't1', { action_index: 0 }]);
  assert.deepEqual(h.settings.tasks[sender], ['t1']);
});
test('approval image precedes summary; question and image are deduplicated', async t => {
  const h = await harness(t); await h.text('Find a sauna'); h.tasks = [executing('awaiting_approval')];
  await h.b.followTasks(); await h.b.followTasks();
  const imageIndex = h.sends.findIndex(s => s[2]);
  assert.ok(imageIndex >= 0); assert.match(h.sends[imageIndex + 1][1], /Reply da or yes to submit, or stop/);
  assert.equal(h.sends.filter(s => s[2]).length, 1);
  h.tasks = [{ ...executing('running'), execution: { status: 'running', question: { text: 'Which city?' } } }];
  await h.b.followTasks(); await h.b.followTasks(); assert.equal(h.sends.filter(s => s[1] === 'Which city?').length, 1);
});
test('CAF fixture converts via mocked afconvert and uploads as a new errand', async t => {
  let h;
  h = await harness(t, { voice: file => convertVoice(file, { tempRoot: h.f.dir, run: async (cmd, args) => {
    assert.equal(cmd, '/usr/bin/afconvert'); assert.deepEqual(args.slice(0, 4), ['-f', 'm4af', '-d', 'aac']);
    assert.equal(args[4], file); await writeFile(args[5], 'converted audio');
  } }), ready: a => readyAttachment(a, { sleep: async () => {}, attachmentRoot: h.f.dir }) });
  const caf = path.join(h.f.dir, 'voice.caf'); await writeFile(caf, 'fixture audio');
  const id = h.f.add({ text: 'yes', audio: 1 }); h.f.attach(id, caf); await h.b.tick();
  const call = h.calls.find(c => c[0] === 'voice');
  assert.equal(call[1].toString(), 'converted audio'); assert.equal(call[2], 'audio/mp4'); assert.deepEqual(call[3], { create: true });
  assert.ok(!h.calls.some(c => ['approve', 'link'].includes(c[0])));
  assert.deepEqual(h.settings.tasks[sender], ['voice-task']);
  assert.ok(!(await readdir(h.f.dir)).some(name => name.startsWith('vali-voice-')));
});
test('missing attachment and failed transcription produce a useful reply', async t => {
  const h = await harness(t, { ready: async () => { throw new Error('not downloaded'); } });
  const id = h.f.add({ text: null, audio: 1 }); h.f.attach(id, path.join(h.f.dir, 'missing.caf'));
  await h.b.tick(); assert.match(h.sends[0][1], /Please type your errand/);
});
test('permission checks report FDA, Automation and missing account without polling', async t => {
  const f = fixture(); t.after(() => f.close());
  for (const [expected, open, script] of [
    ['needs_fda', () => { throw Object.assign(new Error('permission'), { code: 'EPERM' }); }, async () => '1'],
    ['needs_automation', openDb, async () => { throw new Error('error -1743'); }],
    ['needs_account', openDb, async () => '0']
  ]) {
    const b = createBridge({ dbPath: f.file, outbox: path.join(f.dir, 'outbox'), settings: {}, save: async () => {}, open, script }); t.after(() => b.dispose());
    await b.enable(); assert.equal(b.view().status, expected); assert.equal(b.view().message, PERMISSIONS[expected]); await b.tick();
  }
});
test('send failure -1743 pauses bridge and subsequent ticks', async t => {
  const h = await harness(t, { send: async () => { throw new Error('-1743'); } });
  await h.text('Find a sauna'); assert.equal(h.b.view().status, 'needs_automation');
  await h.text('Second'); assert.equal(h.calls.filter(c => c[0] === 'create').length, 1);
});
test('sender passes hostile values as argv and serializes attachments through outbox', async t => {
  const f = fixture(); t.after(() => f.close()); let active = 0; const calls = [];
  const s = createSender({ outbox: f.dir, wait: async () => {}, run: async (script, args) => {
    assert.equal(active++, 0); await Promise.resolve(); calls.push([script, args]); active--;
    assert.ok(!script.includes('hostile')); if (args[1].endsWith('.jpg')) assert.equal((await readFile(args[1])).toString(), 'jpeg');
  } });
  const hostile = 'hostile "\\\n & do shell script "test';
  await Promise.all([s.send(hostile, hostile), s.send(sender, Buffer.from('jpeg'), true)]);
  assert.equal(calls[0][1][0], hostile); assert.equal(calls[0][1][1], hostile);
  assert.equal(path.dirname(calls[1][1][1]), f.dir);
});
test('sender retries once, caps per handle, and blocks queue after Automation denial', async () => {
  let count = 0, denied = false;
  const s = createSender({ wait: async () => {}, run: async () => { count++; if (count === 1) throw new Error('temporary'); } });
  for (let i = 0; i < 21; i++) await s.send(sender, 'reply'); assert.equal(count, 21);
  const blocked = createSender({ wait: async () => {}, onDenied: () => { denied = true; }, run: async () => { throw new Error('-1743'); } });
  await assert.rejects(blocked.send(sender, 'reply')); await blocked.send(sender, 'skipped'); assert.ok(denied);
});
test('API uses mocked network for anonymous link, bearer errands and multipart voice', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ token: 'fixture', id: 'task' }), { status: 200 }); };
  await makeApi({ baseUrl: 'https://fixture.invalid', fetchImpl }).link('123 456');
  const api = makeApi({ baseUrl: 'https://fixture.invalid', token: 'sender-token', fetchImpl });
  await api.createTask({ task: 'Find a sauna' }); await api.voice(Buffer.from('voice'), 'audio/mp4', { create: true });
  assert.equal(calls[0][1].headers.Authorization, undefined); assert.equal(JSON.parse(calls[0][1].body).code, '123456');
  assert.equal(calls[1][1].headers.Authorization, 'Bearer sender-token');
  assert.equal(calls[2][1].body.get('create'), '1'); assert.equal(calls[2][1].body.get('audio').type, 'audio/mp4');
});
test('rendering preserves citations, removes emphasis, and splits without data loss', () => {
  const task = completed('t'); task.research.output.grounding = [{ field: 'answer', confidence: 'low', citations: [{ url: 'https://example.com', title: 'Source' }] }];
  assert.match(renderResult(task), /\(check\) \[1\]/);
  const text = 'a'.repeat(1499) + '👍' + '\n' + 'b'.repeat(2000); const parts = splitText(text);
  assert.equal(parts.join(''), text); assert.ok(parts.every(s => s.length <= 1500 && !/[\uD800-\uDBFF]$/.test(s)));
});
for (const [input, kind] of [
  ['YES!', 'approve'], ['ＤＡ', 'approve'], ['👍🏿', 'approve'], ['Kyllä.', 'approve'], ['ok', 'approve'],
  ['nu', 'stop'], ['cancel!', 'stop'], ['ei', 'stop'], ['lopeta', 'stop'], ['1.', 'choose'], ['9', 'choose'],
  ['???', 'status'], ['tila', 'status'], ['hei', 'help'], ['apua', 'help'], ['linkki 123 456', 'link'],
  ['link １２３４５６', 'link'], ['link 12345', 'new_errand'], ['yes please book', 'new_errand'], ['10', 'new_errand']
]) test(`command parser: ${input}`, () => assert.equal(parseCommand(input).kind, kind));

test('runtime stores safeStorage ciphertext, never exposes token in status, and binds links to their server', async t => {
  const f = fixture(); t.after(() => f.close());
  let config = { backendUrl: 'https://fixture.invalid' }; const writes = [], requests = [];
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: token => Buffer.from('cipher:' + token), decryptString: bytes => bytes.toString().slice(7) };
  const b = makeMessageBridge({ dbPath: f.file, outbox: path.join(f.dir, 'outbox'), getConfig: () => config, safeStorage,
    save: async () => writes.push(JSON.stringify(config)), script: async () => '1', send: async () => {},
    fetchImpl: async (url, init) => {
      requests.push([url, init]);
      return new Response(JSON.stringify(url.endsWith('/link') ? { token: 'runtime-secret' } : url.includes('?limit=') ? { tasks: [] } : queued('runtime-task')));
    } });
  t.after(() => b.dispose());
  assert.equal(b.view().enabled, false); assert.equal(b.view().status, 'off');
  await b.enable(); f.add({ text: 'link 123456' }); await b.tick();
  assert.ok(writes.every(json => !json.includes('runtime-secret')));
  assert.equal(config.imessage.links[sender], Buffer.from('cipher:runtime-secret').toString('base64'));
  assert.ok(!JSON.stringify(b.view()).includes('cipher'));
  f.add({ text: 'Find coffee' }); await b.tick();
  assert.ok(requests.some(([, init]) => init.headers.Authorization === 'Bearer runtime-secret'));
  const count = requests.length;
  config = { ...config, backendUrl: 'https://other.invalid' }; f.add({ text: 'Another errand' }); await b.tick();
  assert.equal(requests.length, count);
  b.dispose(); assert.equal(config.imessage.enabled, true);
});

test('off bridge never opens a database or runs automation; disabling blocks new work', async t => {
  const f = fixture(); t.after(() => f.close());
  const b = createBridge({ dbPath: 'unused', outbox: path.join(f.dir, 'outbox'), settings: {}, save: async () => {}, open: () => { assert.fail('off bridge opened database'); }, script: () => { assert.fail('off bridge ran automation'); } });
  await b.tick(); await b.followTasks(); b.dispose();
  const h = await harness(t); await h.b.disable(); h.f.add(); await h.b.tick(); assert.equal(h.calls.length, 0);
});

test('cursor persistence failure prevents task creation', async t => {
  const f = fixture(); t.after(() => f.close()); let fail = false;
  const b = createBridge({ dbPath: f.file, outbox: path.join(f.dir, 'outbox'), settings: { links: { [sender]: 'sealed' } }, script: async () => '1',
    save: async () => { if (fail) throw new Error('disk full'); }, api: () => { assert.fail('unsaved row called API'); } });
  t.after(() => b.dispose()); await b.enable(); fail = true; f.add(); await assert.rejects(b.tick(), /disk full/);
});

for (const [kind, words] of [
  ['approve', ['yes', 'OK!', 'Approve.', 'KYLLÄ', 'joo', '👍', '👍🏽', '(yes)', '“kyllä”', '👍️']],
  ['stop', ['stop', 'No!', 'cancel', 'EI.', 'lopeta']],
  ['status', ['status', 'Tila!', '?', '?!', '???']],
  ['help', ['help', 'Apua!', 'hi', 'hello', 'Moi.', 'hei']],
  ['new_errand', ['hello help with rent', 'yes please book', '10', '0', 'link 12345', 'link 1234567', 'moi etsi sauna']]
]) test(`backend parser parity: ${kind}`, () => {
  for (const word of words) assert.equal(parseCommand(word).kind, kind, word);
});
test('backend parser parity: spaced links and all nine action choices', () => {
  for (const text of ['link 123456', 'LINK 123 456!', 'linkki 1 2 3 4 5 6.', ' linkki  123456 ']) assert.deepEqual(parseCommand(text), { kind: 'link', code: '123456' });
  for (let n = 1; n <= 9; n++) assert.deepEqual(parseCommand(`${n}!`), { kind: 'choose', n });
});

test('SQL returns only direct iMessage rows with exactly one participant before limiting', t => {
  const f = fixture(); t.after(() => f.close());
  const other = f.addHandle('other@icloud.com');
  for (const extra of [
    { chat: f.addChat(43, [1, other]) },
    { chat: f.addChat(45, []) },
    { chat: f.addChat(45, [1, other]) },
    { service: 'SMS' }, { associated: 2000 }, { item: 1 }, { from: 1 }
  ]) f.add(extra);
  const direct = f.add({ chat: f.addChat(45, [other]), handle: other });
  const rows = readSince(f.db, 0, 1);
  assert.deepEqual(rows.map(row => row.rowid), [direct]);
  assert.equal(rows[0].style, 45); assert.equal(rows[0].participants, 1);
});

test('bridge accepts direct chats and rejects both groups and malformed direct membership', async t => {
  const h = await harness(t);
  const other = h.f.addHandle('other@icloud.com');
  for (const chat of [h.f.addChat(43), h.f.addChat(45, []), h.f.addChat(45, [1, other])]) {
    await h.text('Ignored', { chat });
  }
  assert.equal(h.calls.length, 0);
  await h.text('Direct errand', { chat: h.f.addChat(45) });
  assert.deepEqual(h.calls.find(call => call[0] === 'create'), ['create', { task: 'Direct errand' }]);
});

test('attachment realpaths reject outside files, sibling prefixes, traversal and escaping symlinks', async t => {
  const f = fixture(); t.after(() => f.close());
  const root = path.join(f.dir, 'Attachments');
  const sibling = path.join(f.dir, 'Attachments-other');
  await mkdir(root); await mkdir(sibling);
  const outside = path.join(sibling, 'photo.jpg'); await writeFile(outside, 'private');
  const escape = path.join(root, 'escape.jpg'); await symlink(outside, escape);
  const inside = path.join(root, 'photo.jpg'); await writeFile(inside, 'photo');
  const alias = path.join(root, 'alias.jpg'); await symlink(inside, alias);
  const options = { attachmentRoot: root, sleep: async () => {} };
  for (const filename of [outside, escape, path.join(root, '..', 'Attachments-other', 'photo.jpg')]) {
    await assert.rejects(readyAttachment({ filename }, options), /outside Attachments/);
  }
  assert.equal(await readyAttachment({ filename: alias }, options), inside);
});

test('bridge media uses shared letter types and voice/letter size limits', async t => {
  const h = await harness(t, { ready: async attachment => attachment.filename, voice: async () => Buffer.alloc(MAX_VOICE_BYTES + 1) });
  const pdf = path.join(h.f.dir, 'letter.pdf'); await writeFile(pdf, 'fixture PDF');
  const id = h.f.add({ text: 'Read this' }); h.f.attach(id, pdf, 'application/pdf'); await h.b.tick();
  assert.equal(h.calls.find(call => call[0] === 'letter')[2], 'application/pdf');
  const unsupported = path.join(h.f.dir, 'photo.svg'); await writeFile(unsupported, '<svg/>');
  await assert.rejects(readLetter(unsupported, 'image/svg+xml'), /photo or a PDF/);
  const large = path.join(h.f.dir, 'large.jpg'); await writeFile(large, ''); await truncate(large, MAX_LETTER_BYTES + 1);
  await assert.rejects(readLetter(large, 'image/jpeg'), /too big/);
  assert.throws(() => voiceBytes(Buffer.alloc(MAX_VOICE_BYTES + 1)), /voice size/);
  const audio = h.f.add({ audio: 1 }); h.f.attach(audio, 'fixture.caf'); await h.b.tick();
  assert.ok(!h.calls.some(call => call[0] === 'voice'));
  assert.match(h.sends.at(-1)[1], /Please type your errand/);
});

test('sender sweeps stale and newly sent outbox images on start and dispose', async t => {
  const f = fixture(); t.after(() => f.close());
  const outbox = path.join(f.dir, 'outbox'); await mkdir(outbox);
  const stale = '11111111-1111-4111-8111-111111111111.jpg';
  await writeFile(path.join(outbox, stale), 'old screenshot');
  await writeFile(path.join(outbox, 'keep.txt'), 'unrelated');
  const s = createSender({ outbox, wait: async () => {}, run: async () => {} });
  t.after(() => s.dispose());
  await s.start(); assert.deepEqual(await readdir(outbox), ['keep.txt']);
  await s.send(sender, Buffer.from('jpeg'), true);
  assert.equal((await readdir(outbox)).length, 2);
  await s.dispose(); assert.deepEqual(await readdir(outbox), ['keep.txt']);
});

test('unlink clears help cooldown and task snapshots; expired help entries are pruned', async t => {
  const h = await harness(t, { settings: { helpSentAt: { expired: 0 } } });
  assert.equal(h.settings.helpSentAt.expired, undefined);
  await h.text('Find a sauna');
  h.tasks = [{ ...executing('running'), execution: { status: 'running', question: { text: 'Which city?' } } }];
  await h.b.followTasks();
  h.settings.helpSentAt[sender] = Date.now();
  await h.b.unlink(sender);
  assert.equal(h.settings.tasks[sender], undefined); assert.equal(h.settings.helpSentAt[sender], undefined);
  await h.text('Hello'); assert.match(h.sends.at(-1)[1], /link/i);
  h.settings.links[sender] = 'sealed:secret'; h.settings.tasks[sender] = ['t1'];
  await h.b.followTasks();
  assert.equal(h.sends.filter(send => send[1] === 'Which city?').length, 2);
});
