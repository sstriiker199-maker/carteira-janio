const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const alertas = require('./src/alertas');
const path = require('path');
const fs = require('fs');
const { Mnemonic, HDNodeWallet, Wallet, randomBytes, formatUnits } = require('ethers');
const precos = require('./src/precos');
const QRCode = require('qrcode');

const vault = require('./src/vault');
const { NETWORKS, ASSETS } = require('./src/chains');
const { fmt } = require('./src/util');
const { tronFromEvm } = require('./src/tronaddr');
const evm = require('./src/evm');
const tron = require('./src/tron');
const updater = require('./src/updater');
const ed25519 = require('./src/ed25519');
const { getBytes } = require('ethers');

// Módulos das redes novas (carregados só quando usados)
const MOD = {
  utxo: () => require('./src/utxo'),
  solana: () => require('./src/solana'),
  xrp: () => require('./src/xrp'),
  ton: () => require('./src/ton'),
  cardano: () => require('./src/cardano')
};

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
    carteiraTaxas: s.carteiraTaxas != null ? Number(s.carteiraTaxas) : null,
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

// Carteiras: "frase principal" (padrão), "chave" (chave privada importada) ou "frase" importada
function registroCarteira(index) {
  const data = readJson(dataFile());
  return data && data.wallets.find((x) => x.index === Number(index));
}

function keysFor(index) {
  requireUnlocked();
  if (!keyCache[index]) {
    const w = registroCarteira(index) || { index };
    if (w.origem === 'chave') {
      const pk = session.extras.chaves[w.chave];
      if (!pk) throw new Error('Chave da carteira importada não encontrada.');
      const evmWallet = new Wallet(pk);
      keyCache[index] = { evm: evmWallet, tronPrivateKey: pk.replace(/^0x/, ''), tronAddress: tronFromEvm(evmWallet.address), soEvm: true, redes: {}, ends: {} };
    } else {
      const frase = w.origem === 'frase' ? session.extras.frases[w.grupo] : session.phrase;
      if (!frase) throw new Error('Frase da carteira importada não encontrada.');
      const d = w.deriv != null ? w.deriv : w.index;
      const m = Mnemonic.fromPhrase(frase);
      const evmWallet = HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${d}`);
      const tronNode = HDNodeWallet.fromMnemonic(m, `m/44'/195'/0'/0/${d}`);
      keyCache[index] = { evm: evmWallet, tronPrivateKey: tronNode.privateKey.slice(2), tronAddress: tronFromEvm(tronNode.address), frase, d, redes: {}, ends: {} };
    }
  }
  return keyCache[index];
}

function salvarExtras(data) {
  data.extras = vault.encrypt(JSON.stringify(session.extras), session.senha);
}

class Indisponivel extends Error {}

// Chave de uma carteira numa rede nova (Bitcoin, Solana, XRP, TON, Cardano…)
function chaveRede(index, net) {
  const k = keysFor(index);
  if (k.redes[net.id]) return k.redes[net.id];
  if (k.soEvm) throw new Indisponivel('Carteira importada por chave privada: só funciona em Ethereum, BNB, Polygon, Avalanche e Tron.');
  const m = Mnemonic.fromPhrase(k.frase);
  let chave;
  if (net.kind === 'utxo' || net.kind === 'xrp') {
    const caminho = net.kind === 'xrp' ? "m/44'/144'/0'/0/" : MOD.utxo().REDES[net.coin].caminho;
    const w = HDNodeWallet.fromMnemonic(m, caminho + k.d);
    chave = { priv: w.privateKey, pubkey: Buffer.from(getBytes(w.publicKey)) };
  } else if (net.kind === 'solana') {
    chave = { seed32: ed25519.derivar(m.computeSeed(), `m/44'/501'/${k.d}'/0'`) };
  } else if (net.kind === 'ton') {
    chave = { seed32: ed25519.derivar(m.computeSeed(), `m/44'/607'/${k.d}'`) };
  } else if (net.kind === 'cardano') {
    chave = { entropia: m.entropy, conta: k.d };
  }
  k.redes[net.id] = chave;
  return chave;
}

function addressFor(index, networkId) {
  const k = keysFor(index);
  const net = NETWORKS[networkId];
  if (net.kind === 'tron') return k.tronAddress;
  if (net.kind === 'evm') return k.evm.address;
  if (!k.ends[networkId]) {
    const chave = chaveRede(index, net);
    k.ends[networkId] = net.kind === 'utxo' ? MOD.utxo().endereco(net.coin, chave.pubkey) : MOD[net.kind]().endereco(net.kind === 'solana' || net.kind === 'ton' ? chave.seed32 : chave);
  }
  return k.ends[networkId];
}

function cfgRede(net) {
  const s = settings();
  return { rpc: s.rpc[net.id], apiKey: net.kind === 'tron' ? s.tronApiKey : undefined };
}

function linkExplorer(net, hash) {
  if (net.kind === 'ton') return net.explorer + String(hash).split(':')[0];
  return net.explorer + hash;
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
  session = { phrase, senha: password, extras: { chaves: {}, frases: {} } };
  return true;
});

handle('unlock', ({ password }) => {
  const data = readJson(dataFile());
  if (!data) throw new Error('Nenhum cofre encontrado.');
  const phrase = vault.decrypt(data.vault, password);
  const extras = data.extras ? JSON.parse(vault.decrypt(data.extras, password)) : { chaves: {}, frases: {} };
  session = { phrase, senha: password, extras };
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
  return data.wallets.map((w) => ({ name: w.name, index: w.index, importada: !!w.origem, evmAddress: keysFor(w.index).evm.address, tronAddress: keysFor(w.index).tronAddress }));
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

// Importar carteira de outro app (ex.: MetaMask)
handle('importWallet', ({ tipo, segredo, name, quantidade }) => {
  requireUnlocked();
  const data = readJson(dataFile());
  name = String(name || '').trim() || 'Importada';
  segredo = String(segredo || '').trim();
  data.nextImport = data.nextImport || 100000;
  const usados = new Set(data.wallets.map((w) => w.name.toLowerCase()));
  const nomeLivre = (n) => { let x = n, i = 2; while (usados.has(x.toLowerCase())) x = `${n} (${i++})`; usados.add(x.toLowerCase()); return x; };
  const enderecosExistentes = new Set(data.wallets.map((w) => keysFor(w.index).evm.address.toLowerCase()));
  const novas = [];

  if (tipo === 'chave') {
    let pk = segredo.replace(/\s+/g, '');
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(pk)) throw new Error('Chave privada inválida. Ela tem 64 letras/números (pode começar com 0x).');
    if (!pk.startsWith('0x')) pk = '0x' + pk;
    const addr = new Wallet(pk).address.toLowerCase();
    if (enderecosExistentes.has(addr)) throw new Error('Essa carteira já está no programa.');
    const id = 'k' + Date.now();
    session.extras.chaves[id] = pk;
    novas.push({ name: nomeLivre(name), index: data.nextImport++, origem: 'chave', chave: id });
  } else {
    const frase = segredo.toLowerCase().replace(/\s+/g, ' ');
    if (!Mnemonic.isValidMnemonic(frase)) throw new Error('Frase inválida. Confira as palavras e a ordem.');
    if (frase === session.phrase) throw new Error('Essa é a frase principal deste programa. Use "+ Nova carteira".');
    const qtd = Math.min(50, Math.max(1, Number(quantidade) || 1));
    const grupo = 'g' + Date.now();
    session.extras.frases[grupo] = frase;
    const m = Mnemonic.fromPhrase(frase);
    for (let i = 0; i < qtd; i++) {
      const addr = HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${i}`).address.toLowerCase();
      if (enderecosExistentes.has(addr)) continue;
      novas.push({ name: nomeLivre(qtd > 1 ? `${name} ${i + 1}` : name), index: data.nextImport++, origem: 'frase', grupo, deriv: i });
    }
    if (!novas.length) throw new Error('Essas contas já estão no programa.');
  }
  data.wallets.push(...novas);
  for (const n of novas) registrar({ tipo: 'importada', index: n.index, carteira: n.name });
  salvarExtras(data);
  writeJson(dataFile(), data);
  ultimoGeral = 0;
  cicloMonitor();
  return novas;
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

handle('assets', () => ASSETS.map((a) => ({ ...a, networkName: NETWORKS[a.network].name, standard: NETWORKS[a.network].standard, rotulo: NETWORKS[a.network].rotulo, memo: NETWORKS[a.network].memo || null, kind: NETWORKS[a.network].kind })));

async function fetchBalance(index, assetId) {
  const { asset, net } = getAsset(assetId);
  const s = settings();
  const address = addressFor(index, net.id);
  if (net.kind === 'tron') return tron.balance({ rpc: s.rpc.tron, apiKey: s.tronApiKey }, asset, address);
  if (net.kind === 'evm') return evm.balance(net, s.rpc[net.id], asset, address);
  if (net.kind === 'utxo') return MOD.utxo().saldo(cfgRede(net), net.coin, asset, address);
  return MOD[net.kind]().saldo(cfgRede(net), asset, address);
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

// ---------- Atividade (histórico local) ----------
const ativFile = () => path.join(dataDir(), 'atividade.json');
function registrar(ev) {
  const lista = readJson(ativFile()) || [];
  ev.id = 'a' + Date.now() + Math.random().toString(36).slice(2, 6);
  ev.quando = Date.now();
  lista.unshift(ev);
  if (lista.length > 3000) lista.length = 3000;
  try { fs.writeFileSync(ativFile(), JSON.stringify(lista)); } catch (e) { log('[atividade] ' + e.message); }
  if (win && !win.isDestroyed()) win.webContents.send('atividade', ev);
  return ev.id;
}
function atualizarAtividade(id, campos) {
  const lista = readJson(ativFile()) || [];
  const ev = lista.find((x) => x.id === id);
  if (!ev) return;
  Object.assign(ev, campos);
  try { fs.writeFileSync(ativFile(), JSON.stringify(lista)); } catch { /* ignora */ }
  if (win && !win.isDestroyed()) win.webContents.send('atividade', ev);
}
handle('atividade', ({ index, tipo }) => {
  let lista = readJson(ativFile()) || [];
  if (index != null && index !== '') lista = lista.filter((e) => e.index === Number(index) || e.indexDestino === Number(index));
  if (tipo) lista = lista.filter((e) => e.tipo === tipo);
  return lista.slice(0, 500);
});

function avisarEntrada(w, assetId, diff, decimals) {
  const { asset, net } = getAsset(assetId);
  registrar({
    tipo: 'recebido', index: w.index, carteira: w.name, valor: fmt(diff, decimals), symbol: asset.symbol,
    rede: net.rotulo || net.name, usd: valorUsd(assetId, diff, decimals)
  });
  alertas.avisar({
    cfg: settings(), tipo: 'entradas', log, aoClicar: abrirJanela,
    titulo: `Chegou ${fmt(diff, decimals)} ${asset.symbol}`,
    corpo: `Rede ${net.rotulo || net.name} · carteira ${w.name}`
  });
}

const ultimaConsulta = {}; // "índice|moeda" -> horário

async function verificarCarteira(w) {
  const agora = Date.now();
  const res = await mapLimit(ASSETS, 5, async (a) => {
    const net = NETWORKS[a.network];
    const chave = `${w.index}|${a.id}`;
    const guardado = saldosMem[w.index] && saldosMem[w.index][a.id];
    // redes lentas/limitadas (Bitcoin, TON, Cardano…) são consultadas com menos frequência
    if (net.lento && guardado && agora - (ultimaConsulta[chave] || 0) < net.lento) {
      return { assetId: a.id, raw: guardado.raw, decimals: guardado.decimals, repetido: true };
    }
    try {
      const r = await fetchBalance(w.index, a.id);
      ultimaConsulta[chave] = agora;
      return { assetId: a.id, raw: r.raw, decimals: r.decimals };
    } catch (e) {
      if (e instanceof Indisponivel) return { assetId: a.id, indisponivel: e.message };
      return { assetId: a.id, erro: friendly(e) };
    }
  });
  const lista = [];
  for (const r of res) {
    if (r.indisponivel) { lista.push({ assetId: r.assetId, indisponivel: r.indisponivel, zero: true }); continue; }
    if (r.erro) { lista.push({ assetId: r.assetId, erro: r.erro }); continue; }
    const k = `${w.index}|${r.assetId}`;
    const antes = ultimos[k] != null ? BigInt(ultimos[k]) : null;
    if (antes != null && r.raw > antes) avisarEntrada(w, r.assetId, r.raw - antes, r.decimals);
    ultimos[k] = r.raw.toString();
    (saldosMem[w.index] = saldosMem[w.index] || {})[r.assetId] = { raw: r.raw, decimals: r.decimals };
    const sym = getAsset(r.assetId).asset.symbol;
    const usd = valorUsd(r.assetId, r.raw, r.decimals);
    const v = precos.variacao(sym);
    lista.push({
      assetId: r.assetId, balance: fmt(r.raw, r.decimals), zero: r.raw === 0n, usd,
      preco: precos.preco(sym), var24h: v,
      ganho24h: usd != null && v != null ? usd * v / (100 + v) : null
    });
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

handle('mercado', async () => {
  await precos.atualizar().catch(() => {});
  let erro = null;
  try { await precos.atualizarMercado(); } catch (e) { erro = 'Lista do mercado indisponível agora (' + e.message + ')'; }
  return { moedas: precos.mercadoAoVivo(), dolar: precos.dolar(), erro };
});

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
async function acompanharEnvio(net, hash, texto, w, idAtiv, index) {
  let res = 'pendente';
  try {
    res = await esperarConfirmacao(net, hash, index);
  } catch (e) {
    log('[acompanhar] ' + e.message);
  }
  if (idAtiv) atualizarAtividade(idAtiv, { status: res === 'ok' ? 'confirmado' : res === 'falhou' ? 'falhou' : 'pendente' });
  const titulos = { ok: 'Envio confirmado ✓', falhou: 'Envio FALHOU na rede', pendente: 'Envio ainda não confirmado' };
  alertas.avisar({
    cfg: settings(), tipo: 'envios', log, aoClicar: abrirJanela,
    titulo: titulos[res] || titulos.pendente,
    corpo: `${texto} · carteira ${w.name}`
  });
  cicloMonitor();
}

handle('receive', async ({ index, assetId }) => {
  requireUnlocked();
  const { asset, net } = getAsset(assetId);
  const address = addressFor(index, net.id);
  const qr = await QRCode.toDataURL(address, { margin: 1, width: 240 });
  return { address, qr, symbol: asset.symbol, networkName: net.name, standard: net.standard, aviso: asset.aviso || '' };
});

function usdDe(symbol, raw, decimals) {
  const p = precos.preco(symbol);
  return p == null ? null : Number(formatUnits(raw, decimals)) * p;
}

function nativoDe(net) {
  return ASSETS.find((a) => a.network === net.id && a.native);
}

async function prepararOuEnviar(mode, { index, asset, net, to, amount, max, velocidade, valorRaw, memo }) {
  const s = settings();
  const k = keysFor(index);
  if (net.kind !== 'evm' && net.kind !== 'tron') {
    const mod = net.kind === 'utxo' ? MOD.utxo() : MOD[net.kind]();
    const args = { cfg: cfgRede(net), coin: net.coin, asset, chave: chaveRede(index, net), to, amount, max, velocidade, valorRaw, memo };
    return mode === 'send' ? mod.enviar(args) : mod.preparar(args);
  }
  if (net.kind === 'tron') {
    const args = { cfg: { rpc: s.rpc.tron, apiKey: s.tronApiKey }, asset, from: k.tronAddress, privateKey: k.tronPrivateKey, to, amount, max, valorRaw };
    return mode === 'send' ? tron.send(args) : tron.prepare(args);
  }
  const args = { net, url: s.rpc[net.id], asset, wallet: k.evm, to, amount, max, velocidade, valorRaw };
  return mode === 'send' ? evm.send(args) : evm.prepare(args);
}

async function esperarConfirmacao(net, hash, index) {
  const s = settings();
  if (net.kind === 'utxo') return MOD.utxo().confirmar(cfgRede(net), net.coin, hash);
  if (net.kind === 'ton') return MOD.ton().confirmar(cfgRede(net), hash, chaveRede(index, net).seed32);
  if (net.kind !== 'evm' && net.kind !== 'tron') return MOD[net.kind]().confirmar(cfgRede(net), hash);
  return net.kind === 'tron'
    ? tron.waitConfirm({ rpc: s.rpc.tron, apiKey: s.tronApiKey }, hash)
    : evm.waitConfirm(net, s.rpc[net.id], hash);
}

// Se a carteira não tem moeda para a taxa, calcula quanto a carteira de taxas manda
async function planoTaxa(index, net, r) {
  if (!r.faltaTaxa || r.faltaTaxa <= 0n) return null;
  const s = settings();
  const data = readJson(dataFile());
  const tanque = s.carteiraTaxas != null ? data.wallets.find((w) => w.index === s.carteiraTaxas) : null;
  const nat = nativoDe(net);
  const semTanque = `Esta carteira não tem ${net.symbol} para pagar a taxa (precisa de ~${fmt(r.feeMax, nat.decimals)} ${net.symbol}). ` +
    'Mande um pouco para ela ou escolha uma "Carteira de taxas" em Configurações.';
  if (!tanque) throw new Error(semTanque);
  if (tanque.index === Number(index)) throw new Error(semTanque.replace('Mande um pouco para ela ou escolha uma', 'Abasteça a').replace('em Configurações', ''));
  const extra = net.kind === 'tron' ? 500_000n : 0n;
  const valor = r.faltaTaxa * 13n / 10n + extra;
  return { tanque, valor, nat };
}

async function runTransfer(mode, { index, assetId, to, amount, max, velocidade, memo }) {
  requireUnlocked();
  await precos.atualizar().catch(() => {});
  const { asset, net } = getAsset(assetId);
  const w = getWallet(readJson(dataFile()), index);
  const r = await prepararOuEnviar('estimate', { index, asset, net, to, amount, max, velocidade, memo });
  const plano = await planoTaxa(index, net, r);
  const nat = nativoDe(net);

  let abastecer = null;
  if (plano) {
    // confere se a carteira de taxas consegue pagar
    const destinoTaxa = addressFor(index, net.id);
    let prepTanque;
    try {
      prepTanque = await prepararOuEnviar('estimate', { index: plano.tanque.index, asset: plano.nat, net, to: destinoTaxa, valorRaw: plano.valor, velocidade });
    } catch (e) {
      throw new Error(`A carteira de taxas "${plano.tanque.name}" não tem ${net.symbol} suficiente: ${friendly(e)}`);
    }
    abastecer = {
      de: plano.tanque.name,
      valor: fmt(plano.valor, plano.nat.decimals),
      simbolo: net.symbol,
      usd: usdDe(net.symbol, plano.valor, plano.nat.decimals),
      taxaAbastecer: fmt(prepTanque.fee, prepTanque.feeDecimals),
      taxaAbastecerUsd: usdDe(net.symbol, prepTanque.fee, prepTanque.feeDecimals)
    };
  }

  const out = {
    amount: fmt(r.value, r.decimals, r.decimals),
    amountUsd: usdDe(asset.symbol, r.value, r.decimals),
    symbol: asset.symbol,
    fee: fmt(r.fee, r.feeDecimals),
    feeUsd: usdDe(net.symbol, r.fee, r.feeDecimals),
    feeLabel: r.feeLabel || '≈',
    feeSymbol: net.symbol,
    velocidade: r.velocidade || null,
    opcoes: r.opcoes ? Object.fromEntries(Object.entries(r.opcoes).map(([v, x]) => [v, { fee: fmt(x, r.feeDecimals), usd: usdDe(net.symbol, x, r.feeDecimals) }])) : null,
    abastecer,
    networkName: net.rotulo || net.name,
    to: r.to,
    hash: null,
    explorer: null
  };
  if (mode !== 'send') return out;

  // 1) abastece a taxa, se precisar
  if (plano) {
    const destinoTaxa = addressFor(index, net.id);
    alertas.avisar({ cfg: settings(), tipo: 'envios', log, aoClicar: abrirJanela, titulo: 'Abastecendo taxa…', corpo: `${abastecer.valor} ${net.symbol} de ${plano.tanque.name} para ${w.name}` });
    const t = await prepararOuEnviar('send', { index: plano.tanque.index, asset: plano.nat, net, to: destinoTaxa, valorRaw: plano.valor, velocidade });
    const idTaxa = registrar({
      tipo: 'taxa', index: plano.tanque.index, carteira: plano.tanque.name, indexDestino: w.index, destino: w.name,
      valor: abastecer.valor, symbol: net.symbol, rede: net.rotulo || net.name, usd: abastecer.usd,
      hash: t.hash, explorer: linkExplorer(net, t.hash), status: 'processando'
    });
    const res = await esperarConfirmacao(net, t.hash, plano.tanque.index);
    atualizarAtividade(idTaxa, { status: res === 'ok' ? 'confirmado' : res });
    if (res !== 'ok') throw new Error(`O abastecimento da taxa não confirmou (${res}). Nada de ${asset.symbol} foi enviado. Veja: ${linkExplorer(net, t.hash)}`);
    // aviso de carteira de taxas acabando
    try {
      const sobra = await fetchBalance(plano.tanque.index, plano.nat.id);
      if (sobra.raw < plano.valor * 3n) {
        alertas.avisar({ cfg: settings(), tipo: 'envios', log, aoClicar: abrirJanela, titulo: `Carteira de taxas: ${net.symbol} acabando`, corpo: `Restam ${fmt(sobra.raw, sobra.decimals)} ${net.symbol} em ${plano.tanque.name}.` });
      }
    } catch { /* ignora */ }
  }

  // 2) envia de verdade
  const e = await prepararOuEnviar('send', { index, asset, net, to, amount, max, velocidade, memo });
  out.hash = e.hash;
  out.explorer = linkExplorer(net, e.hash);
  out.amount = fmt(e.value, e.decimals, e.decimals);
  const texto = `${out.amount} ${asset.symbol} na rede ${net.rotulo || net.name}`;
  const dest = readJson(dataFile()).wallets.find((x) => {
    try { return addressFor(x.index, net.id).toLowerCase() === String(e.to).toLowerCase(); } catch { return false; }
  });
  const idAtiv = registrar({
    tipo: 'enviado', index: w.index, carteira: w.name, valor: out.amount, symbol: asset.symbol,
    rede: net.rotulo || net.name, usd: usdDe(asset.symbol, e.value, e.decimals), para: e.to,
    indexDestino: dest ? dest.index : undefined, destino: dest ? dest.name : undefined,
    taxa: fmt(e.fee, e.feeDecimals) + ' ' + net.symbol, taxaUsd: usdDe(net.symbol, e.fee, e.feeDecimals),
    hash: e.hash, explorer: linkExplorer(net, e.hash), status: 'processando', memo: memo || undefined
  });
  alertas.avisar({ cfg: settings(), tipo: 'envios', log, aoClicar: abrirJanela, titulo: 'Envio em processamento…', corpo: `${texto} · carteira ${w.name}` });
  acompanharEnvio(net, e.hash, texto, w, idAtiv, index);
  setTimeout(cicloMonitor, 1500);
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

handle('saveSettings', ({ rpc, tronApiKey, intervalo, notificar, email, carteiraTaxas }) => {
  const clean = {};
  for (const id of Object.keys(NETWORKS)) {
    const u = String((rpc && rpc[id]) || '').trim();
    if (u && !/^(https|wss):\/\//i.test(u)) throw new Error(`O servidor da rede ${NETWORKS[id].name} precisa começar com https:// (ou wss://)`);
    if (u && u !== NETWORKS[id].rpc) clean[id] = u;
  }
  const atual = settings();
  const em = montarEmail(email, atual.email);
  if (em.ativo && (!em.usuario || !em.senhaCifrada)) throw new Error('Para avisos por e-mail, preencha o Gmail e a senha de app.');
  writeJson(cfgFile(), {
    rpc: clean,
    tronApiKey: String(tronApiKey || '').trim(),
    intervalo: Math.max(3, Number(intervalo) || 3),
    carteiraTaxas: carteiraTaxas === '' || carteiraTaxas == null ? null : Number(carteiraTaxas),
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
          out.push('preco ETH ' + (document.querySelector('[data-preco="ETH"]') || {}).textContent + ' / ' + (document.querySelector('[data-var="ETH"]') || {}).textContent);
          const mk = await c('mercado');
          out.push('mercado ' + mk.moedas.length + ' moedas; dolar ' + JSON.stringify(mk.dolar) + '; erro ' + mk.erro + '; top3 ' + mk.moedas.slice(0, 3).map(m => m.symbol + '=' + m.usd).join(','));
          out.push('icones2 ' + [...document.querySelectorAll('img.icone')].filter(i => i.naturalWidth > 0).map(i => i.dataset.icone).join(','));
          for (const id of ['btc', 'ltc', 'doge', 'bch', 'sol', 'xrp', 'ton', 'ada']) await t('endereco ' + id, async () => (await c('receive', { index: 0, assetId: id })).address);
          await t('estimar btc', () => c('estimate', { index: 0, assetId: 'btc', to: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', amount: '0.0001' }));
          await t('estimar sol', () => c('estimate', { index: 0, assetId: 'sol', to: '11111111111111111111111111111112', amount: '0.01' }));
          await t('estimar xrp', () => c('estimate', { index: 0, assetId: 'xrp', to: 'rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3', amount: '1', memo: '123' }));
          await t('estimar ada', () => c('estimate', { index: 0, assetId: 'ada', to: 'addr1qxxe304qg9py8hyyqu8evfj4wln7dnms943wsugpdzzsxnkvvjljtzuwxvx0pnwelkcruy95ujkq3aw6rl0vvg32x99q5t8yha', amount: '2' }));
          await t('estimar ton', () => c('estimate', { index: 0, assetId: 'ton', to: 'UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqEDI', amount: '0.1' }));
          await t('importar chave', async () => (await c('importWallet', { tipo: 'chave', segredo: '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318', name: 'MetaMask' })).map(w => w.name));
          await t('importar frase', async () => (await c('importWallet', { tipo: 'frase', segredo: 'test test test test test test test test test test test junk', name: 'Outra', quantidade: 2 })).map(w => w.name));
          await t('lista final', async () => (await c('wallets')).map(w => w.name + ' ' + w.evmAddress.slice(0, 10) + ' ' + w.tronAddress.slice(0, 6) + (w.importada ? ' (imp)' : '')));
          await t('estimar usdt-tron c/ taxa', () => c('estimate', { index: 1, assetId: 'usdt-tron', to: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: '1' }));
          await t('estimar bnb velocidades', async () => { try { return await c('estimate', { index: 0, assetId: 'bnb', to: '0x000000000000000000000000000000000000dEaD', amount: '0.001', velocidade: 'rapida' }); } catch (e) { return e.message; } });
          return out;
        })()`);
        for (const x of r) log('[teste] ' + x.slice(0, 300));
      } catch (e) { log('[teste] erro: ' + e.message); }
      app.quit();
    }, 5000);
  }
});
app.on('window-all-closed', () => app.quit());
