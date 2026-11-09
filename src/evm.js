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

async function fees(net, p) {
  const block = await p.getBlock('latest');
  if (block && block.baseFeePerGas != null) {
    let prio;
    try { prio = BigInt(await p.send('eth_maxPriorityFeePerGas', [])); } catch { prio = parseUnits('1', 'gwei'); }
    const minPrio = parseUnits(String(net.minPriorityGwei || 0), 'gwei');
    if (prio < minPrio) prio = minPrio;
    const maxFee = block.baseFeePerGas * 2n + prio;
    return { fields: { type: 2, maxFeePerGas: maxFee, maxPriorityFeePerGas: prio }, worst: maxFee };
  }
  const gp = BigInt(await p.send('eth_gasPrice', []));
  return { fields: { type: 0, gasPrice: gp }, worst: gp };
}

// Monta a transação e confere saldo e taxa. Não envia nada.
async function prepare({ net, url, asset, wallet, to, amount, max }) {
  const p = provider(net, url);
  const from = wallet.address;
  to = String(to || '').trim();
  if (!isAddress(to)) {
    throw new Error(`Endereço de destino inválido para a rede ${net.name}. Ele deve começar com 0x e ter 42 caracteres.`);
  }
  to = getAddress(to);
  const [f, nativeBal] = await Promise.all([fees(net, p), p.getBalance(from)]);

  if (asset.native) {
    let gasLimit = 21000n;
    try { gasLimit = await p.estimateGas({ from, to, value: 1n }); } catch { /* usa 21000 */ }
    const fee = gasLimit * f.worst;
    const value = max ? nativeBal - fee : parseAmount(amount, asset.decimals);
    if (value <= 0n) throw new Error(`Saldo de ${asset.symbol} insuficiente para cobrir a taxa (${fmt(fee, 18)} ${net.symbol}).`);
    if (value + fee > nativeBal) {
      throw new Error(`Saldo insuficiente: valor + taxa (${fmt(fee, 18)} ${net.symbol}) passa do seu saldo de ${fmt(nativeBal, 18)} ${asset.symbol}.`);
    }
    return { tx: { to, value, gasLimit, ...f.fields }, value, decimals: asset.decimals, fee, feeDecimals: 18, to };
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
  const fee = gasLimit * f.worst;
  if (fee > nativeBal) {
    throw new Error(`Para enviar ${asset.symbol} você precisa de cerca de ${fmt(fee, 18)} ${net.symbol} nesta carteira para pagar a taxa. Saldo atual: ${fmt(nativeBal, 18)} ${net.symbol}.`);
  }
  return { tx: { to: asset.contract, data, value: 0n, gasLimit, ...f.fields }, value, decimals, fee, feeDecimals: 18, to };
}

async function send(args) {
  const prep = await prepare(args);
  const signer = args.wallet.connect(provider(args.net, args.url));
  const resp = await signer.sendTransaction({ ...prep.tx, chainId: args.net.chainId });
  return { hash: resp.hash, ...prep };
}

async function waitConfirm(net, url, hash) {
  const receipt = await provider(net, url).waitForTransaction(hash, 1, 10 * 60 * 1000);
  if (!receipt) return 'pendente';
  return receipt.status === 1 ? 'ok' : 'falhou';
}

module.exports = { balance, prepare, send, waitConfirm, isAddress };
