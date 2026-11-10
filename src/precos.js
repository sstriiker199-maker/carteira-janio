// Preços em dólar ao vivo.
// - Binance (dados públicos, sem limite prático): preço e variação 24h, a cada ~3 s
// - CoinGecko (gratuito): moedas que não estão na Binance, lista do "Mercado"
const BINANCE = 'https://data-api.binance.vision/api/v3/ticker/24hr';

const PARES = {
  ETH: 'ETHUSDT', BNB: 'BNBUSDT', POL: 'POLUSDT', AVAX: 'AVAXUSDT', TRX: 'TRXUSDT', USDC: 'USDCUSDT',
  SHIB: 'SHIBUSDT', PEPE: 'PEPEUSDT', BTC: 'BTCUSDT', LTC: 'LTCUSDT', DOGE: 'DOGEUSDT', BCH: 'BCHUSDT',
  SOL: 'SOLUSDT', BONK: 'BONKUSDT', XRP: 'XRPUSDT', ADA: 'ADAUSDT', TON: 'TONUSDT'
};
const GECKO = {
  ETH: 'ethereum', BNB: 'binancecoin', POL: 'polygon-ecosystem-token', AVAX: 'avalanche-2', TRX: 'tron',
  USDT: 'tether', USDC: 'usd-coin', SHIB: 'shiba-inu', PEPE: 'pepe', LBLOCK: 'lucky-block',
  BTC: 'bitcoin', LTC: 'litecoin', DOGE: 'dogecoin', BCH: 'bitcoin-cash', SOL: 'solana', BONK: 'bonk',
  XRP: 'ripple', ADA: 'cardano', TON: 'the-open-network'
};

const cache = { USDT: { usd: 1, var24h: 0 } }; // símbolo -> { usd, var24h }
let dolarReal = null; // { brl, var24h }
let euroDolar = null; // 1 EUR em US$
let mercado = [];
let ultBinance = 0;
let ultGecko = 0;
let ultMercado = 0;

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function daBinance() {
  const pares = [...Object.values(PARES), 'USDTBRL', 'EURUSDT'];
  const lista = await getJson(`${BINANCE}?symbols=${encodeURIComponent(JSON.stringify(pares))}`);
  const porPar = Object.fromEntries(lista.map((t) => [t.symbol, t]));
  for (const [sym, par] of Object.entries(PARES)) {
    const t = porPar[par];
    if (t) cache[sym] = { usd: Number(t.lastPrice), var24h: Number(t.priceChangePercent), fonte: 'binance' };
  }
  const brl = porPar.USDTBRL;
  if (brl) dolarReal = { brl: Number(brl.lastPrice), var24h: Number(brl.priceChangePercent) };
  const eur = porPar.EURUSDT;
  if (eur) euroDolar = Number(eur.lastPrice);
}

async function doGecko(somenteFaltando) {
  const syms = Object.keys(GECKO).filter((s) => !somenteFaltando || !cache[s] || cache[s].fonte !== 'binance');
  if (!syms.length) return;
  const ids = [...new Set(syms.map((s) => GECKO[s]))].join(',');
  const j = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
  for (const s of syms) {
    const d = j[GECKO[s]];
    if (d && typeof d.usd === 'number') cache[s] = { usd: d.usd, var24h: d.usd_24h_change || 0, fonte: 'gecko' };
  }
}

async function atualizar() {
  const agora = Date.now();
  if (agora - ultBinance > 2500) {
    ultBinance = agora;
    let binanceOk = true;
    try { await daBinance(); } catch { binanceOk = false; }
    if (agora - ultGecko > 60000 || (!binanceOk && agora - ultGecko > 20000)) {
      ultGecko = agora;
      await doGecko(binanceOk).catch(() => {});
    }
  }
  return cache;
}

async function atualizarMercado() {
  if (Date.now() - ultMercado < 30000 && mercado.length) return mercado;
  ultMercado = Date.now();
  const j = await getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1&price_change_percentage=24h');
  mercado = j.map((c) => ({
    rank: c.market_cap_rank, symbol: String(c.symbol).toUpperCase(), name: c.name, image: c.image,
    usd: c.current_price, var24h: c.price_change_percentage_24h, marketCap: c.market_cap, volume: c.total_volume
  }));
  return mercado;
}

// Para a aba Mercado: mistura a lista do CoinGecko com o preço ao vivo da Binance
function mercadoAoVivo() {
  return mercado.map((m) => {
    const vivo = cache[m.symbol];
    return vivo && vivo.fonte === 'binance' ? { ...m, usd: vivo.usd, var24h: vivo.var24h } : m;
  });
}

const preco = (symbol) => (cache[symbol] ? cache[symbol].usd : undefined);
const variacao = (symbol) => (cache[symbol] ? cache[symbol].var24h : undefined);
const dolar = () => dolarReal;
const euro = () => euroDolar;

module.exports = { atualizar, atualizarMercado, mercadoAoVivo, preco, variacao, dolar, euro };
