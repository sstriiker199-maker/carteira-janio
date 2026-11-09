// XRP Ledger
const xrpl = require('xrpl');
const { parseAmount, fmt } = require('./util');

let cliente = null;
let urlAtual = null;

async function client(cfg) {
  if (!cliente || urlAtual !== cfg.rpc || !cliente.isConnected()) {
    try { if (cliente) await cliente.disconnect(); } catch { /* ignora */ }
    cliente = new xrpl.Client(cfg.rpc, { timeout: 20000 });
    urlAtual = cfg.rpc;
    await cliente.connect();
  }
  return cliente;
}

// chave: { priv: '0x…' (secp256k1), pubkey: Buffer comprimida }
function carteira(chave) {
  const pub = Buffer.from(chave.pubkey).toString('hex').toUpperCase();
  const priv = '00' + chave.priv.replace(/^0x/, '').toUpperCase();
  return new xrpl.Wallet(pub, priv);
}
const endereco = (chave) => carteira(chave).classicAddress;

async function reservas(c) {
  try {
    const r = await c.request({ command: 'server_state' });
    const v = r.result.state.validated_ledger;
    return { base: BigInt(v.reserve_base), inc: BigInt(v.reserve_inc) };
  } catch {
    return { base: 1000000n, inc: 200000n };
  }
}

async function infoConta(c, addr) {
  try {
    const r = await c.request({ command: 'account_info', account: addr, ledger_index: 'validated' });
    return { saldo: BigInt(r.result.account_data.Balance), objetos: BigInt(r.result.account_data.OwnerCount || 0) };
  } catch (e) {
    if (String(e.data && e.data.error) === 'actNotFound' || /Account not found/i.test(e.message)) return null;
    throw e;
  }
}

async function saldo(cfg, asset, addr) {
  const c = await client(cfg);
  const i = await infoConta(c, addr);
  return { raw: i ? i.saldo : 0n, decimals: 6 };
}

async function preparar({ cfg, asset, chave, to, amount, max, valorRaw, memo }) {
  const c = await client(cfg);
  const w = carteira(chave);
  to = String(to || '').trim();
  if (!xrpl.isValidClassicAddress(to)) throw new Error('Endereço de destino inválido para a rede XRP (começa com r).');
  if (to === w.classicAddress) throw new Error('O destino é a própria carteira.');
  let tag;
  if (memo != null && String(memo).trim() !== '') {
    tag = Number(String(memo).trim());
    if (!Number.isInteger(tag) || tag < 0 || tag > 4294967295) throw new Error('A "tag de destino" precisa ser um número.');
  }
  const minha = await infoConta(c, w.classicAddress);
  if (!minha) throw new Error('Esta carteira XRP ainda não foi ativada (precisa receber pelo menos 1 XRP).');
  const res = await reservas(c);
  const reservado = res.base + res.inc * minha.objetos;
  const fee = 12n;
  const disponivel = minha.saldo - reservado - fee;
  const value = valorRaw != null ? BigInt(valorRaw) : max ? disponivel : parseAmount(amount, 6);
  if (value <= 0n) throw new Error(`Saldo de XRP insuficiente. A rede exige que ${fmt(reservado, 6)} XRP fiquem guardados na carteira.`);
  if (value > disponivel) throw new Error(`Você pode enviar no máximo ${fmt(disponivel > 0n ? disponivel : 0n, 6)} XRP (a rede exige que ${fmt(reservado, 6)} XRP fiquem na carteira).`);
  const destino = await infoConta(c, to);
  if (!destino && value < res.base) throw new Error(`Para uma carteira XRP nova, envie pelo menos ${fmt(res.base, 6)} XRP (regra da rede).`);
  return { value, decimals: 6, fee, feeMax: fee, feeDecimals: 6, feeLabel: '≈', to, _tag: tag };
}

async function enviar(args) {
  const prep = await preparar(args);
  const c = await client(args.cfg);
  const w = carteira(args.chave);
  const tx = { TransactionType: 'Payment', Account: w.classicAddress, Destination: prep.to, Amount: prep.value.toString() };
  if (prep._tag != null) tx.DestinationTag = prep._tag;
  const pronto = await c.autofill(tx);
  const assinado = w.sign(pronto);
  const r = await c.submit(assinado.tx_blob);
  const codigo = r.result.engine_result;
  if (!/^tes|^ter/.test(codigo)) throw new Error('A rede XRP recusou: ' + (r.result.engine_result_message || codigo));
  return { ...prep, hash: assinado.hash };
}

async function confirmar(cfg, hash) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const c = await client(cfg);
      const r = await c.request({ command: 'tx', transaction: hash });
      if (r.result.validated) return r.result.meta.TransactionResult === 'tesSUCCESS' ? 'ok' : 'falhou';
    } catch { /* ainda não */ }
  }
  return 'pendente';
}

const validar = (a) => xrpl.isValidClassicAddress(String(a || '').trim());

module.exports = { endereco, validar, saldo, preparar, enviar, confirmar };
