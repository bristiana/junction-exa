// The demo flow in the real app against the live server, on a throwaway account (VALI_USER_DATA), with captures in
// LIVE_OUT: quick box errand -> research -> list -> chat with "How Vali found this" -> letter dropped on the mascot ->
// a cloud browser run on httpbin's test form, approved from the list -> done. Only httpbin is ever approved.
//   VALI_USER_DATA=/tmp/vali-live LIVE_OUT=/tmp/vali-live-out npm run live-app
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const TEST_FORM = 'https://httpbin.org/forms/post';
const RESEARCH = 'My Finnair flight from Helsinki to Barcelona last Tuesday landed 4 hours late. What can I get?';
const FIND = 'Find a public sauna in Helsinki open on Saturday evening';
const FAKE = { name: 'Testi Testaaja', email: 'testi@example.com', phone: '+358 40 0000000' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export async function runLiveApp(x) {
  const out = process.env.LIVE_OUT;
  if (!out) throw new Error('--live-app needs LIVE_OUT.');
  await mkdir(out, { recursive: true });
  const { mascot, chat, quick, glance } = x.windows();
  const js = (w, code) => w.webContents.executeJavaScript(code);
  const shot = async (w, name) => { await x.capture(w, out, name); log('capture', name); };
  const until = async (test, label, ms = 600000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const t = test(x.tasks()); if (t) return t; await sleep(1000); }
    throw new Error(`${label} timed out`);
  };
  const find = text => x.tasks().find(t => t.task.startsWith(text));
  await x.connect();
  await x.setConfig({ profile: FAKE });
  log('account ready');

  // 1. Quick box: type, Enter. Then the same for the errand the browser run will use.
  for (const text of [RESEARCH, FIND]) {
    x.showQuick('type', {});
    await js(quick, `(() => { const i = document.getElementById('errand'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); })()`);
    if (text === RESEARCH) await shot(quick, 'live-quick');
    await js(quick, `document.getElementById('errand').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await until(() => find(text), `errand "${text}" in the list`, 30000);
  }
  x.showGlance({ focus: true });
  await x.waitFor(glance, `document.querySelectorAll('.item').length >= 2`, 'Glance list missing');
  await shot(glance, 'live-glance-working');

  // 2. The letter, dropped on the mascot.
  const before = x.tasks().length;
  const b64 = (await readFile(path.join(x.root, '../scripts/fixtures/letter.png'))).toString('base64');
  await js(mascot, `(() => { const b = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)); const d = new DataTransfer(); d.items.add(new File([b], 'letter.png', { type: 'image/png' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: d, cancelable: true })); })()`);
  await until(ts => ts.length > before, 'letter errand', 120000);
  const letter = x.tasks().find(t => !t.task.startsWith(RESEARCH) && !t.task.startsWith(FIND));
  log('letter errand:', letter.task.slice(0, 100));
  await shot(mascot, 'live-mascot-letter');

  // 3. Research done: the chat with "How Vali found this" open.
  const research = await until(() => { const t = find(RESEARCH); return t && t.status !== 'queued' && t.status !== 'running' && t; }, 'research');
  log('research:', research.status, String(research.output?.structured?.answer || '').slice(0, 160));
  x.openChat(research.id);
  await x.waitFor(chat, `document.querySelector('#detail .exa-activity')`, 'How Vali found this missing', 15000);
  await js(chat, `(() => { const d = document.querySelector('#detail .exa-activity'); d.open = true; d.scrollIntoView({ block: 'start' }); })()`);
  await shot(chat, 'live-chat-found');

  // 4. Let Vali do it on httpbin's test form, to the approval, then Approve from the list.
  const f = await until(() => { const t = find(FIND); return t?.status === 'completed' && t; }, 'find');
  const r = await x.handleMessage({ type: 'execute', taskId: f.id, startUrl: TEST_FORM, goal: 'Order a small cheese pizza on this test form for {{name}}, phone {{phone}}, email {{email}}, delivery 19:00. Stop for approval before submitting.' });
  if (!r.ok) throw new Error(`execute: ${r.error}`);
  x.showGlance({ focus: true });
  await x.waitFor(glance, `document.querySelector('.live:not([hidden]) img')?.naturalWidth > 0`, 'Live view missing', 120000).then(() => shot(glance, 'live-glance-live')).catch(e => log('WARN', e.message.slice(0, 200)));
  const a = await until(() => { const t = find(FIND); return ['awaiting_approval', 'done', 'failed', 'stopped'].includes(t?.execution?.status) && t; }, 'approval', 420000);
  log('execution:', a.execution.status, a.execution.approval?.summary || a.execution.error || '');
  if (a.execution.status !== 'awaiting_approval') throw new Error('The httpbin run did not reach the approval.');
  x.openChat(a.id);
  await x.waitFor(chat, `document.querySelector('.exec-approval')`, 'Chat approval missing');
  await x.waitFor(chat, `document.querySelector('.v-live:not([data-empty]) img')?.naturalWidth > 0`, 'Chat live frame missing', 15000).catch(e => log('WARN', e.message.slice(0, 200)));
  await shot(chat, 'live-chat-approval');
  x.showGlance({ focus: true });
  const pick = `[...document.querySelectorAll('.item')].find(li => li.querySelector('.task')?.textContent.startsWith(${JSON.stringify(FIND)}))`;
  await x.waitFor(glance, `${pick}?.querySelector('button.approve')`, 'Approve in the list missing');
  await shot(glance, 'live-glance-approval');
  if (find(FIND).execution.start_url !== TEST_FORM) throw new Error('Refusing to approve: not the httpbin test form.');
  await js(glance, `${pick}.querySelector('button.approve').click()`);
  const d = await until(() => { const t = find(FIND); return ['done', 'failed', 'stopped'].includes(t?.execution?.status) && t; }, 'submit', 300000);
  log('after approve:', d.execution.status, String(d.execution.result || d.execution.error || '').slice(0, 160));
  x.showGlance({ focus: true }); await sleep(1500);
  await shot(glance, 'live-glance-done');
  x.openChat(d.id); await sleep(1500);
  await shot(chat, 'live-chat-done');

  // 5. The letter's errand in the chat.
  const l = await until(() => { const t = x.tasks().find(t => t.id === letter.id); return t && t.status !== 'queued' && t.status !== 'running' && t; }, 'letter research', 300000);
  log('letter:', l.status, String(l.output?.structured?.answer || '').slice(0, 160));
  x.openChat(l.id); await sleep(1500);
  await shot(chat, 'live-chat-letter');
  x.showGlance({ focus: true }); await sleep(1000);
  await shot(glance, 'live-glance-end');
  return d.execution.status === 'done' && research.status === 'completed';
}
