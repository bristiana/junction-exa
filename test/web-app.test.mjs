import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A small browser surface for exercising the real controller and its rendering modules.
class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.value = '';
    this.hidden = false; this.dataset = {}; this.classes = new Set();
    this.classList = {
      add: (x) => this.classes.add(x), remove: (x) => this.classes.delete(x),
      contains: (x) => this.classes.has(x),
      toggle: (x, on) => on ? this.classes.add(x) : this.classes.delete(x),
    };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() {}
  closest() { return null; }
  get textContent() { return this.text ?? this.children.map((x) => x.textContent).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  async fire(name) { for (const fn of this.events[name] || []) await fn({ preventDefault() {}, target: this }); }
}
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map((m) => [m[1], new Element()]));
const listeners = new Map(), storage = new Map(), requests = [];
globalThis.Node = Element;
globalThis.document = {
  getElementById: (id) => nodes.get(id), querySelector: () => null, querySelectorAll: () => [],
  createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag),
  createTextNode: (text) => Object.assign(new Element('text'), { textContent: text }),
  body: new Element('body'), addEventListener() {},
};
globalThis.window = { scrollTo() {}, addEventListener: (name, fn) => listeners.set(name, fn) };
globalThis.addEventListener = window.addEventListener;
globalThis.matchMedia = () => ({ matches: false });
globalThis.location = { origin: 'http://vali.test', hash: '#/' };
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
globalThis.fetch = async (url, init) => {
  requests.push({ url, init });
  return { ok: true, json: async () => url.includes('/tasks?') ? { tasks: [] } : url.endsWith('/tasks') ? { id: 'new-errand' } : {} };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
await import('../web/app.js');
const route = () => listeners.get('hashchange')();

test('guest landing and login make no account request and signed-out asks show no error notice', async () => {
  await settle();
  assert.deepEqual(requests, []);
  nodes.get('errand').value = 'Check pharmacy hours';
  await nodes.get('ask').fire('submit');
  await settle();
  assert.equal(location.hash, '#/login');
  assert.equal(nodes.get('notice').hidden, true);
  route();
  assert.equal(nodes.get('notice').hidden, true);
  assert.deepEqual(requests, []);
  nodes.get('notice').textContent = 'Old error';
  nodes.get('notice').hidden = false;
  route();
  assert.equal(nodes.get('notice').textContent, '');
  assert.equal(nodes.get('notice').hidden, true);
});

test('dashboard ask uses the shared task path and survives dashboard polling renders', async () => {
  const { session } = await import('../web/api.js');
  session.useToken('test-token'); session.markSignedIn();
  location.hash = '#/dashboard'; route(); await settle();
  const form = nodes.get('dashboard-ask');
  nodes.get('dashboard-errand').value = 'Find a museum';
  await form.fire('submit'); await settle();
  const call = requests.find((r) => r.url.endsWith('/v1/tasks'));
  assert.equal(JSON.parse(call.init.body).task, 'Find a museum');
  assert.equal(location.hash, '#/t/new-errand');
  assert.equal(nodes.get('dashboard-errand').value, '');
  assert.equal(form.classList.contains('busy'), false);
  location.hash = '#/login'; route(); // stop the board refresh timer
});

test('answer hides unknown details and renders inferred detail names', async () => {
  const { renderAnswer } = await import('../web/answer.js');
  const task = { task: 'Fill it', research: { status: 'completed' }, execution: { status: 'done', steps: [{ text: 'Filled in your email' }] } };
  renderAnswer(task, {});
  assert.match(nodes.get('answer').textContent, /Your detailsemail/);
  task.execution.steps = [];
  renderAnswer(task, {});
  assert.ok(!nodes.get('answer').textContent.includes('Your details'));
});

test('header download and favicon point to shipped web assets', async () => {
  assert.match(html, /<a href="\/vali-extension.zip" download="vali-extension.zip" class="link-btn">Get the extension<\/a>/);
  const icon = html.match(/<link rel="icon" href="([^"]+)"/)[1];
  assert.ok((await readFile(new URL('../web/' + icon, import.meta.url))).length > 0);
  // The install steps show only after "Get the extension" is clicked, not on every page.
  assert.doesNotMatch(html, /Chrome extension: unzip/);
  const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(app, /Chrome extension: unzip, open chrome:\/\/extensions, turn on Developer mode, Load unpacked, then sign in from its settings\./);
});

test('Start here shows only in the demo, links only errands in the list, and Got it is remembered', async () => {
  const { OPEN_FIRST, renderWelcome, resetWelcome } = await import('../web/welcome.js');
  const slot = nodes.get('welcome');
  const tasks = [{ id: OPEN_FIRST[1][0] }];
  resetWelcome(); await renderWelcome(tasks);  // this fetch answers /v1/me without demo, like the API before this
  assert.equal(slot.hidden, true);
  const realFetch = fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ demo: true }) });
  try {
    resetWelcome(); await renderWelcome(tasks);
    assert.equal(slot.hidden, false);
    const text = slot.textContent;
    assert.match(text, /Welcome to the demo/);
    assert.ok(text.includes(OPEN_FIRST[1][1]) && !text.includes(OPEN_FIRST[0][1]) && !text.includes(OPEN_FIRST[2][1]));
    const find = (node, tag) => node.tag === tag ? node : node.children?.map((c) => find(c, tag)).find(Boolean);
    await find(slot, 'button').fire('click');
    assert.equal(storage.get('vali.welcome.dismissed'), '1');
    assert.equal(slot.textContent, 'Show the guide');
    await find(slot, 'button').fire('click');
    assert.match(slot.textContent, /Welcome to the demo/);
  } finally { globalThis.fetch = realFetch; }
});
