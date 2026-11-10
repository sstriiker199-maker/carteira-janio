// Cosmos Hub (ATOM). Chave secp256k1 no caminho m/44'/118'/0'/0/i (padrão Keplr e Trust Wallet)
const { sha256, ripemd160 } = require('ethers');
const { toBech32, fromBech32 } = require('@cosmjs/encoding');
const { parseAmount, fmt } = require('./util');

const DENOM = 'uatom';
const PRECO_GAS = 0.02; // uatom por unidade de gás (acima do mínimo da rede)

function endereco(chave) {
  const h = ripemd160(sha256(Uint8Array.from(chave.pubkey)));
  return toBech32('cosmos', Buffer.from(h.slice(2), 'hex'));
}

function validar(a) {
  a = String(a || '').trim();
  try {
    const d = fromBech32(a);
    return d.prefix === 'cosmos' && (d.data.length === 20 || d.data.length === 32) ? a : null;
  } catch { return null; }
}

const leitores = {};
async function leitor(cfg) {
  if (!leitores[cfg.rpc]) {
    const { StargateClient } = require('@cosmjs/stargate');
    leitores[cfg.rpc] = StargateClient.connect(cfg.rpc).catch((e) => { delete leitores[cfg.rpc]; throw e; });
  }
  return leitores[cfg.rpc];
}

async function assinante(cfg, chave) {
  const { DirectSecp256k1Wallet } = require('@cosmjs/proto-signing');
  const { SigningStargateClient } = require('@cosmjs/stargate');
  const carteira = await DirectSecp256k1Wallet.fromKey(Buffer.from(String(chave.priv).replace(/^0x/, ''), 'hex'), 'cosmos');
  return SigningStargateClient.connectWithSigner(cfg.rpc, carteira);
}

async function saldo(cfg, asset, addr) {
  const c = await leitor(cfg);
  const b = await c.getBalance(addr, DENOM);
  return { raw: BigInt(b.amount), decimals: 6 };
}

const msgEnvio = (de, para, valor) => ({
  typeUrl: '/cosmos.bank.v1beta1.MsgSend',
  value: { fromAddress: de, toAddress: para, amount: [{ denom: DENOM, amount: String(valor) }] }
});

async function preparar({ cfg, chave, to, amount, max, valorRaw, memo }) {
  const de = endereco(chave);
  const dest = validar(to);
  if (!dest) throw new Error('Endereço de destino inválido para a Cosmos Hub (começa com cosmos1).');
  const bal = (await saldo(cfg, null, de)).raw;
  if (bal === 0n) throw new Error('Esta carteira não tem ATOM.');
  let gas = 100000;
  try {
    const c = await assinante(cfg, chave);
    gas = Math.ceil((await c.simulate(de, [msgEnvio(de, dest, 1n)], memo || '')) * 1.5);
  } catch { /* usa o padrão */ }
  const fee = BigInt(Math.ceil(gas * PRECO_GAS));
  const value = valorRaw != null ? BigInt(valorRaw) : max ? bal - fee : parseAmount(amount, 6);
  if (value <= 0n) throw new Error(`Sobrou só poeira: ${fmt(bal, 6)} ATOM não paga a taxa (${fmt(fee, 6)} ATOM).`);
  if (value + fee > bal) throw new Error(`Saldo insuficiente: valor + taxa (${fmt(fee, 6)} ATOM) passa do saldo de ${fmt(bal, 6)} ATOM.`);
  return { value, decimals: 6, fee, feeMax: fee, feeDecimals: 6, feeLabel: '≈', to: dest, _gas: gas };
}

async function enviar(args) {
  const prep = await preparar(args);
  const c = await assinante(args.cfg, args.chave);
  const de = endereco(args.chave);
  const taxa = { amount: [{ denom: DENOM, amount: String(prep.fee) }], gas: String(prep._gas) };
  const memo = args.memo != null ? String(args.memo).trim() : '';
  const hash = await c.signAndBroadcastSync(de, [msgEnvio(de, prep.to, prep.value)], taxa, memo);
  return { ...prep, hash };
}

async function confirmar(cfg, hash) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const c = await leitor(cfg);
      const t = await c.getTx(hash);
      if (t) return t.code === 0 ? 'ok' : 'falhou';
    } catch { /* ainda não */ }
  }
  return 'pendente';
}

module.exports = { endereco, validar, saldo, preparar, enviar, confirmar };
