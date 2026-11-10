const $ = (id) => document.getElementById(id);
const rpc = (ch, arg) => window.api.call(ch, arg);
const usdFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });
const dolar = (v) => (v == null ? '' : usdFmt.format(v));
// preço unitário: mostra mais casas para moedas baratas (SHIB, PEPE…)
const precoFmt = (v) => {
  if (v == null) return '';
  if (v >= 1) return usdFmt.format(v);
  const casas = Math.min(10, Math.max(4, 2 - Math.floor(Math.log10(v)) + 2));
  return 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas });
};
let totais = {}; // índice -> total em US$
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

let tanqueIndex = null;

async function mostrarTanque() {
  let t = null;
  try { t = await rpc('resumoTaxas'); } catch { t = null; }
  const box = $('tanque');
  tanqueIndex = t ? t.index : null;
  if (!t) {
    box.innerHTML = '<button id="tq-escolher" class="largo">⛽ Escolher carteira de taxas</button>';
    $('tq-escolher').onclick = escolherTanque;
    return;
  }
  const baixos = t.moedas.filter((m) => m.baixo).map((m) => m.symbol);
  box.innerHTML = `
    <div class="tq-topo"><b>⛽ ${esc(t.name)}</b><span class="li-total">${esc(dolar(t.total))}</span></div>
    <div class="tq-moedas">${t.moedas.map((m) => `<span class="${m.baixo ? 'baixo' : ''}">${esc(m.symbol)} ${esc(m.balance)}</span>`).join(' · ')}</div>
    ${baixos.length ? `<div class="tq-aviso">⚠️ ${esc(baixos.join(', '))} acabando</div>` : ''}`;
  box.classList.toggle('ativa', atual === t.index);
  box.onclick = () => selecionar(t.index);
}

function escolherTanque() {
  abrirModal(`
    <h2>⛽ Carteira de taxas</h2>
    <p class="sub">Escolha a carteira que vai pagar as taxas das outras (deixe nela TRX, BNB, POL, SOL e ETH).</p>
    <select id="tq-sel"><option value="">— nenhuma —</option>${carteiras.map((c) => `<option value="${c.index}">${esc(c.name)}</option>`).join('')}</select>
    <div class="linha"><button id="m-fechar">Cancelar</button><button id="m-ok" class="primario">Salvar</button></div>`);
  $('m-fechar').onclick = fecharModal;
  $('m-ok').onclick = async () => {
    await rpc('definirCarteiraTaxas', { index: $('tq-sel').value });
    fecharModal();
    await carregarCarteiras();
  };
}

async function carregarCarteiras() {
  carteiras = await rpc('wallets');
  try { for (const r of await rpc('resumo')) if (r.totalUsd != null) totais[r.index] = r.totalUsd; } catch { /* ok */ }
  await mostrarTanque();
  $('lista-carteiras').innerHTML = carteiras.filter((c) => c.index !== tanqueIndex).map((c) => `
    <li data-i="${c.index}" class="${c.index === atual ? 'ativa' : ''}">
      <div class="li-topo"><span>${esc(c.name)}</span><span class="li-total" data-total="${c.index}">${esc(dolar(totais[c.index]))}</span></div>
      <small>${c.importada ? '📥 ' : ''}${esc(c.evmAddress.slice(0, 8))}…${esc(c.evmAddress.slice(-6))}</small>
    </li>`).join('');
  for (const li of $('lista-carteiras').querySelectorAll('li')) li.onclick = () => selecionar(Number(li.dataset.i));
}

function carteiraAtual() {
  return carteiras.find((c) => c.index === atual);
}

function selecionar(index) {
  atual = index;
  for (const li of $('lista-carteiras').querySelectorAll('li')) li.classList.toggle('ativa', Number(li.dataset.i) === index);
  $('tanque').classList.toggle('ativa', index === tanqueIndex);
  const c = carteiraAtual();
  $('nome-carteira').textContent = c.name;
  $('end-evm').textContent = c.evmAddress;
  $('end-tron').textContent = c.tronAddress;
  saldos = {};
  $('hora-saldo').textContent = '';
  mostrarTotais();
  desenharTabela();
  // mostra na hora o último saldo conhecido, depois atualiza
  rpc('saldosGuardados', { index }).then((l) => {
    if (atual !== index) return;
    for (const x of l) if (!saldos[x.assetId]) saldos[x.assetId] = x;
    atualizarCelulas();
  }).catch(() => {});
  rpc('monitorFoco', { index }).catch(() => {});
}

// ---------- Tabela: uma linha por moeda, com escolha da rede ----------
const ICONES = {};
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
  if (sld.indisponivel) return '—';
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
      <td class="saldo"><div data-saldo="${esc(g.symbol)}"></div><div class="usd" data-usd="${esc(g.symbol)}"></div></td>
      <td class="saldo"><div data-preco="${esc(g.symbol)}"></div><div class="usd" data-var="${esc(g.symbol)}"></div></td>
      <td class="saldo hoje" data-hoje="${esc(g.symbol)}"></td>
      <td class="botoes">
        <button data-receber-g="${esc(g.symbol)}">Receber</button>
        <button data-enviar-g="${esc(g.symbol)}" class="primario">Enviar</button>
      </td>
    </tr>`).join('') + '<tr id="linha-vazia" class="hidden"><td colspan="6" class="cinza">Nenhuma moeda com saldo nesta carteira.</td></tr>';

  for (const img of document.querySelectorAll('img.icone')) {
    img.addEventListener('error', function falhou() {
      const sim = img.dataset.icone;
      if (img.src.endsWith('.svg')) {
        img.src = img.src.replace(/\.svg$/, '.png');
        img.addEventListener('error', falhou, { once: true });
        return;
      }
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
    cel.title = sld && (sld.erro || sld.indisponivel) ? (sld.erro || sld.indisponivel) : '';
    const celUsd = document.querySelector(`[data-usd="${g.symbol}"]`);
    if (celUsd) celUsd.textContent = sld && !sld.erro && !sld.zero && sld.usd != null ? '≈ ' + dolar(sld.usd) : '';
    const celHoje = document.querySelector(`[data-hoje="${g.symbol}"]`);
    if (celHoje) {
      // ganho/perda de hoje somando todas as redes desta moeda
      let soma = null;
      for (const it of g.itens) {
        const x = saldos[it.id];
        if (x && !x.erro && !x.zero && x.ganho24h != null) soma = (soma || 0) + x.ganho24h;
      }
      const tem = soma != null && Math.abs(soma) >= 0.005;
      celHoje.textContent = tem ? `${soma >= 0 ? '+' : '−'}${dolar(Math.abs(soma))}` : '—';
      celHoje.classList.toggle('sobe', tem && soma > 0);
      celHoje.classList.toggle('desce', tem && soma < 0);
      celHoje.classList.toggle('cinza', !tem);
    }
    const comPreco = g.itens.map((m) => saldos[m.id]).find((x) => x && x.preco != null);
    const celPreco = document.querySelector(`[data-preco="${g.symbol}"]`);
    const celVar = document.querySelector(`[data-var="${g.symbol}"]`);
    if (celPreco) celPreco.textContent = comPreco ? precoFmt(comPreco.preco) : '';
    if (celVar) {
      const v = comPreco ? comPreco.var24h : null;
      celVar.textContent = v == null ? '' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(2).replace('.', ',')}%`;
      celVar.classList.toggle('sobe', v > 0);
      celVar.classList.toggle('desce', v < 0);
    }
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

function mostrarTotais() {
  for (const el of document.querySelectorAll('[data-total]')) el.textContent = dolar(totais[el.dataset.total]);
  $('total-carteira').textContent = totais[atual] != null ? dolar(totais[atual]) : '';
}

let tanqueTimer = null;
window.api.onResumo((lista) => {
  for (const r of lista) if (r.totalUsd != null) totais[r.index] = r.totalUsd;
  mostrarTotais();
  clearTimeout(tanqueTimer);
  tanqueTimer = setTimeout(mostrarTanque, 500);
});

// ---------- Busca de moeda em todas as carteiras ----------
let buscaTimer = null;
$('busca').oninput = () => {
  clearTimeout(buscaTimer);
  buscaTimer = setTimeout(buscar, 250);
};
$('busca').onkeydown = (e) => { if (e.key === 'Escape') { $('busca').value = ''; buscar(); } };

async function buscar() {
  const texto = $('busca').value.trim();
  const box = $('busca-res');
  if (!texto) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  let res = [];
  try { res = await rpc('buscarMoeda', { texto }); } catch (e) { res = []; }
  box.classList.remove('hidden');
  if (!res.length) {
    box.innerHTML = `<div class="cinza">Nenhuma carteira tem "${esc(texto)}".</div>`;
    return;
  }
  box.innerHTML = res.map((r, i) => `
    <div class="res" data-i="${i}">
      <div class="li-topo"><b>${esc(r.carteira)}</b><span>${esc(dolar(r.usd))}</span></div>
      <small>${esc(r.balance)} ${esc(r.symbol)} · ${esc(r.rede)}</small>
    </div>`).join('');
  for (const el of box.querySelectorAll('.res')) {
    el.onclick = () => {
      const r = res[Number(el.dataset.i)];
      const g = grupos().find((x) => x.symbol === r.symbol);
      redeEscolhida[r.symbol] = r.assetId;
      if (g) escolhaManual.add(r.symbol);
      selecionar(r.index);
    };
  }
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
  mostrarTotais();
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
      ${r.memo ? `<label>${r.memo.tipo === 'tag' ? 'Tag de destino (Destination Tag)' : 'Memo / Comentário'} desta carteira</label>
        <div class="end-grande"><code>${esc(r.memo.valor)}</code> <button class="mini" id="m-copiar-memo">Copiar</button></div>
        <p class="ajuda">Opcional. Use se a corretora obrigar a preencher ${r.memo.tipo === 'tag' ? 'a tag' : 'o memo'} no saque. Com ou sem ${r.memo.tipo === 'tag' ? 'tag' : 'memo'}, o dinheiro chega nesta carteira.</p>` : ''}
      <div class="linha"><button id="m-copiar" class="primario">Copiar endereço</button><button id="m-fechar">Fechar</button></div>`);
    $('m-copiar').onclick = async () => { await rpc('copy', { text: r.address }); aviso('Endereço copiado'); };
    if ($('m-copiar-memo')) $('m-copiar-memo').onclick = async () => { await rpc('copy', { text: r.memo.valor }); aviso(r.memo.tipo === 'tag' ? 'Tag copiada' : 'Memo copiado'); };
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
    <div class="campo-valor"><input id="e-para" spellcheck="false" placeholder="Cole o endereço de destino"><button id="e-verificar">Verificar</button></div>
    <div id="e-verif" class="verif"></div>
    <label>…ou escolha uma das suas carteiras ou um favorito</label>
    <select id="e-minhas"><option value="">carregando…</option></select>
    ${m.memo === 'tag' ? `<label>Tag de destino (número) — obrigatória se o destino for uma corretora</label><input id="e-memo" inputmode="numeric" placeholder="ex.: 123456">` : ''}
    ${m.memo === 'comentario' ? `<label>Comentário / Memo — obrigatório se o destino for uma corretora</label><input id="e-memo" placeholder="ex.: 123456789">` : ''}
    <label>Quantidade de ${esc(m.symbol)}</label>
    <div class="campo-valor"><input id="e-valor" placeholder="0,00" inputmode="decimal"><button id="e-max">Máx</button></div>
    <p id="e-erro" class="erro"></p>
    <div id="e-resumo"></div>
    <div class="linha" id="e-botoes"><button id="e-cancelar">Cancelar</button><button id="e-calcular" class="primario">Revisar envio</button></div>`);

  const sel = $('e-minhas');
  opcoesDestino(assetId, atual).then((h) => { if (sel) sel.innerHTML = h; });
  sel.onchange = async () => {
    try {
      const d = await resolverDestino(sel.value, assetId);
      if (d) { $('e-para').value = d.endereco; if ($('e-memo')) $('e-memo').value = d.memo; }
    } catch (e) { $('e-erro').textContent = e.message; }
    limparResumo();
    verificar();
  };
  let verifTimer = null;
  let enderecoBloqueado = false;
  async function verificar() {
    const r = await rpc('verificarEndereco', { assetId, endereco: $('e-para').value }).catch(() => ({ estado: 'vazio' }));
    const el = $('e-verif');
    if (!el) return;
    enderecoBloqueado = r.estado === 'bloqueado';
    el.className = 'verif ' + r.estado;
    el.textContent = r.estado === 'vazio' ? '' : (r.estado === 'ok' ? '✅ ' : r.estado === 'atencao' ? '⚠️ ' : '❌ ') + r.mensagem;
    $('e-calcular').disabled = enderecoBloqueado;
  }
  $('e-para').oninput = () => { limparResumo(); clearTimeout(verifTimer); verifTimer = setTimeout(verificar, 300); };
  $('e-verificar').onclick = verificar;
  if ($('e-memo')) $('e-memo').oninput = limparResumo;
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

  let vel = 'normal';
  const dados = () => ({ index: atual, assetId, to: $('e-para').value.trim(), amount: usarMax ? '' : $('e-valor').value, max: usarMax, velocidade: vel, memo: $('e-memo') ? $('e-memo').value.trim() : undefined });
  const NOMES_VEL = { economica: 'Econômica', normal: 'Normal', rapida: 'Rápida' };
  const comUsd = (v, u) => `${esc(v)}${u != null ? ` <span class="cinza">(≈ ${esc(dolar(u))})</span>` : ''}`;

  $('e-calcular').onclick = async () => {
    $('e-erro').textContent = '';
    $('e-calcular').disabled = true;
    $('e-calcular').textContent = 'Calculando…';
    try {
      const r = await rpc('estimate', dados());
      const selMinha = $('e-minhas');
      const opSel = selMinha && selMinha.selectedOptions[0];
      const destino = carteiras.find((c) => c.evmAddress.toLowerCase() === r.to.toLowerCase() || c.tronAddress === r.to)
        || (opSel && opSel.value ? { name: opSel.textContent.trim() } : null);
      const velHtml = r.opcoes ? `<div class="velocidades">${Object.entries(r.opcoes).map(([v, o]) => `
          <label class="vel ${v === r.velocidade ? 'ativa' : ''}"><input type="radio" name="vel" value="${v}" ${v === r.velocidade ? 'checked' : ''}>
            <b>${NOMES_VEL[v]}</b><span>${esc(o.fee)} ${esc(r.feeSymbol)}</span><span class="cinza">${o.usd != null ? '≈ ' + esc(dolar(o.usd)) : ''}</span>
          </label>`).join('')}</div>
          ${r.velocidade === 'economica' ? '<p class="ajuda">Econômica pode demorar mais para confirmar se a rede estiver cheia.</p>' : ''}` : '';
      $('e-resumo').innerHTML = `<div class="resumo">
        <div><span class="rot">Valor:</span> <b>${esc(r.amount)} ${esc(r.symbol)}</b>${r.amountUsd != null ? ` <span class="cinza">(≈ ${esc(dolar(r.amountUsd))})</span>` : ''}</div>
        <div><span class="rot">Rede:</span> ${esc(r.networkName)}</div>
        <div><span class="rot">Para:</span> <code>${esc(r.to)}</code>${destino ? ` <span class="tag">${esc(destino.name)}</span>` : ''}</div>
        ${$('e-memo') && $('e-memo').value.trim() ? `<div><span class="rot">${m.memo === 'tag' ? 'Tag:' : 'Memo:'}</span> ${esc($('e-memo').value.trim())}</div>` : ''}
        <div><span class="rot">Taxa da rede:</span> ${esc(r.feeLabel)} ${comUsd(r.fee + ' ' + r.feeSymbol, r.feeUsd)}</div>
        ${velHtml}
        ${r.abastecer ? `<p class="alerta-rede">Esta carteira não tem ${esc(r.abastecer.simbolo)} para a taxa. Vou usar <b>${esc(r.abastecer.valor)} ${esc(r.abastecer.simbolo)}</b>${r.abastecer.usd != null ? ' (≈ ' + esc(dolar(r.abastecer.usd)) + ')' : ''} da carteira <b>${esc(r.abastecer.de)}</b> (+ taxa do abastecimento ${comUsd(r.abastecer.taxaAbastecer + ' ' + r.abastecer.simbolo, r.abastecer.taxaAbastecerUsd)}). Primeiro chega a taxa, depois o envio é feito.</p>` : ''}
      </div>
      <p class="sub">Confira o endereço. Envios em blockchain <b>não podem ser desfeitos</b>.</p>`;
      for (const radio of document.querySelectorAll('input[name="vel"]')) {
        radio.onchange = () => { vel = radio.value; $('e-calcular').onclick(); };
      }
      $('e-calcular').classList.add('hidden');
      const velha = $('e-confirmar');
      if (velha) velha.remove();
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
    btn.textContent = $('e-resumo').querySelector('.alerta-rede') ? 'Abastecendo taxa e enviando… (pode levar 1 min)' : 'Enviando…';
    $('e-cancelar').disabled = true;
    try {
      const memoUsado = $('e-memo') ? $('e-memo').value.trim() : '';
      const r = await rpc('send', dados());
      const opSel2 = $('e-minhas') && $('e-minhas').value;
      const ehMinha = (opSel2 && opSel2.startsWith('w:')) || (opSel2 && opSel2.startsWith('c:'))
        || carteiras.some((c) => c.evmAddress.toLowerCase() === String(r.to).toLowerCase() || c.tronAddress === r.to);
      abrirModal(`
        <h2 class="ok">Envio feito ✓</h2>
        <div class="resumo">
          <div><span class="rot">Valor:</span> <b>${esc(r.amount)} ${esc(r.symbol)}</b></div>
          <div><span class="rot">Rede:</span> ${esc(r.networkName)}</div>
          <div><span class="rot">Para:</span> <code>${esc(r.to)}</code></div>
          <div><span class="rot">Código (hash):</span> <code>${esc(r.hash)}</code></div>
        </div>
        <p class="sub">A rede pode levar de alguns segundos a alguns minutos para confirmar. Você recebe um aviso quando confirmar.</p>
        ${ehMinha ? '' : `<div class="secao"><label>Salvar este endereço como favorito</label>
          <div class="campo-valor"><input id="f-nome" placeholder="Nome (ex.: Fornecedor João)"><button id="f-salvar">⭐ Salvar</button></div><span id="f-res" class="cinza"></span></div>`}
        <div class="linha"><button id="m-explorer">Ver no explorador</button><button id="m-fechar" class="primario">Fechar</button></div>`);
      if ($('f-salvar')) {
        $('f-salvar').onclick = async () => {
          try {
            await rpc('salvarContato', { nome: $('f-nome').value, rede: m.network, endereco: r.to, memo: memoUsado });
            $('f-res').textContent = 'Salvo ✓';
            $('f-salvar').disabled = true;
          } catch (e) { $('f-res').textContent = e.message; }
        };
      }
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

// ---------- Destinos: minhas carteiras + favoritos ----------
async function opcoesDestino(assetId, excluirIndex) {
  const m = moedas.find((x) => x.id === assetId);
  let favs = [];
  try { favs = await rpc('contatos', { rede: m.network }); } catch { /* ok */ }
  const minhas = carteiras.filter((c) => c.index !== excluirIndex);
  return `<option value="">— escolher —</option>
    ${minhas.length ? `<optgroup label="Minhas carteiras">${minhas.map((c) => `<option value="w:${c.index}">${esc(c.name)}</option>`).join('')}</optgroup>` : ''}
    ${favs.length ? `<optgroup label="Favoritos (${esc(m.rotulo)})">${favs.map((f) => `<option value="c:${esc(f.id)}">⭐ ${esc(f.nome)}</option>`).join('')}</optgroup>` : ''}`;
}

async function resolverDestino(valor, assetId) {
  if (!valor) return null;
  if (valor.startsWith('w:')) return { endereco: (await rpc('receive', { index: Number(valor.slice(2)), assetId })).address, memo: '' };
  const m = moedas.find((x) => x.id === assetId);
  const f = (await rpc('contatos', { rede: m.network })).find((x) => x.id === valor.slice(2));
  return f ? { endereco: f.endereco, memo: f.memo || '', nome: f.nome } : null;
}

// ---------- Trocar (swap) ----------
// reserva para a taxa quando o usuário clica em Máx numa moeda principal
const RESERVA = { ETH: 0.0005, BNB: 0.0005, POL: 0.05, AVAX: 0.005, TRX: 2, BTC: 0.00005, LTC: 0.0005, DOGE: 2, BCH: 0.0002, SOL: 0.0001, XRP: 1.1, TON: 0.05, ADA: 0.5 };

$('btn-trocar').onclick = () => {
  const comSaldo = moedas.filter((m) => saldos[m.id] && !saldos[m.id].zero && !saldos[m.id].erro && !saldos[m.id].indisponivel);
  if (!comSaldo.length) { aviso('Esta carteira não tem saldo para trocar.'); return; }
  const opDe = comSaldo.map((m) => `<option value="${m.id}">${esc(m.symbol)} — ${esc(m.rotulo)} (saldo ${esc(saldos[m.id].balance)})</option>`).join('');
  const opPara = moedas.map((m) => `<option value="${m.id}">${esc(m.symbol)} — ${esc(m.rotulo)}</option>`).join('');
  abrirModal(`
    <h2>🔄 Trocar moedas</h2>
    <label>Você envia</label>
    <select id="s-de">${opDe}</select>
    <div class="campo-valor"><input id="s-valor" placeholder="Quantidade" inputmode="decimal"><button id="s-max">Máx</button></div>
    <label>Você recebe</label>
    <select id="s-para">${opPara}</select>
    <label>Receber na carteira</label>
    <select id="s-destino">${carteiras.map((c) => `<option value="${c.index}" ${c.index === atual ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <p class="ajuda">A troca é feita pela SideShift.ai. A taxa dela já vem embutida na cotação. Valores muito pequenos podem não ser aceitos (mínimo deles).</p>
    <p id="m-erro" class="erro"></p>
    <div id="s-resumo"></div>
    <div class="linha" id="s-botoes"><button id="m-fechar">Cancelar</button><button id="s-cotar" class="primario">Ver cotação</button></div>`);
  $('m-fechar').onclick = fecharModal;
  const limpar = () => { $('s-resumo').innerHTML = ''; $('m-erro').textContent = ''; const c = $('s-confirmar'); if (c) c.remove(); };
  for (const id of ['s-de', 's-para', 's-valor', 's-destino']) $(id).addEventListener('input', limpar);
  $('s-max').onclick = () => {
    const m = moedas.find((x) => x.id === $('s-de').value);
    const sld = saldos[m.id];
    let v = parseFloat(sld.balance) || 0;
    if (m.native) v = Math.max(0, v - (RESERVA[m.symbol] || 0));
    $('s-valor').value = String(Number(v.toFixed(Math.min(8, m.decimals || 8))));
    limpar();
  };
  $('s-cotar').onclick = async () => {
    limpar();
    $('s-cotar').disabled = true;
    $('s-cotar').textContent = 'Cotando…';
    try {
      const q = await rpc('swapCotar', { index: atual, de: $('s-de').value, para: $('s-para').value, amount: $('s-valor').value });
      const ate = new Date(q.expira).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      $('s-resumo').innerHTML = `<div class="resumo">
        <div><span class="rot">Você envia:</span> <b>${esc(q.envia)} ${esc(q.de)}</b> ${q.usdEnvia != null ? '<span class="cinza">(≈ ' + esc(dolar(q.usdEnvia)) + ')</span>' : ''}</div>
        <div><span class="rot">Você recebe:</span> <b>≈ ${esc(q.recebe)} ${esc(q.para)}</b> ${q.usdRecebe != null ? '<span class="cinza">(≈ ' + esc(dolar(q.usdRecebe)) + ')</span>' : ''}</div>
        <div><span class="rot">Cotação:</span> 1 = ${esc(Number(q.taxa).toPrecision(6))}</div>
        <div><span class="rot">Válida até:</span> ${esc(ate)}</div>
        ${q.usdEnvia && q.usdRecebe ? `<div><span class="rot">Custo da troca:</span> ≈ ${esc(dolar(q.usdEnvia - q.usdRecebe))} (${esc(((1 - q.usdRecebe / q.usdEnvia) * 100).toFixed(2).replace('.', ','))}%)</div>` : ''}
      </div>
      <p class="sub">Ao confirmar, o programa envia o valor para a SideShift (mais a taxa normal da rede) e você recebe a outra moeda em alguns minutos. Você será avisado quando chegar.</p>`;
      const b = document.createElement('button');
      b.id = 's-confirmar';
      b.className = 'perigo';
      b.textContent = 'Confirmar troca';
      $('s-botoes').appendChild(b);
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = 'Enviando…';
        try {
          const r = await rpc('swapExecutar', { quoteId: q.quoteId, index: atual, de: $('s-de').value, para: $('s-para').value, destinoIndex: Number($('s-destino').value) });
          abrirModal(`<h2 class="ok">Troca iniciada ✓</h2>
            <p>Você enviou <b>${esc(r.envia)}</b> e vai receber <b>≈ ${esc(r.recebe)}</b>. Isso costuma levar de 2 a 30 minutos, conforme a rede.</p>
            <p class="sub">Você recebe um aviso quando a troca terminar. Acompanhe também em Atividade.</p>
            <div class="linha"><button id="s-pagina">Ver na SideShift</button><button id="m-fechar" class="primario">Fechar</button></div>`);
          $('s-pagina').onclick = () => rpc('openExternal', { url: r.pagina });
          $('m-fechar').onclick = fecharModal;
        } catch (e) { $('m-erro').textContent = e.message; b.disabled = false; b.textContent = 'Confirmar troca'; }
      };
    } catch (e) { $('m-erro').textContent = e.message; }
    finally { if ($('s-cotar')) { $('s-cotar').disabled = false; $('s-cotar').textContent = 'Ver cotação'; } }
  };
};

// ---------- Favoritos ----------
$('btn-contatos').onclick = async () => {
  const lista = await rpc('contatos', {});
  abrirModal(`
    <h2>⭐ Favoritos</h2>
    ${lista.length ? `<table><thead><tr><th>Nome</th><th>Rede</th><th>Endereço</th><th></th></tr></thead><tbody>
      ${lista.map((c, i) => `<tr><td><input data-fnome="${i}" value="${esc(c.nome)}"></td><td><span class="tag">${esc(c.rotuloRede || c.rede)}</span></td>
        <td><code>${esc(c.endereco)}</code>${c.memo ? `<br><small class="cinza">memo/tag: ${esc(c.memo)}</small>` : ''}</td>
        <td class="botoes"><button class="mini" data-fsalvar="${i}">Salvar</button><button class="mini" data-fapagar="${i}">Apagar</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="cinza">Nenhum favorito ainda. Depois de um envio, use "Salvar como favorito".</p>'}
    <div class="linha"><button id="m-fechar" class="primario">Fechar</button></div>`);
  $('modal').classList.add('largo');
  $('m-fechar').onclick = () => { $('modal').classList.remove('largo'); fecharModal(); };
  for (const b of document.querySelectorAll('[data-fsalvar]')) {
    b.onclick = async () => {
      const c = lista[Number(b.dataset.fsalvar)];
      try { await rpc('salvarContato', { ...c, nome: document.querySelector(`[data-fnome="${b.dataset.fsalvar}"]`).value }); aviso('Favorito salvo'); } catch (e) { aviso(e.message); }
    };
  }
  for (const b of document.querySelectorAll('[data-fapagar]')) {
    b.onclick = async () => { await rpc('apagarContato', { id: lista[Number(b.dataset.fapagar)].id }); $('btn-contatos').onclick(); };
  }
};

// ---------- Envios múltiplos ----------
$('btn-multiplos').onclick = () => {
  abrirModal(`
    <h2>📤 Envios múltiplos</h2>
    <div class="linha filtros">
      <select id="mm-moeda">${moedas.map((m) => `<option value="${m.id}">${esc(m.symbol)} — ${esc(m.rotulo)}</option>`).join('')}</select>
      <label class="inline">Carteiras com mais de US$ <input id="mm-min" type="number" min="0" value="0" class="curto"></label>
      <button id="mm-buscar" class="primario">Mostrar carteiras</button>
    </div>
    <div id="mm-lista"></div>
    <p id="m-erro" class="erro"></p>
    <div class="linha" id="mm-botoes"><button id="m-fechar">Fechar</button></div>`);
  $('modal').classList.add('largo');
  $('m-fechar').onclick = () => { $('modal').classList.remove('largo'); fecharModal(); };
  $('mm-buscar').onclick = carregarMultiplos;
};

async function carregarMultiplos() {
  const assetId = $('mm-moeda').value;
  const m = moedas.find((x) => x.id === assetId);
  const lista = await rpc('carteirasComSaldo', { assetId, minUsd: $('mm-min').value });
  const destinos = await opcoesDestino(assetId, null);
  $('mm-botoes').innerHTML = '<button id="m-fechar">Fechar</button>';
  $('m-fechar').onclick = () => { $('modal').classList.remove('largo'); fecharModal(); };
  if (!lista.length) { $('mm-lista').innerHTML = '<p class="cinza">Nenhuma carteira com esse saldo (as outras carteiras são conferidas em rodízio; com muitas carteiras, a volta completa leva alguns minutos).</p>'; return; }
  $('mm-lista').innerHTML = `<table class="multi"><thead><tr><th></th><th>Carteira</th><th class="dir">Saldo</th><th>Destino</th><th>Valor</th><th>Status</th></tr></thead><tbody>
    ${lista.map((w, i) => `<tr data-mm="${i}">
      <td><input type="checkbox" class="mm-sel" checked></td>
      <td><b>${esc(w.name)}</b></td>
      <td class="dir">${esc(w.balance)} ${esc(m.symbol)}<br><small class="cinza">${esc(dolar(w.usd))}</small></td>
      <td><select class="mm-dsel">${destinos.replace(`value="w:${w.index}"`, `value="w:${w.index}" disabled`)}</select><input class="mm-dest" placeholder="ou cole o endereço" spellcheck="false">
        ${m.memo ? `<input class="mm-memo" placeholder="${m.memo === 'tag' ? 'tag (número)' : 'memo'}">` : ''}</td>
      <td><input class="mm-valor curto" placeholder="0,00"><label class="check mini-check"><input type="checkbox" class="mm-max"> Máx</label></td>
      <td class="mm-status cinza">—</td>
    </tr>`).join('')}</tbody></table>
    <p class="ajuda">Dica: escolha um destino na primeira linha e clique em "Usar em todas".</p>`;
  $('mm-botoes').innerHTML = `<button id="mm-todas">Usar destino da 1ª linha em todas</button><button id="m-fechar">Fechar</button><button id="mm-revisar" class="primario">Revisar</button>`;
  $('m-fechar').onclick = () => { $('modal').classList.remove('largo'); fecharModal(); };
  const linhas = [...document.querySelectorAll('[data-mm]')];
  for (const tr of linhas) {
    const w = lista[Number(tr.dataset.mm)];
    tr.querySelector('.mm-dsel').onchange = async (ev) => {
      const d = await resolverDestino(ev.target.value, assetId).catch(() => null);
      if (d) { tr.querySelector('.mm-dest').value = d.endereco; if (tr.querySelector('.mm-memo')) tr.querySelector('.mm-memo').value = d.memo; tr.querySelector('.mm-dest').onblur(); }
    };
    tr.querySelector('.mm-max').onchange = (ev) => { tr.querySelector('.mm-valor').disabled = ev.target.checked; };
    const verifLinha = async () => {
      const r = await rpc('verificarEndereco', { assetId, endereco: tr.querySelector('.mm-dest').value }).catch(() => ({ estado: 'vazio' }));
      const st = tr.querySelector('.mm-status');
      st.className = 'mm-status verif ' + r.estado;
      st.textContent = r.estado === 'vazio' ? '—' : (r.estado === 'ok' ? '✅ endereço ok' : r.estado === 'atencao' ? '⚠️ ' + r.mensagem : '❌ ' + r.mensagem);
    };
    tr.querySelector('.mm-dest').onchange = verifLinha;
    tr.querySelector('.mm-dest').onblur = verifLinha;
    tr._w = w;
  }
  $('mm-todas').onclick = () => {
    const p = linhas[0];
    for (const tr of linhas.slice(1)) {
      tr.querySelector('.mm-dest').value = p.querySelector('.mm-dest').value;
      if (tr.querySelector('.mm-memo')) tr.querySelector('.mm-memo').value = p.querySelector('.mm-memo').value;
    }
  };
  const dadosLinha = (tr) => ({
    index: tr._w.index, assetId, to: tr.querySelector('.mm-dest').value.trim(),
    amount: tr.querySelector('.mm-valor').value, max: tr.querySelector('.mm-max').checked,
    memo: tr.querySelector('.mm-memo') ? tr.querySelector('.mm-memo').value.trim() : undefined
  });
  $('mm-revisar').onclick = async () => {
    let total = 0;
    let totalTaxa = 0;
    let ok = 0;
    for (const tr of linhas) {
      const st = tr.querySelector('.mm-status');
      if (!tr.querySelector('.mm-sel').checked) { st.textContent = 'pulado'; continue; }
      st.textContent = 'calculando…';
      try {
        const r = await rpc('estimate', dadosLinha(tr));
        st.innerHTML = `${esc(r.amount)} ${esc(r.symbol)}<br><small>taxa ${esc(r.fee)} ${esc(r.feeSymbol)} ${r.feeUsd != null ? '(' + esc(dolar(r.feeUsd)) + ')' : ''}</small>`;
        st.classList.remove('erro');
        tr._ok = true;
        total += r.amountUsd || 0;
        totalTaxa += r.feeUsd || 0;
        ok++;
      } catch (e) { st.textContent = e.message; st.classList.add('erro'); tr._ok = false; }
    }
    $('m-erro').innerHTML = ok ? `<span class="ok">${ok} envio(s) prontos · total ≈ ${esc(dolar(total))} · taxas ≈ ${esc(dolar(totalTaxa))}</span>` : 'Nenhum envio válido.';
    if (ok && !$('mm-enviar')) {
      const b = document.createElement('button');
      b.id = 'mm-enviar';
      b.className = 'perigo';
      b.textContent = 'Enviar todos';
      $('mm-botoes').appendChild(b);
      b.onclick = async () => {
        b.disabled = true;
        $('mm-revisar').disabled = true;
        for (const tr of linhas) {
          if (!tr._ok || !tr.querySelector('.mm-sel').checked) continue;
          const st = tr.querySelector('.mm-status');
          st.textContent = 'enviando…';
          try {
            const r = await rpc('send', dadosLinha(tr));
            st.innerHTML = `✅ enviado<br><small><code>${esc(String(r.hash).slice(0, 14))}…</code></small>`;
          } catch (e) { st.textContent = '❌ ' + e.message; st.classList.add('erro'); }
        }
        $('m-erro').innerHTML = '<span class="ok">Concluído. Veja os detalhes na aba Atividade.</span>';
      };
    }
  };
}

// ---------- Juntar saldos ----------
$('btn-juntar').onclick = () => {
  const grupos2 = grupos();
  abrirModal(`
    <h2>🧲 Juntar saldos</h2>
    <p class="sub">Puxa o saldo das carteiras escolhidas para uma carteira principal, cada moeda na rede certa.</p>
    <label>Carteira principal (recebe tudo)</label>
    <select id="j-destino">${carteiras.map((c) => `<option value="${c.index}" ${c.index === atual ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <label>Moedas</label>
    <div class="chips">${grupos2.map((g) => `<label class="chip"><input type="checkbox" class="j-moeda" value="${esc(g.symbol)}" checked> ${esc(g.symbol)}</label>`).join('')}</div>
    <label>De quais carteiras</label>
    <div class="chips">${carteiras.map((c) => `<label class="chip"><input type="checkbox" class="j-origem" value="${c.index}" checked> ${esc(c.name)}</label>`).join('')}</div>
    <label class="inline">Ignorar valores menores que US$ <input id="j-min" type="number" min="0" value="0.5" step="0.1" class="curto"></label>
    <div id="j-lista"></div>
    <p id="m-erro" class="erro"></p>
    <div class="linha" id="j-botoes"><button id="m-fechar">Fechar</button><button id="j-ver" class="primario">Ver o que vai ser juntado</button></div>`);
  $('modal').classList.add('largo');
  $('m-fechar').onclick = () => { $('modal').classList.remove('largo'); fecharModal(); };
  $('j-ver').onclick = async () => {
    const simbolos = [...document.querySelectorAll('.j-moeda:checked')].map((x) => x.value);
    const assetIds = moedas.filter((m) => simbolos.includes(m.symbol)).map((m) => m.id);
    const origens = [...document.querySelectorAll('.j-origem:checked')].map((x) => Number(x.value));
    const destino = Number($('j-destino').value);
    const itens = await rpc('planoJuntar', { destino, assetIds, origens, minUsd: $('j-min').value });
    if (!itens.length) { $('j-lista').innerHTML = '<p class="cinza">Nada para juntar com esses filtros.</p>'; return; }
    $('j-lista').innerHTML = `<table><thead><tr><th>De</th><th>Moeda</th><th class="dir">Saldo</th><th>Situação</th></tr></thead><tbody>
      ${itens.map((it, i) => `<tr data-j="${i}"><td>${esc(it.carteira)}</td><td><b>${esc(it.symbol)}</b> <span class="cinza">${esc(it.rede)}</span></td>
        <td class="dir">${esc(it.balance)}<br><small class="cinza">${esc(dolar(it.usd))}</small></td><td class="j-st cinza">calculando…</td></tr>`).join('')}</tbody></table>`;
    let ok = 0;
    let soma = 0;
    let taxas = 0;
    for (const [i, it] of itens.entries()) {
      const st = document.querySelector(`[data-j="${i}"] .j-st`);
      try {
        const r = await rpc('estimate', { index: it.index, assetId: it.assetId, to: it.para, max: true });
        const taxaUsd = (r.feeUsd || 0) + (r.abastecer ? (r.abastecer.usd || 0) + (r.abastecer.taxaAbastecerUsd || 0) : 0);
        if (it.usd != null && taxaUsd > it.usd * 0.5) { st.textContent = `pulado: taxa (${dolar(taxaUsd)}) alta demais para o valor`; it._ok = false; continue; }
        st.innerHTML = `ok · taxa ≈ ${esc(dolar(taxaUsd))}${r.abastecer ? ' (usa carteira de taxas)' : ''}`;
        st.classList.remove('cinza');
        it._ok = true;
        ok++;
        soma += it.usd || 0;
        taxas += taxaUsd;
      } catch (e) { st.textContent = e.message; st.classList.add('erro'); it._ok = false; }
    }
    $('m-erro').innerHTML = ok ? `<span class="ok">${ok} envio(s) · total ≈ ${esc(dolar(soma))} · taxas ≈ ${esc(dolar(taxas))}</span>` : 'Nada pode ser juntado agora.';
    if (ok && !$('j-ir')) {
      const b = document.createElement('button');
      b.id = 'j-ir';
      b.className = 'perigo';
      b.textContent = 'Juntar agora';
      $('j-botoes').appendChild(b);
      b.onclick = async () => {
        b.disabled = true;
        $('j-ver').disabled = true;
        for (const [i, it] of itens.entries()) {
          if (!it._ok) continue;
          const st = document.querySelector(`[data-j="${i}"] .j-st`);
          st.textContent = 'enviando…';
          try {
            await rpc('send', { index: it.index, assetId: it.assetId, to: it.para, max: true });
            st.textContent = '✅ enviado';
          } catch (e) { st.textContent = '❌ ' + e.message; st.classList.add('erro'); }
        }
        $('m-erro').innerHTML = '<span class="ok">Concluído. Veja os detalhes na aba Atividade.</span>';
      };
    }
  };
};

// ---------- Mercado ----------
let mercadoTimer = null;
$('btn-mercado').onclick = async () => {
  abrirModal(`
    <h2>Mercado</h2>
    <div id="mk-dolar" class="dolar-real"></div>
    <div id="mk-lista" class="cinza">Carregando…</div>
    <div class="linha"><button id="m-fechar" class="primario">Fechar</button></div>`);
  $('modal').classList.add('largo');
  const fechar = () => { clearInterval(mercadoTimer); $('modal').classList.remove('largo'); fecharModal(); };
  $('m-fechar').onclick = fechar;
  async function carregar() {
    if (!$('mk-lista')) { clearInterval(mercadoTimer); return; }
    let d;
    try { d = await rpc('mercado'); } catch (e) { $('mk-lista').textContent = e.message; return; }
    if (!$('mk-lista')) return;
    const vfmt = (v) => (v == null ? '' : `<span class="${v >= 0 ? 'sobe' : 'desce'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(2).replace('.', ',')}%</span>`);
    $('mk-dolar').innerHTML = d.dolar ? `💵 <b>Dólar:</b> R$ ${d.dolar.brl.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${vfmt(d.dolar.var24h)}` : '';
    if (!d.moedas.length) { $('mk-lista').textContent = d.erro || 'Sem dados agora.'; return; }
    const bi = (v) => v >= 1e9 ? 'US$ ' + (v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' bi' : 'US$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' mi';
    $('mk-lista').classList.remove('cinza');
    $('mk-lista').innerHTML = `<table class="mercado"><thead><tr><th>#</th><th>Moeda</th><th class="dir">Preço</th><th class="dir">24h</th><th class="dir">Valor de mercado</th></tr></thead><tbody>
      ${d.moedas.map((m) => `<tr><td class="cinza">${m.rank || ''}</td><td><b>${esc(m.symbol)}</b> <span class="cinza">${esc(m.name)}</span></td>
        <td class="dir">${esc(precoFmt(m.usd))}</td><td class="dir">${vfmt(m.var24h)}</td><td class="dir cinza">${m.marketCap ? esc(bi(m.marketCap)) : ''}</td></tr>`).join('')}
      </tbody></table><p class="ajuda">Preços ao vivo (Binance), atualizando a cada 3 segundos. Lista e valor de mercado: CoinGecko.</p>`;
  }
  await carregar();
  mercadoTimer = setInterval(carregar, 3000);
};

// ---------- Atividade ----------
$('btn-atividade').onclick = async () => {
  abrirModal(`
    <h2>Atividade</h2>
    <div class="linha filtros">
      <select id="at-carteira"><option value="">Todas as carteiras</option>${carteiras.map((c) => `<option value="${c.index}">${esc(c.name)}</option>`).join('')}</select>
      <select id="at-tipo"><option value="">Tudo</option><option value="enviado">Enviados</option><option value="recebido">Recebidos</option><option value="taxa">Abastecimento de taxa</option><option value="swap">Trocas</option><option value="importada">Carteiras importadas</option></select>
    </div>
    <div id="at-lista" class="cinza">Carregando…</div>
    <div class="linha"><button id="m-fechar" class="primario">Fechar</button></div>`);
  $('modal').classList.add('largo');
  $('m-fechar').onclick = () => { $('modal').classList.remove('largo'); fecharModal(); };
  $('at-carteira').onchange = carregarAtividade;
  $('at-tipo').onchange = carregarAtividade;
  await carregarAtividade();
};

async function carregarAtividade() {
  if (!$('at-lista')) return;
  const lista = await rpc('atividade', { index: $('at-carteira').value, tipo: $('at-tipo').value });
  if (!lista.length) { $('at-lista').textContent = 'Nada por aqui ainda.'; return; }
  const ICON = { enviado: '↗️', recebido: '↘️', taxa: '⛽', importada: '📥', swap: '🔄' };
  const STATUS = { processando: '⏳ processando', confirmado: '✅ confirmado', falhou: '❌ falhou', pendente: '⏳ ainda não confirmado' };
  $('at-lista').classList.remove('cinza');
  $('at-lista').innerHTML = lista.map((e, i) => {
    const quando = new Date(e.quando).toLocaleString('pt-BR');
    let titulo = '';
    let detalhe = '';
    if (e.tipo === 'enviado') {
      titulo = `Enviado ${esc(e.valor)} ${esc(e.symbol)}${e.usd != null ? ' (≈ ' + esc(dolar(e.usd)) + ')' : ''}`;
      detalhe = `De <b>${esc(e.carteira)}</b> para ${e.destino ? '<b>' + esc(e.destino) + '</b> ' : ''}<code>${esc(e.para)}</code>${e.memo ? ' · memo/tag ' + esc(e.memo) : ''}<br>Rede ${esc(e.rede)} · taxa ${esc(e.taxa || '')}${e.taxaUsd != null ? ' (≈ ' + esc(dolar(e.taxaUsd)) + ')' : ''}`;
    } else if (e.tipo === 'recebido') {
      titulo = `Recebido ${esc(e.valor)} ${esc(e.symbol)}${e.usd != null ? ' (≈ ' + esc(dolar(e.usd)) + ')' : ''}`;
      detalhe = `Na carteira <b>${esc(e.carteira)}</b> · rede ${esc(e.rede)}`;
    } else if (e.tipo === 'swap') {
      titulo = `Troca: ${esc(e.valor)} ${esc(e.symbol)} → ${esc(e.recebido || e.paraValor)} ${esc(e.paraSymbol)}`;
      detalhe = `Carteira <b>${esc(e.carteira)}</b> · de ${esc(e.rede)} para ${esc(e.paraRede)} · <b>${esc(e.status || '')}</b>`;
    } else if (e.tipo === 'taxa') {
      titulo = `Taxa abastecida: ${esc(e.valor)} ${esc(e.symbol)}${e.usd != null ? ' (≈ ' + esc(dolar(e.usd)) + ')' : ''}`;
      detalhe = `De <b>${esc(e.carteira)}</b> para <b>${esc(e.destino)}</b> · rede ${esc(e.rede)}`;
    } else {
      titulo = `Carteira importada: ${esc(e.carteira)}`;
    }
    return `<div class="ativ">
      <div class="ativ-ic">${ICON[e.tipo] || '•'}</div>
      <div class="ativ-corpo">
        <div class="li-topo"><b>${titulo}</b><span class="cinza">${esc(quando)}</span></div>
        <div class="ativ-det">${detalhe}</div>
        ${e.hash && e.tipo !== 'swap' ? `<div class="ativ-det">${STATUS[e.status] || ''} · <code>${esc(e.hash.slice(0, 18))}…</code> <button class="mini" data-ver="${i}">Ver transação</button></div>` : ''}
        ${e.tipo === 'swap' ? `<div class="ativ-det"><button class="mini" data-ver="${i}">Ver troca na SideShift</button></div>` : ''}
      </div></div>`;
  }).join('');
  for (const b of document.querySelectorAll('[data-ver]')) b.onclick = () => rpc('openExternal', { url: lista[Number(b.dataset.ver)].explorer });
}
window.api.onAtividade(() => { if ($('at-lista')) carregarAtividade(); });

// ---------- Importar carteira ----------
$('btn-importar-carteira').onclick = () => {
  abrirModal(`
    <h2>Importar carteira</h2>
    <p class="sub">Traga uma carteira de outro app (MetaMask, Trust Wallet…). Ela fica guardada criptografada com a sua senha.</p>
    <label>O que você vai colar?</label>
    <select id="i-tipo"><option value="chave">Chave privada (uma conta)</option><option value="frase">12 ou 24 palavras (várias contas)</option></select>
    <label id="i-rot">Chave privada</label>
    <textarea id="i-segredo" rows="2" spellcheck="false"></textarea>
    <p class="ajuda" id="i-ajuda">Na MetaMask: clique na conta → Detalhes da conta → Mostrar chave privada.</p>
    <label>Nome</label>
    <input id="i-nome" value="MetaMask">
    <div id="i-qtd-box" class="hidden"><label>Quantas contas trazer</label><input id="i-qtd" type="number" min="1" max="200" value="1"></div>
    <p class="alerta">Nunca cole sua chave ou suas palavras em sites ou mensagens. Só aqui dentro do programa.</p>
    <p id="m-erro" class="erro"></p>
    <div class="linha"><button id="m-fechar">Cancelar</button><button id="m-ok" class="primario">Importar</button></div>`);
  $('m-fechar').onclick = fecharModal;
  $('i-tipo').onchange = () => {
    const frase = $('i-tipo').value === 'frase';
    $('i-rot').textContent = frase ? 'Palavras (separadas por espaço)' : 'Chave privada';
    $('i-ajuda').textContent = frase ? 'Conta 1 da MetaMask = primeira carteira, Conta 2 = segunda…' : 'Na MetaMask: clique na conta → Detalhes da conta → Mostrar chave privada.';
    $('i-qtd-box').classList.toggle('hidden', !frase);
  };
  $('m-ok').onclick = async () => {
    $('m-ok').disabled = true;
    try {
      const novas = await rpc('importWallet', { tipo: $('i-tipo').value, segredo: $('i-segredo').value, name: $('i-nome').value, quantidade: $('i-qtd').value });
      $('i-segredo').value = '';
      fecharModal();
      await carregarCarteiras();
      selecionar(novas[0].index);
      aviso(novas.length > 1 ? `${novas.length} carteiras importadas` : 'Carteira importada');
    } catch (e) { $('m-erro').textContent = e.message; $('m-ok').disabled = false; }
  };
};

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
    <p class="ajuda">As outras carteiras são conferidas em rodízio, uma ou duas por vez (com 80 carteiras, a volta completa leva uns 4 minutos).</p>

    <div class="secao">
      <h3>Carteira de taxas</h3>
      <select id="c-taxas"><option value="">— nenhuma —</option>${carteiras.map((c) => `<option value="${c.index}" ${s.carteiraTaxas === c.index ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <p class="ajuda">Quando uma carteira não tiver BNB/TRX/ETH/POL para pagar a taxa de um envio, o programa manda o necessário desta carteira automaticamente.</p>
    </div>

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
      <h3>Chaves de API (opcional, gratuitas)</h3>
      <p class="ajuda">Com elas os saldos carregam mais rápido e sem bloqueio. Se uma chave falhar, o programa usa o servidor gratuito sozinho.</p>
      <label>Alchemy — Ethereum, BNB Chain, Polygon e Avalanche</label>
      <input id="k-alchemy" type="password" value="${esc(s.chaves.alchemy)}" placeholder="cole a API Key" spellcheck="false">
      <p class="ajuda">Crie grátis em <b>dashboard.alchemy.com</b> → crie um app → copie a "API Key". No app, deixe ativadas as redes Ethereum, BNB, Polygon e Avalanche.</p>
      <label>Helius — Solana (SOL e BONK)</label>
      <input id="k-helius" type="password" value="${esc(s.chaves.helius)}" placeholder="cole a API Key" spellcheck="false">
      <p class="ajuda">Crie grátis em <b>dashboard.helius.dev</b> → copie a "API Key".</p>
      <label>TronGrid — Tron (TRX, USDT e USDC TRC-20)</label>
      <input id="c-tronkey" type="password" value="${esc(s.tronApiKey)}" placeholder="cole a API Key" spellcheck="false">
      <p class="ajuda">Crie grátis em <b>trongrid.io</b> → Dashboard → "Create API Key".</p>
      <label>toncenter — TON</label>
      <input id="k-toncenter" type="password" value="${esc(s.chaves.toncenter)}" placeholder="cole a API Key" spellcheck="false">
      <p class="ajuda">No Telegram, fale com <b>@tonapibot</b> → "Manage API keys" → crie uma chave para <b>mainnet</b>.</p>
      <button id="k-testar">Testar chaves</button>
      <div id="k-res" class="ajuda"></div>
    </div>

    <div class="secao">
      <h3>Servidores das redes</h3>
      <p class="ajuda">Avançado: só mude se souber o que está fazendo. Se você preencheu as chaves acima, deixe estes como estão.</p>
      ${Object.keys(s.rpc).map((id) => `
        <label>${esc(s.names[id])}</label>
        <input data-rpc="${id}" value="${esc(s.rpc[id])}" placeholder="${esc(s.defaults[id])}" spellcheck="false">`).join('')}
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
  $('k-testar').onclick = async () => {
    $('k-res').textContent = 'Testando…';
    try {
      const r = await rpc('testarChaves', { chaves: { alchemy: $('k-alchemy').value, helius: $('k-helius').value, toncenter: $('k-toncenter').value }, tronApiKey: $('c-tronkey').value });
      $('k-res').innerHTML = Object.entries(r).map(([k, v]) => `${v === 'ok' ? '✅' : '❌'} <b>${esc(k)}</b> ${v === 'ok' ? 'funcionando' : esc(v)}`).join('<br>');
    } catch (e) { $('k-res').textContent = e.message; }
  };
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
        chaves: { alchemy: $('k-alchemy').value, helius: $('k-helius').value, toncenter: $('k-toncenter').value },
        intervalo: Number($('c-intervalo').value),
        carteiraTaxas: $('c-taxas').value,
        notificar: { entradas: $('c-not-entradas').checked, envios: $('c-not-envios').checked },
        email: emailForm()
      });
      fecharModal();
      aviso('Configurações salvas');
      await carregarCarteiras();
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
