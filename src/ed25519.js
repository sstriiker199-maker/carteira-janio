// Derivação SLIP-10 para chaves ed25519 (Solana, TON) a partir da semente BIP39
const crypto = require('crypto');

function hmac(key, data) {
  return crypto.createHmac('sha512', key).update(data).digest();
}

// caminho como "m/44'/501'/0'/0'" (só índices "hardened")
function derivar(seedHex, caminho) {
  const seed = Buffer.from(seedHex.replace(/^0x/, ''), 'hex');
  let I = hmac(Buffer.from('ed25519 seed'), seed);
  let k = I.subarray(0, 32);
  let c = I.subarray(32);
  for (const parte of caminho.split('/').slice(1)) {
    const n = (parseInt(parte, 10) | 0x80000000) >>> 0;
    const idx = Buffer.alloc(4);
    idx.writeUInt32BE(n);
    I = hmac(c, Buffer.concat([Buffer.alloc(1, 0), k, idx]));
    k = I.subarray(0, 32);
    c = I.subarray(32);
  }
  return Buffer.from(k);
}

module.exports = { derivar };
