// Atualizações automáticas pelo GitHub Releases (electron-updater)
const { app, ipcMain } = require('electron');

let autoUpdater = null;
let win = null;
let estado = { status: 'parado', versaoNova: null, notas: '', progresso: 0, erro: '' };

function enviar() {
  if (win && !win.isDestroyed()) win.webContents.send('update-event', { ...estado, versaoAtual: app.getVersion() });
}
function set(p) {
  estado = { ...estado, ...p };
  enviar();
}

function notasTexto(n) {
  if (!n) return '';
  if (Array.isArray(n)) n = n.map((x) => x.note || '').join('\n');
  return String(n).replace(/<[^>]+>/g, '').trim();
}

// De onde vêm as atualizações: primeiro o repositório público só de instaladores;
// se ele ainda não existir / estiver vazio, o repositório antigo.
const FONTES = [
  { provider: 'github', owner: 'sstriiker199-maker', repo: 'carteira-janio-atualizacoes' },
  { provider: 'github', owner: 'sstriiker199-maker', repo: 'carteira-janio' }
];
async function verificar() {
  let ultimoErro;
  for (const f of FONTES) {
    try {
      autoUpdater.setFeedURL(f);
      const r = await autoUpdater.checkForUpdates();
      if (r && r.updateInfo) return r;
    } catch (e) { ultimoErro = e; }
  }
  throw ultimoErro || new Error('Não consegui verificar atualizações.');
}

function init(mainWindow) {
  win = mainWindow;
  if (app.isPackaged) {
    try {
      autoUpdater = require('electron-updater').autoUpdater;
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('checking-for-update', () => set({ status: 'verificando', erro: '' }));
      autoUpdater.on('update-available', (i) => set({ status: 'disponivel', versaoNova: i.version, notas: notasTexto(i.releaseNotes) }));
      autoUpdater.on('update-not-available', () => set({ status: 'atualizado' }));
      autoUpdater.on('download-progress', (p) => set({ status: 'baixando', progresso: Math.round(p.percent || 0) }));
      autoUpdater.on('update-downloaded', (i) => set({ status: 'pronto', versaoNova: i.version, progresso: 100 }));
      autoUpdater.on('error', (e) => set({ status: 'erro', erro: (e && e.message) || String(e) }));
      setTimeout(() => verificar().catch(() => {}), 5000);
    } catch (e) {
      autoUpdater = null;
      estado.erro = 'Módulo de atualização indisponível: ' + e.message;
    }
  }

  const ok = (fn) => async () => {
    try { return { ok: true, data: await fn() }; } catch (e) { return { ok: false, error: e.message }; }
  };
  const precisa = () => {
    if (!autoUpdater) throw new Error('Atualização automática só funciona no aplicativo instalado (não no modo de teste "npm start").');
  };

  ipcMain.handle('updState', ok(() => ({ ...estado, versaoAtual: app.getVersion(), instalado: !!autoUpdater })));
  ipcMain.handle('updCheck', ok(async () => { precisa(); await verificar(); return true; }));
  ipcMain.handle('updDownload', ok(async () => { precisa(); set({ status: 'baixando', progresso: 0 }); await autoUpdater.downloadUpdate(); return true; }));
  ipcMain.handle('updInstall', ok(() => { precisa(); setImmediate(() => autoUpdater.quitAndInstall(false, true)); return true; }));
}

module.exports = { init };
