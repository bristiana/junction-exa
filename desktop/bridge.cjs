const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vali', {
  call: (op, arg) => ipcRenderer.invoke('vali', op, arg),
  onChange: (fn) => { const handler = (_e, changes, area) => fn(changes, area); ipcRenderer.on('vali:change', handler); return () => ipcRenderer.removeListener('vali:change', handler); },
  onState: (fn) => { const handler = (_e, state) => fn(state); ipcRenderer.on('vali:state', handler); return () => ipcRenderer.removeListener('vali:state', handler); }
});
