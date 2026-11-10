const log = (...a) => console.log('SONDA', ...a.map((x) => typeof x === 'string' ? x : JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v.toString() : v)).map((x) => x.slice(0, 1500)));
const t = async (nome, fn) => { try { log(nome, '=>', await fn()); } catch (e) { log(nome, 'ERRO', String(e && (e.stack || e.message || e)).slice(0, 600)); } };
(async () => {
  await t('sideshift ton', async () => { const l = await (await fetch('https://sideshift.ai/api/v2/coins')).json(); return l.filter((c) => /ton/i.test(c.coin) || (c.networks || []).includes('ton')).map((c) => ({ coin: c.coin, networks: c.networks, depOff: c.depositOffline, setOff: c.settleOffline })); });
  const { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } = require('@aptos-labs/ts-sdk');
  const aptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
  const acc = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(new Uint8Array(32).fill(3)) });
  await t('gas price', () => aptos.getGasPriceEstimation());
  await t('simulate', async () => {
    const tx = await aptos.transaction.build.simple({ sender: '0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf', data: { function: '0x1::aptos_account::transfer', functionArguments: ['0xf867372dfec13fb6c0740d4b574363685e10e6f243e9554ffa8f6e698e940efa', 1] }, options: { maxGasAmount: 20000, gasUnitPrice: 100 } });
    const [s] = await aptos.transaction.simulate.simple({ signerPublicKey: acc.publicKey, transaction: tx });
    return { gas_used: s.gas_used, success: s.success, vm: s.vm_status, price: s.gas_unit_price };
  });
  process.exit(0);
})();
