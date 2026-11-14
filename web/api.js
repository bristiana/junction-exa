// The Vali API. Same origin by default; ?api=https://… or <meta name="vali-api"> points the page elsewhere.
// The anonymous account token is stored per API base, so a link with another ?api= never receives this one.
const base = (new URLSearchParams(location.search).get('api')
  || document.querySelector('meta[name="vali-api"]')?.content || '').replace(/\/+$/, '');
const TOKEN_KEY = 'vali.token:' + (base || location.origin);
let token = load(TOKEN_KEY);

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private window: the token lives for this tab only */ }
}

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `Request failed (${status})`);
    this.status = status;
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
  if (!response.ok) throw new ApiError(response.status, typeof data.detail === 'string' ? data.detail : '');
  return data;
}

async function signIn() {
  token = (await send('POST', '/v1/users', undefined, false)).token;
  save(TOKEN_KEY, token);
}

// Every call is signed in; a token the server forgot (401) is replaced once with a fresh anonymous account.
async function call(method, path, body) {
  if (!token) await signIn();
  try {
    return await send(method, path, body);
  } catch (error) {
    if (error.status !== 401) throw error;
    await signIn();
    return send(method, path, body);
  }
}

export const api = {
  createTask: (task, previousTaskId) => call('POST', '/v1/tasks', { task, previous_task_id: previousTaskId || undefined }),
  task: (id) => call('GET', `/v1/tasks/${encodeURIComponent(id)}`),
  tasks: () => call('GET', '/v1/tasks?limit=50'),
  stats: () => call('GET', '/v1/stats'),
  cancel: (id) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/cancel`),
  execute: (id) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/execute`, {}),
  approve: (id) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/approve`),
  stop: (id) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/stop`),
  message: (id, text) => call('POST', `/v1/tasks/${encodeURIComponent(id)}/messages`, { text }),
  transcribe(blob) {
    const form = new FormData();
    form.append('audio', blob, 'errand.' + (blob.type.includes('mp4') ? 'm4a' : 'webm'));
    return call('POST', '/v1/voice', form);
  },
  // Images load by URL, so the token rides as ?t= (the API's own scheme for screenshots).
  imageUrl: (path) => `${base}${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(token || '')}`,
};
