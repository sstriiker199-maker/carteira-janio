// Troca entre moedas e redes pela SideShift.ai (sem cadastro manual)
const BASE = 'https://sideshift.ai/api/v2';

// rede do programa -> nome da rede na SideShift
const REDE = {
  ethereum: 'ethereum', bsc: 'bsc', polygon: 'polygon', avalanche: 'avax', tron: 'tron', bitcoin: 'bitcoin',
  litecoin: 'litecoin', dogecoin: 'doge', bitcoincash: 'bitcoincash', solana: 'solana', xrp: 'ripple',
  ton: 'ton', cardano: 'cardano', arbitrum: 'arbitrum', base: 'base', optimism: 'optimism'
};

async function req(caminho, { method = 'GET', body, secret } = {}) {
  const headers = { accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  if (secret) headers['x-sideshift-secret'] = secret;
  const r = await fetch(BASE + caminho, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = { error: { message: t.slice(0, 200) } }; }
  if (!r.ok) {
    const msg = (j.error && j.error.message) || `erro ${r.status}`;
    throw new Error('Serviço de troca: ' + traduzir(msg));
  }
  return j;
}

function traduzir(m) {
  if (/below the minimum|too low|minimum/i.test(m)) return 'valor abaixo do mínimo permitido para essa troca. ' + m;
  if (/above the maximum|too high|maximum/i.test(m)) return 'valor acima do máximo permitido para essa troca. ' + m;
  if (/not available|unavailable|offline/i.test(m)) return 'essa troca está indisponível no momento. ' + m;
  return m;
}

let coinsCache = null;
async function moedas() {
  if (!coinsCache) coinsCache = await req('/coins');
  return coinsCache;
}

async function suportado(symbol, redeId) {
  const net = REDE[redeId];
  const lista = await moedas();
  const c = lista.find((x) => String(x.coin).toUpperCase() === symbol.toUpperCase());
  if (!c || !net || !c.networks.includes(net)) return null;
  return { coin: c.coin, network: net };
}

const permissoes = () => req('/permissions');
const criarConta = () => req('/create-account', { method: 'POST', body: {} });

function cotar({ secret, affiliateId, de, para, valor }) {
  return req('/quotes', {
    method: 'POST', secret,
    body: { depositCoin: de.coin, depositNetwork: de.network, settleCoin: para.coin, settleNetwork: para.network, depositAmount: String(valor), affiliateId }
  });
}

function criarTroca({ secret, affiliateId, quoteId, settleAddress, refundAddress }) {
  return req('/shifts/fixed', { method: 'POST', secret, body: { quoteId, settleAddress, refundAddress, affiliateId } });
}

const status = (id) => req('/shifts/' + id);

module.exports = { moedasLista: moedas, REDE, suportado, permissoes, criarConta, cotar, criarTroca, status };
