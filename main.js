const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const alertas = require('./src/alertas');
const path = require('path');
const fs = require('fs');
const { Mnemonic, HDNodeWallet, randomBytes, formatUnits } = require('ethers');
const precos = require('./src/precos');
const QRCode = require('qrcode');

const vault = require('./src/vault');
const { NETWORKS, ASSETS } = require('./src/chains');
const { fmt } = require('./src/util');
const { tronFromEvm } = require('./src/tronaddr');
const evm = require('./src/evm');
const tron = require('./src/tron');
const updater = require('./src/updater');

// Mantém os dados na mesma pasta de sempre, mesmo com o nome novo do programa
app.setPath('userData', path.join(app.getPath('appData'), 'Carteira Janio'));

let win = null;
let session = null; // { phrase } enquanto desbloqueado
const keyCache = {};

// ---------- Registro de erros ----------
function log(text) {
  const line = `${new Date().toISOString()} ${text}\n`;
  if (process.env.CARTEIRA_TESTE) process.stdout.write('LOG ' + line);
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(path.join(app.getPath('userData'), 'log.txt'), line);
  } catch { /* ignora */ }
}
process.on('uncaughtException', (e) => log(`[principal] ${e && e.stack}`));
process.on('unhandledRejection', (e) => log(`[principal] ${e && (e.stack || e)}`));

// ---------- Arquivos ----------
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'carteiras.json');
const cfgFile = () => path.join(dataDir(), 'config.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file.replace(/\.json$/, '.backup.json'));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function settings() {
  const s = readJson(cfgFile()) || {};
  const rpc = {};
  for (const id of Object.keys(NETWORKS)) rpc[id] = (s.rpc && s.rpc[id]) || NETWORKS[id].rpc;
  const n = s.notificar || {};
  const e = s.email || {};
  return {
    rpc,
    tronApiKey: s.tronApiKey || '',
    intervalo: Math.max(3, Number(s.intervalo) || 3),
    notificar: { entradas: n.entradas !== false, envios: n.envios !== false },
    email: {
      ativo: !!e.ativo, usuario: e.usuario || '', destino: e.destino || '',
      entradas: e.entradas !== false, envios: e.envios !== false, senhaCifrada: e.senhaCifrada || ''
    }
  };
}

// ---------- Chaves ----------
function requireUnlocked() {
  if (!session) throw new Error('A carteira está bloqueada. Digite sua senha.');
}

function keysFor(index) {
  requireUnlocked();
  if (!keyCache[index]) {
    const m = Mnemonic.fromPhrase(session.phrase);
    const evmWallet = HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${index}`);
    const tronNode = HDNodeWallet.fromMnemonic(m, `m/44'/195'/0'/0/${index}`);
    keyCache[index] = {
      evm: evmWallet,
      tronPrivateKey: tronNode.privateKey.slice(2),
      tronAddress: tronFromEvm(tronNode.address)
    };
  }
  return keyCache[index];
}

function addressFor(index, networkId) {
  const k = keysFor(index);
  return NETWORKS[networkId].kind === 'tron' ? k.tronAddress : k.evm.address;
}

function getWallet(data, index) {
  const w = data.wallets.find((x) => x.index === Number(index));
  if (!w) throw new Error('Carteira não encontrada.');
  return w;
}

function getAsset(id) {
  const a = ASSETS.find((x) => x.id === id);
  if (!a) throw new Error('Moeda não encontrada.');
  return { asset: a, net: NETWORKS[a.network] };
}

function friendly(e) {
  const msg = (e && (e.shortMessage || e.message)) || String(e);
  if (e && e.code === 'INSUFFICIENT_FUNDS') return 'Saldo insuficiente para pagar a taxa da rede.';
  if (e && (e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT')) return 'Sem resposta do servidor da rede. Verifique a internet ou troque o servidor em Configurações.';
  if (/429|rate limit|Too Many/i.test(msg)) return 'O servidor da rede limitou as consultas. Espere alguns segundos e tente de novo (ou coloque uma chave da TronGrid em Configurações).';
  return msg;
}

// ---------- Comunicação com a tela ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, arg) => {
    try { return { ok: true, data: await fn(arg || {}) }; } catch (e) { return { ok: false, error: friendly(e) }; }
  });
}

handle('state', () => ({ exists: !!readJson(dataFile()), unlocked: !!session }));

handle('newPhrase', () => Mnemonic.fromEntropy(randomBytes(16)).phrase);

handle('create', ({ phrase, password, firstName }) => {
  if (readJson(dataFile())) throw new Error('Já existe um cofre de carteiras neste computador.');
  phrase = String(phrase || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!Mnemonic.isValidMnemonic(phrase)) throw new Error('Frase secreta inválida. Confira as palavras e a ordem.');
  if (!password || String(password).length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  writeJson(dataFile(), {
    version: 1,
    vault: vault.encrypt(phrase, password),
    wallets: [{ name: (firstName || 'Carteira 1').trim(), index: 0 }],
    nextIndex: 1
  });
  session = { phrase };
  return true;
});

handle('unlock', ({ password }) => {
  const data = readJson(dataFile());
  if (!data) throw new Error('Nenhum cofre encontrado.');
  session = { phrase: vault.decrypt(data.vault, password) };
  return true;
});

handle('lock', () => {
  session = null;
  foco = null;
  for (const k of Object.keys(saldosMem)) delete saldosMem[k];
  for (const k of Object.keys(keyCache)) delete keyCache[k];
  return true;
});

handle('wallets', () => {
  requireUnlocked();
  const data = readJson(dataFile());
  return data.wallets.map((w) => ({ ...w, evmAddress: keysFor(w.index).evm.address, tronAddress: keysFor(w.index).tronAddress }));
});

handle('addWallet', ({ name }) => {
  requireUnlocked();
  const data = readJson(dataFile());
  name = String(name || '').trim();
  if (!name) throw new Error('Digite um nome para a carteira.');
  if (data.wallets.some((w) => w.name.toLowerCase() === name.toLowerCase())) throw new Error('Já existe uma carteira com esse nome.');
  const w = { name, index: data.nextIndex };
  data.wallets.push(w);
  data.nextIndex += 1;
  writeJson(dataFile(), data);
  return w;
});

handle('renameWallet', ({ index, name }) => {
  requireUnlocked();
  const data = readJson(dataFile());
  name = String(name || '').trim();
  if (!name) throw new Error('Digite um nome.');
  getWallet(data, index).name = name;
  writeJson(dataFile(), data);
  return true;
});

handle('assets', () => ASSETS.map((a) => ({ ...a, networkName: NETWORKS[a.network].name, standard: NETWORKS[a.network].standard, rotulo: NETWORKS[a.network].rotulo })));

async function fetchBalance(index, assetId) {
  const { asset, net } = getAsset(assetId);
  const s = settings();
  const address = addressFor(index, net.id);
  return net.kind === 'tron'
    ? tron.balance({ rpc: s.rpc.tron, apiKey: s.tronApiKey }, asset, address)
    : evm.balance(net, s.rpc[net.id], asset, address);
}

handle('balance', async ({ index, assetId }) => {
  const r = await fetchBalance(index, assetId);
  return { assetId, balance: fmt(r.raw, r.decimals), zero: r.raw === 0n };
});

// ---------- Monitor: atualiza saldos sozinho e avisa quando chega dinheiro ----------
const saldosFile = () => path.join(dataDir(), 'saldos.json');
let ultimos = null;
let foco = null;
let ultimoGeral = 0;
let timerMonitor = null;
let rodando = false;
let pedirDeNovo = false;
const saldosMem = {}; // índice da carteira -> { assetId: { raw, decimals } }

function valorUsd(assetId, raw, decimals) {
  const p = precos.preco(getAsset(assetId).asset.symbol);
  if (p == null) return null;
  return Number(formatUnits(raw, decimals)) * p;
}

function resumo() {
  const data = readJson(dataFile());
  if (!data || !session) return [];
  return data.wallets.map((w) => {
    const m = saldosMem[w.index];
    if (!m) return { index: w.index, totalUsd: null };
    let total = 0;
    for (const [assetId, v] of Object.entries(m)) {
      const u = valorUsd(assetId, v.raw, v.decimals);
      if (u) total += u;
    }
    return { index: w.index, totalUsd: total };
  });
}

function enviarResumo() {
  if (win && !win.isDestroyed()) win.webContents.send('resumo', resumo());
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

function abrirJanela() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function avisarEntrada(w, assetId, diff, decimals) {
  const { asset, net } = getAsset(assetId);
  alertas.avisar({
    cfg: settings(), tipo: 'entradas', log, aoClicar: abrirJanela,
    titulo: `Chegou ${fmt(diff, decimals)} ${asset.symbol}`,
    corpo: `Rede ${net.rotulo || net.name} · carteira ${w.name}`
  });
}

async function verificarCarteira(w) {
  const res = await mapLimit(ASSETS, 4, async (a) => {
    try {
      const r = await fetchBalance(w.index, a.id);
      return { assetId: a.id, raw: r.raw, decimals: r.decimals };
    } catch (e) {
      return { assetId: a.id, erro: friendly(e) };
    }
  });
  const lista = [];
  for (const r of res) {
    if (r.erro) { lista.push({ assetId: r.assetId, erro: r.erro }); continue; }
    const k = `${w.index}|${r.assetId}`;
    const antes = ultimos[k] != null ? BigInt(ultimos[k]) : null;
    if (antes != null && r.raw > antes) avisarEntrada(w, r.assetId, r.raw - antes, r.decimals);
    ultimos[k] = r.raw.toString();
    (saldosMem[w.index] = saldosMem[w.index] || {})[r.assetId] = { raw: r.raw, decimals: r.decimals };
    lista.push({ assetId: r.assetId, balance: fmt(r.raw, r.decimals), zero: r.raw === 0n, usd: valorUsd(r.assetId, r.raw, r.decimals) });
  }
  if (win && !win.isDestroyed()) win.webContents.send('saldos', { index: w.index, saldos: lista, quando: Date.now() });
}

async function cicloMonitor() {
  clearTimeout(timerMonitor);
  if (rodando) { pedirDeNovo = true; return; }
  rodando = true;
  try {
    if (session) {
      if (!ultimos) ultimos = readJson(saldosFile()) || {};
      const data = readJson(dataFile());
      const agora = Date.now();
      const todas = agora - ultimoGeral > 60000;
      if (todas) ultimoGeral = agora;
      const lista = data.wallets
        .filter((w) => todas || w.index === foco)
        .sort((a, b) => (a.index === foco ? -1 : b.index === foco ? 1 : 0));
      await precos.atualizar().catch((e) => log('[preços] ' + e.message));
      for (const w of lista) { await verificarCarteira(w); enviarResumo(); }
      fs.writeFileSync(saldosFile(), JSON.stringify(ultimos));
    }
  } catch (e) {
    log('[monitor] ' + (e && e.message));
  }
  rodando = false;
  if (pedirDeNovo) { pedirDeNovo = false; return cicloMonitor(); }
  timerMonitor = setTimeout(cicloMonitor, settings().intervalo * 1000);
}

handle('monitorFoco', ({ index }) => { foco = Number(index); cicloMonitor(); return true; });
handle('monitorAgora', () => { cicloMonitor(); return true; });
handle('resumo', () => resumo());

// Busca uma moeda em todas as carteiras (usa os últimos saldos conferidos)
handle('buscarMoeda', ({ texto }) => {
  requireUnlocked();
  const q = String(texto || '').trim().toLowerCase();
  if (!q) return [];
  const data = readJson(dataFile());
  const out = [];
  for (const w of data.wallets) {
    const m = saldosMem[w.index] || {};
    for (const a of ASSETS) {
      if (!a.symbol.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q)) continue;
      const v = m[a.id];
      if (!v || v.raw === 0n) continue;
      out.push({
        index: w.index, carteira: w.name, assetId: a.id, symbol: a.symbol,
        rede: NETWORKS[a.network].rotulo || NETWORKS[a.network].name,
        balance: fmt(v.raw, v.decimals), usd: valorUsd(a.id, v.raw, v.decimals)
      });
    }
  }
  out.sort((x, y) => (y.usd || 0) - (x.usd || 0));
  return out;
});

// Acompanha um envio até ser confirmado na rede
async function acompanharEnvio(net, hash, texto, w) {
  const cfgTron = { rpc: settings().rpc.tron, apiKey: settings().tronApiKey };
  let res = 'pendente';
  try {
    res = net.kind === 'tron' ? await tron.waitConfirm(cfgTron, hash) : await evm.waitConfirm(net, settings().rpc[net.id], hash);
  } catch (e) {
    log('[acompanhar] ' + e.message);
  }
  const titulos = { ok: 'Envio confirmado ✓', falhou: 'Envio FALHOU na rede', pendente: 'Envio ainda não confirmado' };
  alertas.avisar({
    cfg: settings(), tipo: 'envios', log, aoClicar: abrirJanela,
    titulo: titulos[res] || titulos.pendente,
    corpo: `${texto} · carteira ${w.name}`
  });
  cicloMonitor();
}

handle('receive', async ({ index, assetId }) => {
  const { asset, net } = getAsset(assetId);
  const address = addressFor(index, net.id);
  const qr = await QRCode.toDataURL(address, { margin: 1, width: 240 });
  return { address, qr, symbol: asset.symbol, networkName: net.name, standard: net.standard, aviso: asset.aviso || '' };
});

async function runTransfer(mode, { index, assetId, to, amount, max }) {
  requireUnlocked();
  const { asset, net } = getAsset(assetId);
  const s = settings();
  const k = keysFor(index);
  let r;
  if (net.kind === 'tron') {
    const args = { cfg: { rpc: s.rpc.tron, apiKey: s.tronApiKey }, asset, from: k.tronAddress, privateKey: k.tronPrivateKey, to, amount, max };
    r = mode === 'send' ? await tron.send(args) : await tron.prepare(args);
  } else {
    const args = { net, url: s.rpc[net.id], asset, wallet: k.evm, to, amount, max };
    r = mode === 'send' ? await evm.send(args) : await evm.prepare(args);
  }
  const out = {
    amount: fmt(r.value, r.decimals, r.decimals),
    symbol: asset.symbol,
    fee: fmt(r.fee, r.feeDecimals),
    feeLabel: r.feeLabel || 'no máximo',
    feeSymbol: net.symbol,
    networkName: net.name,
    to: r.to,
    hash: r.hash || null,
    explorer: r.hash ? net.explorer + r.hash : null
  };
  if (mode === 'send' && r.hash) {
    const w = getWallet(readJson(dataFile()), index);
    const texto = `${out.amount} ${asset.symbol} na rede ${net.rotulo || net.name}`;
    alertas.avisar({ cfg: settings(), tipo: 'envios', log, aoClicar: abrirJanela, titulo: 'Envio em processamento…', corpo: `${texto} · carteira ${w.name}` });
    acompanharEnvio(net, r.hash, texto, w);
    setTimeout(cicloMonitor, 1500);
  }
  return out;
}

handle('estimate', (arg) => runTransfer('estimate', arg));
handle('send', (arg) => runTransfer('send', arg));

handle('revealPhrase', ({ password }) => {
  const data = readJson(dataFile());
  return vault.decrypt(data.vault, password);
});

handle('exportKey', ({ index, password }) => {
  const data = readJson(dataFile());
  vault.decrypt(data.vault, password); // confere a senha
  const k = keysFor(index);
  return { evm: k.evm.privateKey, tron: k.tronPrivateKey };
});

handle('getSettings', () => ({ ...settings(), email: { ...settings().email, senhaCifrada: undefined, temSenha: !!settings().email.senhaCifrada }, defaults: Object.fromEntries(Object.values(NETWORKS).map((n) => [n.id, n.rpc])), names: Object.fromEntries(Object.values(NETWORKS).map((n) => [n.id, n.name])) }));

function montarEmail(email, anterior) {
  email = email || {};
  return {
    ativo: !!email.ativo,
    usuario: String(email.usuario || '').trim(),
    destino: String(email.destino || '').trim(),
    entradas: email.entradas !== false,
    envios: email.envios !== false,
    senhaCifrada: email.senha ? alertas.cifrar(String(email.senha).replace(/\s+/g, '')) : (anterior.senhaCifrada || '')
  };
}

handle('saveSettings', ({ rpc, tronApiKey, intervalo, notificar, email }) => {
  const clean = {};
  for (const id of Object.keys(NETWORKS)) {
    const u = String((rpc && rpc[id]) || '').trim();
    if (u && !/^https:\/\//i.test(u)) throw new Error(`O servidor da rede ${NETWORKS[id].name} precisa começar com https://`);
    if (u && u !== NETWORKS[id].rpc) clean[id] = u;
  }
  const atual = settings();
  const em = montarEmail(email, atual.email);
  if (em.ativo && (!em.usuario || !em.senhaCifrada)) throw new Error('Para avisos por e-mail, preencha o Gmail e a senha de app.');
  writeJson(cfgFile(), {
    rpc: clean,
    tronApiKey: String(tronApiKey || '').trim(),
    intervalo: Math.max(3, Number(intervalo) || 3),
    notificar: { entradas: !(notificar && notificar.entradas === false), envios: !(notificar && notificar.envios === false) },
    email: em
  });
  cicloMonitor();
  return true;
});

handle('testarEmail', async ({ email }) => {
  const em = montarEmail(email, settings().email);
  await alertas.enviarEmail({ ...em, senha: alertas.decifrar(em.senhaCifrada) }, '[Wallet - Trabalho] E-mail de teste', 'Se você recebeu este e-mail, os avisos da Wallet - Trabalho estão funcionando.');
  return true;
});

handle('copy', ({ text }) => { clipboard.writeText(String(text || '')); return true; });

handle('openExternal', ({ url }) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
  return true;
});

// ---------- Janela ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14161c',
    title: 'Wallet - Trabalho',
    icon: path.join(__dirname, 'renderer', 'app-icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // Registro de erros da tela (arquivo log.txt na pasta de dados do app)
  win.webContents.on('console-message', (e, level, message, line, source) => {
    const msg = message ?? e.message;
    const lvl = level ?? e.level;
    const ln = line ?? e.lineNumber;
    const src = source ?? e.sourceId;
    log(`[tela:${lvl}] ${msg} (${src}:${ln})`);
  });
  win.webContents.on('preload-error', (_e, p, err) => log(`[preload] ${p}: ${err && err.stack}`));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log(`[carregar] ${code} ${desc} ${url}`));
  win.webContents.on('render-process-gone', (_e, d) => log(`[tela caiu] ${JSON.stringify(d)}`));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  updater.init(win);
}

app.setAppUserModelId('com.janio.carteira');

app.whenReady().then(() => {
  createWindow();
  // Modo de teste automático (usado só pelo GitHub): abre, espera e fecha
  if (process.env.CARTEIRA_TESTE) {
    setTimeout(async () => {
      try {
        const vis = await win.webContents.executeJavaScript(
          "[...document.querySelectorAll('.tela')].filter(t=>!t.classList.contains('hidden')).map(t=>t.id).join(',') || 'NENHUMA'");
        log('[teste] tela visível: ' + vis);
        // Testa o fluxo completo com uma frase de teste pública (sem dinheiro)
        const r = await win.webContents.executeJavaScript(`(async () => {
          const c = window.api.call, out = [];
          const t = async (nome, f) => { try { out.push(nome + ' OK ' + JSON.stringify(await f())); } catch (e) { out.push(nome + ' ERRO ' + e.message); } };
          await t('criar', () => c('create', { phrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', password: 'teste12345', firstName: 'Janio 1' }));
          await t('nova', () => c('addWallet', { name: 'Janio 2' }));
          await t('lista', async () => (await c('wallets')).map(w => w.name + ' ' + w.evmAddress + ' ' + w.tronAddress));
          for (const a of await c('assets')) await t('saldo ' + a.id, () => c('balance', { index: 0, assetId: a.id }));
          await t('receber', async () => (await c('receive', { index: 0, assetId: 'usdt-tron' })).address);
          await t('estimar eth', () => c('estimate', { index: 0, assetId: 'eth', to: '0x000000000000000000000000000000000000dEaD', amount: '0.001' }));
          await new Promise(r => setTimeout(r, 3000));
          await t('estimar usdt-tron', () => c('estimate', { index: 0, assetId: 'usdt-tron', to: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: '1' }));
          await t('endereco errado', () => c('estimate', { index: 0, assetId: 'usdt-bsc', to: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: '1' }));
          await t('config', async () => (await c('getSettings')).intervalo);
          await abrirPrincipal();
          await new Promise(r => setTimeout(r, 12000));
          out.push('linhas ' + document.querySelectorAll('#tabela-moedas tr[data-grupo]').length);
          out.push('seletores ' + [...document.querySelectorAll('.sel-rede')].map(x => x.dataset.rede + ':' + x.options.length).join(' '));
          out.push('icones ' + [...document.querySelectorAll('img.icone')].filter(i => i.naturalWidth > 0).map(i => i.dataset.icone).join(','));
          out.push('letras ' + [...document.querySelectorAll('.icone.letra')].map(i => i.textContent).join(','));
          out.push('saldos ' + [...document.querySelectorAll('[data-saldo]')].map(x => x.dataset.saldo + '=' + x.textContent).join(' | '));
          out.push('hora ' + document.getElementById('hora-saldo').textContent);
          out.push('resumo ' + JSON.stringify(await c('resumo')));
          out.push('busca usdt ' + JSON.stringify(await c('buscarMoeda', { texto: 'usdt' })));
          out.push('lista lateral ' + [...document.querySelectorAll('#lista-carteiras li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim()).join(' / '));
          out.push('usd celula ' + (document.querySelector('[data-usd="USDT"]') || {}).textContent);
          return out;
        })()`);
        for (const x of r) log('[teste] ' + x.slice(0, 300));
      } catch (e) { log('[teste] erro: ' + e.message); }
      app.quit();
    }, 5000);
  }
});
app.on('window-all-closed', () => app.quit());
