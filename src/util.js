const { parseUnits, formatUnits } = require('ethers');

// Converte "1,5" ou "1.5" para o valor inteiro da moeda (wei, sun etc.)
function parseAmount(text, decimals) {
  const s = String(text || '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Digite um valor válido (ex.: 10 ou 0,5).');
  const frac = s.split('.')[1] || '';
  if (frac.length > decimals) throw new Error(`Essa moeda aceita no máximo ${decimals} casas decimais.`);
  const v = parseUnits(s, decimals);
  if (v <= 0n) throw new Error('O valor precisa ser maior que zero.');
  return v;
}

// Formata para exibição: até 8 casas decimais, sem zeros sobrando
function fmt(raw, decimals, maxDec = 8) {
  const full = formatUnits(raw, decimals);
  let [i, f = ''] = full.split('.');
  f = f.slice(0, maxDec).replace(/0+$/, '');
  if (!f && raw > 0n && i === '0') return '< 0.' + '0'.repeat(maxDec - 1) + '1';
  return f ? `${i}.${f}` : i;
}

module.exports = { parseAmount, fmt };
