// TON (carteira padrão v4R2, compatível com Trust Wallet)
const { TonClient, WalletContractV4, internal, SendMode, Address, toNano } = require('@ton/ton');
const { keyPairFromSeed } = require('@ton/crypto');
const { parseAmount, fmt } = require('./util');

const clientes = {};
function client(cfg) {
  const k = cfg.rpc + '|' + (cfg.apiKey || '');
  if (!clientes[k]) clientes[k] = new TonClient({ endpoint: cfg.rpc, apiKey: cfg.apiKey || undefined, timeout: 20000 });
  return clientes[k];
}

async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= 4 || !/429|rate|limit/i.test(String(e && (e.message || e)) + ' ' + String(e && e.response && e.response.status))) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
}

function carteira(seed32) {
  const kp = keyPairFromSeed(Buffer.from(seed32));
  return { kp, wallet: WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey }) };
}
const endereco = (seed32) => carteira(seed32).wallet.address.toString({ bounceable: false });

function validar(addr) {
  try { return Address.parse(String(addr).trim()); } catch { return null; }
}

async function saldo(cfg, asset, addr) {
  const raw = await retry(() => client(cfg).getBalance(Address.parse(addr)));
  return { raw: BigInt(raw), decimals: 9 };
}

const TAXA = toNano('0.01'); // estimativa de taxa por envio

async function preparar({ cfg, asset, chave, to, amount, max, valorRaw }) {
  const { wallet } = carteira(chave.seed32);
  const dest = validar(to);
  if (!dest) throw new Error('Endereço de destino inválido para a rede TON.');
  const bal = BigInt(await retry(() => client(cfg).getBalance(wallet.address)));
  const value = valorRaw != null ? BigInt(valorRaw) : max ? bal - TAXA : parseAmount(amount, 9);
  if (value <= 0n) throw new Error('Saldo de TON insuficiente para a taxa.');
  if (value + TAXA > bal) throw new Error(`Saldo insuficiente: valor + taxa (~${fmt(TAXA, 9)} TON) passa do saldo de ${fmt(bal, 9)} TON.`);
  return { value, decimals: 9, fee: TAXA, feeMax: TAXA, feeDecimals: 9, feeLabel: 'até', to: String(to).trim(), _max: !!max };
}

async function enviar(args) {
  const prep = await preparar(args);
  const { kp, wallet } = carteira(args.chave.seed32);
  const c = client(args.cfg);
  const aberta = c.open(wallet);
  const seqno = await retry(() => aberta.getSeqno());
  const dest = Address.parse(prep.to);
  const comentario = args.memo != null && String(args.memo).trim() ? String(args.memo).trim() : undefined;
  await retry(() => aberta.sendTransfer({
    seqno,
    secretKey: kp.secretKey,
    sendMode: prep._max ? SendMode.CARRY_ALL_REMAINING_BALANCE : SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: [internal({ to: dest, value: prep._max ? 0n : prep.value, bounce: false, body: comentario })]
  }));
  // a TON não devolve o código da transação na hora: usamos carteira:seqno para acompanhar
  return { ...prep, hash: `${wallet.address.toString({ bounceable: false })}:${seqno}` };
}

async function confirmar(cfg, ref, seed32) {
  const [addr, seq] = ref.split(':');
  const c = client(cfg);
  const w = c.open(WalletContractV4.create({ workchain: 0, publicKey: keyPairFromSeed(Buffer.from(seed32)).publicKey }));
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      if ((await w.getSeqno()) > Number(seq)) return 'ok';
    } catch { /* tenta de novo */ }
  }
  return addr ? 'pendente' : 'pendente';
}

module.exports = { endereco, validar, saldo, preparar, enviar, confirmar };
