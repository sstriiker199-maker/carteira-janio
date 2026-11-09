const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: async (channel, arg) => {
    const r = await ipcRenderer.invoke(channel, arg);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  onUpdate: (fn) => ipcRenderer.on('update-event', (_e, data) => fn(data)),
  onSaldos: (fn) => ipcRenderer.on('saldos', (_e, data) => fn(data))
});
