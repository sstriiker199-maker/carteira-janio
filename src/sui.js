// Sui (SUI). Chave ed25519 no caminho m/44'/784'/i'/0'/0' (padrão da Sui Wallet e da Trust Wallet)
const { SuiGrpcClient } = require('@mysten/sui/grpc');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { Transaction } = require('@mysten/sui/transactions');
const { isValidSuiAddress, normalizeSuiAddress } = require('@mysten/sui/utils');
const { parseAmount, fmt } = require('./util');

const clientes = {};
const client = (cfg) => (clientes[cfg.rpc] = clientes[cfg.rpc] || new SuiGrpcClient({ network: 'mainnet', baseUrl: cfg.rpc }));
const saldoDe = async (c, owner) => BigInt((await c.getBalance({ owner })).balance.balance);
const resultado = (r) => r.Transaction || r.FailedTransaction || r;
const par = (seed32) => Ed25519Keypair.fromSecretKey(Uint8Array.from(seed32));
const endereco = (seed32) => par(seed32).toSuiAddress();

function validar(a) {
  a = String(a || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(a)) return null; // 0x + 64 (endereço 0x de 40 é de outra rede)
  return isValidSuiAddress(normalizeSuiAddress(a)) ? normalizeSuiAddress(a) : null;
}

async function saldo(cfg, asset, addr) {
  return { raw: await saldoDe(client(cfg), addr), decimals: 9 };
}

function montar(de, para, value, orcamento) {
  const tx = new Transaction();
  tx.setSender(de);
  if (orcamento) tx.setGasBudget(orcamento);
  const [moeda] = tx.splitCoins(tx.gas, [value]);
  tx.transferObjects([moeda], para);
  return tx;
}

// custo real da transação simulando na rede
async function custo(c, tx) {
  const bytes = await tx.build({ client: c });
  const r = resultado(await c.simulateTransaction({ transaction: bytes, include: { effects: true } }));
  if (!r.status || !r.status.success) throw new Error('A rede Sui recusou a simulação: ' + JSON.stringify((r.status && r.status.error) || 'erro').slice(0, 160));
  const g = r.effects.gasUsed;
  const total = BigInt(g.computationCost) + BigInt(g.storageCost) - BigInt(g.storageRebate);
  const teto = ((BigInt(g.computationCost) + BigInt(g.storageCost)) * 15n) / 10n;
  return { total: total > 0n ? total : 0n, teto };
}

async function preparar({ cfg, chave, to, amount, max, valorRaw }) {
  const c = client(cfg);
  const kp = par(chave.seed32);
  const de = kp.toSuiAddress();
  const dest = validar(to);
  if (!dest) throw new Error('Endereço de destino inválido para a rede Sui (0x seguido de 64 letras/números).');
  const bal = await saldoDe(c, de);
  if (bal === 0n) throw new Error('Esta carteira não tem SUI.');
  // simula com um valor pequeno para saber a taxa
  const sim = await custo(c, montar(de, dest, 1n)).catch((e) => {
    if (/insufficient|balance|gas/i.test(e.message)) throw new Error(`Saldo de SUI insuficiente para a taxa (saldo ${fmt(bal, 9)} SUI).`);
    throw e;
  });
  const fee = sim.teto;
  const value = valorRaw != null ? BigInt(valorRaw) : max ? bal - fee : parseAmount(amount, 9);
  if (value <= 0n) throw new Error(`Sobrou só poeira: ${fmt(bal, 9)} SUI não paga a taxa (~${fmt(fee, 9)} SUI).`);
  if (value + fee > bal) throw new Error(`Saldo insuficiente: valor + taxa (${fmt(fee, 9)} SUI) passa do saldo de ${fmt(bal, 9)} SUI.`);
  return { value, decimals: 9, fee: sim.total, feeMax: fee, feeDecimals: 9, feeLabel: '≈', to: dest };
}

async function enviar(args) {
  const prep = await preparar(args);
  const c = client(args.cfg);
  const kp = par(args.chave.seed32);
  const tx = montar(kp.toSuiAddress(), prep.to, prep.value, prep.feeMax);
  const r = resultado(await c.signAndExecuteTransaction({ signer: kp, transaction: tx, include: { effects: true } }));
  if (r.status && r.status.success === false) throw new Error('A rede Sui recusou: ' + JSON.stringify(r.status.error).slice(0, 160));
  return { ...prep, hash: r.digest };
}

async function confirmar(cfg, digest) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const r = resultado(await client(cfg).getTransaction({ digest, include: { effects: true } }));
      if (r.status) return r.status.success ? 'ok' : 'falhou';
    } catch { /* ainda não */ }
  }
  return 'pendente';
}

module.exports = { endereco, validar, saldo, preparar, enviar, confirmar };
