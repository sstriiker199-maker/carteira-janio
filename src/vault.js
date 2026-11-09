// Criptografa a frase secreta com a senha do usuário (scrypt + AES-256-GCM).
const crypto = require('crypto');

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), salt, 32, SCRYPT);
}

function encrypt(text, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return {
    v: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ct: ct.toString('hex')
  };
}

function decrypt(box, password) {
  try {
    const key = deriveKey(password, Buffer.from(box.salt, 'hex'));
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'hex'));
    d.setAuthTag(Buffer.from(box.tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(box.ct, 'hex')), d.final()]).toString('utf8');
  } catch {
    throw new Error('Senha incorreta.');
  }
}

module.exports = { encrypt, decrypt };
