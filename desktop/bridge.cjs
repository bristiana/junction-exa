const { contextBridge, ipcRenderer } = require('electron');
const on = channel => fn => { const handler = (_e, ...args) => fn(...args); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler); };
contextBridge.exposeInMainWorld('vali', {
  call: (op, arg) => ipcRenderer.invoke('vali', op, arg),
  onChange: on('vali:change'),
  onState: on('vali:state'),
  onQuick: on('vali:quick'),
  onTalk: on('vali:talk')
});
