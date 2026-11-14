const { contextBridge, ipcRenderer } = require('electron');
const event = channel => callback => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('vali', {
  storageGet: (keys, area) => ipcRenderer.invoke('storage-get', { keys, area }),
  storageSet: (values, area) => ipcRenderer.invoke('storage-set', { values, area }),
  storageRemove: (keys, area) => ipcRenderer.invoke('storage-remove', { keys, area }),
  onStorage: event('storage-changed'),
  command: msg => ipcRenderer.invoke('command', msg),
  getStatus: () => ipcRenderer.invoke('status-get'),
  onStatus: event('status'),
  onFocus: event('focus-input'),
  openChat: id => ipcRenderer.invoke('open-chat', id),
  hideQuick: () => ipcRenderer.invoke('hide-quick'),
  external: url => ipcRenderer.invoke('external', url),
  importToken: value => ipcRenderer.invoke('import-token', value),
  liveFrame: id => ipcRenderer.invoke('live-frame', id),
  drag: phase => ipcRenderer.send('drag', { phase }),
});
