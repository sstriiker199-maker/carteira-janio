const crypto = require('crypto');
const log = (...a) => console.log('SONDA', ...a.map((x) => typeof x === 'string' ? x : JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v.toString() : v)));
const t = async (nome, fn) => { try { log(nome, '=>', await fn()); } catch (e) { log(nome, 'ERRO', String(e && (e.stack || e.message || e)).slice(0, 600)); } };
function derivar(seed, caminho) {
  const h = (k, d) => crypto.createHmac('sha512', k).update(d).digest();
  let I = h(Buffer.from('ed25519 seed'), seed); let k = I.subarray(0, 32); let c = I.subarray(32);
  for (const p of caminho.split('/').slice(1)) { const n = (parseInt(p, 10) | 0x80000000) >>> 0; const i = Buffer.alloc(4); i.writeUInt32BE(n); I = h(c, Buffer.concat([Buffer.alloc(1, 0), k, i])); k = I.subarray(0, 32); c = I.subarray(32); }
  return Buffer.from(k);
}
(async () => {
  const pj = require('@mysten/sui/package.json');
  log('sui versao', pj.version, pj.type, Object.keys(pj.exports || {}).join(' '));
  await t('sui require cjs', async () => { const g = require('@mysten/sui/grpc'); return Object.keys(g); });
  const imp = async (p) => { try { return require(p); } catch (e) { return import(p); } };
  const RICO = '0x02a212de6a9dfa3a69e22387acfbafbb1a9e591bd9d636e7895dcfc8de05f331'; // endereço com SUI (qualquer)
  await t('sui grpc', async () => {
    const { SuiGrpcClient } = await imp('@mysten/sui/grpc');
    const c = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(c)).join(',');
    const core = c.core ? Object.getOwnPropertyNames(Object.getPrototypeOf(c.core)).join(',') : 'sem core';
    let bal; try { bal = await c.core.getBalance({ owner: RICO }); } catch (e) { bal = 'ERRO ' + e.message; }
    let bal2; try { bal2 = await c.getBalance({ owner: RICO }); } catch (e) { bal2 = 'ERRO ' + e.message; }
    return { proto, core, bal, bal2 };
  });
  await t('sui tx dryrun', async () => {
    const { SuiGrpcClient } = await imp('@mysten/sui/grpc');
    const { Transaction } = await imp('@mysten/sui/transactions');
    const { Ed25519Keypair } = await imp('@mysten/sui/keypairs/ed25519');
    const c = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });
    const tx = new Transaction();
    tx.setSender(RICO);
    const [m] = tx.splitCoins(tx.gas, [1n]);
    tx.transferObjects([m], '0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1');
    const bytes = await tx.build({ client: c });
    const fn = c.core.simulateTransaction ? 'simulateTransaction' : c.core.dryRunTransaction ? 'dryRunTransaction' : '?';
    const r = await c.core[fn]({ transaction: bytes });
    const kp = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7));
    return { fn, len: bytes.length, r: JSON.stringify(r, (k, v) => typeof v === 'bigint' ? v.toString() : v).slice(0, 900), kpAddr: kp.toSuiAddress(), temSignExec: typeof c.signAndExecuteTransaction, coreExec: typeof c.core.executeTransaction, waitFor: typeof c.core.waitForTransaction, getTx: typeof c.core.getTransaction };
  });
  await t('polkadot reservas', async () => {
    const { ApiPromise, WsProvider } = require('@polkadot/api');
    const out = {};
    for (const url of ['wss://sys.ibp.network/asset-hub-polkadot', 'wss://asset-hub-polkadot-rpc.n.dwellir.com', 'wss://statemint-rpc-tn.dwellir.com', 'wss://polkadot-asset-hub-rpc.polkadot.io']) {
      try {
        const api = await Promise.race([ApiPromise.create({ provider: new WsProvider(url, 2000, {}, 15000), noInitWarn: true }), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 20000))]);
        out[url] = (await api.rpc.system.chain()).toString() + ' ED=' + api.consts.balances.existentialDeposit.toString() + ' transferAll=' + typeof api.tx.balances.transferAll;
        await api.disconnect();
      } catch (e) { out[url] = 'ERRO ' + e.message.slice(0, 60); }
    }
    return out;
  });
  process.exit(0);
})();
