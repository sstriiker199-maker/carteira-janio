const log = (...a) => console.log('SONDA', ...a.map((x) => typeof x === 'string' ? x : JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v.toString() : v)).map((x) => x.slice(0, 1200)));
const t = async (nome, fn) => { try { log(nome, '=>', await fn()); } catch (e) { log(nome, 'ERRO', String(e && (e.stack || e.message || e)).slice(0, 600)); } };
(async () => {
  const { SuiGrpcClient } = require('@mysten/sui/grpc');
  const { Transaction } = require('@mysten/sui/transactions');
  const c = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });
  const RICO = '0x02a212de6a9dfa3a69e22387acfbafbb1a9e591bd9d636e7895dcfc8de05f331';
  await t('getBalance', () => c.getBalance({ owner: RICO }));
  await t('getBalance vazio', () => c.getBalance({ owner: '0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1' }));
  await t('gasPrice', () => c.getReferenceGasPrice());
  const tx = new Transaction();
  tx.setSender(RICO);
  const [m] = tx.splitCoins(tx.gas, [1n]);
  tx.transferObjects([m], '0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1');
  const bytes = await tx.build({ client: c });
  await t('simulate effects', async () => { const r = await c.simulateTransaction({ transaction: bytes, include: { effects: true } }); const T = r.Transaction || r.FailedTransaction || r; return { kind: r.$kind, status: T.status, gas: T.effects && T.effects.gasUsed, keys: Object.keys(T) }; });
  await t('getTransaction', async () => {
    const l = await c.listTransactions ? null : null;
    const r = await c.getTransaction({ digest: 'GpGzW6E9oRAxtQJMH2qpB7LuHo1QY3AwQxoFDtbzJrFh', include: { effects: true } });
    const T = r.Transaction || r.FailedTransaction || r; return { kind: r.$kind, status: T.status, keys: Object.keys(T) };
  });
  await t('getTransaction inexistente', async () => {
    const r = await c.getTransaction({ digest: '11111111111111111111111111111111' }); return r;
  });
  process.exit(0);
})();
