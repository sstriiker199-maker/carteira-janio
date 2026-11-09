const $ = (id) => document.getElementById(id);
const rpc = (ch, arg) => window.api.call(ch, arg);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let modoFrase = 'criar'; // 'criar' | 'importar'
let fraseNova = '';
let carteiras = [];
let atual = null; // índice da carteira aberta
let moedas = [];
let saldos = {}; // assetId -> { balance, zero, erro }

function mostrar(tela) {
  for (const t of document.querySelectorAll('.tela')) t.classList.add('hidden');
  $(tela).classList.remove('hidden');
}

function aviso(msg) {
  const a = $('aviso');
  a.textContent = msg;
  a.classList.remove('hidden');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => a.classList.add('hidden'), 2500);
}

function abrirModal(html) {
  $('modal').innerHTML = html;
  $('modal-fundo').classList.remove('hidden');
}
function fecharModal() {
  $('modal-fundo').classList.add('hidden');
  $('modal').innerHTML = '';
}

// ---------- Início ----------
async function iniciar() {
  const s = await rpc('state');
  if (!s.exists) return mostrar('tela-inicio');
  if (!s.unlocked) {
    mostrar('tela-desbloquear');
    $('senha-entrar').focus();
    return;
  }
  await abrirPrincipal();
}

$('btn-criar').onclick = async () => {
  modoFrase = 'criar';
  fraseNova = await rpc('newPhrase');
  $('frase-titulo').textContent = 'Sua frase secreta';
  $('frase-palavras').innerHTML = fraseNova.split(' ').map((w) => `<li>${esc(w)}</li>`).join('');
  $('frase-mostrar').classList.remove('hidden');
  $('frase-digitar').classList.add('hidden');
  $('frase-ok').checked = false;
  $('frase-erro').textContent = '';
  mostrar('tela-frase');
};

$('btn-importar').onclick = () => {
  modoFrase = 'importar';
  $('frase-titulo').textContent = 'Importar frase secreta';
  $('frase-mostrar').classList.add('hidden');
  $('frase-digitar').classList.remove('hidden');
  $('frase-input').value = '';
  $('frase-erro').textContent = '';
  mostrar('tela-frase');
};

$('frase-voltar').onclick = () => mostrar('tela-inicio');

$('frase-continuar').onclick = async () => {
  const erro = $('frase-erro');
  erro.textContent = '';
  if (modoFrase === 'criar' && !$('frase-ok').checked) return (erro.textContent = 'Marque que você anotou as 12 palavras.');
  if ($('senha1').value !== $('senha2').value) return (erro.textContent = 'As senhas não são iguais.');
  try {
    await rpc('create', {
      phrase: modoFrase === 'criar' ? fraseNova : $('frase-input').value,
      password: $('senha1').value,
      firstName: $('primeiro-nome').value
    });
    fraseNova = '';
    $('senha1').value = $('senha2').value = '';
    await abrirPrincipal();
  } catch (e) {
    erro.textContent = e.message;
  }
};

async function entrar() {
  $('entrar-erro').textContent = '';
  $('btn-entrar').disabled = true;
  try {
    await rpc('unlock', { password: $('senha-entrar').value });
    $('senha-entrar').value = '';
    await abrirPrincipal();
  } catch (e) {
    $('entrar-erro').textContent = e.message;
  } finally {
    $('btn-entrar').disabled = false;
  }
}
$('btn-entrar').onclick = entrar;
$('senha-entrar').onkeydown = (e) => { if (e.key === 'Enter') entrar(); };

// ---------- Tela principal ----------
async function abrirPrincipal() {
  mostrar('tela-principal');
  moedas = await rpc('assets');
  await carregarCarteiras();
  if (atual == null || !carteiras.some((c) => c.index === atual)) atual = carteiras[0].index;
  selecionar(atual);
}

async function carregarCarteiras() {
  carteiras = await rpc('wallets');
  $('lista-carteiras').innerHTML = carteiras.map((c) => `
    <li data-i="${c.index}" class="${c.index === atual ? 'ativa' : ''}">
      ${esc(c.name)}<small>${esc(c.evmAddress.slice(0, 8))}…${esc(c.evmAddress.slice(-6))}</small>
    </li>`).join('');
  for (const li of $('lista-carteiras').querySelectorAll('li')) li.onclick = () => selecionar(Number(li.dataset.i));
}

function carteiraAtual() {
  return carteiras.find((c) => c.index === atual);
}

function selecionar(index) {
  atual = index;
  for (const li of $('lista-carteiras').querySelectorAll('li')) li.classList.toggle('ativa', Number(li.dataset.i) === index);
  const c = carteiraAtual();
  $('nome-carteira').textContent = c.name;
  $('end-evm').textContent = c.evmAddress;
  $('end-tron').textContent = c.tronAddress;
  saldos = {};
  $('hora-saldo').textContent = '';
  desenharTabela();
  rpc('monitorFoco', { index }).catch(() => {});
}

// ---------- Tabela: uma linha por moeda, com escolha da rede ----------
const ICONES = { POL: 'matic' };
const CORES = { LBLOCK: '#d4a017', PEPE: '#3d9a3d' };
let redeEscolhida = {}; // símbolo -> assetId escolhido
const escolhaManual = new Set();

function grupos() {
  const g = [];
  for (const m of moedas) {
    let x = g.find((y) => y.symbol === m.symbol);
    if (!x) { x = { symbol: m.symbol, name: m.name, itens: [] }; g.push(x); }
    x.itens.push(m);
  }
  return g;
}

function valorNum(sld) {
  if (!sld || sld.erro || sld.zero) return 0;
  if (String(sld.balance).startsWith('<')) return 1e-12;
  return parseFloat(sld.balance) || 0;
}

function escolhida(g) {
  if (!escolhaManual.has(g.symbol)) {
    let melhor = redeEscolhida[g.symbol] || g.itens[0].id;
    let max = valorNum(saldos[melhor]);
    for (const m of g.itens) { const v = valorNum(saldos[m.id]); if (v > max) { max = v; melhor = m.id; } }
    redeEscolhida[g.symbol] = melhor;
  }
  return redeEscolhida[g.symbol] || g.itens[0].id;
}

function textoSaldo(sld, simbolo) {
  if (!sld) return 'carregando…';
  if (sld.erro) return 'erro';
  return `${sld.balance} ${simbolo}`;
}

function desenharTabela() {
  const gs = grupos();
  $('tabela-moedas').innerHTML = gs.map((g) => `
    <tr data-grupo="${esc(g.symbol)}">
      <td class="nome-moeda">
        <img class="icone" data-icone="${esc(g.symbol)}" src="icons/${esc((ICONES[g.symbol] || g.symbol).toLowerCase())}.svg" alt="">
        <b>${esc(g.symbol)}</b><span>${esc(g.name)}</span>
      </td>
      <td>${g.itens.length > 1
        ? `<select class="sel-rede" data-rede="${esc(g.symbol)}">${g.itens.map((m) => `<option value="${m.id}">${esc(m.rotulo)}</option>`).join('')}</select>`
        : `<span class="tag">${esc(g.itens[0].rotulo || g.itens[0].networkName)}</span>`}</td>
      <td class="saldo" data-saldo="${esc(g.symbol)}"></td>
      <td class="botoes">
        <button data-receber-g="${esc(g.symbol)}">Receber</button>
        <button data-enviar-g="${esc(g.symbol)}" class="primario">Enviar</button>
      </td>
    </tr>`).join('') + '<tr id="linha-vazia" class="hidden"><td colspan="4" class="cinza">Nenhuma moeda com saldo nesta carteira.</td></tr>';

  for (const img of document.querySelectorAll('img.icone')) {
    img.addEventListener('error', () => {
      const sim = img.dataset.icone;
      const span = document.createElement('span');
      span.className = 'icone letra';
      span.textContent = sim.slice(0, 1);
      span.style.background = CORES[sim] || '#4b5568';
      img.replaceWith(span);
    }, { once: true });
  }
  for (const sel of document.querySelectorAll('[data-rede]')) {
    sel.onchange = () => { redeEscolhida[sel.dataset.rede] = sel.value; escolhaManual.add(sel.dataset.rede); atualizarCelulas(); };
  }
  const grupoDe = (sim) => gs.find((g) => g.symbol === sim);
  for (const b of document.querySelectorAll('[data-receber-g]')) b.onclick = () => receber(escolhida(grupoDe(b.dataset.receberG)));
  for (const b of document.querySelectorAll('[data-enviar-g]')) b.onclick = () => enviar(escolhida(grupoDe(b.dataset.enviarG)));
  atualizarCelulas();
}

function atualizarCelulas() {
  const so = $('so-com-saldo').checked;
  let visiveis = 0;
  for (const g of grupos()) {
    const id = escolhida(g);
    const sld = saldos[id];
    const cel = document.querySelector(`[data-saldo="${g.symbol}"]`);
    if (!cel) continue;
    cel.textContent = textoSaldo(sld, g.symbol);
    cel.classList.toggle('cinza', !sld);
    cel.classList.toggle('erro', !!(sld && sld.erro));
    cel.title = sld && sld.erro ? sld.erro : '';
    const sel = document.querySelector(`[data-rede="${g.symbol}"]`);
    if (sel) {
      if (sel.value !== id) sel.value = id;
      for (const op of sel.options) {
        const m = g.itens.find((x) => x.id === op.value);
        const s2 = saldos[op.value];
        op.textContent = s2 && !s2.erro && !s2.zero ? `${m.rotulo} — ${s2.balance}` : m.rotulo;
      }
    }
    const temSaldo = g.itens.some((m) => valorNum(saldos[m.id]) > 0);
    const linha = document.querySelector(`tr[data-grupo="${g.symbol}"]`);
    const mostrar = !so || temSaldo;
    linha.classList.toggle('hidden', !mostrar);
    if (mostrar) visiveis++;
  }
  $('linha-vazia').classList.toggle('hidden', visiveis > 0);
}

window.api.onSaldos((d) => {
  if (d.index !== atual) return;
  for (const x of d.saldos) {
    const antes = saldos[x.assetId];
    // num erro passageiro, mantém o último saldo bom
    saldos[x.assetId] = x.erro && antes && !antes.erro ? antes : x;
  }
  atualizarCelulas();
  $('hora-saldo').textContent = 'Atualizado às ' + new Date(d.quando).toLocaleTimeString('pt-BR');
});

$('btn-atualizar').onclick = () => rpc('monitorAgora').catch(() => {});
$('so-com-saldo').onchange = () => atualizarCelulas();

for (const b of document.querySelectorAll('[data-copiar]')) {
  b.onclick = async () => { await rpc('copy', { text: $(b.dataset.copiar).textContent }); aviso('Endereço copiado'); };
}

// ---------- Nova carteira / renomear ----------
$('btn-nova').onclick = () => {
  const sugestao = proximoNome();
  abrirModal(`
    <h2>Nova carteira</h2>
    <label>Nome</label>
    <input id="m-nome" value="${esc(sugestao)}">
    <p id="m-erro" class="erro"></p>
    <div class="linha"><button id="m-cancelar">Cancelar</button><button id="m-ok" class="primario">Criar</button></div>`);
  $('m-nome').select();
  $('m-cancelar').onclick = fecharModal;
  $('m-ok').onclick = async () => {
    try {
      const w = await rpc('addWallet', { name: $('m-nome').value });
      fecharModal();
      atual = w.index;
      await carregarCarteiras();
      selecionar(w.index);
      aviso('Carteira criada');
    } catch (e) { $('m-erro').textContent = e.message; }
  };
};

function proximoNome() {
  const ult = carteiras[carteiras.length - 1];
  const m = ult && ult.name.match(/^(.*?)(\d+)$/);
  if (m) {
    let n = Number(m[2]) + 1;
    while (carteiras.some((c) => c.name === m[1] + n)) n++;
    return m[1] + n;
  }
  return 'Carteira ' + (carteiras.length + 1);
}

$('btn-renomear').onclick = () => {
  abrirModal(`
    <h2>Renomear carteira</h2>
    <input id="m-nome" value="${esc(carteiraAtual().name)}">
    <p id="m-erro" class="erro"></p>
    <div class="linha"><button id="m-cancelar">Cancelar</button><button id="m-ok" class="primario">Salvar</button></div>`);
  $('m-cancelar').onclick = fecharModal;
  $('m-ok').onclick = async () => {
    try {
      await rpc('renameWallet', { index: atual, name: $('m-nome').value });
      fecharModal();
      await carregarCarteiras();
      selecionar(atual);
    } catch (e) { $('m-erro').textContent = e.message; }
  };
};

// ---------- Receber ----------
async function receber(assetId) {
  try {
    const r = await rpc('receive', { index: atual, assetId });
    abrirModal(`
      <h2>Receber ${esc(r.symbol)}</h2>
      <p class="alerta-rede">Envie <b>somente ${esc(r.symbol)} pela rede ${esc(r.networkName)}${r.standard && r.symbol !== 'TRX' ? ' (' + esc(r.standard) + ')' : ''}</b> para este endereço. Se mandarem por outra rede, o dinheiro pode ser perdido.</p>
      ${r.aviso ? `<p class="alerta">${esc(r.aviso)}</p>` : ''}
      <img class="qr" src="${r.qr}" width="240" height="240" alt="QR Code">
      <div class="end-grande"><code>${esc(r.address)}</code></div>
      <div class="linha"><button id="m-copiar" class="primario">Copiar endereço</button><button id="m-fechar">Fechar</button></div>`);
    $('m-copiar').onclick = async () => { await rpc('copy', { text: r.address }); aviso('Endereço copiado'); };
    $('m-fechar').onclick = fecharModal;
  } catch (e) { aviso(e.message); }
}

// ---------- Enviar ----------
function enviar(assetId) {
  const m = moedas.find((x) => x.id === assetId);
  const tron = m.network === 'tron';
  const outras = carteiras.filter((c) => c.index !== atual);
  const s = saldos[assetId];
  let usarMax = false;

  abrirModal(`
    <h2>Enviar ${esc(m.symbol)} <span class="tag">${esc(m.networkName)}</span></h2>
    <p class="sub">Saldo: ${s && !s.erro ? esc(s.balance) + ' ' + esc(m.symbol) : '—'}</p>
    ${m.aviso ? `<p class="alerta">${esc(m.aviso)}</p>` : ''}
    <label>Enviar para (endereço ${tron ? 'Tron, começa com T' : '0x…'})</label>
    <input id="e-para" spellcheck="false" placeholder="${tron ? 'T…' : '0x…'}">
    ${outras.length ? `<label>…ou escolha uma das suas carteiras</label>
    <select id="e-minhas"><option value="">— escolher —</option>${outras.map((c) => `<option value="${esc(tron ? c.tronAddress : c.evmAddress)}">${esc(c.name)}</option>`).join('')}</select>` : ''}
    <label>Quantidade de ${esc(m.symbol)}</label>
    <div class="campo-valor"><input id="e-valor" placeholder="0,00" inputmode="decimal"><button id="e-max">Máx</button></div>
    <p id="e-erro" class="erro"></p>
    <div id="e-resumo"></div>
    <div class="linha" id="e-botoes"><button id="e-cancelar">Cancelar</button><button id="e-calcular" class="primario">Revisar envio</button></div>`);

  const sel = $('e-minhas');
  if (sel) sel.onchange = () => { if (sel.value) $('e-para').value = sel.value; limparResumo(); };
  $('e-para').oninput = limparResumo;
  $('e-valor').oninput = () => { usarMax = false; $('e-max').classList.remove('primario'); limparResumo(); };
  $('e-max').onclick = () => {
    usarMax = !usarMax;
    $('e-max').classList.toggle('primario', usarMax);
    $('e-valor').value = usarMax ? 'TUDO (menos a taxa)' : '';
    limparResumo();
  };
  $('e-cancelar').onclick = fecharModal;

  function limparResumo() {
    $('e-resumo').innerHTML = '';
    $('e-erro').textContent = '';
    $('e-calcular').classList.remove('hidden');
    const c = $('e-confirmar');
    if (c) c.remove();
  }

  const dados = () => ({ index: atual, assetId, to: $('e-para').value.trim(), amount: usarMax ? '' : $('e-valor').value, max: usarMax });

  $('e-calcular').onclick = async () => {
    $('e-erro').textContent = '';
    $('e-calcular').disabled = true;
    $('e-calcular').textContent = 'Calculando…';
    try {
      const r = await rpc('estimate', dados());
      const destino = carteiras.find((c) => c.evmAddress.toLowerCase() === r.to.toLowerCase() || c.tronAddress === r.to);
      $('e-resumo').innerHTML = `<div class="resumo">
        <div><span class="rot">Valor:</span> <b>${esc(r.amount)} ${esc(r.symbol)}</b></div>
        <div><span class="rot">Rede:</span> ${esc(r.networkName)}</div>
        <div><span class="rot">Para:</span> <code>${esc(r.to)}</code>${destino ? ` <span class="tag">${esc(destino.name)}</span>` : ''}</div>
        <div><span class="rot">Taxa da rede:</span> ${esc(r.feeLabel)} ${esc(r.fee)} ${esc(r.feeSymbol)}</div>
      </div>
      <p class="sub">Confira o endereço. Envios em blockchain <b>não podem ser desfeitos</b>.</p>`;
      $('e-calcular').classList.add('hidden');
      const conf = document.createElement('button');
      conf.id = 'e-confirmar';
      conf.className = 'perigo';
      conf.textContent = 'Confirmar e enviar';
      $('e-botoes').appendChild(conf);
      conf.onclick = () => confirmar(conf);
    } catch (e) {
      $('e-erro').textContent = e.message;
    } finally {
      $('e-calcular').disabled = false;
      $('e-calcular').textContent = 'Revisar envio';
    }
  };

  async function confirmar(btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    $('e-cancelar').disabled = true;
    try {
      const r = await rpc('send', dados());
      abrirModal(`
        <h2 class="ok">Envio feito ✓</h2>
        <div class="resumo">
          <div><span class="rot">Valor:</span> <b>${esc(r.amount)} ${esc(r.symbol)}</b></div>
          <div><span class="rot">Rede:</span> ${esc(r.networkName)}</div>
          <div><span class="rot">Para:</span> <code>${esc(r.to)}</code></div>
          <div><span class="rot">Código (hash):</span> <code>${esc(r.hash)}</code></div>
        </div>
        <p class="sub">A rede pode levar de alguns segundos a alguns minutos para confirmar. Depois clique em "Atualizar saldos".</p>
        <div class="linha"><button id="m-explorer">Ver no explorador</button><button id="m-fechar" class="primario">Fechar</button></div>`);
      $('m-explorer').onclick = () => rpc('openExternal', { url: r.explorer });
      $('m-fechar').onclick = () => { fecharModal(); rpc('monitorAgora').catch(() => {}); };
    } catch (e) {
      $('e-erro').textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Confirmar e enviar';
      $('e-cancelar').disabled = false;
    }
  }
}

// ---------- Segurança ----------
function pedirSenha(titulo, explicacao, aoConfirmar) {
  abrirModal(`
    <h2>${esc(titulo)}</h2>
    <p class="alerta">${explicacao}</p>
    <label>Sua senha</label>
    <input id="m-senha" type="password">
    <p id="m-erro" class="erro"></p>
    <div id="m-resultado"></div>
    <div class="linha"><button id="m-fechar">Fechar</button><button id="m-ok" class="primario">Mostrar</button></div>`);
  $('m-senha').focus();
  $('m-fechar').onclick = fecharModal;
  $('m-ok').onclick = async () => {
    $('m-erro').textContent = '';
    try {
      $('m-resultado').innerHTML = await aoConfirmar($('m-senha').value);
      $('m-ok').classList.add('hidden');
    } catch (e) { $('m-erro').textContent = e.message; }
  };
}

$('btn-frase').onclick = () => pedirSenha('Frase secreta',
  'Nunca mostre estas palavras para ninguém. Quem tiver a frase controla <b>todas</b> as carteiras.',
  async (senha) => {
    const f = await rpc('revealPhrase', { password: senha });
    return `<ol class="palavras">${f.split(' ').map((w) => `<li>${esc(w)}</li>`).join('')}</ol>`;
  });

$('btn-exportar').onclick = () => pedirSenha(`Exportar chave – ${carteiraAtual().name}`,
  'A chave privada dá acesso total a esta carteira. Use só para importar em outro app seu (ex.: MetaMask ou TronLink).',
  async (senha) => {
    const k = await rpc('exportKey', { index: atual, password: senha });
    return `<label>Chave Ethereum / BNB / Polygon / Avalanche</label><div class="end-grande"><code>${esc(k.evm)}</code></div>
            <label>Chave Tron</label><div class="end-grande"><code>${esc(k.tron)}</code></div>`;
  });

$('btn-bloquear').onclick = async () => {
  await rpc('lock');
  carteiras = [];
  mostrar('tela-desbloquear');
  $('senha-entrar').focus();
};

// ---------- Configurações ----------
$('btn-config').onclick = async () => {
  const s = await rpc('getSettings');
  const chk = (id, v, txt) => `<label class="check"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${txt}</label>`;
  abrirModal(`
    <h2>Configurações</h2>

    <h3>Atualização dos saldos</h3>
    <label>Atualizar a carteira aberta a cada</label>
    <select id="c-intervalo">${[3, 5, 10, 30, 60].map((n) => `<option value="${n}" ${s.intervalo === n ? 'selected' : ''}>${n} segundos</option>`).join('')}</select>
    <p class="ajuda">As outras carteiras são conferidas a cada 1 minuto (para avisar quando chegar dinheiro).</p>

    <div class="secao">
      <h3>Notificações no computador</h3>
      ${chk('c-not-entradas', s.notificar.entradas, 'Avisar quando chegar moeda')}
      ${chk('c-not-envios', s.notificar.envios, 'Avisar sobre meus envios (processando / confirmado)')}
    </div>

    <div class="secao">
      <h3>Avisos por e-mail (Gmail)</h3>
      ${chk('c-email-ativo', s.email.ativo, 'Enviar avisos por e-mail')}
      <label>Seu Gmail (que vai enviar)</label>
      <input id="c-email-usuario" value="${esc(s.email.usuario)}" placeholder="voce@gmail.com" spellcheck="false">
      <label>Senha de app do Gmail ${s.email.temSenha ? '(já salva — deixe vazio para manter)' : ''}</label>
      <input id="c-email-senha" type="password" placeholder="16 letras, ex.: abcd efgh ijkl mnop">
      <p class="ajuda">Não é a senha normal. Crie em <b>myaccount.google.com/apppasswords</b> (precisa da verificação em duas etapas ligada).</p>
      <label>Mandar os avisos para (vazio = o mesmo Gmail)</label>
      <input id="c-email-destino" value="${esc(s.email.destino)}" spellcheck="false">
      ${chk('c-email-entradas', s.email.entradas, 'E-mail quando chegar moeda')}
      ${chk('c-email-envios', s.email.envios, 'E-mail sobre meus envios')}
      <button id="c-email-teste">Enviar e-mail de teste</button> <span id="c-email-res" class="cinza"></span>
    </div>

    <div class="secao">
      <h3>Servidores das redes</h3>
      <p class="ajuda">Deixe como está se tudo estiver funcionando.</p>
      ${Object.keys(s.rpc).map((id) => `
        <label>${esc(s.names[id])}</label>
        <input data-rpc="${id}" value="${esc(s.rpc[id])}" placeholder="${esc(s.defaults[id])}" spellcheck="false">`).join('')}
      <label>Chave da TronGrid (opcional, evita bloqueio por excesso de consultas)</label>
      <input id="c-tronkey" value="${esc(s.tronApiKey)}" spellcheck="false">
      <button id="c-padrao">Restaurar servidores padrão</button>
    </div>

    <p id="m-erro" class="erro"></p>
    <div class="linha"><button id="m-fechar">Cancelar</button><button id="m-ok" class="primario">Salvar</button></div>`);

  const emailForm = () => ({
    ativo: $('c-email-ativo').checked,
    usuario: $('c-email-usuario').value,
    senha: $('c-email-senha').value,
    destino: $('c-email-destino').value,
    entradas: $('c-email-entradas').checked,
    envios: $('c-email-envios').checked
  });
  $('m-fechar').onclick = fecharModal;
  $('c-padrao').onclick = () => { for (const i of document.querySelectorAll('[data-rpc]')) i.value = s.defaults[i.dataset.rpc]; };
  $('c-email-teste').onclick = async () => {
    $('c-email-res').textContent = 'Enviando…';
    try { await rpc('testarEmail', { email: emailForm() }); $('c-email-res').textContent = 'Enviado ✓ confira sua caixa de entrada'; }
    catch (e) { $('c-email-res').textContent = e.message; }
  };
  $('m-ok').onclick = async () => {
    const servidores = {};
    for (const i of document.querySelectorAll('[data-rpc]')) servidores[i.dataset.rpc] = i.value;
    try {
      await rpc('saveSettings', {
        rpc: servidores,
        tronApiKey: $('c-tronkey').value,
        intervalo: Number($('c-intervalo').value),
        notificar: { entradas: $('c-not-entradas').checked, envios: $('c-not-envios').checked },
        email: emailForm()
      });
      fecharModal();
      aviso('Configurações salvas');
    } catch (e) { $('m-erro').textContent = e.message; }
  };
};

// ---------- Atualizações ----------
let upd = null;
let updAberto = false;

function desenharUpd() {
  if (!upd) return;
  $('upd-badge').classList.toggle('hidden', !['disponivel', 'baixando', 'pronto'].includes(upd.status));
  if (!updAberto) return;
  let corpo = '';
  if (!upd.instalado) {
    corpo = '<p class="sub">Você está rodando em modo de teste. A atualização automática funciona no aplicativo instalado pelo arquivo <b>Setup</b>.</p>';
  } else if (upd.status === 'verificando') {
    corpo = '<p>Procurando atualizações…</p>';
  } else if (upd.status === 'atualizado') {
    corpo = '<p class="ok">Você já está na versão mais recente ✓</p>';
  } else if (upd.status === 'disponivel') {
    corpo = `<p>Nova versão disponível: <b>${esc(upd.versaoNova)}</b></p>
      ${upd.notas ? `<label>O que mudou</label><div class="notas">${esc(upd.notas)}</div>` : ''}
      <button id="u-baixar" class="primario largo">Baixar atualização</button>`;
  } else if (upd.status === 'baixando') {
    corpo = `<p>Baixando versão ${esc(upd.versaoNova || '')}… ${upd.progresso}%</p><div class="barra"><div id="u-barra"></div></div>`;
  } else if (upd.status === 'pronto') {
    corpo = `<p class="ok">Versão ${esc(upd.versaoNova)} baixada ✓</p>
      <p class="sub">O aplicativo vai fechar, instalar e abrir de novo. Suas carteiras não são afetadas.</p>
      <button id="u-instalar" class="primario largo">Instalar e reiniciar</button>`;
  } else if (upd.status === 'erro') {
    corpo = `<p class="erro">Não foi possível atualizar: ${esc(upd.erro)}</p>`;
  } else {
    corpo = '<p class="sub">Clique em "Procurar atualizações".</p>';
  }
  $('u-corpo').innerHTML = corpo;
  if ($('u-barra')) $('u-barra').style.width = upd.progresso + '%';
  if ($('u-baixar')) $('u-baixar').onclick = () => rpc('updDownload').catch((e) => aviso(e.message));
  if ($('u-instalar')) $('u-instalar').onclick = () => rpc('updInstall').catch((e) => aviso(e.message));
}

window.api.onUpdate((d) => { upd = { ...upd, ...d }; desenharUpd(); });
rpc('updState').then((d) => { upd = d; desenharUpd(); }).catch(() => {});

$('btn-atualizacoes').onclick = async () => {
  upd = await rpc('updState');
  abrirModal(`
    <h2>Atualizações</h2>
    <p class="sub">Versão instalada: <b>${esc(upd.versaoAtual)}</b></p>
    <div id="u-corpo"></div>
    <div class="linha"><button id="u-verificar">Procurar atualizações</button><button id="m-fechar" class="primario">Fechar</button></div>`);
  updAberto = true;
  desenharUpd();
  $('m-fechar').onclick = () => { updAberto = false; fecharModal(); };
  $('u-verificar').onclick = () => rpc('updCheck').catch((e) => { upd.status = 'erro'; upd.erro = e.message; desenharUpd(); });
};

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal-fundo').classList.contains('hidden')) fecharModal(); });

iniciar();
