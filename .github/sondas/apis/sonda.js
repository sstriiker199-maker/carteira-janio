const log = (...a) => console.log('SONDA', ...a.map((x) => typeof x === 'string' ? x : JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v.toString() : v)).map((x) => x.slice(0, 1500)));
const t = async (nome, fn) => { try { log(nome, '=>', await fn()); } catch (e) { log(nome, 'ERRO', String(e && (e.stack || e.message || e)).slice(0, 500)); } };
const get = async (u, o = {}) => { const r = await fetch(u, { ...o, headers: { accept: 'application/json', ...(o.headers || {}) }, signal: AbortSignal.timeout(20000) }); const tx = await r.text(); try { return { s: r.status, j: JSON.parse(tx) }; } catch { return { s: r.status, txt: tx.slice(0, 300) }; } };
const USDT = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const EU = 'UQDKbjIcfM6ezt8KjKJJLshZJJSqX7XOA4ff-W72r5gqPrHF';
(async () => {
  const sdk = require('@ston-fi/sdk');
  const { StonApiClient } = require('@ston-fi/api');
  const api = new StonApiClient();
  let tonAddr;
  await t('asset TON', async () => { const l = await api.searchAssets({ searchString: 'TON', condition: 'asset:essential', limit: 5 }).catch(() => null) || []; const a = await api.queryAssets({ condition: 'asset:essential' }).catch(() => []); const ton = a.find((x) => x.kind === 'Ton' || x.symbol === 'TON'); tonAddr = ton && (ton.contractAddress || ton.contract_address); return { busca: (l || []).slice(0, 3).map((x) => [x.symbol, x.contractAddress, x.kind]), ton }; });
  let sim;
  for (const off of [tonAddr, 'EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S', 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'].filter(Boolean)) {
    await t('sim TON->USDT com ' + off, async () => { const s = await api.simulateSwap({ offerAddress: off, askAddress: USDT, offerUnits: '10000000000', slippageTolerance: '0.01' }); if (!sim) sim = s; return { ask: s.askUnits, min: s.minAskUnits, router: s.router && s.router.address, pton: s.router && s.router.ptonMasterAddress, keys: Object.keys(s).join(',') }; });
  }
  await t('sim USDT->TON', async () => { const s = await api.simulateSwap({ offerAddress: USDT, askAddress: tonAddr || 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c', offerUnits: '20000000', slippageTolerance: '0.01' }); return { ask: s.askUnits, router: s.router && s.router.address }; });
  await t('montar tx', async () => {
    const { TonClient } = require('@ton/ton');
    const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC' });
    const c = sdk.dexFactory(sim.router);
    const router = client.open(c.Router.create(sim.router.address));
    const proxyTon = c.pTON.create(sim.router.ptonMasterAddress);
    const p = await router.getSwapTonToJettonTxParams({ userWalletAddress: EU, proxyTon, offerAmount: sim.offerUnits, askJettonAddress: sim.askAddress, minAskAmount: sim.minAskUnits, queryId: 1 });
    return { to: p.to.toString(), value: p.value.toString(), body: !!p.body };
  });
  const SOLR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const EVMR = '0xF977814e90dA44bFA03b6295A0616a897441aceC';
  await t('debridge bsc->sol', async () => { const r = await get(`https://dln.debridge.finance/v1.0/dln/order/create-tx?srcChainId=56&srcChainTokenIn=0x55d398326f99059fF775485246999027B3197955&srcChainTokenInAmount=50000000000000000000&dstChainId=7565164&dstChainTokenOut=11111111111111111111111111111111&dstChainTokenOutAmount=auto&prependOperatingExpenses=true&dstChainTokenOutRecipient=${SOLR}&senderAddress=${EVMR}&srcChainOrderAuthorityAddress=${EVMR}&dstChainOrderAuthorityAddress=${SOLR}`); return { s: r.s, err: r.j && r.j.errorMessage, out: r.j && r.j.estimation && r.j.estimation.dstChainTokenOut && [r.j.estimation.dstChainTokenOut.amount, r.j.estimation.dstChainTokenOut.recommendedAmount, r.j.estimation.dstChainTokenOut.decimals], txk: r.j && r.j.tx && Object.keys(r.j.tx).join(','), to: r.j && r.j.tx && r.j.tx.to, value: r.j && r.j.tx && r.j.tx.value, fix: r.j && r.j.fixFee, aprov: r.j && r.j.tx && r.j.tx.allowanceTarget, delay: r.j && r.j.order && r.j.order.approximateFulfillmentDelay }; });
  await t('debridge sol->bsc', async () => { const r = await get(`https://dln.debridge.finance/v1.0/dln/order/create-tx?srcChainId=7565164&srcChainTokenIn=11111111111111111111111111111111&srcChainTokenInAmount=500000000&dstChainId=56&dstChainTokenOut=0x55d398326f99059fF775485246999027B3197955&dstChainTokenOutAmount=auto&prependOperatingExpenses=true&dstChainTokenOutRecipient=${EVMR}&senderAddress=${SOLR}&srcChainOrderAuthorityAddress=${SOLR}&dstChainOrderAuthorityAddress=${EVMR}`); return { s: r.s, err: r.j && r.j.errorMessage, out: r.j && r.j.estimation && r.j.estimation.dstChainTokenOut && r.j.estimation.dstChainTokenOut.amount, txk: r.j && r.j.tx && Object.keys(r.j.tx).join(','), dataIni: r.j && r.j.tx && String(r.j.tx.data).slice(0, 12) }; });
  await t('dln status chaves', async () => { const j = (await get('https://stats-api.dln.trade/api/Orders/0x313d90a13e5f54efa3c065a98f1434c59d12ba9f4da8b224533bc56b6ed40d82')).j; return { keys: Object.keys(j).join(','), state: j.state, status: j.status, orderStatus: j.orderStatus }; });
  process.exit(0);
})();
