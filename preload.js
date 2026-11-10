const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: async (channel, arg) => {
    const r = await ipcRenderer.invoke(channel, arg);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  onUpdate: (fn) => ipcRenderer.on('update-event', (_e, data) => fn(data)),
  onSaldos: (fn) => ipcRenderer.on('saldos', (_e, data) => fn(data)),
  onResumo: (fn) => ipcRenderer.on('resumo', (_e, data) => fn(data)),
  onAtividade: (fn) => ipcRenderer.on('atividade', (_e, data) => fn(data)),
  onBloqueado: (fn) => ipcRenderer.on('bloqueado', (_e, data) => fn(data))
});
