// Solana: SOL e tokens SPL (BONK)
const web3 = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const { parseAmount, fmt } = require('./util');

const conexoes = {};
function conn(cfg) {
  if (!conexoes[cfg.rpc]) conexoes[cfg.rpc] = new web3.Connection(cfg.rpc, 'confirmed');
  return conexoes[cfg.rpc];
}

const keypair = (seed32) => web3.Keypair.fromSeed(seed32);
const endereco = (seed32) => keypair(seed32).publicKey.toBase58();

function validar(addr) {
  try { return new web3.PublicKey(String(addr).trim()); } catch { return null; }
}

// Saldo na conta de token padrão (ATA) — consulta simples, aceita por servidores gratuitos
async function saldoToken(c, dono, mint) {
  const ata = spl.getAssociatedTokenAddressSync(new web3.PublicKey(mint), dono, true);
  try {
    const r = await c.getTokenAccountBalance(ata);
    return { raw: BigInt(r.value.amount), decimals: r.value.decimals };
  } catch (e) {
    if (/could not find account|Invalid param: could not find|not found/i.test(String(e.message))) return { raw: 0n, decimals: null };
    throw e;
  }
}

async function saldo(cfg, asset, addr) {
  const c = conn(cfg);
  const dono = new web3.PublicKey(addr);
  if (asset.native) return { raw: BigInt(await c.getBalance(dono)), decimals: 9 };
  const r = await saldoToken(c, dono, asset.contract);
  return { raw: r.raw, decimals: r.decimals != null ? r.decimals : asset.decimals };
}

// preço por unidade de computação (microlamports) de cada velocidade
const PRIORIDADE = { economica: 0, normal: 20000, rapida: 300000 };
const LIMITE_CU = { nativo: 1000, token: 60000, tokenCriarConta: 90000 };
const ASSINATURA = 5000n;
const ALUGUEL_CONTA_TOKEN = 2039280n; // custo para criar a conta de token do destinatário

async function preparar({ cfg, asset, chave, to, amount, max, velocidade, valorRaw }) {
  const c = conn(cfg);
  const kp = keypair(chave.seed32);
  const dest = validar(to);
  if (!dest) throw new Error('Endereço de destino inválido para a rede Solana.');
  const vel = PRIORIDADE[velocidade] != null ? velocidade : 'normal';
  const solBal = BigInt(await c.getBalance(kp.publicKey));
  const custo = (v, cu) => ASSINATURA + BigInt(Math.ceil((PRIORIDADE[v] * cu) / 1e6));

  if (asset.native) {
    const cu = LIMITE_CU.nativo;
    const fee = custo(vel, cu);
    const value = valorRaw != null ? BigInt(valorRaw) : max ? solBal - fee : parseAmount(amount, 9);
    if (value <= 0n) throw new Error('Saldo de SOL insuficiente para a taxa.');
    if (value + fee > solBal) throw new Error(`Saldo insuficiente: valor + taxa (${fmt(fee, 9)} SOL) passa do saldo de ${fmt(solBal, 9)} SOL.`);
    const destBal = await c.getBalance(dest);
    const minimo = BigInt(await c.getMinimumBalanceForRentExemption(0));
    if (destBal === 0 && value < minimo) throw new Error(`Para uma carteira Solana nova, envie pelo menos ${fmt(minimo, 9)} SOL (regra da rede).`);
    return {
      value, decimals: 9, fee, feeMax: fee, feeDecimals: 9, to: dest.toBase58(), velocidade: vel,
      opcoes: Object.fromEntries(Object.keys(PRIORIDADE).map((v) => [v, custo(v, cu)])), _cu: cu
    };
  }

  const mint = new web3.PublicKey(asset.contract);
  const { raw: tokBal, decimals: dec } = await saldoToken(c, kp.publicKey, asset.contract);
  const decimals = dec != null ? dec : asset.decimals;
  const value = max ? tokBal : parseAmount(amount, decimals);
  if (value <= 0n) throw new Error(`Você não tem ${asset.symbol} nesta carteira.`);
  if (value > tokBal) throw new Error(`Saldo de ${asset.symbol} insuficiente (você tem ${fmt(tokBal, decimals)}).`);
  const ataDest = spl.getAssociatedTokenAddressSync(mint, dest, true);
  const precisaCriar = !(await c.getAccountInfo(ataDest));
  const cu = precisaCriar ? LIMITE_CU.tokenCriarConta : LIMITE_CU.token;
  const fee = custo(vel, cu) + (precisaCriar ? ALUGUEL_CONTA_TOKEN : 0n);
  return {
    value, decimals, fee, feeMax: fee, feeDecimals: 9, to: dest.toBase58(), velocidade: vel,
    opcoes: Object.fromEntries(Object.keys(PRIORIDADE).map((v) => [v, custo(v, cu) + (precisaCriar ? ALUGUEL_CONTA_TOKEN : 0n)])),
    feeLabel: precisaCriar ? '≈ (inclui criar a conta do token no destino)' : '≈',
    nativeBal: solBal, faltaTaxa: fee > solBal ? fee - solBal : 0n, _cu: cu, _criar: precisaCriar, _ataDest: ataDest
  };
}

async function enviar(args) {
  const prep = await preparar(args);
  if (prep.faltaTaxa > 0n) {
    throw new Error(`Para enviar ${args.asset.symbol} você precisa de cerca de ${fmt(prep.fee, 9)} SOL nesta carteira para a taxa. Saldo atual: ${fmt(prep.nativeBal, 9)} SOL.`);
  }
  const c = conn(args.cfg);
  const kp = keypair(args.chave.seed32);
  const dest = new web3.PublicKey(prep.to);
  const tx = new web3.Transaction();
  tx.add(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: prep._cu }));
  if (PRIORIDADE[prep.velocidade] > 0) tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORIDADE[prep.velocidade] }));
  if (args.asset.native) {
    tx.add(web3.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: dest, lamports: prep.value }));
  } else {
    const mint = new web3.PublicKey(args.asset.contract);
    const ataOrigem = spl.getAssociatedTokenAddressSync(mint, kp.publicKey, true);
    if (prep._criar) {
      tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, prep._ataDest, dest, mint));
    }
    tx.add(spl.createTransferCheckedInstruction(ataOrigem, mint, prep._ataDest, kp.publicKey, prep.value, prep.decimals));
  }
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = kp.publicKey;
  tx.sign(kp);
  const hash = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
  return { ...prep, hash };
}

async function confirmar(cfg, sig) {
  const c = conn(cfg);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const s = (await c.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return s.err ? 'falhou' : 'ok';
    } catch { /* tenta de novo */ }
  }
  return 'pendente';
}

module.exports = { endereco, validar, saldo, preparar, enviar, confirmar };
