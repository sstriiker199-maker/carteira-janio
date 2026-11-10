// Comparador de trocas: THORChain, LI.FI e ChangeNOW (a SideShift fica em swap.js)
const THORNODES = ['https://gateway.liquify.com/chain/thorchain_api', 'https://thornode.ninerealms.com'];
async function thorGet(caminho) {
  let erro;
  for (const base of THORNODES) {
    try { return await getJson(base + caminho); } catch (e) {
      erro = e;
      if (!/fetch failed|timeout|HTTP 5|HTTP 403|HTTP 429|aborted/i.test(e.message)) throw e; // erro da cotação em si: não adianta outro servidor
    }
  }
  throw erro;
}
const LIFI = 'https://li.quest/v1';
const CHANGENOW = 'https://api.changenow.io/v2';

async function getJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(25000) });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = { message: t.slice(0, 200) }; }
  if (!r.ok || (j && j.error && typeof j.error === 'string')) {
    throw new Error((j && (j.message || j.error)) || `HTTP ${r.status}`);
  }
  return j;
}

// ---------------- THORChain ----------------
const THOR_ATIVO = {
  btc: 'BTC.BTC', eth: 'ETH.ETH', bnb: 'BSC.BNB', avax: 'AVAX.AVAX', ltc: 'LTC.LTC', doge: 'DOGE.DOGE',
  bch: 'BCH.BCH', xrp: 'XRP.XRP', sol: 'SOL.SOL', trx: 'TRON.TRX',
  'usdt-eth': 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7',
  'usdt-bsc': 'BSC.USDT-0X55D398326F99059FF775485246999027B3197955',
  'usdt-tron': 'TRON.USDT-TR7NHQJEKQXGTCI8Q8ZY4PL8OTSZGJLJ6T',
  'usdc-eth': 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
  'usdc-bsc': 'BSC.USDC-0X8AC76A51CC950D9822D68B83FE1AD97B32CD580D'
};
// de quais moedas o programa já sabe fazer o depósito na THORChain (com o "memo")
const THOR_ORIGEM = new Set(['btc', 'ltc', 'doge', 'bch', 'eth', 'bnb', 'avax', 'usdt-eth', 'usdt-bsc', 'usdc-eth', 'usdc-bsc']);

function thorDestino(assetId, addr) {
  return assetId === 'bch' ? String(addr).replace(/^bitcoincash:/, '') : addr;
}

async function thorCotar({ de, para, valorRaw, decimaisDe, destino }) {
  if (!THOR_ATIVO[de.id] || !THOR_ATIVO[para.id]) throw new Error('par não disponível na THORChain');
  if (!THOR_ORIGEM.has(de.id)) throw new Error(`envio de ${de.symbol} para a THORChain ainda não suportado no programa`);
  const amount8 = (BigInt(valorRaw) * 10n ** 8n) / 10n ** BigInt(decimaisDe);
  const q = new URLSearchParams({
    from_asset: THOR_ATIVO[de.id], to_asset: THOR_ATIVO[para.id], amount: amount8.toString(),
    destination: thorDestino(para.id, destino), streaming_interval: '1', streaming_quantity: '0'
  });
  const j = await thorGet(`/thorchain/quote/swap?${q}`);
  if (!j.memo || !j.inbound_address) throw new Error(j.message || 'cotação incompleta');
  return {
    recebe: Number(j.expected_amount_out) / 1e8,
    tempo: j.total_swap_seconds || null,
    aviso: j.recommended_min_amount_in && amount8 < BigInt(j.recommended_min_amount_in)
      ? `valor abaixo do mínimo recomendado (${Number(j.recommended_min_amount_in) / 1e8} ${de.symbol})` : '',
    dados: { memo: j.memo, inbound: j.inbound_address, router: j.router || null, expiry: j.expiry, minimo: j.recommended_min_amount_in }
  };
}

async function thorStatus(hash) {
  const h = String(hash).replace(/^0x/, '').toUpperCase();
  const j = await thorGet(`/thorchain/tx/status/${h}`);
  const st = j.stages || {};
  if (st.outbound_signed && st.outbound_signed.completed) return 'concluída';
  if (j.out_txs && j.out_txs.length && st.swap_finalised && st.swap_finalised.completed) return 'concluída';
  if (st.swap_status && st.swap_status.pending === false && st.swap_finalised && st.swap_finalised.completed) return 'enviando para você';
  if (st.inbound_observed && st.inbound_observed.completed) return 'trocando';
  return 'aguardando a rede';
}

// ---------------- LI.FI ----------------
const LIFI_CHAIN = { ethereum: 1, bsc: 56, polygon: 137, avalanche: 43114, solana: 1151111081099710 };
const NATIVO_EVM = '0x0000000000000000000000000000000000000000';
const NATIVO_SOL = '11111111111111111111111111111111';

function lifiToken(asset) {
  if (asset.native) return asset.network === 'solana' ? NATIVO_SOL : NATIVO_EVM;
  return asset.contract;
}

async function lifiCotar({ de, para, valorRaw, origem, destino, chave }) {
  if (!LIFI_CHAIN[de.network] || !LIFI_CHAIN[para.network]) throw new Error('par não disponível na LI.FI');
  const q = new URLSearchParams({
    fromChain: String(LIFI_CHAIN[de.network]), toChain: String(LIFI_CHAIN[para.network]),
    fromToken: lifiToken(de), toToken: lifiToken(para), fromAmount: String(valorRaw),
    fromAddress: origem, toAddress: destino, slippage: '0.005', integrator: 'wallet-trabalho'
  });
  const headers = chave ? { 'x-lifi-api-key': chave } : {};
  const j = await getJson(`${LIFI}/quote?${q}`, { headers });
  const e = j.estimate || {};
  return {
    recebe: Number(e.toAmount) / 10 ** (j.action && j.action.toToken ? j.action.toToken.decimals : para.decimals || 18),
    tempo: e.executionDuration || null,
    ferramenta: (j.toolDetails && j.toolDetails.name) || j.tool,
    taxasUsd: (e.feeCosts || []).reduce((a, f) => a + Number(f.amountUSD || 0), 0) + (e.gasCosts || []).reduce((a, g) => a + Number(g.amountUSD || 0), 0),
    dados: { txReq: j.transactionRequest, aprovarPara: e.approvalAddress || null, fromChain: LIFI_CHAIN[de.network], toChain: LIFI_CHAIN[para.network] }
  };
}

async function lifiStatus(hash, fromChain, toChain) {
  const j = await getJson(`${LIFI}/status?txHash=${hash}&fromChain=${fromChain}&toChain=${toChain}`);
  if (j.status === 'DONE') return 'concluída';
  if (j.status === 'FAILED') return 'falhou';
  return 'trocando';
}

// ---------------- ChangeNOW ----------------
const CN_REDE = {
  ethereum: ['eth'], bsc: ['bsc'], polygon: ['matic', 'polygon', 'pol'], avalanche: ['avaxc', 'cchain', 'avax'],
  tron: ['trx', 'tron'], bitcoin: ['btc'], litecoin: ['ltc'], dogecoin: ['doge'], bitcoincash: ['bch'],
  solana: ['sol'], xrp: ['xrp'], ton: ['ton'], cardano: ['ada', 'cardano']
};
let cnMoedas = null;

async function cnLista(chave) {
  if (!cnMoedas) cnMoedas = await getJson(`${CHANGENOW}/exchange/currencies?active=true&flow=standard`, { headers: { 'x-changenow-api-key': chave } });
  return cnMoedas;
}

async function cnAchar(chave, asset) {
  const lista = await cnLista(chave);
  const redes = CN_REDE[asset.network] || [];
  const sym = asset.symbol.toLowerCase();
  const c = lista.find((x) => x.ticker === sym && redes.includes(String(x.network).toLowerCase()))
    || (asset.symbol === 'POL' ? lista.find((x) => ['pol', 'matic'].includes(x.ticker) && redes.includes(String(x.network).toLowerCase())) : null);
  if (!c) throw new Error(`${asset.symbol} na rede ${asset.network} não está na ChangeNOW`);
  return { ticker: c.ticker, network: c.network };
}

async function cnCotar({ de, para, valor, chave }) {
  if (!chave) throw new Error('precisa da chave da ChangeNOW (Configurações → Chaves de API)');
  const [a, b] = await Promise.all([cnAchar(chave, de), cnAchar(chave, para)]);
  const q = new URLSearchParams({ fromCurrency: a.ticker, toCurrency: b.ticker, fromNetwork: a.network, toNetwork: b.network, fromAmount: String(valor), flow: 'standard', type: 'direct' });
  const j = await getJson(`${CHANGENOW}/exchange/estimated-amount?${q}`, { headers: { 'x-changenow-api-key': chave } });
  if (j.toAmount == null) throw new Error(j.message || 'sem cotação');
  return { recebe: Number(j.toAmount), tempo: null, aviso: j.warningMessage || '', dados: { a, b } };
}

async function cnCriar({ chave, a, b, valor, destino, destinoExtra, reembolso }) {
  return getJson(`${CHANGENOW}/exchange`, {
    method: 'POST',
    headers: { 'x-changenow-api-key': chave, 'content-type': 'application/json' },
    body: JSON.stringify({
      fromCurrency: a.ticker, toCurrency: b.ticker, fromNetwork: a.network, toNetwork: b.network,
      fromAmount: String(valor), address: destino, extraId: destinoExtra || '', refundAddress: reembolso, flow: 'standard', type: 'direct'
    })
  });
}

async function cnStatus(chave, id) {
  const j = await getJson(`${CHANGENOW}/exchange/by-id?id=${id}`, { headers: { 'x-changenow-api-key': chave } });
  const mapa = { waiting: 'aguardando depósito', confirming: 'depósito detectado', exchanging: 'trocando', sending: 'enviando para você', finished: 'concluída', failed: 'falhou', refunded: 'devolvida', expired: 'expirada', verifying: 'em verificação' };
  return { status: mapa[j.status] || j.status, recebido: j.amountTo };
}

module.exports = { thorCotar, thorStatus, THOR_ATIVO, lifiCotar, lifiStatus, LIFI_CHAIN, cnCotar, cnCriar, cnStatus };
