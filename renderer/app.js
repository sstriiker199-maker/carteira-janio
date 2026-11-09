const $ = (id) => document.getElementById(id);
const rpc = (ch, arg) => window.api.call(ch, arg);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let modoFrase = 'criar'; // 'criar' | 'importar'
let fraseNova = '';
let carteiras = [];
let atual = null; // índice da carteira aberta
let moedas = [];
let saldos = {}; // assetId -> { balance, zero, erro }
let carregando = 0;

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
  desenharTabela();
  atualizarSaldos();
}

function desenharTabela() {
  const so = $('so-com-saldo').checked;
  const linhas = moedas.filter((m) => !so || (saldos[m.id] && !saldos[m.id].zero && !saldos[m.id].erro));
  $('tabela-moedas').innerHTML = linhas.map((m) => {
    const s = saldos[m.id];
    let saldo = '<span class="cinza">carregando…</span>';
    if (s && s.erro) saldo = `<span class="erro" title="${esc(s.erro)}">erro ⓘ</span>`;
    else if (s) saldo = `${esc(s.balance)} ${esc(m.symbol)}`;
    return `<tr>
      <td class="nome-moeda"><b>${esc(m.symbol)}</b><span>${esc(m.name)}</span></td>
      <td><span class="tag">${esc(m.networkName)}${m.native ? '' : ' · ' + esc(m.standard)}</span></td>
      <td class="saldo">${saldo}</td>
      <td class="botoes">
        <button data-receber="${m.id}">Receber</button>
        <button data-enviar="${m.id}" class="primario">Enviar</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="cinza">Nenhuma moeda com saldo nesta carteira.</td></tr>';
  for (const b of document.querySelectorAll('[data-receber]')) b.onclick = () => receber(b.dataset.receber);
  for (const b of document.querySelectorAll('[data-enviar]')) b.onclick = () => enviar(b.dataset.enviar);
}

async function atualizarSaldos() {
  const minhaVez = ++carregando;
  const indice = atual;
  saldos = {};
  desenharTabela();
  const fila = [...moedas];
  async function trabalhador() {
    while (fila.length) {
      const m = fila.shift();
      try {
        saldos[m.id] = await rpc('balance', { index: indice, assetId: m.id });
      } catch (e) {
        saldos[m.id] = { erro: e.message };
      }
      if (minhaVez !== carregando) return;
      desenharTabela();
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
}

$('btn-atualizar').onclick = () => atualizarSaldos();
$('so-com-saldo').onchange = () => desenharTabela();

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
      $('m-fechar').onclick = () => { fecharModal(); atualizarSaldos(); };
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
  abrirModal(`
    <h2>Configurações</h2>
    <p class="sub">Servidores usados para consultar saldo e enviar. Deixe como está se tudo estiver funcionando.</p>
    ${Object.keys(s.rpc).map((id) => `
      <label>${esc(s.names[id])}</label>
      <input data-rpc="${id}" value="${esc(s.rpc[id])}" placeholder="${esc(s.defaults[id])}" spellcheck="false">`).join('')}
    <label>Chave da TronGrid (opcional, evita bloqueio por excesso de consultas)</label>
    <input id="c-tronkey" value="${esc(s.tronApiKey)}" spellcheck="false">
    <p id="m-erro" class="erro"></p>
    <div class="linha"><button id="c-padrao">Restaurar padrão</button><button id="m-fechar">Cancelar</button><button id="m-ok" class="primario">Salvar</button></div>`);
  $('m-fechar').onclick = fecharModal;
  $('c-padrao').onclick = () => { for (const i of document.querySelectorAll('[data-rpc]')) i.value = s.defaults[i.dataset.rpc]; };
  $('m-ok').onclick = async () => {
    const rpc = {};
    for (const i of document.querySelectorAll('[data-rpc]')) rpc[i.dataset.rpc] = i.value;
    try {
      await rpc('saveSettings', { rpc, tronApiKey: $('c-tronkey').value });
      fecharModal();
      aviso('Configurações salvas');
      atualizarSaldos();
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
    corpo = `<p>Baixando versão ${esc(upd.versaoNova || '')}… ${upd.progresso}%</p><div class="barra"><div style="width:${upd.progresso}%"></div></div>`;
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
