// Ethereum, BNB Chain, Polygon e Avalanche (todas usam o mesmo tipo de carteira 0x...)
const { JsonRpcProvider, Network, Contract, Interface, isAddress, getAddress, parseUnits } = require('ethers');
const { parseAmount, fmt } = require('./util');

const ERC20 = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)'
]);

const providers = {};
const decCache = {};

function provider(net, url) {
  const key = net.id + '|' + url;
  if (!providers[key]) {
    const n = Network.from(net.chainId);
    providers[key] = new JsonRpcProvider(url, n, { staticNetwork: n });
  }
  return providers[key];
}

async function tokenDecimals(p, asset) {
  if (decCache[asset.id] == null) {
    const c = new Contract(asset.contract, ERC20, p);
    decCache[asset.id] = Number(await c.decimals());
  }
  return decCache[asset.id];
}

async function balance(net, url, asset, address) {
  const p = provider(net, url);
  if (asset.native) return { raw: await p.getBalance(address), decimals: asset.decimals };
  const c = new Contract(asset.contract, ERC20, p);
  const [raw, decimals] = await Promise.all([c.balanceOf(address), tokenDecimals(p, asset)]);
  return { raw, decimals };
}

// Três velocidades de taxa. "esperado" = custo provável; "worst" = teto máximo.
async function fees(net, p) {
  const block = await p.getBlock('latest');
  const minPrio = parseUnits(String(net.minPriorityGwei || 0), 'gwei');
  if (block && block.baseFeePerGas != null) {
    let prio;
    try { prio = BigInt(await p.send('eth_maxPriorityFeePerGas', [])); } catch { prio = parseUnits('1', 'gwei'); }
    const base = block.baseFeePerGas;
    const mk = (pr) => {
      if (pr < minPrio) pr = minPrio;
      const maxFee = base * 2n + pr;
      return { fields: { type: 2, maxFeePerGas: maxFee, maxPriorityFeePerGas: pr }, worst: maxFee, esperado: base + pr };
    };
    return { economica: mk(prio * 8n / 10n), normal: mk(prio), rapida: mk(prio * 15n / 10n + parseUnits('0.01', 'gwei')) };
  }
  const gp = BigInt(await p.send('eth_gasPrice', []));
  const mk = (g) => {
    if (g < minPrio) g = minPrio;
    return { fields: { type: 0, gasPrice: g }, worst: g, esperado: g };
  };
  return { economica: mk(gp), normal: mk(gp * 11n / 10n), rapida: mk(gp * 15n / 10n) };
}

const VELOCIDADES = ['economica', 'normal', 'rapida'];

// Monta a transação e confere saldo e taxa. Não envia nada.
// valorRaw: valor exato em unidades mínimas (usado pela carteira de taxas)
async function prepare({ net, url, asset, wallet, to, amount, max, velocidade, valorRaw }) {
  const p = provider(net, url);
  const from = wallet.address;
  to = String(to || '').trim();
  if (!isAddress(to)) {
    throw new Error(`Endereço de destino inválido para a rede ${net.name}. Ele deve começar com 0x e ter 42 caracteres.`);
  }
  to = getAddress(to);
  const vel = VELOCIDADES.includes(velocidade) ? velocidade : 'normal';
  const [tiers, nativeBal] = await Promise.all([fees(net, p), p.getBalance(from)]);
  const f = tiers[vel];

  if (asset.native) {
    let gasLimit = 21000n;
    try { gasLimit = await p.estimateGas({ from, to, value: 1n }); } catch { /* usa 21000 */ }
    const feeMax = gasLimit * f.worst;
    const value = valorRaw != null ? BigInt(valorRaw) : max ? nativeBal - feeMax : parseAmount(amount, asset.decimals);
    if (value <= 0n) {
      throw new Error(nativeBal === 0n ? `Esta carteira não tem ${asset.symbol}.` : `Sobrou só poeira: ${fmt(nativeBal, 18)} ${asset.symbol} não paga a taxa (${fmt(feeMax, 18)} ${net.symbol}).`);
    }
    if (value + feeMax > nativeBal) {
      throw new Error(`Saldo insuficiente: valor + taxa (${fmt(feeMax, 18)} ${net.symbol}) passa do saldo de ${fmt(nativeBal, 18)} ${asset.symbol}.`);
    }
    return {
      tx: { to, value, gasLimit, ...f.fields }, value, decimals: asset.decimals, to,
      fee: gasLimit * f.esperado, feeMax, feeDecimals: 18, velocidade: vel,
      opcoes: Object.fromEntries(VELOCIDADES.map((v) => [v, gasLimit * tiers[v].esperado]))
    };
  }

  const decimals = await tokenDecimals(p, asset);
  const c = new Contract(asset.contract, ERC20, p);
  const tokBal = await c.balanceOf(from);
  const value = max ? tokBal : parseAmount(amount, decimals);
  if (value <= 0n) throw new Error(`Você não tem ${asset.symbol} nesta carteira.`);
  if (value > tokBal) throw new Error(`Saldo de ${asset.symbol} insuficiente (você tem ${fmt(tokBal, decimals)}).`);
  const data = ERC20.encodeFunctionData('transfer', [to, value]);
  let gasLimit;
  try { gasLimit = (await p.estimateGas({ from, to: asset.contract, data })) * 12n / 10n; } catch { gasLimit = 120000n; }
  const feeMax = gasLimit * f.worst;
  return {
    tx: { to: asset.contract, data, value: 0n, gasLimit, ...f.fields }, value, decimals, to,
    fee: gasLimit * f.esperado, feeMax, feeDecimals: 18, velocidade: vel,
    opcoes: Object.fromEntries(VELOCIDADES.map((v) => [v, gasLimit * tiers[v].esperado])),
    nativeBal,
    faltaTaxa: feeMax > nativeBal ? feeMax - nativeBal : 0n
  };
}

async function send(args) {
  const prep = await prepare(args);
  if (prep.faltaTaxa > 0n) {
    throw new Error(`Para enviar ${args.asset.symbol} você precisa de cerca de ${fmt(prep.feeMax, 18)} ${args.net.symbol} nesta carteira para pagar a taxa. Saldo atual: ${fmt(prep.nativeBal, 18)} ${args.net.symbol}.`);
  }
  const signer = args.wallet.connect(provider(args.net, args.url));
  const resp = await signer.sendTransaction({ ...prep.tx, chainId: args.net.chainId });
  return { hash: resp.hash, ...prep };
}

async function waitConfirm(net, url, hash) {
  const receipt = await provider(net, url).waitForTransaction(hash, 1, 10 * 60 * 1000);
  if (!receipt) return 'pendente';
  return receipt.status === 1 ? 'ok' : 'falhou';
}

// ---------- Trocas: THORChain (roteador) e LI.FI (transação pronta) ----------
const ERC20_APROVAR = new Interface([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
]);
const ROTEADOR = new Interface(['function depositWithExpiry(address vault, address asset, uint256 amount, string memo, uint256 expiration) payable']);
const ZERO = '0x0000000000000000000000000000000000000000';

async function aprovarSePreciso(net, url, wallet, token, gastador, valor) {
  const p = provider(net, url);
  const c = new Contract(token, ERC20_APROVAR, p);
  const atual = await c.allowance(wallet.address, gastador);
  if (atual >= valor) return null;
  const f = (await fees(net, p)).normal;
  const data = ERC20_APROVAR.encodeFunctionData('approve', [gastador, valor]);
  let gasLimit;
  try { gasLimit = (await p.estimateGas({ from: wallet.address, to: token, data })) * 13n / 10n; } catch { gasLimit = 80000n; }
  const tx = await wallet.connect(p).sendTransaction({ to: token, data, gasLimit, chainId: net.chainId, ...f.fields });
  await p.waitForTransaction(tx.hash, 1, 5 * 60 * 1000);
  return tx.hash;
}

// envia para o roteador da THORChain (moeda principal ou token)
async function depositarThorchain({ net, url, wallet, asset, router, vault, valor, memo, expiry }) {
  const p = provider(net, url);
  const token = asset.native ? ZERO : asset.contract;
  if (!asset.native) await aprovarSePreciso(net, url, wallet, asset.contract, router, valor);
  const data = ROTEADOR.encodeFunctionData('depositWithExpiry', [vault, token, valor, memo, BigInt(expiry)]);
  const f = (await fees(net, p)).normal;
  const value = asset.native ? valor : 0n;
  let gasLimit;
  try { gasLimit = (await p.estimateGas({ from: wallet.address, to: router, data, value })) * 13n / 10n; } catch { gasLimit = asset.native ? 120000n : 180000n; }
  const tx = await wallet.connect(p).sendTransaction({ to: router, data, value, gasLimit, chainId: net.chainId, ...f.fields });
  return tx.hash;
}

// executa a transação pronta da LI.FI (aprova o token antes, se precisar)
async function executarLifi({ net, url, wallet, asset, txReq, aprovarPara, valor }) {
  const p = provider(net, url);
  if (!asset.native && aprovarPara) await aprovarSePreciso(net, url, wallet, asset.contract, aprovarPara, valor);
  const f = (await fees(net, p)).normal;
  const req = { to: txReq.to, data: txReq.data, value: txReq.value ? BigInt(txReq.value) : 0n, chainId: net.chainId, ...f.fields };
  try { req.gasLimit = (await p.estimateGas({ from: wallet.address, to: req.to, data: req.data, value: req.value })) * 13n / 10n; }
  catch { if (txReq.gasLimit) req.gasLimit = BigInt(txReq.gasLimit); }
  const tx = await wallet.connect(p).sendTransaction(req);
  return tx.hash;
}

module.exports = { balance, prepare, send, waitConfirm, isAddress, depositarThorchain, executarLifi };
