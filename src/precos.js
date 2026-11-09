// Preços em dólar (CoinGecko, gratuito), atualizados no máximo 1 vez por minuto
const IDS = {
  ETH: 'ethereum', BNB: 'binancecoin', POL: 'polygon-ecosystem-token', AVAX: 'avalanche-2', TRX: 'tron',
  USDT: 'tether', USDC: 'usd-coin', SHIB: 'shiba-inu', PEPE: 'pepe', LBLOCK: 'lucky-block',
  BTC: 'bitcoin', LTC: 'litecoin', DOGE: 'dogecoin', BCH: 'bitcoin-cash', SOL: 'solana', BONK: 'bonk',
  XRP: 'ripple', ADA: 'cardano', TON: 'the-open-network'
};

const cache = {};
let ultimo = 0;

async function atualizar() {
  if (Date.now() - ultimo < 55000) return cache;
  ultimo = Date.now();
  const ids = [...new Set(Object.values(IDS))].join(',');
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error('Preços indisponíveis (' + r.status + ')');
  const j = await r.json();
  for (const [sym, id] of Object.entries(IDS)) {
    if (j[id] && typeof j[id].usd === 'number') cache[sym] = j[id].usd;
  }
  return cache;
}

function preco(symbol) {
  return cache[symbol];
}

module.exports = { atualizar, preco };
