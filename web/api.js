// The Vali API. Same origin by default; <meta name="vali-api"> points a build elsewhere (the CSP must allow it).
// The anonymous account token is stored per API base.
const base = (document.querySelector('meta[name="vali-api"]')?.content || '').replace(/\/+$/, '');
const TOKEN_KEY = 'vali.token:' + (base || location.origin);
let token = load(TOKEN_KEY);
const DEMO_KEY = 'vali.demo:' + (base || location.origin);
const SIGNED_KEY = 'vali.signed:' + (base || location.origin);
// A shared demo link (#demo=<token>) offers that account, already full, on the sign-in page;
// the token leaves the address bar at once.
const demo = String(globalThis.location?.hash || '').match(/(?:^#|&)demo=([A-Za-z0-9_-]{20,})/);
if (demo) {
  save(DEMO_KEY, demo[1]);
  globalThis.history?.replaceState(null, '', location.pathname + location.search + '#/login');
}

// Who is signed in on this browser. Signing in is a choice on #/login; the token is the account.
export const session = {
  signedIn: () => load(SIGNED_KEY) === '1' && Boolean(token),
  hasAccount: () => Boolean(token),
  hasDemo: () => Boolean(load(DEMO_KEY)) && load(DEMO_KEY) !== token,
  useDemo() { token = load(DEMO_KEY); save(TOKEN_KEY, token); },
  useToken(fresh) { token = fresh; save(TOKEN_KEY, token); },
  markSignedIn: () => save(SIGNED_KEY, '1'),
  async ensureAccount() { if (!token) await signIn(); },
  reset() { token = null; remove(TOKEN_KEY); },
  signOut() { remove(SIGNED_KEY); },
};

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function remove(key) {
  try { localStorage.removeItem(key); } catch { /* nothing stored */ }
}

function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private window: the token lives for this tab only */ }
}

export class ApiError extends Error {
  constructor(status, detail, retryAfter) {
    super(detail || `Request failed (${status})`);
    this.status = status;
    this.retryAfter = retryAfter; // seconds, from a 429's Retry-After header
  }
}

async function send(method, path, body, auth = true) {
  const headers = { 'X-Vali-Channel': 'web' };
  if (auth) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('Retry-After')) || data.retry_after || null;
    throw new ApiError(response.status, typeof data.detail === 'string' ? data.detail : '', retryAfter);
  }
  return data;
}

// Calls that start together share one sign-in, so a first visit creates one account, not one per request.
let signingIn = null;
function signIn() {
  signingIn ||= send('POST', '/v1/users', undefined, false).then(({ token: fresh }) => {
    token = fresh;
    save(TOKEN_KEY, token);
  }).finally(() => { signingIn = null; });
  return signingIn;
}

// Every call is signed in; a token the server forgot (401) is replaced once with a fresh anonymous account.
// A 401 that arrives after another call already replaced the token just retries with the new one.
async function call(method, path, body) {
  if (!token) await signIn();
  const used = token;
  try {
    return await send(method, path, body);
  } catch (error) {
    if (error.status !== 401) throw error;
    if (token === used) await signIn();
    return send(method, path, body);
  }
}

export const api = {
  // knownDetails: names of the saved details (never values), so the research writes {{name}} instead of asking.
  createTask: (task, previousTaskId, knownDetails = []) => call('POST', '/v1/tasks',
    { task, previous_task_id: previousTaskId || undefined, known_details: knownDetails.length ? knownDetails : undefined }),
  task: (id) => call('GET', `/v1/tasks/${encodeURIComponent(id)}`),
  tasks: () => call('GET', '/v1/tasks?limit=50'),
  pair: () => call('POST', '/v1/pair'),
  register: (email, password) => call('POST', '/v1/auth/register', { email, password }),
  login: (email, password) => send('POST', '/v1/auth/login', { email, password }, false),
  stats: () => call('GET', '/v1/stats'),
  watches: () => call('GET', '/v1/watches'),
  services: () => call('GET', '/v1/services'),
  service: (id) => call('GET', `/v1/services/${encodeURIComponent(id)}`),
  places: (q) => call('GET', `/v1/places?q=${encodeURIComponent(q)}&city=helsinki`),
  company: (name) => call('GET', `/v1/company?name=${encodeURIComponent(name)}`),
  cancel: (id) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/cancel`),
  // The only request that carries Your details: the cloud browser types them into this one form.
  execute: (id, actionIndex, profile = {}) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/execute`,
    { action_index: actionIndex, profile: Object.keys(profile).length ? profile : undefined }),
  approve: (id) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/approve`),
  stop: (id) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/stop`),
  // Restart a stopped browser run from where it stopped; answer is what it was waiting for.
  resume: (id, answer, profile = {}) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/continue`,
    { answer: answer || undefined, profile: Object.keys(profile).length ? profile : undefined }),
  message: (id, text) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/messages`, { text }),
  transcribe(blob) {
    const form = new FormData();
    form.append('audio', blob, 'errand.' + (blob.type.includes('mp4') ? 'm4a' : 'webm'));
    return call('POST', '/v1/voice', form);
  },
  // Images load by URL, so the token rides as ?t= (the API's own scheme for screenshots).
  imageUrl: (path) => `${base}${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(token || '')}`,
};
