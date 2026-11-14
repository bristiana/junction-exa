// Small compatibility surface for the unmodified extension panel and API client.
const listeners = new Set();
window.vali.onChange((changes, area) => { for (const fn of listeners) fn(changes, area); });
const storage = area => ({
  get: keys => window.vali.call('storage:get', { area, keys }),
  set: values => window.vali.call('storage:set', { area, values }),
  remove: keys => window.vali.call('storage:remove', { area, keys })
});
window.chrome = {
  storage: { local: storage('local'), session: storage('session'), onChanged: { addListener: fn => listeners.add(fn) } },
  runtime: { sendMessage: msg => window.vali.call('message', msg) },
  // The browser tab in front of Vali (Chrome or Safari) stands in for the extension's active tab: "Use this page".
  tabs: {
    query: async () => { const tab = await window.vali.call('frontTab').catch(() => null); return tab ? [{ id: 'front', url: tab.url, title: tab.title }] : []; },
    create: ({ url }) => window.vali.call('external', url), onActivated: { addListener: fn => tabListeners.add(fn) }, onUpdated: { addListener() {} }
  }
};
const tabListeners = new Set();
window.addEventListener('focus', () => { for (const fn of tabListeners) fn({}); });
window.fetch = async (url, options = {}) => {
  const response = await window.vali.call('request', { url: String(url), method: options.method || 'GET', body: options.body });
  const body = response.base64 ? Uint8Array.from(atob(response.base64), c => c.charCodeAt(0)) : response.body;
  return new Response(body, { status: response.status, headers: { 'Content-Type': response.mime || 'application/json' } });
};
