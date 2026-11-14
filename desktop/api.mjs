// The desktop's Vali API client: the extension's client (vendor/lib/backend.js) plus the upload and linking
// endpoints. Plain Node, no Electron, so scripts/live-check.mjs drives exactly what the app uses.
import { createClient, BackendError } from './vendor/lib/backend.js';

export function makeApi({ baseUrl, token = '', fetchImpl = globalThis.fetch, timeoutMs = 20000, channel = 'mac' } = {}) {
  const base = createClient({ baseUrl, token, fetchImpl, channel });
  async function send(path, { method = 'POST', json, form, auth = true, timeout = timeoutMs } = {}) {
    if (!baseUrl) throw new BackendError(0, 'Set the Vali server in settings.');
    const headers = { Accept: 'application/json' }; // uploads keep their own channel: voice or letter
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && !token) throw new BackendError(401, 'Not connected yet.');
    if (token && auth !== false) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetchImpl(baseUrl + path, { method, headers, body: form || (json !== undefined ? JSON.stringify(json) : undefined), redirect: 'error', signal: AbortSignal.timeout(timeout) });
    } catch (_) { throw new BackendError(0, "Can't reach the Vali server."); }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text.slice(0, 300); }
    if (!res.ok) throw new BackendError(res.status, body);
    return body;
  }
  const blob = (bytes, mime) => new Blob([bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes], { type: mime });
  return {
    ...base,
    message: (taskId, text) => send(`/v1/tasks/${encodeURIComponent(taskId)}/messages`, { json: { text: String(text || '') } }),
    // Device linking: a signed-in device shows a short code, the other trades it for the same account token.
    linkCode: () => send('/v1/link/code', { json: {} }),
    link: code => send('/v1/link', { json: { code: String(code || '').replace(/\D/g, '') }, auth: token ? true : false }),
    // Speech to text; create=true also starts an errand from what was said.
    voice(bytes, mime, { create = false } = {}) {
      const form = new FormData();
      form.append('audio', blob(bytes, mime), 'voice.' + (/mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm'));
      if (create) form.append('create', '1');
      return send('/v1/voice', { form, timeout: 60000 });
    },
    // Talk to Vali: a one-off ElevenLabs credential for this account, used within 15 minutes (backend/vali_api/VOICE.md).
    voiceSession: () => send('/v1/voice/session?connection=webrtc', { json: {} }),
    // A photo or PDF of a letter becomes an errand with the letter as context.
    letter(bytes, mime, name = 'letter', note = '') {
      const form = new FormData();
      form.append('file', blob(bytes, mime), name);
      if (String(note).trim()) form.append('note', String(note).trim());
      return send('/v1/letters', { form, timeout: 90000 });
    },
    // The newest live browser frame (or null): the image endpoint takes the token as ?t=.
    async liveFrame(taskId) {
      const url = base.liveUrl({ remoteId: taskId });
      if (!url) return null;
      try {
        const res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
        return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      } catch (_) { return null; }
    },
  };
}
