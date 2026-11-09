// Endereços Tron: são o mesmo tipo de chave do Ethereum, com prefixo 0x41 e formato Base58Check.
const crypto = require('crypto');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function base58encode(buf) {
  let n = BigInt('0x' + (buf.toString('hex') || '0'));
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

function base58decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let lead = 0;
  for (const ch of str) {
    if (ch !== '1') break;
    lead++;
  }
  return Buffer.concat([Buffer.alloc(lead), Buffer.from(n === 0n ? '' : hex, 'hex')]);
}

// Converte um endereço 0x... (20 bytes) para o formato Tron (T...)
function tronFromEvm(evmAddress) {
  const payload = Buffer.from('41' + evmAddress.slice(2).toLowerCase(), 'hex');
  const check = sha256(sha256(payload)).subarray(0, 4);
  return base58encode(Buffer.concat([payload, check]));
}

function isTronAddress(addr) {
  if (typeof addr !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return false;
  const raw = base58decode(addr);
  if (!raw || raw.length !== 25 || raw[0] !== 0x41) return false;
  const payload = raw.subarray(0, 21);
  const check = sha256(sha256(payload)).subarray(0, 4);
  return check.equals(raw.subarray(21));
}

module.exports = { tronFromEvm, isTronAddress };
