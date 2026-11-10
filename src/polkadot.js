// Polkadot (DOT) na rede Asset Hub — desde nov/2025 os saldos de DOT ficam lá.
// Chave ed25519 no caminho m/44'/354'/i'/0'/0' (padrão da Trust Wallet)
const { Keyring } = require('@polkadot/keyring');
const { cryptoWaitReady, checkAddress, decodeAddress } = require('@polkadot/util-crypto');
const { parseAmount, fmt } = require('./util');

const DEC = 10;
const pronto = cryptoWaitReady().catch(() => {});
const anel = () => new Keyring({ type: 'ed25519', ss58Format: 0 });
const par = (seed32) => anel().addFromSeed(Uint8Array.from(seed32));
const endereco = (seed32) => par(seed32).address;

function validar(a) {
  a = String(a || '').trim();
  try {
    decodeAddress(a);
    return checkAddress(a, 0)[0] || checkAddress(a, 42)[0] ? a : null;
  } catch { return null; }
}

const apis = {};
async function api(cfg) {
  await pronto;
  const atual = apis[cfg.rpc];
  if (atual) {
    const a = await atual.catch(() => null);
    if (a && a.isConnected) return a;
    delete apis[cfg.rpc];
  }
  const { ApiPromise, WsProvider } = require('@polkadot/api');
  const p = (async () => {
    const prov = new WsProvider(cfg.rpc, 2500, {}, 20000);
    const a = await Promise.race([
      ApiPromise.create({ provider: prov, noInitWarn: true, throwOnConnect: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('servidor Polkadot demorou para responder')), 25000))
    ]).catch((e) => { prov.disconnect().catch(() => {}); throw e; });
    return a;
  })();
  apis[cfg.rpc] = p;
  p.catch(() => { delete apis[cfg.rpc]; });
  return p;
}

async function livre(a, addr) {
  const conta = await a.query.system.account(addr);
  return BigInt(conta.data.free.toString());
}

async function saldo(cfg, asset, addr) {
  return { raw: await livre(await api(cfg), addr), decimals: DEC };
}

function montar(a, dest, value, max) {
  return max ? a.tx.balances.transferAll(dest, false) : a.tx.balances.transferKeepAlive(dest, value);
}

async function preparar({ cfg, chave, to, amount, max, valorRaw }) {
  const a = await api(cfg);
  await pronto;
  const p = par(chave.seed32);
  const dest = validar(to);
  if (!dest) throw new Error('Endereço de destino inválido para a rede Polkadot (normalmente começa com 1).');
  const bal = await livre(a, p.address);
  if (bal === 0n) throw new Error('Esta carteira não tem DOT.');
  const ed = BigInt(a.consts.balances.existentialDeposit.toString());
  const info = await montar(a, dest, 1n, false).paymentInfo(p);
  const fee = (BigInt(info.partialFee.toString()) * 12n) / 10n;
  const value = valorRaw != null ? BigInt(valorRaw) : max ? bal - fee : parseAmount(amount, DEC);
  if (value <= 0n) throw new Error(`Sobrou só poeira: ${fmt(bal, DEC)} DOT não paga a taxa (~${fmt(fee, DEC)} DOT).`);
  if (value + fee > bal) throw new Error(`Saldo insuficiente: valor + taxa (${fmt(fee, DEC)} DOT) passa do saldo de ${fmt(bal, DEC)} DOT.`);
  if (!max && bal - value - fee < ed) {
    const pode = bal - fee - ed;
    throw new Error(`Na Polkadot a carteira precisa manter pelo menos ${fmt(ed, DEC)} DOT (regra da rede). Envie tudo (Máx) ou no máximo ${fmt(pode > 0n ? pode : 0n, DEC)} DOT.`);
  }
  const destBal = await livre(a, dest);
  if (destBal === 0n && value < ed) throw new Error(`Para uma carteira Polkadot nova, envie pelo menos ${fmt(ed, DEC)} DOT (regra da rede).`);
  return { value, decimals: DEC, fee: BigInt(info.partialFee.toString()), feeMax: fee, feeDecimals: DEC, feeLabel: '≈', to: dest, _max: !!max };
}

const resultados = {}; // hash -> 'ok' | 'falhou'

async function enviar(args) {
  const prep = await preparar(args);
  const a = await api(args.cfg);
  const p = par(args.chave.seed32);
  const tx = montar(a, prep.to, prep.value, prep._max);
  const hash = await new Promise((resolve, reject) => {
    let devolvido = false;
    tx.signAndSend(p, (r) => {
      const h = r.txHash.toHex();
      if (!devolvido && (r.status.isReady || r.status.isBroadcast || r.status.isInBlock)) { devolvido = true; resolve(h); }
      if (r.status.isInBlock || r.status.isFinalized) resultados[h] = r.dispatchError ? 'falhou' : 'ok';
      if (r.status.isInvalid || r.status.isDropped || r.status.isUsurped) {
        resultados[h] = 'falhou';
        if (!devolvido) { devolvido = true; reject(new Error('A rede Polkadot recusou a transação.')); }
      }
    }).catch((e) => { if (!devolvido) { devolvido = true; reject(e); } });
  });
  return { ...prep, hash };
}

async function confirmar(cfg, hash) {
  for (let i = 0; i < 60; i++) {
    if (resultados[hash]) return resultados[hash];
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 'pendente';
}

module.exports = { endereco, validar, saldo, preparar, enviar, confirmar };
