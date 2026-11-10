const log = (...a) => console.log('SONDA', ...a.map((x) => typeof x === 'string' ? x : JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v.toString() : v)).map((x) => x.slice(0, 1800)));
const t = async (nome, fn) => { try { log(nome, '=>', await fn()); } catch (e) { log(nome, 'ERRO', String(e && (e.stack || e.message || e)).slice(0, 500)); } };
const get = async (u, o = {}) => { const r = await fetch(u, { ...o, headers: { accept: 'application/json', ...(o.headers || {}) }, signal: AbortSignal.timeout(20000) }); const tx = await r.text(); try { return { s: r.status, j: JSON.parse(tx) }; } catch { return { s: r.status, txt: tx.slice(0, 300) }; } };
const USDT = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const EU = 'UQDKbjIcfM6ezt8KjKJJLshZJJSqX7XOA4ff-W72r5gqPrHF';
(async () => {
  const fs = require('fs');
  log('versoes', JSON.parse(fs.readFileSync('node_modules/@ston-fi/sdk/package.json')).version, JSON.parse(fs.readFileSync('node_modules/@ston-fi/api/package.json')).version);
  const sdk = require('@ston-fi/sdk');
  log('sdk exports', Object.keys(sdk).join(','));
  const { StonApiClient } = require('@ston-fi/api');
  const api = new StonApiClient();
  log('api metodos', Object.getOwnPropertyNames(Object.getPrototypeOf(api)).join(','));
  let sim;
  await t('simulate TON->USDT', async () => {
    const tonAddr = sdk.pTON && sdk.pTON.v2_1 ? null : null;
    sim = await api.simulateSwap({ offerAddress: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c', askAddress: USDT, offerUnits: '10000000000', slippageTolerance: '0.01' });
    return sim;
  });
  await t('simulate USDT->TON', async () => api.simulateSwap({ offerAddress: USDT, askAddress: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c', offerUnits: '20000000', slippageTolerance: '0.01' }));
  await t('montar tx TON->USDT', async () => {
    const { TonClient } = require('@ton/ton');
    const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC' });
    const contratos = sdk.dexFactory(sim.router);
    const router = client.open(contratos.Router.create(sim.router.address));
    const proxyTon = contratos.pTON.create(sim.router.ptonMasterAddress);
    const p = await router.getSwapTonToJettonTxParams({ userWalletAddress: EU, proxyTon, offerAmount: sim.offerUnits, askJettonAddress: sim.askAddress, minAskAmount: sim.minAskUnits, queryId: 1 });
    return { to: p.to.toString(), value: p.value.toString(), body: !!p.body, keys: Object.keys(p).join(',') };
  });
  await t('debridge bsc->sol', async () => { const r = await get('https://dln.debridge.finance/v1.0/dln/order/create-tx?srcChainId=56&srcChainTokenIn=0x55d398326f99059fF775485246999027B3197955&srcChainTokenInAmount=50000000000000000000&dstChainId=7565164&dstChainTokenOut=11111111111111111111111111111111&dstChainTokenOutAmount=auto&prependOperatingExpenses=true&dstChainTokenOutRecipient=GjJyeC1r2RgkuoCWMyPYkCWSGSGLcz266EaAkLA27AhL&senderAddress=0x9858EfFD232B4033E47d90003D41EC34EcaEda94&srcChainOrderAuthorityAddress=0x9858EfFD232B4033E47d90003D41EC34EcaEda94&dstChainOrderAuthorityAddress=GjJyeC1r2RgkuoCWMyPYkCWSGSGLcz266EaAkLA27AhL'); return { s: r.s, err: r.j && r.j.errorMessage, out: r.j && r.j.estimation && r.j.estimation.dstChainTokenOut, txk: r.j && r.j.tx && Object.keys(r.j.tx).join(','), to: r.j && r.j.tx && r.j.tx.to, value: r.j && r.j.tx && r.j.tx.value, fix: r.j && r.j.fixFee, aprov: r.j && r.j.tx && r.j.tx.allowanceTarget, orderId: r.j && r.j.orderId, est: r.j && r.j.order && r.j.order.approximateFulfillmentDelay }; });
  await t('debridge sol->bsc', async () => { const r = await get('https://dln.debridge.finance/v1.0/dln/order/create-tx?srcChainId=7565164&srcChainTokenIn=11111111111111111111111111111111&srcChainTokenInAmount=500000000&dstChainId=56&dstChainTokenOut=0x55d398326f99059fF775485246999027B3197955&dstChainTokenOutAmount=auto&prependOperatingExpenses=true&dstChainTokenOutRecipient=0x9858EfFD232B4033E47d90003D41EC34EcaEda94&senderAddress=GjJyeC1r2RgkuoCWMyPYkCWSGSGLcz266EaAkLA27AhL&srcChainOrderAuthorityAddress=GjJyeC1r2RgkuoCWMyPYkCWSGSGLcz266EaAkLA27AhL&dstChainOrderAuthorityAddress=0x9858EfFD232B4033E47d90003D41EC34EcaEda94'); return { s: r.s, err: r.j && r.j.errorMessage, out: r.j && r.j.estimation && r.j.estimation.dstChainTokenOut && r.j.estimation.dstChainTokenOut.amount, txk: r.j && r.j.tx && Object.keys(r.j.tx).join(','), dataIni: r.j && r.j.tx && String(r.j.tx.data).slice(0, 12) }; });
  await t('dln order status', async () => (await get('https://stats-api.dln.trade/api/Orders/0x313d90a13e5f54efa3c065a98f1434c59d12ba9f4da8b224533bc56b6ed40d82')).j);
  await t('exolix TON native', async () => { const r = await get('https://exolix.com/api/v2/currencies?search=TON&withNetworks=true&size=10'); return (r.j.data || []).map((c) => c.code + ':' + c.networks.map((n) => n.network).join('/')); });
  await t('exolix rate SOL->USDT TRX', async () => (await get('https://exolix.com/api/v2/rate?coinFrom=SOL&networkFrom=SOL&coinTo=USDT&networkTo=TRX&amount=1&rateType=float')).j);
  await t('exolix rate pequeno', async () => (await get('https://exolix.com/api/v2/rate?coinFrom=SOL&networkFrom=SOL&coinTo=USDT&networkTo=TRX&amount=0.001&rateType=float')));
  process.exit(0);
})();
