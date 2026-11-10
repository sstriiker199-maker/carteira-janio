// Sonda: confere bibliotecas e nomes de redes nos serviços de troca
const crypto = require('crypto');
const log = (...a) => console.log('SONDA', ...a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)));
const t = async (nome, fn) => { try { log(nome, '=>', await fn()); } catch (e) { log(nome, 'ERRO', String(e && (e.stack || e.message || e)).slice(0, 400)); } };
function derivar(seed, caminho) {
  const h = (k, d) => crypto.createHmac('sha512', k).update(d).digest();
  let I = h(Buffer.from('ed25519 seed'), seed); let k = I.subarray(0, 32); let c = I.subarray(32);
  for (const p of caminho.split('/').slice(1)) { const n = (parseInt(p, 10) | 0x80000000) >>> 0; const i = Buffer.alloc(4); i.writeUInt32BE(n); I = h(c, Buffer.concat([Buffer.alloc(1, 0), k, i])); k = I.subarray(0, 32); c = I.subarray(32); }
  return Buffer.from(k);
}
const get = async (u, h = {}) => { const r = await fetch(u, { headers: { accept: 'application/json', ...h }, signal: AbortSignal.timeout(20000) }); const tx = await r.text(); try { return JSON.parse(tx); } catch { return { status: r.status, txt: tx.slice(0, 200) }; } };
(async () => {
  const { Mnemonic, HDNodeWallet } = require('ethers');
  const frase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const m = Mnemonic.fromPhrase(frase);
  const seed = Buffer.from(m.computeSeed().slice(2), 'hex');

  await t('sui', async () => {
    const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
    const { SuiClient } = require('@mysten/sui/client');
    const kp = Ed25519Keypair.fromSecretKey(derivar(seed, "m/44'/784'/0'/0'/0'"));
    const kp2 = Ed25519Keypair.deriveKeypair(frase, "m/44'/784'/0'/0'/0'");
    const addr = kp.toSuiAddress();
    const out = { addr, igualSDK: addr === kp2.toSuiAddress() };
    for (const url of ['https://fullnode.mainnet.sui.io:443', 'https://sui-rpc.publicnode.com']) {
      try { const c = new SuiClient({ url }); out[url] = (await c.getBalance({ owner: '0x0000000000000000000000000000000000000000000000000000000000000005' })).totalBalance; } catch (e) { out[url] = 'ERRO ' + e.message.slice(0, 80); }
    }
    return out;
  });
  await t('aptos', async () => {
    const { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } = require('@aptos-labs/ts-sdk');
    const acc = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(derivar(seed, "m/44'/637'/0'/0'/0'")) });
    const acc2 = Account.fromDerivationPath({ path: "m/44'/637'/0'/0'/0'", mnemonic: frase });
    const aptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
    let bal; try { bal = await aptos.getAccountAPTAmount({ accountAddress: '0x1' }); } catch (e) { bal = 'ERRO ' + e.message.slice(0, 100); }
    let bal2; try { bal2 = await aptos.getAccountAPTAmount({ accountAddress: acc.accountAddress }); } catch (e) { bal2 = 'ERRO ' + e.message.slice(0, 100); }
    return { addr: acc.accountAddress.toString(), igualSDK: acc.accountAddress.toString() === acc2.accountAddress.toString(), bal0x1: bal, balNovo: bal2 };
  });
  await t('cosmos', async () => {
    const { DirectSecp256k1Wallet } = require('@cosmjs/proto-signing');
    const { StargateClient } = require('@cosmjs/stargate');
    const w = HDNodeWallet.fromMnemonic(m, "m/44'/118'/0'/0/0");
    const cw = await DirectSecp256k1Wallet.fromKey(Buffer.from(w.privateKey.slice(2), 'hex'), 'cosmos');
    const [a] = await cw.getAccounts();
    const out = { addr: a.address, esperado: 'cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4' };
    for (const url of ['https://cosmos-rpc.publicnode.com:443', 'https://rpc.cosmos.directory/cosmoshub']) {
      try { const c = await StargateClient.connect(url); out[url] = (await c.getBalance(a.address, 'uatom')).amount; } catch (e) { out[url] = 'ERRO ' + e.message.slice(0, 80); }
    }
    try { out.feemarket = await get('https://cosmos-rest.publicnode.com/feemarket/v1/gas_price/uatom'); } catch (e) { out.feemarket = e.message; }
    return out;
  });
  await t('polkadot', async () => {
    const { ApiPromise, WsProvider } = require('@polkadot/api');
    const { Keyring } = require('@polkadot/keyring');
    const { cryptoWaitReady } = require('@polkadot/util-crypto');
    await cryptoWaitReady();
    const kr = new Keyring({ type: 'ed25519', ss58Format: 0 });
    const par = kr.addFromSeed(derivar(seed, "m/44'/354'/0'/0'/0'"));
    const out = { addr: par.address, esperadoTrust: '14mXLqz2wqMPvYsZ5mCcwMBkr6wV38ZqbAG7qBY4cMu2vH4z?' };
    for (const url of ['wss://polkadot-asset-hub-rpc.polkadot.io', 'wss://asset-hub-polkadot-rpc.dwellir.com']) {
      try {
        const api = await Promise.race([ApiPromise.create({ provider: new WsProvider(url), noInitWarn: true }), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 25000))]);
        const ed = api.consts.balances.existentialDeposit.toString();
        const acc = await api.query.system.account(par.address);
        const tx = api.tx.balances.transferKeepAlive(par.address, 10n ** 9n);
        let fee; try { fee = (await tx.paymentInfo(par)).partialFee.toString(); } catch (e) { fee = 'ERRO ' + e.message.slice(0, 80); }
        out[url] = { ed, free: acc.data.free.toString(), fee, chain: (await api.rpc.system.chain()).toString() };
        await api.disconnect();
      } catch (e) { out[url] = 'ERRO ' + e.message.slice(0, 80); }
    }
    return out;
  });
  await t('sideshift redes', async () => {
    const l = await get('https://sideshift.ai/api/v2/coins');
    if (!Array.isArray(l)) return l;
    const quer = ['SUI', 'APT', 'ATOM', 'DOT', 'ETH', 'USDC', 'USDT'];
    return Object.fromEntries(quer.map((s) => [s, (l.find((c) => c.coin === s) || {}).networks]));
  });
  await t('changenow v1 redes', async () => {
    const l = await get('https://api.changenow.io/v1/currencies?active=true&fixedRate=false');
    if (!Array.isArray(l)) return l;
    const tick = ['sui', 'apt', 'atom', 'dot', 'eth', 'ethbase', 'etharb', 'ethop', 'usdcarb', 'usdcbase', 'usdcop', 'usdtarb', 'usdtop', 'arb', 'op'];
    return l.filter((c) => tick.includes(c.ticker) || /arbitrum|base|optimism|polkadot|aptos|cosmos|\bsui\b/i.test(c.name)).slice(0, 40).map((c) => c.ticker + ':' + c.name);
  });
  await t('changenow v2 sem chave', async () => {
    const l = await get('https://api.changenow.io/v2/exchange/currencies?active=true&flow=standard');
    if (!Array.isArray(l)) return l;
    const nets = ['arbitrum', 'base', 'op', 'optimism', 'sui', 'apt', 'aptos', 'atom', 'cosmos', 'dot', 'polkadot', 'dotah', 'assethub'];
    return l.filter((c) => nets.includes(String(c.network).toLowerCase()) && ['eth', 'usdc', 'usdt', 'sui', 'apt', 'atom', 'dot'].includes(c.ticker)).map((c) => c.ticker + '@' + c.network);
  });
  await t('changenow v2 dot', async () => {
    const l = await get('https://api.changenow.io/v2/exchange/currencies?active=true&flow=standard');
    if (!Array.isArray(l)) return l;
    return l.filter((c) => ['dot', 'atom', 'apt', 'sui'].includes(c.ticker) || /dot|polkadot/.test(String(c.network))).map((c) => c.ticker + '@' + c.network);
  });
  await t('lifi chains', async () => {
    const j = await get('https://li.quest/v1/chains?chainTypes=EVM,SVM,MVM,UTXO');
    return (j.chains || []).filter((c) => [42161, 8453, 10].includes(c.id) || /sui|aptos/i.test(c.name)).map((c) => c.id + ':' + c.name + ':' + c.chainType);
  });
  await t('thor pools', async () => {
    const j = await get('https://gateway.liquify.com/chain/thorchain_api/thorchain/pools');
    if (!Array.isArray(j)) return j;
    return j.filter((p) => /^(BASE|GAIA|ETH\.ETH|ARB)/.test(p.asset)).map((p) => p.asset + ':' + p.status);
  });
  await t('thor inbound', async () => {
    const j = await get('https://gateway.liquify.com/chain/thorchain_api/thorchain/inbound_addresses');
    return Array.isArray(j) ? j.map((x) => x.chain + (x.halted ? ' HALT' : '') + (x.chain_trading_paused ? ' PAUSA' : '')) : j;
  });
  await t('binance precos', async () => (await get('https://data-api.binance.vision/api/v3/ticker/price?symbols=' + encodeURIComponent(JSON.stringify(['SUIUSDT', 'APTUSDT', 'ATOMUSDT', 'DOTUSDT'])))));
  for (const [n, u] of [['arb', 'https://arbitrum-one-rpc.publicnode.com'], ['base', 'https://base-rpc.publicnode.com'], ['op', 'https://optimism-rpc.publicnode.com']]) {
    await t('rpc ' + n, async () => { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) }); return (await r.json()).result; });
  }
  await t('icones trust', async () => {
    const o = {};
    for (const c of ['sui', 'aptos', 'cosmos', 'polkadot', 'arbitrum', 'base', 'optimism']) { const r = await fetch(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${c}/info/logo.png`); o[c] = r.status; }
    return o;
  });
  process.exit(0);
})();
