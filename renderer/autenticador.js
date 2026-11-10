// ---------- Autenticador (códigos 2FA, igual ao Google Authenticator) ----------
// As chaves secretas nunca chegam nesta tela: o programa só manda o código de 6 dígitos.

let autTimer = null;
let autCamera = null;
let autFiltro = '';
let autSelecionando = false;
const autSel = new Set();

function autParar() {
  clearInterval(autTimer); autTimer = null;
  if (autCamera) { for (const t of autCamera.getTracks()) t.stop(); autCamera = null; }
}
// ao fechar qualquer janela, desliga o relógio e a câmera
const _fecharModalOriginal = fecharModal;
fecharModal = function () { autParar(); _fecharModalOriginal(); };

const fmtCodigo = (c) => (c.length === 6 ? c.slice(0, 3) + ' ' + c.slice(3) : c.length === 8 ? c.slice(0, 4) + ' ' + c.slice(4) : c);

async function abrirAutenticador() {
  autParar();
  abrirModal(`
    <div class="aut-topo">
      <h2>Autenticador</h2>
      <div class="linha aut-acoes">
        <button id="aut-add" class="primario">+ Adicionar conta</button>
        <button id="aut-google">Importar do Google Authenticator</button>
        <button id="aut-sel">Selecionar</button>
        <button id="aut-bk">Backup</button>
      </div>
    </div>
    <div id="aut-barra-sel" class="aut-barra-sel hidden">
      <span id="aut-sel-n">0 selecionadas</span>
      <button id="aut-sel-todas" class="mini">Selecionar todas</button>
      <button id="aut-sel-nenhuma" class="mini">Limpar</button>
      <span class="aut-esp"></span>
      <button id="aut-sel-remover" class="perigo-borda" disabled>Remover selecionadas</button>
      <button id="aut-sel-sair">Cancelar</button>
    </div>
    <p class="sub">Códigos de verificação em duas etapas (2FA). As chaves ficam cifradas com a senha da carteira e somem da tela quando ela bloqueia.</p>
    <input id="aut-busca" placeholder="Buscar conta (ex.: Twitch)" spellcheck="false" value="${esc(autFiltro)}">
    <div id="aut-lista" class="aut-lista"><p class="cinza">Carregando…</p></div>
    <div class="linha"><button id="m-fechar">Fechar</button></div>`);
  $('modal').classList.add('largo');
  $('m-fechar').onclick = fecharModal;
  $('aut-add').onclick = autAdicionarTela;
  $('aut-google').onclick = autGoogleTela;
  $('aut-bk').onclick = autBackupTela;
  $('aut-sel').onclick = () => { autSelecionando = true; autSel.clear(); autDesenhar(true); };
  $('aut-sel-sair').onclick = () => { autSelecionando = false; autSel.clear(); autDesenhar(true); };
  $('aut-sel-todas').onclick = () => { for (const c of autUltima) autSel.add(c.id); autDesenhar(true); };
  $('aut-sel-nenhuma').onclick = () => { autSel.clear(); autDesenhar(true); };
  $('aut-sel-remover').onclick = autRemoverSelecionadas;
  $('aut-busca').oninput = () => { autFiltro = $('aut-busca').value; autDesenhar(true); };
  await autDesenhar(true);
  autTimer = setInterval(() => autDesenhar(false), 1000);
}

let autUltima = [];
async function autDesenhar(refazer) {
  const box = $('aut-lista');
  if (!box) { autParar(); return; }
  let lista;
  try { lista = await rpc('autLista'); } catch (e) { box.innerHTML = `<p class="erro">${esc(e.message)}</p>`; return; }
  const f = autFiltro.trim().toLowerCase();
  const vis = lista.filter((c) => !f || `${c.emissor} ${c.nome}`.toLowerCase().includes(f))
    .sort((a, b) => `${a.emissor} ${a.nome}`.localeCompare(`${b.emissor} ${b.nome}`, 'pt-BR'));
  // barra do modo de seleção
  const barraSel = $('aut-barra-sel');
  if (barraSel) {
    barraSel.classList.toggle('hidden', !autSelecionando);
    $('aut-sel').classList.toggle('hidden', autSelecionando);
    for (const id of [...autSel]) if (!lista.some((c) => c.id === id)) autSel.delete(id);
    $('aut-sel-n').textContent = `${autSel.size} selecionada${autSel.size === 1 ? '' : 's'}`;
    $('aut-sel-remover').disabled = !autSel.size;
    $('aut-sel-remover').textContent = autSel.size ? `Remover selecionadas (${autSel.size})` : 'Remover selecionadas';
  }
  const mudou = refazer || vis.length !== autUltima.length || vis.some((c, i) => !autUltima[i] || autUltima[i].id !== c.id || autUltima[i].nome !== c.nome || autUltima[i].emissor !== c.emissor);
  autUltima = vis;
  if (!lista.length) {
    box.innerHTML = `<div class="aut-vazio"><p>Nenhuma conta ainda.</p><p class="cinza">Clique em <b>Importar do Google Authenticator</b> para trazer as suas contas do celular, ou em <b>+ Adicionar conta</b>.</p></div>`;
    return;
  }
  if (mudou) {
    box.innerHTML = vis.map((c) => `
      <div class="aut-card${autSelecionando ? ' selecionando' : ''}${autSel.has(c.id) ? ' marcada' : ''}" data-id="${esc(c.id)}">
        ${autSelecionando ? `<input type="checkbox" class="aut-check" aria-label="Selecionar ${esc(c.emissor || c.nome)}" ${autSel.has(c.id) ? 'checked' : ''}>` : ''}
        <div class="aut-cab"><div class="aut-nomes"><span class="aut-emissor">${esc(c.emissor || 'Conta')}</span><span class="aut-nome">${esc(c.nome)}</span></div>
          <div class="aut-menu"><button class="mini" data-aut="ren">Renomear</button><button class="mini" data-aut="qr">QR</button><button class="mini perigo-borda" data-aut="del">Remover</button></div></div>
        <button class="aut-codigo" data-aut="copiar" title="Clique para copiar"><span data-cod></span></button>
        <div class="aut-rodape"><div class="aut-barra"><div data-barra></div></div><span class="aut-resta" data-resta></span><span class="aut-prox cinza" data-prox></span></div>
      </div>`).join('') || '<p class="cinza">Nenhuma conta com esse nome.</p>';
    for (const card of box.querySelectorAll('.aut-card')) {
      const id = card.dataset.id;
      if (autSelecionando) {
        // no modo de seleção, clicar no cartão marca/desmarca
        card.onclick = () => { if (autSel.has(id)) autSel.delete(id); else autSel.add(id); autDesenhar(true); };
        continue;
      }
      for (const b of card.querySelectorAll('[data-aut]')) b.onclick = () => autAcao(b.dataset.aut, id, card);
    }
  }
  for (const c of vis) {
    const card = box.querySelector(`.aut-card[data-id="${CSS.escape(c.id)}"]`);
    if (!card) continue;
    card.querySelector('[data-cod]').textContent = fmtCodigo(c.codigo);
    card.querySelector('[data-resta]').textContent = c.resta + ' s';
    card.querySelector('[data-prox]').textContent = c.resta <= 5 ? 'próximo: ' + fmtCodigo(c.proximo) : '';
    const barra = card.querySelector('[data-barra]');
    barra.style.width = Math.round((c.resta / c.periodo) * 100) + '%';
    card.classList.toggle('acabando', c.resta <= 5);
    card.dataset.codigo = c.codigo;
  }
}

async function autAcao(acao, id, card) {
  const c = autUltima.find((x) => x.id === id);
  if (!c) return;
  if (acao === 'copiar') {
    await navigator.clipboard.writeText(card.dataset.codigo || c.codigo);
    card.classList.add('copiado');
    setTimeout(() => card.classList.remove('copiado'), 900);
    aviso(`Código de ${c.emissor || c.nome} copiado`);
    return;
  }
  if (acao === 'ren') {
    autParar();
    abrirModal(`
      <h2>Renomear conta</h2>
      <label>Site / serviço</label><input id="a-emissor" value="${esc(c.emissor)}">
      <label>Nome da conta</label><input id="a-nome" value="${esc(c.nome)}">
      <p id="a-erro" class="erro"></p>
      <div class="linha"><button id="a-voltar">Voltar</button><button id="a-ok" class="primario">Salvar</button></div>`);
    $('a-voltar').onclick = abrirAutenticador;
    $('a-ok').onclick = async () => {
      try { await rpc('autEditar', { id, nome: $('a-nome').value, emissor: $('a-emissor').value }); abrirAutenticador(); } catch (e) { $('a-erro').textContent = e.message; }
    };
    return;
  }
  if (acao === 'qr' || acao === 'del') {
    autParar();
    const del = acao === 'del';
    abrirModal(`
      <h2>${del ? 'Remover' : 'QR Code de'} ${esc(c.emissor || c.nome)}</h2>
      <p class="alerta">${del
        ? 'Se remover, você perde os códigos dessa conta neste programa. Antes, confira se ela está no celular ou num backup, ou você pode ficar sem acesso ao site.'
        : 'Este QR Code dá acesso aos códigos dessa conta. Use só para passar para o seu celular (Google Authenticator → + → Ler QR code). Não tire print nem mande para ninguém.'}</p>
      <label>Sua senha</label><input id="a-senha" type="password">
      <p id="a-erro" class="erro"></p>
      <div id="a-res"></div>
      <div class="linha"><button id="a-voltar">Voltar</button><button id="a-ok" class="${del ? 'perigo' : 'primario'}">${del ? 'Remover' : 'Mostrar QR'}</button></div>`);
    $('a-senha').focus();
    $('a-voltar').onclick = abrirAutenticador;
    $('a-ok').onclick = async () => {
      $('a-erro').textContent = '';
      try {
        if (del) { await rpc('autRemover', { id, password: $('a-senha').value }); aviso('Conta removida do autenticador'); abrirAutenticador(); return; }
        const r = await rpc('autQr', { id, password: $('a-senha').value });
        $('a-res').innerHTML = `<img class="qr" src="${r.qr}" alt="QR Code da conta"><label>Ou digite a chave no celular</label><div class="end-grande"><code>${esc(r.segredo)}</code></div>`;
        $('a-ok').classList.add('hidden');
      } catch (e) { $('a-erro').textContent = e.message; }
    };
  }
}

// ----- Remover várias de uma vez -----
function autRemoverSelecionadas() {
  const ids = [...autSel];
  if (!ids.length) return;
  const nomes = autUltima.filter((c) => autSel.has(c.id)).map((c) => (c.emissor ? c.emissor + ' – ' : '') + c.nome);
  autParar();
  abrirModal(`
    <h2>Remover ${ids.length} conta${ids.length === 1 ? '' : 's'}</h2>
    <p class="alerta">Você vai perder os códigos destas contas neste programa. Confira antes se elas estão no celular ou num backup, ou você pode ficar sem acesso aos sites.</p>
    <div class="aut-remover-lista">${nomes.map((n) => `<div>• ${esc(n)}</div>`).join('')}</div>
    <label>Sua senha</label><input id="a-senha" type="password">
    <p id="a-erro" class="erro"></p>
    <div class="linha"><button id="a-voltar">Voltar</button><button id="a-ok" class="perigo">Remover ${ids.length}</button></div>`);
  $('a-senha').focus();
  $('a-voltar').onclick = abrirAutenticador;
  $('a-ok').onclick = async () => {
    $('a-erro').textContent = '';
    try {
      const r = await rpc('autRemoverVarias', { ids, password: $('a-senha').value });
      autSel.clear(); autSelecionando = false;
      aviso(`${r.removidas} conta(s) removida(s) do autenticador`);
      abrirAutenticador();
    } catch (e) { $('a-erro').textContent = e.message; }
  };
}

// ----- Adicionar uma conta -----
function autAdicionarTela() {
  autParar();
  abrirModal(`
    <h2>Adicionar conta</h2>
    <p class="sub">Quando o site mostrar o QR Code do autenticador, tire um print e cole aqui (Ctrl+V), ou escolha "Não consigo ler o código" no site e copie a chave.</p>
    ${autLeitorHtml()}
    <div class="secao">
      <h3>Ou digite a chave</h3>
      <div class="grade2">
        <div><label>Site / serviço</label><input id="a-emissor" placeholder="ex.: Twitch"></div>
        <div><label>Nome da conta</label><input id="a-nome" placeholder="ex.: pixelvault247"></div>
      </div>
      <label>Chave secreta (letras e números que o site mostra)</label>
      <input id="a-segredo" placeholder="ex.: JBSW Y3DP EHPK 3PXP" spellcheck="false" autocomplete="off">
      <p id="a-erro" class="erro"></p>
    </div>
    <div class="linha"><button id="a-voltar">Voltar</button><button id="a-ok" class="primario">Adicionar</button></div>`);
  $('a-voltar').onclick = abrirAutenticador;
  $('a-ok').onclick = async () => {
    $('a-erro').textContent = '';
    try {
      const seg = $('a-segredo').value.trim();
      if (/^otpauth/i.test(seg)) await rpc('autImportar', { textos: [seg] });
      else await rpc('autAdicionar', { segredo: seg, nome: $('a-nome').value, emissor: $('a-emissor').value });
      aviso('Conta adicionada ✓');
      abrirAutenticador();
    } catch (e) { $('a-erro').textContent = e.message; }
  };
  autLigarLeitor(async (texto) => {
    const r = await rpc('autImportar', { textos: [texto] });
    return r;
  }, true);
}

// ----- Importar do Google Authenticator -----
function autGoogleTela() {
  autParar();
  abrirModal(`
    <h2>Importar do Google Authenticator</h2>
    <ol class="aut-passos">
      <li>No celular, abra o <b>Google Authenticator</b>.</li>
      <li>Toque no menu <b>☰</b> (ou nos três pontinhos) → <b>Transferir contas</b> → <b>Exportar contas</b>.</li>
      <li>Marque as contas que quer trazer e toque em <b>Próxima</b>. Vai aparecer um <b>QR Code</b> (com muitas contas, aparecem vários — leia um de cada vez).</li>
      <li>Aqui no PC, use a <b>câmera</b> para ler o QR da tela do celular. Se o PC não tiver câmera, tire uma <b>foto</b> da tela do celular com outro aparelho e cole/escolha a imagem.</li>
    </ol>
    ${autLeitorHtml()}
    <div id="a-lotes" class="aut-lotes"></div>
    <p class="ajuda">As contas continuam no celular também — exportar não apaga nada de lá. Recomendado: deixe Gmail, GitHub e corretoras grandes também no celular.</p>
    <div class="linha"><button id="a-voltar">Concluir</button></div>`);
  $('a-voltar').onclick = abrirAutenticador;
  const vistos = new Set();
  let totalAdd = 0;
  autLigarLeitor(async (texto) => {
    if (vistos.has(texto)) return null;
    vistos.add(texto);
    const r = await rpc('autImportar', { textos: [texto] });
    totalAdd += r.adicionadas;
    const l = r.lotes[0];
    const linha = l ? `QR ${l.indice + 1} de ${l.total} lido ✓` : 'QR lido ✓';
    $('a-lotes').insertAdjacentHTML('beforeend', `<div class="ok">${esc(linha)} — ${r.adicionadas} conta(s) nova(s)${r.repetidas ? `, ${r.repetidas} já existia(m)` : ''}${r.pulados.length ? `, ${r.pulados.length} de contador (não suportada): ${esc(r.pulados.join(', '))}` : ''}</div>`);
    if (l && l.total > 1 && l.indice + 1 < l.total) $('a-lotes').insertAdjacentHTML('beforeend', `<div class="cinza">No celular, toque em <b>Próxima</b> para mostrar o QR ${l.indice + 2}.</div>`);
    $('a-voltar').textContent = `Concluir (${totalAdd} nova${totalAdd === 1 ? '' : 's'})`;
    return r;
  }, false);
}

// ----- Leitor de QR Code: câmera, colar imagem ou escolher arquivo -----
function autLeitorHtml() {
  return `
    <div class="aut-leitor">
      <div class="linha aut-leitor-bt">
        <button id="q-cam">Ler com a câmera do PC</button>
        <button id="q-colar">Colar print/foto (Ctrl+V)</button>
        <button id="q-arquivo">Escolher imagem…</button>
        <input id="q-file" type="file" accept="image/*" class="hidden">
      </div>
      <div id="q-video-box" class="aut-video hidden"><video id="q-video" playsinline muted></video><div class="aut-mira"></div></div>
      <p id="q-msg" class="cinza"></p>
    </div>`;
}

function autLigarLeitor(aoLer, fecharAoLer) {
  const msg = (t, cls) => { const m = $('q-msg'); if (m) { m.className = cls || 'cinza'; m.textContent = t; } };
  const tratar = async (texto) => {
    try {
      const r = await aoLer(texto);
      if (r == null) return false;
      msg(`Lido ✓ (${r.adicionadas} conta(s) nova(s))`, 'ok');
      if (fecharAoLer && r.adicionadas) { aviso('Conta adicionada ✓'); abrirAutenticador(); }
      return true;
    } catch (e) { msg(e.message, 'erro'); return false; }
  };
  const lerImagem = (dataUrl) => new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * escala); cv.height = Math.round(img.height * escala);
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const d = ctx.getImageData(0, 0, cv.width, cv.height);
      const q = window.jsQR ? window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' }) : null;
      res(q ? q.data : null);
    };
    img.onerror = () => res(null);
    img.src = dataUrl;
  });
  const deArquivo = (file) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(file); });
  const processar = async (file) => {
    if (!file) return;
    msg('Lendo a imagem…');
    const texto = await lerImagem(await deArquivo(file));
    if (!texto) { msg('Não encontrei um QR Code nessa imagem. Tente uma foto mais de perto e sem reflexo.', 'erro'); return; }
    await tratar(texto);
  };
  $('q-arquivo').onclick = () => $('q-file').click();
  $('q-file').onchange = () => processar($('q-file').files[0]);
  // colar com Ctrl+V em qualquer lugar da janela
  const colar = (e) => {
    if (!$('q-msg')) { window.removeEventListener('paste', colar); return; }
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); processar(item.getAsFile()); }
  };
  window.addEventListener('paste', colar);
  $('q-colar').onclick = async () => {
    try {
      const itens = await navigator.clipboard.read();
      for (const it of itens) {
        const tipo = it.types.find((t) => t.startsWith('image/'));
        if (tipo) { await processar(await it.getType(tipo)); return; }
      }
      msg('Não tem imagem copiada. Tire o print (Win+Shift+S) e clique de novo, ou aperte Ctrl+V.', 'erro');
    } catch { msg('Aperte Ctrl+V nesta janela para colar o print.', 'cinza'); }
  };
  $('q-cam').onclick = async () => {
    if (autCamera) { autParar(); $('q-video-box').classList.add('hidden'); $('q-cam').textContent = 'Ler com a câmera do PC'; msg(''); return; }
    try {
      autCamera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) { msg('Não consegui abrir a câmera: ' + (e.message || e) + '. Use a opção de foto/print.', 'erro'); return; }
    const v = $('q-video');
    v.srcObject = autCamera;
    await v.play().catch(() => {});
    $('q-video-box').classList.remove('hidden');
    $('q-cam').textContent = 'Desligar câmera';
    msg('Aponte o QR Code do celular para a câmera…');
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    let ocupado = false;
    const passo = async () => {
      if (!autCamera || !$('q-video')) return;
      if (!ocupado && v.videoWidth) {
        cv.width = v.videoWidth; cv.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const d = ctx.getImageData(0, 0, cv.width, cv.height);
        const q = window.jsQR ? window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' }) : null;
        if (q && q.data) { ocupado = true; await tratar(q.data); ocupado = false; }
      }
      setTimeout(passo, 250);
    };
    passo();
  };
}

// ----- Backup cifrado -----
function autBackupTela() {
  autParar();
  abrirModal(`
    <h2>Backup do autenticador</h2>
    <p class="sub">O backup é um arquivo cifrado com a sua senha. Guarde fora do PC (pen drive, nuvem). Para restaurar, use a senha que a carteira tinha quando você fez o backup.</p>
    <label>Sua senha</label><input id="a-senha" type="password">
    <p id="a-erro" class="erro"></p>
    <div class="linha"><button id="a-voltar">Voltar</button><button id="a-rest">Restaurar de um arquivo</button><button id="a-ok" class="primario">Salvar backup</button></div>`);
  $('a-senha').focus();
  $('a-voltar').onclick = abrirAutenticador;
  $('a-ok').onclick = async () => {
    $('a-erro').textContent = '';
    try { const r = await rpc('autBackup', { password: $('a-senha').value }); if (r.salvo) { aviso(`Backup salvo (${r.contas} contas)`); abrirAutenticador(); } } catch (e) { $('a-erro').textContent = e.message; }
  };
  $('a-rest').onclick = async () => {
    $('a-erro').textContent = '';
    try { const r = await rpc('autRestaurar', { password: $('a-senha').value }); if (!r.cancelado) { aviso(`${r.adicionadas} conta(s) restaurada(s)${r.repetidas ? `, ${r.repetidas} já existiam` : ''}`); abrirAutenticador(); } } catch (e) { $('a-erro').textContent = e.message; }
  };
}

$('btn-autenticador').onclick = abrirAutenticador;
