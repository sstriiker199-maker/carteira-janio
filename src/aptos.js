// Aptos (APT). Chave ed25519 no caminho m/44'/637'/i'/0'/0' (padrão da Petra e da Trust Wallet)
const { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey, AccountAddress } = require('@aptos-labs/ts-sdk');
const { parseAmount, fmt } = require('./util');

const clientes = {};
function client(cfg) {
  const k = cfg.rpc + '|' + (cfg.apiKey || '');
  if (!clientes[k]) {
    clientes[k] = new Aptos(new AptosConfig({
      network: Network.MAINNET, fullnode: cfg.rpc,
      clientConfig: cfg.apiKey ? { API_KEY: cfg.apiKey } : undefined
    }));
  }
  return clientes[k];
}
const conta = (seed32) => Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(Uint8Array.from(seed32)) });
const endereco = (seed32) => conta(seed32).accountAddress.toString();

function validar(a) {
  a = String(a || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(a)) return null; // 0x + 64 (endereço 0x de 40 é de outra rede)
  try { return AccountAddress.from(a).toStringLong(); } catch { return null; }
}

async function saldoBruto(c, addr) {
  try { return BigInt(await c.getAccountAPTAmount({ accountAddress: addr })); } catch (e) {
    if (/not found|account_not_found|resource_not_found/i.test(String(e.message))) return 0n;
    throw e;
  }
}

async function saldo(cfg, asset, addr) {
  return { raw: await saldoBruto(client(cfg), addr), decimals: 8 };
}

async function montar(c, de, para, value, gas) {
  return c.transaction.build.simple({
    sender: de,
    data: { function: '0x1::aptos_account::transfer', functionArguments: [para, value] },
    options: gas ? { maxGasAmount: gas.max, gasUnitPrice: gas.preco } : undefined
  });
}

async function preparar({ cfg, chave, to, amount, max, valorRaw }) {
  const c = client(cfg);
  const acc = conta(chave.seed32);
  const dest = validar(to);
  if (!dest) throw new Error('Endereço de destino inválido para a rede Aptos (0x seguido de 64 letras/números).');
  const bal = await saldoBruto(c, acc.accountAddress);
  if (bal === 0n) throw new Error('Esta carteira não tem APT.');
  const preco = BigInt((await c.getGasPriceEstimation()).gas_estimate);
  // simula para saber o gás usado (enviar para conta nova gasta mais)
  let usado = 1000n;
  try {
    const tx = await montar(c, acc.accountAddress, dest, 1n, { max: 20000, preco: Number(preco) });
    const [sim] = await c.transaction.simulate.simple({ signerPublicKey: acc.publicKey, transaction: tx });
    if (sim && sim.gas_used) usado = BigInt(sim.gas_used);
  } catch { /* usa a estimativa */ }
  const maxGas = (usado * 15n) / 10n + 50n;
  const feeMax = maxGas * preco;
  const value = valorRaw != null ? BigInt(valorRaw) : max ? bal - feeMax : parseAmount(amount, 8);
  if (value <= 0n) throw new Error(`Sobrou só poeira: ${fmt(bal, 8)} APT não paga a taxa (~${fmt(feeMax, 8)} APT).`);
  if (value + feeMax > bal) throw new Error(`Saldo insuficiente: valor + taxa (${fmt(feeMax, 8)} APT) passa do saldo de ${fmt(bal, 8)} APT.`);
  return { value, decimals: 8, fee: usado * preco, feeMax, feeDecimals: 8, feeLabel: '≈', to: dest, _gas: { max: Number(maxGas), preco: Number(preco) } };
}

async function enviar(args) {
  const prep = await preparar(args);
  const c = client(args.cfg);
  const acc = conta(args.chave.seed32);
  const tx = await montar(c, acc.accountAddress, prep.to, prep.value, prep._gas);
  const r = await c.signAndSubmitTransaction({ signer: acc, transaction: tx });
  return { ...prep, hash: r.hash };
}

async function confirmar(cfg, hash) {
  try {
    const r = await client(cfg).waitForTransaction({ transactionHash: hash, options: { timeoutSecs: 120, checkSuccess: false } });
    return r.success ? 'ok' : 'falhou';
  } catch { return 'pendente'; }
}

module.exports = { endereco, validar, saldo, preparar, enviar, confirmar };
