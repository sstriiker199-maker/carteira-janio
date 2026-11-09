// Avisos: notificação do Windows e e-mail pelo Gmail
const { Notification, safeStorage } = require('electron');
const nodemailer = require('nodemailer');

function cifrar(texto) {
  if (!texto) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(texto).toString('base64');
  return 'b64:' + Buffer.from(texto).toString('base64');
}

function decifrar(valor) {
  if (!valor) return '';
  if (valor.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(valor.slice(4), 'base64'));
  if (valor.startsWith('b64:')) return Buffer.from(valor.slice(4), 'base64').toString();
  return '';
}

async function enviarEmail(email, assunto, texto) {
  const usuario = String(email.usuario || '').trim();
  const senha = String(email.senha || '').replace(/\s+/g, '');
  if (!usuario || !senha) throw new Error('Preencha o Gmail e a senha de app.');
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user: usuario, pass: senha } });
  try {
    await t.sendMail({
      from: `Wallet - Trabalho <${usuario}>`,
      to: String(email.destino || '').trim() || usuario,
      subject: assunto,
      text: texto
    });
  } catch (e) {
    if (/Invalid login|Username and Password not accepted|535/i.test(e.message)) {
      throw new Error('O Gmail recusou o login. Confira o e-mail e use uma "senha de app" (não a senha normal do Gmail).');
    }
    throw e;
  }
}

// tipo: 'entradas' ou 'envios'
function avisar({ cfg, tipo, titulo, corpo, aoClicar, log }) {
  if (cfg.notificar[tipo] && Notification.isSupported()) {
    const n = new Notification({ title: titulo, body: corpo, icon: require('path').join(__dirname, '..', 'renderer', 'app-icon.png') });
    if (aoClicar) n.on('click', aoClicar);
    n.show();
  }
  if (cfg.email.ativo && cfg.email[tipo]) {
    const email = { ...cfg.email, senha: decifrar(cfg.email.senhaCifrada) };
    enviarEmail(email, `[Wallet - Trabalho] ${titulo}`, `${titulo}\n${corpo}\n\n${new Date().toLocaleString('pt-BR')}`)
      .catch((e) => log && log('[email] ' + e.message));
  }
}

module.exports = { cifrar, decifrar, enviarEmail, avisar };
