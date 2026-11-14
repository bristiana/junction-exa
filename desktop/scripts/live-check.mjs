// Live check of the desktop's API path (api.mjs, the same client main.mjs uses) against a Vali server.
// Creates a throwaway account, then: link/voice/letters (or "coming soon"), a find errand, a claim errand, and a
// cloud browser run on httpbin's test form that is approved. It approves nothing else.
//   VALI_URL=https://… node scripts/live-check.mjs        (default: the deployed server)
import { makeApi } from '../api.mjs';
import { toLocalTask } from '../vendor/lib/backend.js';
import { plainStatus, comingSoon, buildErrand } from '../logic.mjs';
const baseUrl = process.env.VALI_URL || 'https://bogdan-c-2206--vali-web.us-east.modal.run';
const TEST_FORM = 'https://httpbin.org/forms/post';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
const check = (ok, what) => { log(ok ? 'PASS' : 'FAIL', what); if (!ok) failures++; };

const user = await makeApi({ baseUrl }).createUser();
check(!!user?.token, 'POST /v1/users gives a token');
const api = makeApi({ baseUrl, token: user.token });
check(!!(await api.me()).user_id, 'GET /v1/me');

for (const [name, run] of [['link code', () => api.linkCode()], ['link', () => makeApi({ baseUrl }).link('000000')], ['voice', () => api.voice(new Uint8Array(2048), 'audio/webm', { create: false })], ['letters', () => api.letter(new Uint8Array([37, 80, 68, 70]), 'application/pdf', 'letter.pdf')]]) {
  try { const out = await run(); log('INFO', name, 'answered', JSON.stringify(out).slice(0, 120)); }
  catch (e) { log('INFO', name, comingSoon(e) ? 'not deployed yet (UI shows "coming soon")' : `HTTP ${e.status}: ${e.message}`); }
}

async function until(id, done, label, ms = 600000) {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    const t = toLocalTask(await api.getTask(id));
    const s = plainStatus(t).label + (t.execution?.status ? ` / ${t.execution.status}` : '');
    if (s !== last) { log('...', label, s); last = s; }
    if (done(t)) return t;
    await sleep(3000);
  }
  throw new Error(`${label} timed out`);
}

// 1. Find (quick search) from the quick box path, with page context.
const find = buildErrand({ text: 'Find a public sauna in Helsinki open this Saturday evening', page: null });
const f = await until((await api.createTask({ task: find.task, effort: 'low' })).id, t => t.status !== 'queued' && t.status !== 'running', 'find');
check(f.status === 'completed' && !!f.output, `find result: ${String(f.output?.structured?.answer || f.output?.text || '').slice(0, 140)}`);
const listed = await api.listTasks(10);
check((listed.tasks || []).some(t => t.id === f.remoteId), 'the new errand is in GET /v1/tasks (what the panel and the list show)');

// 2. Claim (agent research), runs while the browser check goes.
const claimId = (await api.createTask({ task: 'My Finnair flight from Helsinki to Berlin yesterday was delayed by 4 hours. Claim compensation.', effort: 'low' })).id;

// 3. Let Vali do it on httpbin's test form: live view, approval, approve.
const profile = { name: 'Testi Testaaja', email: 'testi@example.com', phone: '+358 40 0000000' };
await api.execute(f.remoteId, { start_url: TEST_FORM, goal: 'Order a small cheese pizza on this test form for {{name}}, phone {{phone}}, email {{email}}, delivery 19:00. Stop for approval before submitting.', profile });
const a = await until(f.remoteId, t => ['awaiting_approval', 'done', 'failed', 'stopped'].includes(t.execution?.status), 'execute', 420000);
check(a.execution.status === 'awaiting_approval', `approval: ${a.execution.approval?.summary || a.execution.error || a.execution.result || ''}`.slice(0, 200));
const frame = await api.liveFrame(f.remoteId);
check(!!frame?.length, `live frame (${frame?.length || 0} bytes)`);
check((a.execution.approval?.filled || []).some(x => String(x.value).includes('{{') || String(x.value).includes('Testi')), 'approval lists the filled values (placeholders or profile)');
if (a.execution.status === 'awaiting_approval' && a.execution.start_url === TEST_FORM) {
  await api.approve(f.remoteId);
  const d = await until(f.remoteId, t => ['done', 'failed', 'stopped'].includes(t.execution?.status), 'submit', 300000);
  check(d.execution.status === 'done', `after approve: ${d.execution.status} ${String(d.execution.result || d.execution.error || '').slice(0, 140)}`);
}

const c = await until(claimId, t => t.status !== 'queued' && t.status !== 'running', 'claim', 900000);
const s = c.output?.structured || {};
check(c.status === 'completed', `claim research: ${plainStatus(c).label}; ${String(s.answer || '').slice(0, 140)}; ${(s.actions || []).length} actions, ${(c.output?.grounding || []).length} sources`);
log(failures ? `${failures} check(s) failed` : 'All live checks passed');
process.exit(failures ? 1 : 0);
