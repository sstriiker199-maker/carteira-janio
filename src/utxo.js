// Bitcoin, Litecoin, Dogecoin e Bitcoin Cash (moedas de "UTXO")
const bitcoin = require('bitcoinjs-lib');
const cashaddr = require('cashaddrjs');
const { SigningKey, getBytes } = require('ethers');
const { parseAmount, fmt } = require('./util');

const REDES = {
  btc: {
    tipo: 'segwit', api: 'mempool', caminho: "m/84'/0'/0'/0/", poeira: 546,
    rede: bitcoin.networks.bitcoin
  },
  ltc: {
    tipo: 'segwit', api: 'mempool', caminho: "m/84'/2'/0'/0/", poeira: 546,
    rede: { messagePrefix: '\x19Litecoin Signed Message:\n', bech32: 'ltc', bip32: { public: 0x019da462, private: 0x019d9cfe }, pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 }
  },
  doge: {
    tipo: 'legado', api: 'bitcore', caminho: "m/44'/3'/0'/0/", poeira: 1000000, minSatByte: 1000,
    rede: { messagePrefix: '\x19Dogecoin Signed Message:\n', bech32: 'doge', bip32: { public: 0x02facafd, private: 0x02fac398 }, pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e }
  },
  bch: {
    tipo: 'bch', api: 'bitcore', caminho: "m/44'/145'/0'/0/", poeira: 546, minSatByte: 1,
    rede: bitcoin.networks.bitcoin
  }
};

async function http(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Servidor da rede respondeu ${r.status}: ${txt.slice(0, 160)}`);
  return txt;
}
const json = async (url, opts) => JSON.parse(await http(url, opts));

// ---------- Endereços ----------
function endereco(coin, pubkey) {
  const c = REDES[coin];
  if (c.tipo === 'segwit') return bitcoin.payments.p2wpkh({ pubkey, network: c.rede }).address;
  if (c.tipo === 'legado') return bitcoin.payments.p2pkh({ pubkey, network: c.rede }).address;
  const hash = bitcoin.payments.p2pkh({ pubkey }).hash;
  return cashaddr.encode('bitcoincash', 'P2PKH', new Uint8Array(hash));
}

function scriptDestino(coin, addr) {
  const c = REDES[coin];
  addr = String(addr || '').trim();
  try {
    if (coin === 'bch') {
      if (/^[13]/.test(addr)) return bitcoin.address.toOutputScript(addr, bitcoin.networks.bitcoin);
      const full = addr.includes(':') ? addr : 'bitcoincash:' + addr;
      const d = cashaddr.decode(full);
      const hash = Buffer.from(d.hash);
      return d.type === 'P2SH' ? bitcoin.payments.p2sh({ hash }).output : bitcoin.payments.p2pkh({ hash }).output;
    }
    return bitcoin.address.toOutputScript(addr, c.rede);
  } catch {
    return null;
  }
}

// ---------- Consultas ----------
const apiAddr = (cfg, coin, addr) => (coin === 'bch' ? addr.replace(/^bitcoincash:/, '') : addr);

async function saldoRaw(cfg, coin, addr) {
  const c = REDES[coin];
  if (c.api === 'mempool') {
    const d = await json(`${cfg.rpc}/address/${addr}`);
    const s = (x) => BigInt(x.funded_txo_sum) - BigInt(x.spent_txo_sum);
    return s(d.chain_stats) + s(d.mempool_stats);
  }
  const d = await json(`${cfg.rpc}/address/${apiAddr(cfg, coin, addr)}/balance`);
  return BigInt(Math.round(Number(d.balance)));
}

async function utxos(cfg, coin, addr) {
  const c = REDES[coin];
  if (c.api === 'mempool') {
    const l = await json(`${cfg.rpc}/address/${addr}/utxo`);
    return l.map((u) => ({ txid: u.txid, vout: u.vout, value: Number(u.value) }));
  }
  const l = await json(`${cfg.rpc}/address/${apiAddr(cfg, coin, addr)}/?unspent=true&limit=1000`);
  return l.filter((u) => !u.spentTxid).map((u) => ({ txid: u.mintTxid, vout: u.mintIndex, value: Number(u.value) }));
}

// sat por byte para as 3 velocidades
async function taxas(cfg, coin) {
  const c = REDES[coin];
  if (c.api === 'mempool') {
    const f = await json(`${cfg.rpc}/v1/fees/recommended`);
    return { economica: Math.max(1, f.economyFee), normal: Math.max(1, f.halfHourFee), rapida: Math.max(1, f.fastestFee) };
  }
  const um = async (n) => {
    try {
      const f = await json(`${cfg.rpc}/fee/${n}`);
      return Math.max(c.minSatByte, Math.ceil((Number(f.feerate) * 1e8) / 1000));
    } catch { return c.minSatByte * 2; }
  };
  const [e, n, r] = await Promise.all([um(6), um(3), um(1)]);
  return { economica: e, normal: Math.max(e, n), rapida: Math.max(n, r) };
}

const tamanho = (coin, nIn, nOut) => (REDES[coin].tipo === 'segwit' ? 11 + 68 * nIn + 31 * nOut : 10 + 148 * nIn + 34 * nOut);

async function saldo(cfg, coin, asset, addr) {
  return { raw: await saldoRaw(cfg, coin, addr), decimals: 8 };
}

// ---------- Montar ----------
async function preparar({ cfg, coin, asset, chave, to, amount, max, velocidade, valorRaw, opReturn }) {
  const c = REDES[coin];
  const de = endereco(coin, chave.pubkey);
  const script = scriptDestino(coin, to);
  if (!script) throw new Error(`Endereço de destino inválido para ${asset.name}.`);
  const vel = ['economica', 'normal', 'rapida'].includes(velocidade) ? velocidade : 'normal';
  const [lista, tx] = await Promise.all([utxos(cfg, coin, de), taxas(cfg, coin)]);
  if (!lista.length) throw new Error(`Você não tem ${asset.symbol} nesta carteira (ou ainda não confirmou).`);
  const total = lista.reduce((a, u) => a + u.value, 0);
  const extra = opReturn ? 11 + Buffer.byteLength(opReturn) : 0; // saída com o "memo" (troca THORChain)
  const custo = (rate, nIn, nOut) => Math.ceil((tamanho(coin, nIn, nOut) + extra) * rate);

  let valor;
  let usados;
  let troco = 0;
  const rate = tx[vel];
  if (max) {
    usados = lista;
    valor = total - custo(rate, usados.length, 1);
  } else {
    valor = valorRaw != null ? Number(valorRaw) : Number(parseAmount(amount, 8));
    usados = [];
    let soma = 0;
    for (const u of [...lista].sort((a, b) => b.value - a.value)) {
      usados.push(u);
      soma += u.value;
      if (soma >= valor + custo(rate, usados.length, 2)) break;
    }
    const fee2 = custo(rate, usados.length, 2);
    if (soma < valor + fee2) {
      throw new Error(`Saldo insuficiente: valor + taxa (${fmt(BigInt(fee2), 8)} ${asset.symbol}) passa do saldo de ${fmt(BigInt(total), 8)} ${asset.symbol}.`);
    }
    troco = soma - valor - fee2;
    if (troco < c.poeira) troco = 0;
  }
  if (valor < c.poeira) throw new Error(`Valor pequeno demais para a rede ${asset.name} (mínimo ~${fmt(BigInt(c.poeira), 8)} ${asset.symbol}).`);
  const nOut = troco > 0 ? 2 : 1;
  const somaUsada = usados.reduce((a, u) => a + u.value, 0);
  const fee = somaUsada - valor - troco;
  const opcoes = Object.fromEntries(Object.entries(tx).map(([v, r]) => [v, BigInt(custo(r, usados.length, nOut))]));
  return {
    value: BigInt(valor), decimals: 8, fee: BigInt(fee), feeMax: BigInt(fee), feeDecimals: 8, to: String(to).trim(),
    velocidade: vel, opcoes, _plano: { usados, valor, troco, script, de, opReturn }
  };
}

function assinador(chave) {
  const sk = new SigningKey(chave.priv);
  return (hash) => {
    const sig = sk.sign(hash);
    return Buffer.concat([Buffer.from(getBytes(sig.r)), Buffer.from(getBytes(sig.s))]);
  };
}

function montarTx(coin, chave, plano) {
  const c = REDES[coin];
  const assinar = assinador(chave);
  const meuScript = c.tipo === 'segwit'
    ? bitcoin.payments.p2wpkh({ pubkey: chave.pubkey, network: c.rede }).output
    : bitcoin.payments.p2pkh({ pubkey: chave.pubkey }).output;

  if (c.tipo === 'segwit') {
    const psbt = new bitcoin.Psbt({ network: c.rede });
    psbt.setMaximumFeeRate(100000);
    for (const u of plano.usados) psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: meuScript, value: u.value } });
    psbt.addOutput({ script: plano.script, value: plano.valor });
    if (plano.opReturn) psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from(plano.opReturn)] }).output, value: 0 });
    if (plano.troco > 0) psbt.addOutput({ script: meuScript, value: plano.troco });
    psbt.signAllInputs({ publicKey: chave.pubkey, sign: assinar });
    psbt.finalizeAllInputs();
    return psbt.extractTransaction().toHex();
  }

  const tx = new bitcoin.Transaction();
  tx.version = coin === 'bch' ? 2 : 1;
  for (const u of plano.usados) tx.addInput(Buffer.from(u.txid, 'hex').reverse(), u.vout);
  tx.addOutput(plano.script, plano.valor);
  if (plano.opReturn) tx.addOutput(bitcoin.payments.embed({ data: [Buffer.from(plano.opReturn)] }).output, 0);
  if (plano.troco > 0) tx.addOutput(meuScript, plano.troco);
  plano.usados.forEach((u, i) => {
    let der;
    if (coin === 'bch') {
      const h = tx.hashForWitnessV0(i, meuScript, u.value, 0x41); // SIGHASH_ALL | FORKID
      der = bitcoin.script.signature.encode(assinar(h), 0x01);
      der[der.length - 1] = 0x41;
    } else {
      const h = tx.hashForSignature(i, meuScript, bitcoin.Transaction.SIGHASH_ALL);
      der = bitcoin.script.signature.encode(assinar(h), bitcoin.Transaction.SIGHASH_ALL);
    }
    tx.setInputScript(i, bitcoin.script.compile([der, chave.pubkey]));
  });
  return tx.toHex();
}

async function transmitir(cfg, coin, hex) {
  if (REDES[coin].api === 'mempool') return (await http(`${cfg.rpc}/tx`, { method: 'POST', body: hex })).trim();
  const d = await json(`${cfg.rpc}/tx/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawTx: hex }) });
  return d.txid;
}

async function enviar(args) {
  const prep = await preparar(args);
  const hex = montarTx(args.coin, args.chave, prep._plano);
  const hash = await transmitir(args.cfg, args.coin, hex);
  return { ...prep, hash };
}

async function confirmar(cfg, coin, txid) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 20000));
    try {
      if (REDES[coin].api === 'mempool') {
        const s = await json(`${cfg.rpc}/tx/${txid}/status`);
        if (s.confirmed) return 'ok';
      } else {
        const t = await json(`${cfg.rpc}/tx/${txid}`);
        if (t.blockHeight > 0) return 'ok';
      }
    } catch { /* tenta de novo */ }
  }
  return 'pendente';
}

module.exports = { REDES, endereco, scriptDestino, saldo, preparar, enviar, confirmar, montarTx };
