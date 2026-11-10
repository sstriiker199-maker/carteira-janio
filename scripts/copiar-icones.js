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

// Fontes do visual (ficam dentro do programa; sem internet)
const FONTES = {
  'inter-400': ['@fontsource/inter', 'inter-latin-400-normal.woff2'],
  'inter-500': ['@fontsource/inter', 'inter-latin-500-normal.woff2'],
  'inter-600': ['@fontsource/inter', 'inter-latin-600-normal.woff2'],
  'outfit-200': ['@fontsource/outfit', 'outfit-latin-200-normal.woff2'],
  'outfit-300': ['@fontsource/outfit', 'outfit-latin-300-normal.woff2'],
  'outfit-400': ['@fontsource/outfit', 'outfit-latin-400-normal.woff2'],
  'outfit-500': ['@fontsource/outfit', 'outfit-latin-500-normal.woff2'],
  'jetbrains-400': ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2']
};
const pastaFontes = path.join(__dirname, '..', 'renderer', 'fonts');
fs.mkdirSync(pastaFontes, { recursive: true });
const fontesOk = [];
for (const [nome, [pacote, arquivo]] of Object.entries(FONTES)) {
  try {
    const f = path.join(path.dirname(require.resolve(pacote + '/package.json')), 'files', arquivo);
    fs.copyFileSync(f, path.join(pastaFontes, nome + '.woff2'));
    fontesOk.push(nome);
  } catch (e) { console.log('Sem fonte ' + nome + ': ' + e.message); }
}
console.log('Fontes copiadas: ' + fontesOk.join(', '));

// Tokens que não estão no pacote: logo oficial do repositório público da Trust Wallet
const TOKENS = {
  shib: 'ethereum/assets/0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
  pepe: 'ethereum/assets/0x6982508145454Ce325dDbE47a25d4ec3d2311933',
  lblock: 'ethereum/assets/0x2b867efD2dE4Ad2B583Ca0CB3dF9C4040Ef4D329',
  bonk: 'solana/assets/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  pol: 'polygon/info',
  ton: 'ton/info'
};
(async () => {
  for (const [nome, caminho] of Object.entries(TOKENS)) {
    if (fs.existsSync(path.join(destino, nome + '.svg'))) continue;
    try {
      const r = await fetch(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${caminho}/logo.png`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      fs.writeFileSync(path.join(destino, nome + '.png'), Buffer.from(await r.arrayBuffer()));
      console.log('Logo baixado: ' + nome);
    } catch (e) {
      console.log('Sem logo para ' + nome + ': ' + e.message);
    }
  }
})();
