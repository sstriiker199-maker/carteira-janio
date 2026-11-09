// Copia os ícones das moedas (pacote cryptocurrency-icons) para renderer/icons
const fs = require('fs');
const path = require('path');

const SIMBOLOS = ['eth', 'bnb', 'matic', 'avax', 'trx', 'usdt', 'usdc', 'shib', 'pepe', 'btc', 'ltc', 'doge', 'bch', 'sol', 'xrp', 'ada', 'ton', 'bonk'];
const destino = path.join(__dirname, '..', 'renderer', 'icons');

let origem;
try {
  origem = path.join(path.dirname(require.resolve('cryptocurrency-icons/package.json')), 'svg', 'color');
} catch {
  console.log('cryptocurrency-icons não instalado; ícones serão letras.');
  process.exit(0);
}

fs.mkdirSync(destino, { recursive: true });
const copiados = [];
for (const s of SIMBOLOS) {
  const f = path.join(origem, s + '.svg');
  if (fs.existsSync(f)) {
    fs.copyFileSync(f, path.join(destino, s + '.svg'));
    copiados.push(s);
  }
}
console.log('Ícones copiados: ' + copiados.join(', '));
