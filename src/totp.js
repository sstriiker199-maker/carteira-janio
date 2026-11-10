// Autenticador (códigos de 6 dígitos que mudam a cada 30 s — padrão TOTP, igual ao Google Authenticator)
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(txt) {
  const s = String(txt || '').toUpperCase().replace(/[\s=-]/g, '');
  if (!s || /[^A-Z2-7]/.test(s)) throw new Error('Chave inválida: use só letras A–Z e números 2–7 (como o site mostra).');
  let bits = 0;
  let valor = 0;
  const out = [];
  for (const ch of s) {
    valor = (valor << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function base32Encode(buf) {
  let bits = 0;
  let valor = 0;
  let out = '';
  for (const b of buf) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(valor << (5 - bits)) & 31];
  return out;
}

const ALGOS = { SHA1: 'sha1', SHA256: 'sha256', SHA512: 'sha512' };

function hotp(segredo, contador, digitos = 6, algo = 'SHA1') {
  const chave = base32Decode(segredo);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = crypto.createHmac(ALGOS[algo] || 'sha1', chave).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digitos).padStart(digitos, '0');
}

// código de agora + quantos segundos faltam para trocar
function codigo(conta, agora = Date.now()) {
  const periodo = conta.periodo || 30;
  const t = Math.floor(agora / 1000);
  return {
    codigo: hotp(conta.segredo, Math.floor(t / periodo), conta.digitos || 6, conta.algo || 'SHA1'),
    proximo: hotp(conta.segredo, Math.floor(t / periodo) + 1, conta.digitos || 6, conta.algo || 'SHA1'),
    resta: periodo - (t % periodo), periodo
  };
}

// valida e normaliza uma conta
function normalizar(c) {
  const segredo = String(c.segredo || '').toUpperCase().replace(/[\s=-]/g, '');
  base32Decode(segredo); // lança erro se for inválida
  const digitos = [6, 7, 8].includes(Number(c.digitos)) ? Number(c.digitos) : 6;
  const algo = ALGOS[String(c.algo || 'SHA1').toUpperCase()] ? String(c.algo || 'SHA1').toUpperCase() : 'SHA1';
  const periodo = Number(c.periodo) > 0 && Number(c.periodo) <= 300 ? Number(c.periodo) : 30;
  const emissor = String(c.emissor || '').trim().slice(0, 80);
  let nome = String(c.nome || '').trim().slice(0, 120);
  if (!nome && !emissor) nome = 'Conta';
  return { segredo, digitos, algo, periodo, emissor, nome };
}

// otpauth://totp/Emissor:usuario?secret=...&issuer=...
function lerUri(uri) {
  const u = new URL(String(uri).trim());
  if (u.protocol !== 'otpauth:') throw new Error('Não é um código de autenticador (otpauth://).');
  if (u.hostname.toLowerCase() === 'hotp') throw new Error('Esta conta usa contador (HOTP), que o autenticador não suporta. Só códigos por tempo (TOTP).');
  const rotulo = decodeURIComponent(u.pathname.replace(/^\//, ''));
  let emissor = u.searchParams.get('issuer') || '';
  let nome = rotulo;
  if (rotulo.includes(':')) { const [a, ...b] = rotulo.split(':'); if (!emissor) emissor = a; nome = b.join(':'); }
  return normalizar({
    segredo: u.searchParams.get('secret'), emissor, nome: nome.trim(),
    digitos: u.searchParams.get('digits'), algo: u.searchParams.get('algorithm'), periodo: u.searchParams.get('period')
  });
}

function criarUri(c) {
  const rot = encodeURIComponent(c.emissor ? `${c.emissor}:${c.nome}` : c.nome);
  const q = new URLSearchParams({ secret: c.segredo, digits: String(c.digitos || 6), algorithm: c.algo || 'SHA1', period: String(c.periodo || 30) });
  if (c.emissor) q.set('issuer', c.emissor);
  return `otpauth://totp/${rot}?${q}`;
}

// ---- Exportação do Google Authenticator: otpauth-migration://offline?data=... (protobuf) ----
function lerVarint(b, p) {
  let r = 0n;
  let s = 0n;
  for (;;) {
    if (p.i >= b.length) throw new Error('dados cortados');
    const x = b[p.i++];
    r |= BigInt(x & 0x7f) << s;
    if (!(x & 0x80)) return r;
    s += 7n;
  }
}
function campos(b) {
  const p = { i: 0 };
  const out = [];
  while (p.i < b.length) {
    const tag = Number(lerVarint(b, p));
    const num = tag >> 3;
    const tipo = tag & 7;
    if (tipo === 0) out.push({ num, v: lerVarint(b, p) });
    else if (tipo === 2) { const n = Number(lerVarint(b, p)); out.push({ num, v: b.subarray(p.i, p.i + n) }); p.i += n; }
    else if (tipo === 1) { out.push({ num, v: b.subarray(p.i, p.i + 8) }); p.i += 8; }
    else if (tipo === 5) { out.push({ num, v: b.subarray(p.i, p.i + 4) }); p.i += 4; }
    else throw new Error('formato desconhecido');
  }
  return out;
}

function lerMigracao(uri) {
  const u = new URL(String(uri).trim());
  if (u.protocol !== 'otpauth-migration:') throw new Error('Não é uma exportação do Google Authenticator.');
  const dados = u.searchParams.get('data');
  if (!dados) throw new Error('A exportação não tem dados.');
  const buf = Buffer.from(dados.replace(/ /g, '+'), 'base64');
  const contas = [];
  const pulados = [];
  let lote = { indice: 0, total: 1, id: null };
  for (const f of campos(buf)) {
    if (f.num === 1) {
      const c = { segredo: null, nome: '', emissor: '', algo: 'SHA1', digitos: 6, tipo: 2 };
      for (const g of campos(f.v)) {
        if (g.num === 1) c.segredo = base32Encode(g.v);
        else if (g.num === 2) c.nome = g.v.toString('utf8');
        else if (g.num === 3) c.emissor = g.v.toString('utf8');
        else if (g.num === 4) c.algo = { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' }[Number(g.v)] || 'SHA1';
        else if (g.num === 5) c.digitos = Number(g.v) === 2 ? 8 : 6;
        else if (g.num === 6) c.tipo = Number(g.v);
      }
      let nome = c.nome;
      if (c.emissor && nome.startsWith(c.emissor + ':')) nome = nome.slice(c.emissor.length + 1);
      if (c.tipo === 1) { pulados.push(c.emissor || nome); continue; } // HOTP (contador): não suportado
      contas.push(normalizar({ ...c, nome }));
    } else if (f.num === 3) lote.total = Number(f.v);
    else if (f.num === 4) lote.indice = Number(f.v);
    else if (f.num === 5) lote.id = Number(f.v);
  }
  return { contas, pulados, lote };
}

module.exports = { codigo, normalizar, lerUri, criarUri, lerMigracao, hotp, base32Decode, base32Encode };
