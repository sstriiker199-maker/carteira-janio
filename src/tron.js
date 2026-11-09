// Rede Tron: TRX e tokens TRC-20 (USDT, USDC)
const { TronWeb } = require('tronweb');
const { parseAmount, fmt } = require('./util');
const { isTronAddress } = require('./tronaddr');

const FEE_LIMIT_SUN = 150_000_000; // teto de 150 TRX por envio de token (só é cobrado o que for usado)
const TRX_RESERVE_SUN = 1_500_000n; // deixa 1,5 TRX para taxa/ativação de conta nova
const decCache = {};

// O servidor gratuito da TronGrid limita consultas: tenta de novo com espera
async function retry(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String((e && (e.message || e.error)) || e) + ' ' + String(e && e.response && e.response.status);
      if (i >= 4 || !/429|rate|limit|too many/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
}

function client(cfg, privateKey) {
  const opts = { fullHost: cfg.rpc };
  if (cfg.apiKey) opts.headers = { 'TRON-PRO-API-KEY': cfg.apiKey };
  if (privateKey) opts.privateKey = privateKey;
  return new TronWeb(opts);
}

async function constCall(t, contract, fn, params, owner) {
  const r = await retry(() => t.transactionBuilder.triggerConstantContract(contract, fn, {}, params, owner));
  const hex = r && r.constant_result && r.constant_result[0];
  if (hex == null) throw new Error('Falha ao consultar a rede Tron.');
  return { value: BigInt('0x' + (hex || '0')), energy: r.energy_used };
}

async function tokenDecimals(t, asset, owner) {
  if (decCache[asset.id] == null) {
    decCache[asset.id] = Number((await constCall(t, asset.contract, 'decimals()', [], owner)).value);
  }
  return decCache[asset.id];
}

async function balance(cfg, asset, address) {
  const t = client(cfg);
  if (asset.native) return { raw: BigInt(await retry(() => t.trx.getBalance(address))), decimals: 6 };
  const decimals = await tokenDecimals(t, asset, address);
  const { value } = await constCall(t, asset.contract, 'balanceOf(address)', [{ type: 'address', value: address }], address);
  return { raw: value, decimals };
}

async function prepare({ cfg, asset, from, to, amount, max }) {
  to = String(to || '').trim();
  if (!isTronAddress(to)) throw new Error('Endereço de destino inválido para a rede Tron. Ele deve começar com T e ter 34 caracteres.');
  const t = client(cfg);
  const trxBal = BigInt(await retry(() => t.trx.getBalance(from)));

  if (asset.native) {
    const value = max ? trxBal - TRX_RESERVE_SUN : parseAmount(amount, 6);
    if (value <= 0n) throw new Error('Saldo de TRX insuficiente. É preciso deixar cerca de 1,5 TRX para a taxa.');
    if (value + 1_100_000n > trxBal) throw new Error(`Deixe pelo menos 1,1 TRX na carteira para a taxa (saldo: ${fmt(trxBal, 6)} TRX).`);
    return { value, decimals: 6, fee: 1_100_000n, feeDecimals: 6, feeLabel: 'até', to };
  }

  const decimals = await tokenDecimals(t, asset, from);
  const { value: tokBal } = await constCall(t, asset.contract, 'balanceOf(address)', [{ type: 'address', value: from }], from);
  const value = max ? tokBal : parseAmount(amount, decimals);
  if (value <= 0n) throw new Error(`Você não tem ${asset.symbol} nesta carteira.`);
  if (value > tokBal) throw new Error(`Saldo de ${asset.symbol} insuficiente (você tem ${fmt(tokBal, decimals)}).`);

  // Estima a energia gasta e quanto TRX será queimado
  let energy = 130000;
  try {
    const sim = await constCall(t, asset.contract, 'transfer(address,uint256)',
      [{ type: 'address', value: to }, { type: 'uint256', value: value.toString() }], from);
    if (sim.energy) energy = sim.energy;
  } catch { /* usa estimativa padrão */ }
  let energyPrice = 210;
  try {
    const params = await retry(() => t.trx.getChainParameters());
    const p = params.find((x) => x.key === 'getEnergyFee');
    if (p) energyPrice = Number(p.value);
  } catch { /* usa padrão */ }
  let freeEnergy = 0;
  try {
    const r = await retry(() => t.trx.getAccountResources(from));
    freeEnergy = Math.max(0, (r.EnergyLimit || 0) - (r.EnergyUsed || 0));
  } catch { /* sem energia própria */ }
  const fee = BigInt(Math.max(0, energy - freeEnergy) * energyPrice + 350_000);
  if (fee > trxBal) {
    throw new Error(`Para enviar ${asset.symbol} na rede Tron você precisa de cerca de ${fmt(fee, 6)} TRX nesta carteira para pagar a taxa. Saldo atual: ${fmt(trxBal, 6)} TRX.`);
  }
  return { value, decimals, fee, feeDecimals: 6, feeLabel: 'cerca de', to };
}

function decodeMsg(m) {
  if (!m) return 'erro desconhecido';
  try { return /^[0-9a-f]+$/i.test(m) ? Buffer.from(m, 'hex').toString('utf8') : String(m); } catch { return String(m); }
}

async function send({ cfg, asset, from, privateKey, to, amount, max }) {
  const prep = await prepare({ cfg, asset, from, to, amount, max });
  const t = client(cfg, privateKey);
  let tx;
  if (asset.native) {
    tx = await t.transactionBuilder.sendTrx(prep.to, Number(prep.value), from);
  } else {
    const r = await t.transactionBuilder.triggerSmartContract(
      asset.contract, 'transfer(address,uint256)', { feeLimit: FEE_LIMIT_SUN },
      [{ type: 'address', value: prep.to }, { type: 'uint256', value: prep.value.toString() }], from);
    if (!r || !r.transaction) throw new Error('A rede Tron não conseguiu montar a transação.');
    tx = r.transaction;
  }
  const signed = await t.trx.sign(tx, privateKey);
  const res = await t.trx.sendRawTransaction(signed);
  if (!res || !res.result) throw new Error('A rede Tron recusou o envio: ' + decodeMsg(res && (res.message || res.code)));
  return { hash: res.txid || signed.txID, ...prep };
}

async function waitConfirm(cfg, txid) {
  const t = client(cfg);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    let info;
    try { info = await retry(() => t.trx.getTransactionInfo(txid)); } catch { continue; }
    if (info && info.blockNumber) {
      const res = info.receipt && info.receipt.result;
      return !res || res === 'SUCCESS' ? 'ok' : 'falhou';
    }
  }
  return 'pendente';
}

module.exports = { balance, prepare, send, waitConfirm };
