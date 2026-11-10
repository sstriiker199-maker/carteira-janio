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
    rpcProprio: s.rpc || {},
    tronApiKey: s.tronApiKey || '',
    chaves: {
      alchemy: s.chaves && s.chaves.alchemy ? alertas.decifrar(s.chaves.alchemy) : '',
      helius: s.chaves && s.chaves.helius ? alertas.decifrar(s.chaves.helius) : '',
      toncenter: s.chaves && s.chaves.toncenter ? alertas.decifrar(s.chaves.toncenter) : ''
    },
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

// Lista de servidores de cada rede, em ordem: o seu (se colocou), o da sua chave de API, e o gratuito por último
const ALCHEMY = { ethereum: 'eth-mainnet', bsc: 'bnb-mainnet', polygon: 'polygon-mainnet', avalanche: 'avax-mainnet' };
function servidores(net) {
  const s = settings();
  const lista = [];
  if (s.rpcProprio[net.id]) lista.push({ rpc: s.rpcProprio[net.id], apiKey: net.id === 'tron' ? s.tronApiKey || undefined : net.id === 'ton' ? s.chaves.toncenter || undefined : undefined, origem: 'seu servidor' });
  if (ALCHEMY[net.id] && s.chaves.alchemy) lista.push({ rpc: `https://${ALCHEMY[net.id]}.g.alchemy.com/v2/${s.chaves.alchemy}`, origem: 'Alchemy' });
  if (net.id === 'solana' && s.chaves.helius) lista.push({ rpc: `https://mainnet.helius-rpc.com/?api-key=${s.chaves.helius}`, origem: 'Helius' });
  if (net.id === 'tron' && s.tronApiKey) lista.push({ rpc: net.rpc, apiKey: s.tronApiKey, origem: 'TronGrid (chave)' });
  if (net.id === 'ton' && s.chaves.toncenter) lista.push({ rpc: net.rpc, apiKey: s.chaves.toncenter, origem: 'toncenter (chave)' });
  lista.push({ rpc: net.rpc, origem: 'gratuito' });
  const vistos = new Set();
  return lista.filter((x) => { const k = x.rpc + '|' + (x.apiKey || ''); if (vistos.has(k)) return false; vistos.add(k); return true; });
}

function cfgRede(net) {
  return servidores(net)[0];
}

// Tenta no servidor principal; se falhar, usa o próximo (só para consultas, nunca para envio)
async function comReserva(net, fn) {
  const lista = servidores(net);
  let ultimoErro;
  for (const cfg of lista) {
    try { return await fn(cfg); } catch (e) {
      if (e instanceof Indisponivel || e.naoRepetir) throw e;
      ultimoErro = e;
    }
  }
  throw ultimoErro;
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
  try { carregarCache(); } catch { /* ok */ }
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
  return data.wallets.map((w) => ({ name: w.name, index: w.index, importada: !!w.origem, grupo: w.origem === 'frase' ? w.grupo : null, evmAddress: keysFor(w.index).evm.address, tronAddress: keysFor(w.index).tronAddress }));
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
    const qtd = Math.min(200, Math.max(1, Number(quantidade) || 1));
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
  rodizio = Math.max(0, data.wallets.length - novas.length - 1);
  cicloMonitor();
  return novas;
});

// Remover carteiras do programa (o dinheiro continua na blockchain)
handle('removerCarteiras', ({ indices, password }) => {
  requireUnlocked();
  const data = readJson(dataFile());
  vault.decrypt(data.vault, password); // confere a senha
  const tirar = new Set((indices || []).map(Number));
  if (!tirar.size) throw new Error('Nenhuma carteira escolhida.');
  if (data.wallets.length - [...tirar].filter((i) => data.wallets.some((w) => w.index === i)).length < 1) {
    throw new Error('Precisa ficar pelo menos uma carteira no programa.');
  }
  const removidas = data.wallets.filter((w) => tirar.has(w.index));
  data.wallets = data.wallets.filter((w) => !tirar.has(w.index));
  // apaga chaves/frases importadas que não são mais usadas
  for (const w of removidas) {
    if (w.origem === 'chave') delete session.extras.chaves[w.chave];
    if (w.origem === 'frase' && !data.wallets.some((x) => x.grupo === w.grupo)) delete session.extras.frases[w.grupo];
    delete keyCache[w.index];
    delete saldosMem[w.index];
  }
  salvarExtras(data);
  writeJson(dataFile(), data);
  if (ultimos) for (const k of Object.keys(ultimos)) if (tirar.has(Number(k.split('|')[0]))) delete ultimos[k];
  try { salvarCache(); } catch { /* ok */ }
  const cfg = readJson(cfgFile()) || {};
  if (cfg.carteiraTaxas != null && tirar.has(Number(cfg.carteiraTaxas))) { cfg.carteiraTaxas = null; writeJson(cfgFile(), cfg); }
  if (tirar.has(foco)) foco = null;
  rodizio = 0;
  registrar({ tipo: 'removida', carteira: removidas.length === 1 ? removidas[0].name : `${removidas.length} carteiras` });
  return removidas.length;
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
  const address = addressFor(index, net.id);
  return comReserva(net, (cfg) => {
    if (net.kind === 'tron') return tron.balance(cfg, asset, address);
    if (net.kind === 'evm') return evm.balance(net, cfg.rpc, asset, address);
    if (net.kind === 'utxo') return MOD.utxo().saldo(cfg, net.coin, asset, address);
    return MOD[net.kind]().saldo(cfg, asset, address);
  });
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
let rodizio = 0;
let ultimoTanque = 0;
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

const emVerificacao = new Set();
const cacheFile = () => path.join(dataDir(), 'saldos-cache.json');

function formatarSaldo(assetId, raw, decimals) {
  const sym = getAsset(assetId).asset.symbol;
  const usd = valorUsd(assetId, raw, decimals);
  const v = precos.variacao(sym);
  return {
    assetId, balance: fmt(raw, decimals), zero: raw === 0n, usd,
    preco: precos.preco(sym), var24h: v,
    ganho24h: usd != null && v != null ? usd * v / (100 + v) : null
  };
}

function enviarSaldos(index, lista) {
  if (lista.length && win && !win.isDestroyed()) win.webContents.send('saldos', { index, saldos: lista, quando: Date.now() });
}

// Saldos guardados (aparecem na hora ao abrir a carteira, antes de consultar as redes)
handle('saldosGuardados', ({ index }) => {
  const m = saldosMem[Number(index)] || {};
  return Object.entries(m).map(([assetId, v]) => formatarSaldo(assetId, v.raw, v.decimals));
});

function salvarCache() {
  const out = {};
  for (const [i, m] of Object.entries(saldosMem)) {
    out[i] = {};
    for (const [a, v] of Object.entries(m)) out[i][a] = { raw: v.raw.toString(), decimals: v.decimals };
  }
  try { fs.writeFileSync(cacheFile(), JSON.stringify(out)); } catch { /* ignora */ }
}

function carregarCache() {
  const c = readJson(cacheFile()) || {};
  for (const [i, m] of Object.entries(c)) {
    saldosMem[i] = saldosMem[i] || {};
    for (const [a, v] of Object.entries(m)) if (!saldosMem[i][a]) saldosMem[i][a] = { raw: BigInt(v.raw), decimals: v.decimals };
  }
}

const comTempo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('A rede demorou para responder.')), ms))]);

async function verificarCarteira(w, rapido) {
  if (emVerificacao.has(w.index)) return;
  emVerificacao.add(w.index);
  try {
    const agora = Date.now();
    let pendentes = [];
    let timer = null;
    const despejar = () => { clearTimeout(timer); timer = null; const l = pendentes; pendentes = []; enviarSaldos(w.index, l); };
    const publicar = (item) => { pendentes.push(item); if (!timer) timer = setTimeout(despejar, 150); };

    await mapLimit(ASSETS, rapido ? 10 : 5, async (a) => {
      const net = NETWORKS[a.network];
      const chave = `${w.index}|${a.id}`;
      const guardado = saldosMem[w.index] && saldosMem[w.index][a.id];
      // redes lentas/limitadas (Bitcoin, TON, Cardano…) são consultadas com menos frequência
      if (net.lento && guardado && agora - (ultimaConsulta[chave] || 0) < net.lento) {
        publicar(formatarSaldo(a.id, guardado.raw, guardado.decimals));
        return;
      }
      let r;
      try {
        r = await comTempo(fetchBalance(w.index, a.id), 15000);
        ultimaConsulta[chave] = agora;
      } catch (e) {
        if (e instanceof Indisponivel) { publicar({ assetId: a.id, indisponivel: e.message, zero: true }); return; }
        publicar({ assetId: a.id, erro: friendly(e) });
        return;
      }
      const antes = ultimos[chave] != null ? BigInt(ultimos[chave]) : null;
      if (antes != null && r.raw > antes) avisarEntrada(w, a.id, r.raw - antes, r.decimals);
      ultimos[chave] = r.raw.toString();
      (saldosMem[w.index] = saldosMem[w.index] || {})[a.id] = { raw: r.raw, decimals: r.decimals };
      publicar(formatarSaldo(a.id, r.raw, r.decimals));
    });
    despejar();
  } finally {
    emVerificacao.delete(w.index);
  }
}

async function cicloMonitor() {
  clearTimeout(timerMonitor);
  if (rodando) { pedirDeNovo = true; return; }
  rodando = true;
  try {
    if (session) {
      if (!ultimos) { ultimos = readJson(saldosFile()) || {}; carregarCache(); }
      const data = readJson(dataFile());
      const agora = Date.now();
      // carteira aberta: sempre. As outras: em rodízio, algumas por ciclo (aguenta centenas de carteiras)
      const outras = data.wallets.filter((w) => w.index !== foco);
      const lote = [];
      if (outras.length) {
        const porCiclo = ultimoGeral === 0 ? Math.min(outras.length, 4) : outras.length <= 20 ? 2 : 1;
        for (let i = 0; i < porCiclo; i++) lote.push(outras[(rodizio + i) % outras.length]);
        rodizio = (rodizio + porCiclo) % outras.length;
      }
      ultimoGeral = agora;
      const focada = data.wallets.find((w) => w.index === foco);
      const tq = settings().carteiraTaxas;
      const tanque = tq != null && tq !== foco && agora - (ultimoTanque || 0) > 15000 ? data.wallets.find((w) => w.index === tq) : null;
      if (tanque) ultimoTanque = agora;
      const lista = [...new Set((focada ? [focada] : []).concat(tanque ? [tanque] : [], lote))];
      await precos.atualizar().catch((e) => log('[preços] ' + e.message));
      for (const w of lista) { await verificarCarteira(w, w.index === foco); enviarResumo(); }
      fs.writeFileSync(saldosFile(), JSON.stringify(ultimos));
      salvarCache();
    }
  } catch (e) {
    log('[monitor] ' + (e && e.message));
  }
  rodando = false;
  if (pedirDeNovo) { pedirDeNovo = false; return cicloMonitor(); }
  timerMonitor = setTimeout(cicloMonitor, settings().intervalo * 1000);
}

handle('monitorFoco', ({ index }) => {
  foco = Number(index);
  if (!ultimos) { ultimos = readJson(saldosFile()) || {}; carregarCache(); }
  if (!timerMonitor && !rodando) setTimeout(cicloMonitor, 2000);
  // a carteira aberta "fura a fila": consulta já, em paralelo com o rodízio
  const w = (readJson(dataFile()) || { wallets: [] }).wallets.find((x) => x.index === foco);
  if (w && session) verificarCarteira(w, true).then(enviarResumo).catch(() => {});
  return true;
});
handle('monitorAgora', () => { cicloMonitor(); return true; });
handle('resumo', () => resumo());

// Cartão da carteira de taxas (topo da barra lateral)
const MOEDAS_TAXA = ['trx', 'bnb', 'pol', 'sol', 'eth'];
const MINIMO_TAXA_USD = { trx: 3, bnb: 0.5, pol: 0.2, sol: 0.3, eth: 2 };
handle('resumoTaxas', () => {
  const s = settings();
  if (s.carteiraTaxas == null || !session) return null;
  const w = (readJson(dataFile()) || { wallets: [] }).wallets.find((x) => x.index === s.carteiraTaxas);
  if (!w) return null;
  const m = saldosMem[w.index] || {};
  let total = 0;
  const moedasT = MOEDAS_TAXA.map((id) => {
    const v = m[id];
    const a = getAsset(id).asset;
    if (!v) return { symbol: a.symbol, balance: '…', usd: null, baixo: false };
    const usd = valorUsd(id, v.raw, v.decimals);
    if (usd) total += usd;
    return { symbol: a.symbol, balance: fmt(v.raw, v.decimals, 4), usd, baixo: usd != null && usd < MINIMO_TAXA_USD[id] };
  });
  return { index: w.index, name: w.name, total, moedas: moedasT };
});
handle('definirCarteiraTaxas', ({ index }) => {
  const atual = readJson(cfgFile()) || {};
  atual.carteiraTaxas = index === '' || index == null ? null : Number(index);
  writeJson(cfgFile(), atual);
  cicloMonitor();
  return true;
});

// ---------- Verificar endereço de destino ----------
function enderecoValidoPara(net, a) {
  a = String(a || '').trim();
  if (!a) return false;
  try {
    if (net.kind === 'evm') return evm.isAddress(a);
    if (net.kind === 'tron') return require('./src/tronaddr').isTronAddress(a);
    if (net.kind === 'utxo') return !!MOD.utxo().scriptDestino(net.coin, a);
    if (net.kind === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) && !!MOD.solana().validar(a);
    if (net.kind === 'ton') return /^(EQ|UQ|0:|-1:|kQ|0Q)/.test(a) && !!MOD.ton().validar(a);
    return !!MOD[net.kind]().validar(a);
  } catch { return false; }
}

handle('verificarEndereco', ({ assetId, endereco }) => {
  const { asset, net } = getAsset(assetId);
  const a = String(endereco || '').trim();
  if (!a) return { estado: 'vazio' };
  // de quais redes esse endereço parece ser
  const vistas = new Set();
  const redes = [];
  for (const n of Object.values(NETWORKS)) {
    const grupo = n.kind === 'evm' ? 'evm' : n.id;
    if (vistas.has(grupo)) continue;
    if (enderecoValidoPara(n, a)) { vistas.add(grupo); redes.push(n.kind === 'evm' ? 'Ethereum/BNB/Polygon/Avalanche (0x)' : n.rotulo); }
  }
  const nomeMoeda = `${asset.symbol} pela rede ${net.rotulo}`;
  if (enderecoValidoPara(net, a)) {
    let msg = `Endereço válido da rede ${net.kind === 'evm' ? net.rotulo : net.rotulo}.`;
    if (net.kind === 'evm') msg += ` Endereços 0x servem para várias redes: confira se o destino aceita ${net.rotulo}.`;
    let meu = null;
    try {
      const data = readJson(dataFile());
      const w = data.wallets.find((x) => { try { return addressFor(x.index, net.id).toLowerCase() === a.toLowerCase(); } catch { return false; } });
      if (w) meu = w.name;
    } catch { /* ok */ }
    return { estado: net.kind === 'evm' ? 'atencao' : 'ok', mensagem: msg + (meu ? ` É a sua carteira "${meu}".` : '') };
  }
  if (redes.length) {
    return { estado: 'bloqueado', mensagem: `Este endereço é da rede ${redes.join(' / ')}, mas você está enviando ${nomeMoeda}. Envio bloqueado: o dinheiro seria perdido.` };
  }
  return { estado: 'bloqueado', mensagem: `Isso não parece um endereço da rede ${net.rotulo}. Confira se copiou o endereço inteiro.` };
});

// ---------- Troca (swap) ----------
const swap = require('./src/swap');

async function contaSwap() {
  const atual = readJson(cfgFile()) || {};
  if (atual.swap && atual.swap.id && atual.swap.secretCifrado) {
    return { id: atual.swap.id, secret: alertas.decifrar(atual.swap.secretCifrado) };
  }
  const c = await swap.criarConta();
  atual.swap = { id: c.id, secretCifrado: alertas.cifrar(c.secret) };
  writeJson(cfgFile(), atual);
  return { id: c.id, secret: c.secret };
}

// arredonda para cima nas casas decimais da moeda
function arredondarCima(txt, casas) {
  const [i, f = ''] = String(txt).split('.');
  if (f.length <= casas) return txt;
  const base = BigInt(i + f.slice(0, casas).padEnd(casas, '0')) + 1n;
  const s2 = base.toString().padStart(casas + 1, '0');
  return casas ? `${s2.slice(0, -casas)}.${s2.slice(-casas)}` : s2;
}

handle('swapCotar', async ({ index, de, para, amount }) => {
  requireUnlocked();
  const A = getAsset(de);
  const B = getAsset(para);
  if (de === para) throw new Error('Escolha moedas diferentes.');
  const perm = await swap.permissoes();
  if (!perm.createShift) throw new Error('O serviço de troca (SideShift) não está disponível na sua região/conexão.');
  const sd = await swap.suportado(A.asset.symbol, A.net.id);
  const sp = await swap.suportado(B.asset.symbol, B.net.id);
  if (!sd) throw new Error(`${A.asset.symbol} na rede ${A.net.rotulo} não é aceito pelo serviço de troca.`);
  if (!sp) throw new Error(`${B.asset.symbol} na rede ${B.net.rotulo} não é aceito pelo serviço de troca.`);
  const valor = String(amount || '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(valor) || Number(valor) <= 0) throw new Error('Digite o valor que você quer trocar.');
  const conta = await contaSwap();
  const q = await swap.cotar({ secret: conta.secret, affiliateId: conta.id, de: sd, para: sp, valor });
  await precos.atualizar().catch(() => {});
  const usdDe2 = precos.preco(A.asset.symbol) != null ? Number(q.depositAmount) * precos.preco(A.asset.symbol) : null;
  const usdPara = precos.preco(B.asset.symbol) != null ? Number(q.settleAmount) * precos.preco(B.asset.symbol) : null;
  return {
    quoteId: q.id, envia: q.depositAmount, recebe: q.settleAmount, taxa: q.rate, expira: q.expiresAt,
    usdEnvia: usdDe2, usdRecebe: usdPara, de: `${A.asset.symbol} (${A.net.rotulo})`, para: `${B.asset.symbol} (${B.net.rotulo})`
  };
});

async function acompanharSwap(id, idAtiv, textoPara) {
  const fim = Date.now() + 3 * 60 * 60 * 1000;
  let ultimo = '';
  while (Date.now() < fim) {
    await new Promise((r) => setTimeout(r, 15000));
    let st;
    try { st = await swap.status(id); } catch { continue; }
    if (st.status !== ultimo) {
      ultimo = st.status;
      const mapa = { waiting: 'aguardando depósito', pending: 'depósito detectado', processing: 'trocando', settling: 'enviando para você', settled: 'concluída', refund: 'devolvendo', refunded: 'devolvida', expired: 'expirada' };
      atualizarAtividade(idAtiv, { status: mapa[st.status] || st.status, recebido: st.settleAmount });
      if (st.status === 'settled') {
        alertas.avisar({ cfg: settings(), tipo: 'entradas', log, aoClicar: abrirJanela, titulo: 'Troca concluída ✓', corpo: `Você recebeu ${st.settleAmount} ${textoPara}` });
        cicloMonitor();
        return;
      }
      if (st.status === 'refunded' || st.status === 'expired') {
        alertas.avisar({ cfg: settings(), tipo: 'envios', log, aoClicar: abrirJanela, titulo: st.status === 'refunded' ? 'Troca devolvida' : 'Troca expirada', corpo: 'Veja os detalhes na aba Atividade.' });
        return;
      }
    }
  }
}

handle('swapExecutar', async ({ quoteId, index, de, para, destinoIndex }) => {
  requireUnlocked();
  const A = getAsset(de);
  const B = getAsset(para);
  const conta = await contaSwap();
  const settleAddress = addressFor(destinoIndex != null ? Number(destinoIndex) : Number(index), B.net.id);
  const refundAddress = addressFor(Number(index), A.net.id);
  const sh = await swap.criarTroca({ secret: conta.secret, affiliateId: conta.id, quoteId, settleAddress, refundAddress });
  const casas = A.asset.decimals != null ? A.asset.decimals : 18;
  const valor = arredondarCima(sh.depositAmount, Math.min(casas, 8));
  const w = getWallet(readJson(dataFile()), index);
  const idAtiv = registrar({
    tipo: 'swap', index: Number(index), carteira: w.name, valor: sh.depositAmount, symbol: A.asset.symbol, rede: A.net.rotulo,
    paraValor: sh.settleAmount, paraSymbol: B.asset.symbol, paraRede: B.net.rotulo, status: 'enviando depósito',
    explorer: `https://sideshift.ai/orders/${sh.id}`, hash: sh.id
  });
  // envia o depósito para a SideShift
  const envio = await runTransfer('send', { index, assetId: de, to: sh.depositAddress, amount: valor, memo: sh.depositMemo || undefined });
  atualizarAtividade(idAtiv, { status: 'aguardando a troca', depositoHash: envio.hash });
  acompanharSwap(sh.id, idAtiv, `${B.asset.symbol} (${B.net.rotulo})`);
  return { id: sh.id, pagina: `https://sideshift.ai/orders/${sh.id}`, envia: sh.depositAmount, recebe: sh.settleAmount };
});

// ---------- Contatos (endereços favoritos) ----------
const contatosFile = () => path.join(dataDir(), 'contatos.json');
handle('contatos', ({ rede }) => {
  const l = readJson(contatosFile()) || [];
  return rede ? l.filter((c) => c.rede === rede) : l;
});
handle('salvarContato', ({ id, nome, rede, endereco, memo, carteira }) => {
  nome = String(nome || '').trim();
  endereco = String(endereco || '').trim();
  if (!nome) throw new Error('Dê um nome para o favorito.');
  if (!endereco) throw new Error('Endereço vazio.');
  if (!NETWORKS[rede]) throw new Error('Rede inválida.');
  if (!enderecoValidoPara(NETWORKS[rede], endereco)) throw new Error(`Esse endereço não é da rede ${NETWORKS[rede].rotulo}. Confira antes de salvar.`);
  const vinc = carteira === '' || carteira == null ? undefined : Number(carteira);
  const l = readJson(contatosFile()) || [];
  const existente = id ? l.find((c) => c.id === id) : l.find((c) => c.rede === rede && c.endereco === endereco && (c.memo || '') === (memo || ''));
  if (existente) Object.assign(existente, { nome, endereco, memo: memo || undefined, carteira: carteira === undefined ? existente.carteira : vinc });
  else l.push({ id: 'c' + Date.now(), nome, rede, rotuloRede: NETWORKS[rede].rotulo, endereco, memo: memo || undefined, carteira: vinc });
  writeJson(contatosFile(), l);
  return true;
});
handle('redes', () => Object.values(NETWORKS).map((n) => ({ id: n.id, rotulo: n.rotulo, memo: n.memo || null, assetId: ASSETS.find((a) => a.network === n.id).id })));

// Moedas favoritas (aparecem primeiro nas listas de moedas)
handle('moedasFavoritas', () => (readJson(cfgFile()) || {}).moedasFavoritas || []);
handle('salvarMoedasFavoritas', ({ ids }) => {
  const atual = readJson(cfgFile()) || {};
  atual.moedasFavoritas = (ids || []).filter((id) => ASSETS.some((a) => a.id === id));
  writeJson(cfgFile(), atual);
  return atual.moedasFavoritas;
});

handle('apagarContato', ({ id }) => {
  writeJson(contatosFile(), (readJson(contatosFile()) || []).filter((c) => c.id !== id));
  return true;
});

// ---------- Envios múltiplos / Juntar saldos ----------
handle('carteirasComSaldo', ({ assetId, minUsd }) => {
  requireUnlocked();
  const data = readJson(dataFile());
  const min = Number(minUsd) || 0;
  const out = [];
  for (const w of data.wallets) {
    const v = saldosMem[w.index] && saldosMem[w.index][assetId];
    if (!v || v.raw === 0n) continue;
    const usd = valorUsd(assetId, v.raw, v.decimals);
    if (min > 0 && (usd == null || usd < min)) continue;
    out.push({ index: w.index, name: w.name, balance: fmt(v.raw, v.decimals), usd });
  }
  return out.sort((a, b) => (b.usd || 0) - (a.usd || 0));
});

handle('planoJuntar', ({ destino, assetIds, origens, minUsd }) => {
  requireUnlocked();
  const data = readJson(dataFile());
  const min = Number(minUsd) || 0;
  const out = [];
  for (const w of data.wallets) {
    if (w.index === Number(destino)) continue;
    if (origens && !origens.map(Number).includes(w.index)) continue;
    for (const a of ASSETS) {
      if (assetIds && !assetIds.includes(a.id)) continue;
      const v = saldosMem[w.index] && saldosMem[w.index][a.id];
      if (!v || v.raw === 0n) continue;
      const usd = valorUsd(a.id, v.raw, v.decimals);
      if (min > 0 && (usd == null || usd < min)) continue;
      let para;
      try { para = addressFor(Number(destino), a.network); } catch { continue; }
      out.push({ index: w.index, carteira: w.name, assetId: a.id, symbol: a.symbol, native: !!a.native, rede: NETWORKS[a.network].rotulo, balance: fmt(v.raw, v.decimals), usd, para });
    }
  }
  // tokens primeiro, moedas principais por último (para sobrar taxa para os tokens)
  return out.sort((x, y) => Number(x.native) - Number(y.native));
});

// Só no teste automático: monta e assina transações de BTC/LTC/DOGE/BCH com moedas fictícias (não envia nada)
if (process.env.CARTEIRA_TESTE) {
  handle('testeAssinar', () => {
    const u = MOD.utxo();
    const out = {};
    for (const net of Object.values(NETWORKS).filter((n) => n.kind === 'utxo')) {
      try {
        const chave = chaveRede(1, net);
        const destino = addressFor(0, net.id);
        const plano = { usados: [{ txid: 'ab'.repeat(32), vout: 0, value: 100000000 }], valor: 50000000, troco: 49000000, script: u.scriptDestino(net.coin, destino) };
        out[net.coin] = 'ok ' + u.montarTx(net.coin, chave, plano).length + ' hex';
      } catch (e) { out[net.coin] = 'ERRO ' + e.message; }
    }
    return out;
  });
}

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
  // XRP/TON: tag/memo fixo desta carteira (opcional; útil quando a corretora obriga a preencher)
  let memo = null;
  if (net.memo) {
    const h = require('crypto').createHash('sha256').update(address).digest();
    memo = { tipo: net.memo, valor: String(100000000 + (h.readUInt32BE(0) % 900000000)) };
  }
  return { address, qr, symbol: asset.symbol, networkName: net.name, standard: net.standard, aviso: asset.aviso || '', memo };
});

function usdDe(symbol, raw, decimals) {
  const p = precos.preco(symbol);
  return p == null ? null : Number(formatUnits(raw, decimals)) * p;
}

function nativoDe(net) {
  return ASSETS.find((a) => a.network === net.id && a.native);
}

async function prepararOuEnviar(mode, { index, asset, net, to, amount, max, velocidade, valorRaw, memo }) {
  const k = keysFor(index);
  const executar = (cfg) => {
    if (net.kind !== 'evm' && net.kind !== 'tron') {
      const mod = net.kind === 'utxo' ? MOD.utxo() : MOD[net.kind]();
      const args = { cfg, coin: net.coin, asset, chave: chaveRede(index, net), to, amount, max, velocidade, valorRaw, memo };
      return mode === 'send' ? mod.enviar(args) : mod.preparar(args);
    }
    if (net.kind === 'tron') {
      const args = { cfg, asset, from: k.tronAddress, privateKey: k.tronPrivateKey, to, amount, max, valorRaw };
      return mode === 'send' ? tron.send(args) : tron.prepare(args);
    }
    const args = { net, url: cfg.rpc, asset, wallet: k.evm, to, amount, max, velocidade, valorRaw };
    return mode === 'send' ? evm.send(args) : evm.prepare(args);
  };
  // envio usa só o servidor principal (para nunca enviar duas vezes); cálculo usa reserva
  if (mode === 'send') return executar(cfgRede(net));
  return comReserva(net, async (cfg) => {
    try { return await executar(cfg); } catch (e) {
      // erros de saldo/endereço não são falha de servidor: não adianta tentar outro
      if (!/fetch failed|timeout|ETIMEDOUT|ECONN|ENOTFOUND|429|401|403|5\d\d|rate|limit|network|servidor|SERVER_ERROR|demorou/i.test(String(e && (e.shortMessage || e.message)))) { e.naoRepetir = true; }
      throw e;
    }
  }).catch((e) => { throw e; });
}

async function esperarConfirmacao(net, hash, index) {
  const cfg = cfgRede(net);
  if (net.kind === 'utxo') return MOD.utxo().confirmar(cfg, net.coin, hash);
  if (net.kind === 'ton') return MOD.ton().confirmar(cfg, hash, chaveRede(index, net).seed32);
  if (net.kind !== 'evm' && net.kind !== 'tron') return MOD[net.kind]().confirmar(cfg, hash);
  return net.kind === 'tron' ? tron.waitConfirm(cfg, hash) : evm.waitConfirm(net, cfg.rpc, hash);
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
  if (!enderecoValidoPara(net, to)) throw new Error(`Endereço de destino não é da rede ${net.rotulo}. Envio bloqueado para não perder o dinheiro.`);
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

handle('saveSettings', ({ rpc, tronApiKey, intervalo, notificar, email, carteiraTaxas, chaves }) => {
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
    chaves: {
      alchemy: alertas.cifrar(String((chaves && chaves.alchemy) || '').trim()),
      helius: alertas.cifrar(String((chaves && chaves.helius) || '').trim()),
      toncenter: alertas.cifrar(String((chaves && chaves.toncenter) || '').trim())
    },
    swap: (readJson(cfgFile()) || {}).swap,
    intervalo: Math.max(3, Number(intervalo) || 3),
    carteiraTaxas: carteiraTaxas === '' || carteiraTaxas == null ? null : Number(carteiraTaxas),
    notificar: { entradas: !(notificar && notificar.entradas === false), envios: !(notificar && notificar.envios === false) },
    email: em
  });
  cicloMonitor();
  return true;
});

handle('testarChaves', async ({ chaves, tronApiKey }) => {
  const out = {};
  const post = async (url, body, headers = {}) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 120)}`);
    const j = JSON.parse(t);
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    return j;
  };
  const k = chaves || {};
  if (String(k.alchemy || '').trim()) {
    for (const [id, sub] of Object.entries(ALCHEMY)) {
      try { await post(`https://${sub}.g.alchemy.com/v2/${k.alchemy.trim()}`, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }); out['Alchemy ' + NETWORKS[id].name] = 'ok'; }
      catch (e) { out['Alchemy ' + NETWORKS[id].name] = 'erro: ' + e.message + (/not enabled|disabled/i.test(e.message) ? ' (ative essa rede no painel da Alchemy)' : ''); }
    }
  }
  if (String(k.helius || '').trim()) {
    try { await post(`https://mainnet.helius-rpc.com/?api-key=${k.helius.trim()}`, { jsonrpc: '2.0', id: 1, method: 'getSlot' }); out.Helius = 'ok'; } catch (e) { out.Helius = 'erro: ' + e.message; }
  }
  if (String(tronApiKey || '').trim()) {
    try { await post('https://api.trongrid.io/wallet/getnowblock', {}, { 'TRON-PRO-API-KEY': tronApiKey.trim() }); out.TronGrid = 'ok'; } catch (e) { out.TronGrid = 'erro: ' + e.message; }
  }
  if (String(k.toncenter || '').trim()) {
    try {
      const r = await fetch('https://toncenter.com/api/v2/getMasterchainInfo', { headers: { 'X-API-Key': k.toncenter.trim() }, signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      out.toncenter = j.ok ? 'ok' : 'erro: ' + (j.error || r.status);
    } catch (e) { out.toncenter = 'erro: ' + e.message; }
  }
  if (!Object.keys(out).length) throw new Error('Preencha pelo menos uma chave.');
  return out;
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
          const cheios = (ms) => new Promise(r => setTimeout(() => r([...document.querySelectorAll('[data-saldo]')].filter(x => !/carregando/.test(x.textContent)).length), ms));
          out.push('preenchidos em 1s: ' + await cheios(1000) + ' / 19');
          out.push('preenchidos em 3s: ' + await cheios(2000) + ' / 19');
          await new Promise(r => setTimeout(r, 9000));
          out.push('linhas ' + document.querySelectorAll('#tabela-moedas tr[data-grupo]').length);
          out.push('seletores ' + [...document.querySelectorAll('.sel-rede')].map(x => x.dataset.rede + ':' + x.options.length).join(' '));
          out.push('icones ' + [...document.querySelectorAll('img.icone')].filter(i => i.naturalWidth > 0).map(i => i.dataset.icone).join(','));
          out.push('letras ' + [...document.querySelectorAll('.icone.letra')].map(i => i.textContent).join(','));
          out.push('saldos ' + [...document.querySelectorAll('[data-saldo]')].map(x => x.dataset.saldo + '=' + x.textContent).join(' | '));
          out.push('hora ' + document.getElementById('hora-saldo').textContent);
          out.push('linha SOL ' + [...document.querySelector('tr[data-grupo="SOL"]').querySelectorAll('td')].map(td => td.textContent.replace(/\\s+/g, ' ').trim()).join(' | '));
          await c('definirCarteiraTaxas', { index: 1 });
          await carregarCarteiras(); await new Promise(r => setTimeout(r, 4000)); await mostrarTanque();
          out.push('cartao taxas ' + document.getElementById('tanque').textContent.replace(/\\s+/g, ' ').trim());
          out.push('lista sem taxas ' + [...document.querySelectorAll('#lista-carteiras li')].length);
          out.push('cabecalho ' + [...document.querySelectorAll('thead th')].map(t => t.textContent).join(' | '));
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
          const dest2 = async (id) => (await c('receive', { index: 1, assetId: id })).address;
          await t('estimar xrp', async () => c('estimate', { index: 0, assetId: 'xrp', to: await dest2('xrp'), amount: '1', memo: '123' }));
          await t('estimar ada', async () => c('estimate', { index: 0, assetId: 'ada', to: await dest2('ada'), amount: '2' }));
          await t('estimar ton', async () => c('estimate', { index: 0, assetId: 'ton', to: await dest2('ton'), amount: '0.1' }));
          await t('estimar sol->janio2', async () => c('estimate', { index: 0, assetId: 'sol', to: await dest2('sol'), amount: '0.01', velocidade: 'rapida' }));
          await t('estimar bonk', async () => c('estimate', { index: 0, assetId: 'bonk', to: await dest2('sol'), amount: '1' }));
          await t('assinar utxo', () => c('testeAssinar'));
          await t('favorito vinculado', async () => { await c('salvarContato', { nome: 'Corretora XRP', rede: 'xrp', endereco: 'rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3', memo: '555', carteira: 0 }); return (await c('contatos', { rede: 'xrp' })).map(x => x.nome + ' tag ' + x.memo + ' carteira ' + x.carteira); });
          await t('favorito rede errada', () => c('salvarContato', { nome: 'X', rede: 'solana', endereco: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }));
          await t('tela favoritos nova', async () => { await document.getElementById('btn-contatos').onclick(); const ok = !!document.getElementById('nf-rede'); fecharModal(); return ok ? 'formulario ok' : 'sem formulario'; });
          await t('favorito', async () => { await c('salvarContato', { nome: 'Teste Fav', rede: 'tron', endereco: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }); return (await c('contatos', { rede: 'tron' })).map(x => x.nome); });
          await t('com saldo SOL', () => c('carteirasComSaldo', { assetId: 'sol', minUsd: 1 }));
          await t('plano juntar', async () => (await c('planoJuntar', { destino: 1, minUsd: 0.5 })).map(i => i.carteira + ':' + i.symbol + ':' + i.balance));
          await t('tela multiplos', async () => { document.getElementById('btn-multiplos').click(); await new Promise(r => setTimeout(r, 300)); document.getElementById('mm-moeda').value = 'sol'; await carregarMultiplos(); await new Promise(r => setTimeout(r, 1500)); const n = document.querySelectorAll('[data-mm]').length; const op = document.querySelector('.mm-dsel') ? document.querySelector('.mm-dsel').options.length : 0; fecharModal(); return n + ' linhas, ' + op + ' destinos'; });
          await t('verif usdt-tron->sol', () => c('verificarEndereco', { assetId: 'usdt-tron', endereco: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' }));
          await t('verif sol ok', () => c('verificarEndereco', { assetId: 'sol', endereco: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' }));
          await t('verif bnb 0x', () => c('verificarEndereco', { assetId: 'usdt-bsc', endereco: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0' }));
          await t('verif btc errado', () => c('verificarEndereco', { assetId: 'btc', endereco: 'ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh' }));
          await t('verif lixo', () => c('verificarEndereco', { assetId: 'xrp', endereco: 'abc123' }));
          await t('swap cotar (EUA bloqueado é esperado)', () => c('swapCotar', { index: 0, de: 'usdt-tron', para: 'sol', amount: '20' }));
          await t('tela trocar', async () => { document.getElementById('btn-trocar').click(); await new Promise(r => setTimeout(r, 300)); const n = document.getElementById('s-de') ? document.getElementById('s-de').options.length : -1; fecharModal(); return n + ' moedas com saldo'; });
          await t('servidores bsc', async () => 'ok');
          await t('testar chaves falsas', () => c('testarChaves', { chaves: { alchemy: 'chave-falsa', helius: 'chave-falsa', toncenter: 'falsa' }, tronApiKey: 'falsa' }));
          await t('salvar chave falsa e ver reserva', async () => { await c('saveSettings', { rpc: {}, tronApiKey: '', intervalo: 3, notificar: {}, email: {}, carteiraTaxas: '', chaves: { alchemy: 'chave-falsa', helius: 'chave-falsa', toncenter: '' } }); return [await c('balance', { index: 0, assetId: 'usdt-bsc' }), await c('balance', { index: 0, assetId: 'sol' })]; });
          await t('receber xrp com tag', async () => { const r = await c('receive', { index: 0, assetId: 'xrp' }); return r.address + ' tag ' + JSON.stringify(r.memo); });
          await t('receber ton com memo', async () => (await c('receive', { index: 0, assetId: 'ton' })).memo);
          await t('remover grupo', async () => { const ws = await c('wallets'); const g = ws.find(w => w.name === 'Outra 1').grupo; const ids = ws.filter(w => w.grupo === g).map(w => w.index); const n = await c('removerCarteiras', { indices: ids, password: 'teste12345' }); return n + ' removidas, restam ' + (await c('wallets')).length; });
          await t('remover senha errada', () => c('removerCarteiras', { indices: [1], password: 'errada' }));
          await t('moedas favoritas', async () => { await c('salvarMoedasFavoritas', { ids: ['usdt-tron', 'sol', 'xrp'] }); return c('moedasFavoritas'); });
          await t('multiplos ordem', async () => { await carregarFavMoedas(); document.getElementById('btn-multiplos').click(); await new Promise(r => setTimeout(r, 300)); const o = [...document.getElementById('mm-moeda').options].slice(0, 4).map(x => x.textContent); fecharModal(); return o; });
          await t('tela juntar', async () => { document.getElementById('btn-juntar').click(); await new Promise(r => setTimeout(r, 300)); const n = document.querySelectorAll('.j-moeda').length; fecharModal(); return n + ' moedas'; });
          await t('tela favoritos', async () => { await document.getElementById('btn-contatos').onclick(); const n = document.querySelectorAll('[data-fapagar]').length; fecharModal(); return n + ' favoritos'; });
          await t('importar chave', async () => (await c('importWallet', { tipo: 'chave', segredo: '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318', name: 'MetaMask' })).map(w => w.name));
          await t('importar frase', async () => (await c('importWallet', { tipo: 'frase', segredo: 'test test test test test test test test test test test junk', name: 'Outra', quantidade: 2 })).map(w => w.name));
          await t('importar 82 (completa)', async () => (await c('importWallet', { tipo: 'frase', segredo: 'test test test test test test test test test test test junk', name: 'Outra', quantidade: 82 })).length + ' novas');
          await t('total carteiras', async () => (await c('wallets')).length);
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
