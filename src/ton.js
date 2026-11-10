// TON (carteira padrão v4R2, compatível com Trust Wallet)
const { TonClient, WalletContractV4, internal, SendMode, Address, toNano, beginCell } = require('@ton/ton');
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

// ---- Tokens da TON (jettons, ex.: USDT) ----
const carteirasJetton = {};
async function carteiraJetton(cfg, mestre, dono) {
  const k = mestre + '|' + dono;
  if (!carteirasJetton[k]) {
    const r = await retry(() => client(cfg).runMethod(Address.parse(mestre), 'get_wallet_address', [{ type: 'slice', cell: beginCell().storeAddress(Address.parse(dono)).endCell() }]));
    carteirasJetton[k] = r.stack.readAddress().toString();
  }
  return Address.parse(carteirasJetton[k]);
}

async function saldoJetton(cfg, asset, dono) {
  const jw = await carteiraJetton(cfg, asset.contract, dono);
  try {
    const r = await retry(() => client(cfg).runMethod(jw, 'get_wallet_data'));
    return r.stack.readBigNumber();
  } catch (e) {
    // carteira do token ainda não existe (nunca recebeu) = saldo zero
    if (/exit_code|-13|not.*(init|deploy|active)|uninit|cannot/i.test(String(e && (e.message || e)))) return 0n;
    throw e;
  }
}

async function saldo(cfg, asset, addr) {
  if (asset && asset.contract) return { raw: await saldoJetton(cfg, asset, addr), decimals: asset.decimals };
  const raw = await retry(() => client(cfg).getBalance(Address.parse(addr)));
  return { raw: BigInt(raw), decimals: 9 };
}

const TAXA = toNano('0.01'); // estimativa de taxa por envio
const TON_JETTON = toNano('0.05'); // TON anexado ao envio de token (o que sobra volta)

function corpoJetton(valor, destino, resposta, comentario) {
  const b = beginCell()
    .storeUint(0x0f8a7ea5, 32).storeUint(BigInt(Date.now()), 64)
    .storeCoins(valor).storeAddress(destino).storeAddress(resposta)
    .storeBit(0) // sem custom_payload
    .storeCoins(comentario ? 1n : 0n);
  if (comentario) b.storeBit(1).storeRef(beginCell().storeUint(0, 32).storeStringTail(comentario).endCell());
  else b.storeBit(0);
  return b.endCell();
}

async function prepararJetton({ cfg, asset, chave, to, amount, max }) {
  const { wallet } = carteira(chave.seed32);
  const dest = validar(to);
  if (!dest) throw new Error('Endereço de destino inválido para a rede TON.');
  const dono = wallet.address.toString({ bounceable: false });
  const [tok, tonBal] = await Promise.all([saldoJetton(cfg, asset, dono), retry(() => client(cfg).getBalance(wallet.address)).then(BigInt)]);
  const value = max ? tok : parseAmount(amount, asset.decimals);
  if (value <= 0n) throw new Error(`Você não tem ${asset.symbol} (TON) nesta carteira.`);
  if (value > tok) throw new Error(`Saldo de ${asset.symbol} insuficiente (você tem ${fmt(tok, asset.decimals)}).`);
  const fee = TON_JETTON + TAXA;
  return {
    value, decimals: asset.decimals, fee, feeMax: fee, feeDecimals: 9, feeLabel: 'até (o que sobra volta)', to: String(to).trim(),
    nativeBal: tonBal, faltaTaxa: fee > tonBal ? fee - tonBal : 0n, _jetton: true
  };
}

async function preparar(args) {
  if (args.asset && args.asset.contract) return prepararJetton(args);
  const { cfg, chave, to, amount, max, valorRaw } = args;
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
  if (prep._jetton) {
    if (prep.faltaTaxa > 0n) throw new Error(`Para enviar ${args.asset.symbol} na rede TON você precisa de cerca de ${fmt(prep.fee, 9)} TON nesta carteira para a taxa.`);
    const jw = await carteiraJetton(args.cfg, args.asset.contract, wallet.address.toString({ bounceable: false }));
    await retry(() => aberta.sendTransfer({
      seqno, secretKey: kp.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: [internal({ to: jw, value: TON_JETTON, bounce: true, body: corpoJetton(prep.value, dest, wallet.address, comentario) })]
    }));
    return { ...prep, hash: `${wallet.address.toString({ bounceable: false })}:${seqno}` };
  }
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

// envia uma mensagem pronta (usado pela troca na STON.fi)
async function enviarMensagem({ cfg, chave, to, value, body }) {
  const { kp, wallet } = carteira(chave.seed32);
  const c = client(cfg);
  const aberta = c.open(wallet);
  const bal = BigInt(await retry(() => c.getBalance(wallet.address)));
  const precisa = BigInt(value) + TAXA;
  if (bal < precisa) throw new Error(`Saldo de TON insuficiente: a troca precisa de ${fmt(precisa, 9)} TON (já com as taxas) e a carteira tem ${fmt(bal, 9)} TON.`);
  const seqno = await retry(() => aberta.getSeqno());
  await retry(() => aberta.sendTransfer({
    seqno, secretKey: kp.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: [internal({ to, value: BigInt(value), bounce: true, body })]
  }));
  return `${wallet.address.toString({ bounceable: false })}:${seqno}`;
}

module.exports = { enviarMensagem, endereco, validar, saldo, preparar, enviar, confirmar, carteira, client, retry, carteiraJetton };
