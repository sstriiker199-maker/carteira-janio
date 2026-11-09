// Cardano (ADA) — endereços "base" padrão (CIP-1852), servidor Koios
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');
const { parseAmount, fmt } = require('./util');

const H = (n) => 0x80000000 + n;
const BN = (x) => CSL.BigNum.from_str(String(x));

function chaves(entropiaHex, conta) {
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropiaHex.replace(/^0x/, ''), 'hex'), Buffer.from(''));
  const acct = root.derive(H(1852)).derive(H(1815)).derive(H(conta));
  const pay = acct.derive(0).derive(0);
  const stake = acct.derive(2).derive(0);
  const addr = CSL.BaseAddress.new(
    CSL.NetworkInfo.mainnet().network_id(),
    CSL.Credential.from_keyhash(pay.to_public().to_raw_key().hash()),
    CSL.Credential.from_keyhash(stake.to_public().to_raw_key().hash())
  ).to_address();
  return { pay, addr };
}
const endereco = (chave) => chaves(chave.entropia, chave.conta).addr.to_bech32();

async function koios(cfg, caminho, corpo) {
  const opts = corpo === undefined
    ? { headers: { accept: 'application/json' } }
    : { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(corpo) };
  const r = await fetch(cfg.rpc + caminho, { ...opts, signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Servidor Cardano respondeu ${r.status}: ${t.slice(0, 160)}`);
  return JSON.parse(t);
}

async function saldo(cfg, asset, addr) {
  const d = await koios(cfg, '/address_info', { _addresses: [addr] });
  return { raw: d.length ? BigInt(d[0].balance) : 0n, decimals: 6 };
}

async function parametros(cfg) {
  try {
    const p = await koios(cfg, '/cli_protocol_params');
    return { a: p.txFeePerByte, b: p.txFeeFixed, porByte: p.utxoCostPerByte, maxTx: p.maxTxSize, maxValor: p.maxValueSize };
  } catch {
    return { a: 44, b: 155381, porByte: 4310, maxTx: 16384, maxValor: 5000 };
  }
}

function construtor(p) {
  return CSL.TransactionBuilder.new(
    CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(CSL.LinearFee.new(BN(p.a), BN(p.b)))
      .pool_deposit(BN(500000000))
      .key_deposit(BN(2000000))
      .max_value_size(p.maxValor)
      .max_tx_size(p.maxTx)
      .coins_per_utxo_byte(BN(p.porByte))
      .build()
  );
}

async function preparar({ cfg, asset, chave, to, amount, max, valorRaw }) {
  const { addr } = chaves(chave.entropia, chave.conta);
  let dest;
  try { dest = CSL.Address.from_bech32(String(to).trim()); } catch { throw new Error('Endereço de destino inválido para a rede Cardano (começa com addr1).'); }
  const [utxos, p, tip] = await Promise.all([
    koios(cfg, '/address_utxos', { _addresses: [addr.to_bech32()] }),
    parametros(cfg),
    koios(cfg, '/tip')
  ]);
  // usa só as "moedas" que têm apenas ADA (não mexe em tokens guardados na carteira)
  const puros = utxos.filter((u) => !u.asset_list || !u.asset_list.length);
  if (!puros.length) throw new Error('Você não tem ADA disponível nesta carteira.');
  const total = puros.reduce((a, u) => a + BigInt(u.value), 0n);
  const ttl = Number(tip[0].abs_slot) + 7200;

  const montar = (valor, comTroco, feeFixa) => {
    const tb = construtor(p);
    const ins = CSL.TxInputsBuilder.new();
    for (const u of puros) {
      ins.add_regular_input(addr, CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), u.tx_index), CSL.Value.new(BN(u.value)));
    }
    tb.set_inputs(ins);
    tb.add_output(CSL.TransactionOutput.new(dest, CSL.Value.new(BN(valor))));
    tb.set_ttl_bignum(BN(ttl));
    if (comTroco) tb.add_change_if_needed(addr);
    else tb.set_fee(BN(feeFixa));
    return tb;
  };

  let valor;
  let tb;
  if (max || (valorRaw == null && false)) {
    const teste = montar(total - 1000000n, true);
    const fee = BigInt(teste.get_fee_if_set().to_str()) + 2000n;
    valor = total - fee;
    tb = montar(valor, false, fee);
  } else {
    valor = valorRaw != null ? BigInt(valorRaw) : parseAmount(amount, 6);
    if (valor < 1000000n) throw new Error('Na rede Cardano o mínimo por envio é 1 ADA.');
    try { tb = montar(valor, true); } catch (e) {
      throw new Error(`Saldo de ADA insuficiente para valor + taxa (saldo disponível: ${fmt(total, 6)} ADA).`);
    }
  }
  if (valor < 1000000n) throw new Error('Saldo de ADA insuficiente (o mínimo por envio é 1 ADA, mais a taxa).');
  const fee = BigInt(tb.get_fee_if_set().to_str());
  return { value: valor, decimals: 6, fee, feeMax: fee, feeDecimals: 6, feeLabel: '≈', to: String(to).trim(), _tb: tb };
}

async function enviar(args) {
  const prep = await preparar(args);
  const { pay } = chaves(args.chave.entropia, args.chave.conta);
  const corpo = prep._tb.build();
  const hash = CSL.hash_transaction(corpo);
  const ws = CSL.TransactionWitnessSet.new();
  const vks = CSL.Vkeywitnesses.new();
  vks.add(CSL.make_vkey_witness(hash, pay.to_raw_key()));
  ws.set_vkeys(vks);
  const tx = CSL.Transaction.new(corpo, ws, undefined);
  const r = await fetch(args.cfg.rpc + '/submittx', {
    method: 'POST', headers: { 'content-type': 'application/cbor' }, body: Buffer.from(tx.to_bytes()), signal: AbortSignal.timeout(30000)
  });
  const t = await r.text();
  if (!r.ok) throw new Error('A rede Cardano recusou: ' + t.slice(0, 200));
  return { ...prep, hash: hash.to_hex() };
}

async function confirmar(cfg, hash) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    try {
      const d = await koios(cfg, '/tx_status', { _tx_hashes: [hash] });
      if (d[0] && d[0].num_confirmations > 0) return 'ok';
    } catch { /* tenta de novo */ }
  }
  return 'pendente';
}

module.exports = { endereco, saldo, preparar, enviar, confirmar };
