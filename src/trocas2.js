// Mais serviços de troca para o comparador:
// - Jupiter (Solana) e STON.fi (TON): trocas dentro da própria rede, sem chave
// - deBridge: entre redes 0x e Solana, sem chave
// - Exolix (sem chave), SimpleSwap, StealthEX e LetsExchange (com chave): o serviço dá um endereço de depósito

async function http(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
    signal: AbortSignal.timeout(25000)
  });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = { message: t.slice(0, 200) }; }
  if (!r.ok || (j && j.error && typeof j.error === 'string' && !('minAmount' in j))) {
    const msg = (j && (j.message || j.error || j.errorMessage || j.description)) || `HTTP ${r.status}`;
    const e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200));
    e.status = r.status;
    e.corpo = j;
    throw e;
  }
  return j;
}

function traduzir(m) {
  m = String(m || '');
  if (/min(imum|imal)?|too (low|small)|less than/i.test(m)) return 'valor abaixo do mínimo desse serviço. ' + m.slice(0, 120);
  if (/max(imum)?|too (high|big)/i.test(m)) return 'valor acima do máximo desse serviço. ' + m.slice(0, 120);
  if (/not (available|supported|found)|unsupported|pair|no route|unavailable/i.test(m)) return 'par não disponível';
  if (/401|403|unauthori[sz]ed|forbidden|api.?key|token/i.test(m)) return 'chave inválida ou sem permissão';
  return m.slice(0, 160);
}

// Situação das trocas por endereço de depósito, em português
const ESTADOS = {
  waiting: 'aguardando depósito', wait: 'aguardando depósito', new: 'aguardando depósito',
  confirming: 'depósito detectado', confirmation: 'depósito detectado', confirmed: 'depósito detectado',
  exchanging: 'trocando', sending: 'enviando para você', sending_confirmation: 'enviando para você',
  finished: 'concluída', success: 'concluída', failed: 'falhou', error: 'falhou', aml_check_failed: 'em verificação',
  refunded: 'devolvida', refund: 'devolvida', expired: 'expirada', overdue: 'expirada', verifying: 'em verificação'
};
const estado = (s) => ESTADOS[String(s || '').toLowerCase()] || String(s || '');

// ---------- Como cada rede do programa aparece nas listas dos serviços ----------
const REDE_RX = {
  ethereum: /^(eth|ethereum|erc-?20)$/i,
  bsc: /^(bsc|bep-?20|bnb|binance.?smart.?chain|binancesmartchain|bnb.?chain|bnbsc)$/i,
  polygon: /^(matic|polygon|pol|polygon.?pos)$/i,
  avalanche: /^(avaxc|avax|c-?chain|avalanche|avalanche.?c.?chain|avax.?c(.?chain)?)$/i,
  arbitrum: /^(arb|arbitrum|arbitrum.?one)$/i,
  base: /^base$/i,
  optimism: /^(op|optimism)$/i,
  tron: /^(trx|tron|trc-?20)$/i,
  bitcoin: /^(btc|bitcoin)$/i,
  litecoin: /^(ltc|litecoin)$/i,
  dogecoin: /^(doge|dogecoin)$/i,
  bitcoincash: /^(bch|bitcoin.?cash)$/i,
  solana: /^(sol|solana|spl)$/i,
  xrp: /^(xrp|ripple|xrp.?ledger)$/i,
  ton: /^(ton|toncoin|the.?open.?network)$/i,
  cardano: /^(ada|cardano)$/i
};
// rede "de casa" de cada moeda principal (onde ela aparece como "mainnet")
const CASA = { ETH: 'ethereum', BNB: 'bsc', POL: 'polygon', AVAX: 'avalanche', TRX: 'tron', BTC: 'bitcoin', LTC: 'litecoin', DOGE: 'dogecoin', BCH: 'bitcoincash', SOL: 'solana', XRP: 'xrp', TON: 'ton', ADA: 'cardano' };
const simbolos = (a) => (a.symbol === 'POL' ? ['pol', 'matic'] : [a.symbol.toLowerCase()]);
const mesmoContrato = (x, c) => x && c && (String(c).startsWith('0x') ? String(x).toLowerCase() === String(c).toLowerCase() : String(x) === String(c));

// acha a moeda certa (moeda + rede) na lista de um serviço
// pegar(item) => { sym, rede, contrato }
function casar(lista, asset, pegar) {
  const itens = lista.map((x) => ({ x, ...pegar(x) }));
  const rx = REDE_RX[asset.network];
  const syms = simbolos(asset);
  if (asset.contract) {
    const porContrato = itens.find((i) => mesmoContrato(i.contrato, asset.contract));
    if (porContrato) return porContrato.x;
  }
  const s = (i) => String(i.sym || '').toLowerCase();
  const r = (i) => String(i.rede || '');
  let ok = itens.find((i) => syms.includes(s(i)) && rx && rx.test(r(i)));
  if (!ok && asset.native && CASA[asset.symbol] === asset.network) ok = itens.find((i) => syms.includes(s(i)) && /^(mainnet)?$/i.test(r(i)));
  if (!ok) ok = itens.find((i) => syms.some((y) => s(i).startsWith(y)) && rx && rx.test(r(i)));
  return ok ? ok.x : null;
}

// ---------- Jupiter (Solana) ----------
const MINT_SOL = 'So11111111111111111111111111111111111111112';
const jupBase = (chave) => (chave ? 'https://api.jup.ag/swap/v1' : 'https://lite-api.jup.ag/swap/v1');
const jupCab = (chave) => (chave ? { 'x-api-key': chave } : {});
const mint = (a) => (a.native ? MINT_SOL : a.contract);

async function jupCotar({ de, para, valorRaw, origem, destino, chave }) {
  if (de.network !== 'solana' || para.network !== 'solana') throw new Error('a Jupiter só troca moedas da rede Solana');
  if (origem !== destino) throw new Error('a Jupiter só entrega na mesma carteira de onde sai');
  const q = new URLSearchParams({ inputMint: mint(de), outputMint: mint(para), amount: String(valorRaw), slippageBps: '50', restrictIntermediateTokens: 'true' });
  let j;
  try { j = await http(`${jupBase(chave)}/quote?${q}`, { headers: jupCab(chave) }); } catch (e) { throw new Error(traduzir(e.message)); }
  if (!j.outAmount) throw new Error('sem rota na Jupiter');
  return { recebe: Number(j.outAmount) / 10 ** para.decimals, tempo: 10, dados: { quote: j } };
}

async function jupTransacao({ quote, usuario, chave }) {
  const j = await http(`${jupBase(chave)}/swap`, {
    method: 'POST', headers: jupCab(chave),
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: usuario, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' })
  });
  if (!j.swapTransaction) throw new Error('A Jupiter não devolveu a transação.');
  return j.swapTransaction; // base64
}

// ---------- STON.fi (TON) ----------
const TON_ENDERECO = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'; // TON "nativo" na API da STON.fi
const stonEnd = (a) => (a.native ? TON_ENDERECO : a.contract);
let stonApi = null;
const api = () => {
  if (!stonApi) { const { StonApiClient } = require('@ston-fi/api'); stonApi = new StonApiClient(); }
  return stonApi;
};

async function stonCotar({ de, para, valorRaw, origem, destino }) {
  if (de.network !== 'ton' || para.network !== 'ton') throw new Error('a STON.fi só troca moedas da rede TON');
  if (origem !== destino) throw new Error('a STON.fi só entrega na mesma carteira de onde sai');
  let sim;
  try {
    sim = await api().simulateSwap({ offerAddress: stonEnd(de), askAddress: stonEnd(para), offerUnits: String(valorRaw), slippageTolerance: '0.01' });
  } catch (e) { throw new Error(traduzir(e.message)); }
  const tonExtra = 0.3; // TON anexado para as taxas da troca (o que sobra volta)
  return {
    recebe: Number(sim.askUnits) / 10 ** para.decimals, tempo: 20,
    aviso: `precisa de ~${tonExtra} TON a mais na carteira para as taxas da troca (o que sobra volta)`,
    dados: { sim }
  };
}

// monta a mensagem que a carteira TON envia para o roteador da STON.fi
async function stonMensagem({ de, para, sim, usuario, tonClient }) {
  const sdk = require('@ston-fi/sdk');
  const c = sdk.dexFactory(sim.router);
  const router = tonClient.open(c.Router.create(sim.router.address));
  const comum = { userWalletAddress: usuario, offerAmount: sim.offerUnits, minAskAmount: sim.minAskUnits, queryId: Date.now() };
  if (de.native) {
    const proxyTon = c.pTON.create(sim.router.ptonMasterAddress);
    return router.getSwapTonToJettonTxParams({ ...comum, proxyTon, askJettonAddress: sim.askAddress });
  }
  if (para.native) {
    const proxyTon = c.pTON.create(sim.router.ptonMasterAddress);
    return router.getSwapJettonToTonTxParams({ ...comum, proxyTon, offerJettonAddress: sim.offerAddress });
  }
  return router.getSwapJettonToJettonTxParams({ ...comum, offerJettonAddress: sim.offerAddress, askJettonAddress: sim.askAddress });
}

// ---------- deBridge (entre redes 0x e Solana) ----------
const DLN = 'https://dln.debridge.finance/v1.0';
const DLN_CHAIN = { ethereum: 1, bsc: 56, polygon: 137, avalanche: 43114, arbitrum: 42161, base: 8453, optimism: 10, solana: 7565164 };
const dlnToken = (a) => (a.native ? (a.network === 'solana' ? '11111111111111111111111111111111' : '0x0000000000000000000000000000000000000000') : a.contract);

async function dlnCotar({ de, para, valorRaw, origem, destino }) {
  if (!DLN_CHAIN[de.network] || !DLN_CHAIN[para.network]) throw new Error('par não disponível na deBridge');
  if (de.network === para.network) throw new Error('a deBridge só troca entre redes diferentes');
  const q = new URLSearchParams({
    srcChainId: String(DLN_CHAIN[de.network]), srcChainTokenIn: dlnToken(de), srcChainTokenInAmount: String(valorRaw),
    dstChainId: String(DLN_CHAIN[para.network]), dstChainTokenOut: dlnToken(para), dstChainTokenOutAmount: 'auto',
    prependOperatingExpenses: 'true', dstChainTokenOutRecipient: destino, senderAddress: origem,
    srcChainOrderAuthorityAddress: origem, dstChainOrderAuthorityAddress: destino
  });
  let j;
  try { j = await http(`${DLN}/dln/order/create-tx?${q}`); } catch (e) {
    if (/not allowed account type/i.test(e.message)) throw new Error('a deBridge só aceita carteiras que já existem na rede (que já receberam algum saldo antes)');
    throw new Error(traduzir(e.message));
  }
  const out = j.estimation && j.estimation.dstChainTokenOut;
  if (!out || !j.tx) throw new Error('a deBridge não cotou esse par');
  const dec = out.decimals != null ? out.decimals : para.decimals;
  const aviso = j.fixFee && de.network !== 'solana' && BigInt(j.fixFee) > 0n ? 'inclui uma taxa fixa da deBridge paga na moeda principal da rede' : '';
  return {
    recebe: Number(out.recommendedAmount || out.amount) / 10 ** dec,
    tempo: (j.order && j.order.approximateFulfillmentDelay) || 30, aviso,
    dados: { tx: j.tx, orderId: j.orderId || null, fixFee: j.fixFee || '0' }
  };
}

async function dlnStatus(hash) {
  let ids;
  try { ids = (await http(`${DLN}/dln/tx/${hash}/order-ids`)).orderIds || []; } catch { ids = []; }
  if (!ids.length) return 'aguardando a rede';
  const o = await http(`https://stats-api.dln.trade/api/Orders/${ids[0]}`);
  const s = String((typeof o.state === 'string' ? o.state : o.state && o.state.status) || o.status || '');
  if (/Fulfilled|SentUnlock|ClaimedUnlock/i.test(s)) return 'concluída';
  if (/Cancel/i.test(s)) return 'devolvida';
  return 'trocando';
}

// ---------- Exolix (não precisa de chave) ----------
const EXO = 'https://exolix.com/api/v2';
const EXO_REDE = { ethereum: 'ETH', bsc: 'BSC', polygon: 'MATIC', avalanche: 'AVAXC', arbitrum: 'ARBITRUM', base: 'BASE', optimism: 'OPTIMISM', tron: 'TRX', bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE', bitcoincash: 'BCH', solana: 'SOL', xrp: 'XRP', ton: 'TON', cardano: 'ADA' };
const exoCab = (chave) => (chave ? { authorization: chave } : {});
const exoMoeda = (a) => {
  if (!EXO_REDE[a.network]) throw new Error('rede não disponível na Exolix');
  return { coin: a.symbol, network: EXO_REDE[a.network] };
};

async function exoCotar({ de, para, valor, chave }) {
  const a = exoMoeda(de);
  const b = exoMoeda(para);
  const q = new URLSearchParams({ coinFrom: a.coin, networkFrom: a.network, coinTo: b.coin, networkTo: b.network, amount: String(valor), rateType: 'float' });
  let j;
  try { j = await http(`${EXO}/rate?${q}`, { headers: exoCab(chave) }); } catch (e) {
    if (e.corpo && e.corpo.minAmount) throw new Error(`valor abaixo do mínimo da Exolix (${e.corpo.minAmount} ${de.symbol})`);
    throw new Error(traduzir(e.message));
  }
  if (j.minAmount && Number(valor) < Number(j.minAmount)) throw new Error(`valor abaixo do mínimo da Exolix (${j.minAmount} ${de.symbol})`);
  if (!j.toAmount) throw new Error(j.message || 'sem cotação');
  return { recebe: Number(j.toAmount), tempo: 600, aviso: j.message || '', dados: { a, b } };
}

async function exoCriar({ chave, dados, valor, destino, destinoExtra, reembolso }) {
  const j = await http(`${EXO}/transactions`, {
    method: 'POST', headers: exoCab(chave),
    body: JSON.stringify({
      coinFrom: dados.a.coin, networkFrom: dados.a.network, coinTo: dados.b.coin, networkTo: dados.b.network,
      amount: Number(valor), withdrawalAddress: destino, withdrawalExtraId: destinoExtra || '', refundAddress: reembolso, refundExtraId: '', rateType: 'float'
    })
  });
  if (!j.depositAddress) throw new Error('A Exolix não devolveu o endereço de depósito.');
  return { id: j.id, deposito: j.depositAddress, depositoExtra: j.depositExtraId || '', recebe: j.amountTo, pagina: `https://exolix.com/transaction/${j.id}` };
}

async function exoStatus(chave, id) {
  const j = await http(`${EXO}/transactions/${id}`, { headers: exoCab(chave) });
  return { status: estado(j.status), recebido: j.amountTo };
}

// ---------- SimpleSwap (chave) ----------
const SS = 'https://api.simpleswap.io';
let ssLista = null;
async function ssMoedas(chave) {
  if (!ssLista) ssLista = await http(`${SS}/get_all_currencies?api_key=${encodeURIComponent(chave)}`);
  return ssLista;
}
async function ssAchar(chave, asset) {
  const c = casar(await ssMoedas(chave), asset, (x) => ({ sym: x.symbol, rede: x.network, contrato: x.contract_address }));
  if (!c) throw new Error(`${asset.symbol} nessa rede não está na SimpleSwap`);
  return c.symbol;
}
async function ssCotar({ de, para, valor, chave }) {
  if (!chave) throw new Error('precisa da chave da SimpleSwap (Configurações → Chaves de API)');
  const [a, b] = await Promise.all([ssAchar(chave, de), ssAchar(chave, para)]);
  const q = new URLSearchParams({ api_key: chave, fixed: 'false', currency_from: a, currency_to: b, amount: String(valor) });
  let j;
  try { j = await http(`${SS}/get_estimated?${q}`); } catch (e) { throw new Error(traduzir(e.message)); }
  const recebe = Number(typeof j === 'object' ? j.amount || j.result : j);
  if (!(recebe > 0)) throw new Error('sem cotação');
  return { recebe, tempo: 900, dados: { a, b } };
}
async function ssCriar({ chave, dados, valor, destino, destinoExtra, reembolso }) {
  const j = await http(`${SS}/create_exchange?api_key=${encodeURIComponent(chave)}`, {
    method: 'POST',
    body: JSON.stringify({ fixed: false, currency_from: dados.a, currency_to: dados.b, amount: Number(valor), address_to: destino, extra_id_to: destinoExtra || '', user_refund_address: reembolso, user_refund_extra_id: '' })
  });
  if (!j.address_from) throw new Error('A SimpleSwap não devolveu o endereço de depósito.');
  return { id: j.id, deposito: j.address_from, depositoExtra: j.extra_id_from || '', recebe: j.amount_to, pagina: `https://simpleswap.io/exchange?id=${j.id}` };
}
async function ssStatus(chave, id) {
  const j = await http(`${SS}/get_exchange?api_key=${encodeURIComponent(chave)}&id=${encodeURIComponent(id)}`);
  return { status: estado(j.status), recebido: j.amount_to };
}

// ---------- StealthEX (chave) ----------
const SX = 'https://api.stealthex.io/v4';
const sxCab = (chave) => ({ authorization: `Bearer ${chave}` });
let sxLista = null;
async function sxMoedas(chave) {
  if (!sxLista) {
    const todas = [];
    for (let offset = 0; offset < 5000; offset += 250) {
      const p = await http(`${SX}/currencies?limit=250&offset=${offset}`, { headers: sxCab(chave) });
      todas.push(...p);
      if (p.length < 250) break;
    }
    sxLista = todas;
  }
  return sxLista;
}
async function sxAchar(chave, asset) {
  const c = casar(await sxMoedas(chave), asset, (x) => ({ sym: x.symbol, rede: x.network, contrato: x.contract_address }));
  if (!c) throw new Error(`${asset.symbol} nessa rede não está na StealthEX`);
  return { symbol: c.symbol, network: c.network };
}
async function sxCotar({ de, para, valor, chave }) {
  if (!chave) throw new Error('precisa da chave da StealthEX (Configurações → Chaves de API)');
  const [a, b] = await Promise.all([sxAchar(chave, de), sxAchar(chave, para)]);
  let j;
  try {
    j = await http(`${SX}/rates/estimated-amount`, { method: 'POST', headers: sxCab(chave), body: JSON.stringify({ route: { from: a, to: b }, amount: Number(valor), rate: 'floating', estimation: 'direct' }) });
  } catch (e) { throw new Error(traduzir(e.message)); }
  if (!(Number(j.estimated_amount) > 0)) throw new Error('sem cotação');
  return { recebe: Number(j.estimated_amount), tempo: 900, dados: { a, b } };
}
async function sxCriar({ chave, dados, valor, destino, destinoExtra, reembolso }) {
  const corpo = { route: { from: dados.a, to: dados.b }, amount: Number(valor), rate: 'floating', estimation: 'direct', address: destino, refund_address: reembolso };
  if (destinoExtra) corpo.extra_id = destinoExtra;
  const j = await http(`${SX}/exchanges`, { method: 'POST', headers: sxCab(chave), body: JSON.stringify(corpo) });
  if (!j.deposit || !j.deposit.address) throw new Error('A StealthEX não devolveu o endereço de depósito.');
  return { id: j.id, deposito: j.deposit.address, depositoExtra: j.deposit.extra_id || '', recebe: j.withdrawal && j.withdrawal.expected_amount, pagina: `https://stealthex.io/exchange/?id=${j.id}` };
}
async function sxStatus(chave, id) {
  const j = await http(`${SX}/exchanges/${id}`, { headers: sxCab(chave) });
  return { status: estado(j.status), recebido: j.withdrawal && (j.withdrawal.amount || j.withdrawal.expected_amount) };
}

// ---------- LetsExchange (chave + código de afiliado) ----------
const LE = 'https://api.letsexchange.io/api';
const leCab = (chave) => ({ authorization: `Bearer ${chave}` });
let leLista = null;
async function leMoedas(chave, afiliado) {
  if (!leLista) leLista = await http(`${LE}/v2/coins?affiliate_id=${encodeURIComponent(afiliado || '')}`, { headers: leCab(chave) });
  return leLista;
}
async function leAchar(chave, afiliado, asset) {
  const lista = await leMoedas(chave, afiliado);
  const planos = [];
  for (const c of lista) for (const n of c.networks || []) if (n.is_active !== 0) planos.push({ c, n });
  const p = casar(planos, asset, (x) => ({ sym: x.c.code, rede: x.n.code, contrato: x.n.contract_address }));
  if (!p) throw new Error(`${asset.symbol} nessa rede não está na LetsExchange`);
  return { coin: p.c.code, network: p.n.code };
}
async function leCotar({ de, para, valor, chave, afiliado }) {
  if (!chave) throw new Error('precisa da chave da LetsExchange (Configurações → Chaves de API)');
  const [a, b] = await Promise.all([leAchar(chave, afiliado, de), leAchar(chave, afiliado, para)]);
  let j;
  try {
    j = await http(`${LE}/v1/info`, { method: 'POST', headers: leCab(chave), body: JSON.stringify({ from: a.coin, to: b.coin, network_from: a.network, network_to: b.network, amount: Number(valor), affiliate_id: afiliado || '', float: true }) });
  } catch (e) { throw new Error(traduzir(e.message)); }
  if (j.min_amount && Number(valor) < Number(j.min_amount)) throw new Error(`valor abaixo do mínimo da LetsExchange (${j.min_amount} ${de.symbol})`);
  if (!(Number(j.amount) > 0)) throw new Error('sem cotação');
  return { recebe: Number(j.amount), tempo: 900, dados: { a, b } };
}
async function leCriar({ chave, afiliado, dados, valor, destino, destinoExtra, reembolso }) {
  const j = await http(`${LE}/v1/transaction`, {
    method: 'POST', headers: leCab(chave),
    body: JSON.stringify({
      float: true, coin_from: dados.a.coin, coin_to: dados.b.coin, network_from: dados.a.network, network_to: dados.b.network,
      deposit_amount: Number(valor), withdrawal: destino, withdrawal_extra_id: destinoExtra || '', return: reembolso, return_extra_id: '', affiliate_id: afiliado || undefined
    })
  });
  if (!j.deposit) throw new Error('A LetsExchange não devolveu o endereço de depósito.');
  return { id: j.transaction_id, deposito: j.deposit, depositoExtra: j.deposit_extra_id || '', recebe: j.withdrawal_amount, pagina: `https://letsexchange.io/?transactionId=${j.transaction_id}` };
}
async function leStatus(chave, id) {
  const j = await http(`${LE}/v1/transaction/${id}`, { headers: leCab(chave) });
  return { status: estado(j.status), recebido: j.real_withdrawal_amount || j.withdrawal_amount };
}

// Os quatro serviços "de endereço de depósito" com a mesma cara
const DEPOSITO = {
  exolix: { nome: 'Exolix', cotar: exoCotar, criar: exoCriar, status: exoStatus, precisaChave: false },
  simpleswap: { nome: 'SimpleSwap', cotar: ssCotar, criar: ssCriar, status: ssStatus, precisaChave: true },
  stealthex: { nome: 'StealthEX', cotar: sxCotar, criar: sxCriar, status: sxStatus, precisaChave: true },
  letsexchange: { nome: 'LetsExchange', cotar: leCotar, criar: leCriar, status: leStatus, precisaChave: true }
};

// testa se a chave funciona (usado em Configurações)
async function testarChave(provedor, chave, afiliado) {
  if (provedor === 'simpleswap') { ssLista = null; return (await ssMoedas(chave)).length + ' moedas'; }
  if (provedor === 'stealthex') { const l = await http(`${SX}/currencies?limit=5`, { headers: sxCab(chave) }); sxLista = null; return 'ok (' + l.length + ')'; }
  if (provedor === 'letsexchange') { leLista = null; return (await leMoedas(chave, afiliado)).length + ' moedas'; }
  if (provedor === 'jupiter') { await http(`https://api.jup.ag/swap/v1/quote?inputMint=${MINT_SOL}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=10000000&slippageBps=50`, { headers: jupCab(chave) }); return 'ok'; }
  throw new Error('serviço desconhecido');
}

module.exports = {
  jupCotar, jupTransacao, stonCotar, stonMensagem, dlnCotar, dlnStatus, DLN_CHAIN, EXO_REDE,
  DEPOSITO, testarChave, casar, estado,
  achar: { simpleswap: ssAchar, stealthex: sxAchar, letsexchange: (chave, asset, afiliado) => leAchar(chave, afiliado, asset) }
};
