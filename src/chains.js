// Redes e moedas da Etapa 1.
// "rpc" é o servidor público padrão de cada rede; dá para trocar em Configurações.

const NETWORKS = {
  ethereum: {
    id: 'ethereum', rotulo: 'Ethereum (ERC-20)', name: 'Ethereum', kind: 'evm', chainId: 1, symbol: 'ETH',
    standard: 'ERC-20', rpc: 'https://ethereum-rpc.publicnode.com',
    explorer: 'https://etherscan.io/tx/', minPriorityGwei: 0.05
  },
  bsc: {
    id: 'bsc', rotulo: 'BNB Chain (BEP-20)', name: 'BNB Chain', kind: 'evm', chainId: 56, symbol: 'BNB',
    standard: 'BEP-20', rpc: 'https://bsc-rpc.publicnode.com',
    explorer: 'https://bscscan.com/tx/', minPriorityGwei: 0.1
  },
  polygon: {
    id: 'polygon', rotulo: 'Polygon', name: 'Polygon', kind: 'evm', chainId: 137, symbol: 'POL',
    standard: 'Polygon (ERC-20)', rpc: 'https://polygon-bor-rpc.publicnode.com',
    explorer: 'https://polygonscan.com/tx/', minPriorityGwei: 30
  },
  avalanche: {
    id: 'avalanche', rotulo: 'Avalanche C-Chain', name: 'Avalanche C-Chain', kind: 'evm', chainId: 43114, symbol: 'AVAX',
    standard: 'Avalanche C-Chain', rpc: 'https://avalanche-c-chain-rpc.publicnode.com',
    explorer: 'https://snowtrace.io/tx/', minPriorityGwei: 0
  },
  arbitrum: {
    id: 'arbitrum', rotulo: 'Arbitrum One', name: 'Arbitrum', kind: 'evm', chainId: 42161, symbol: 'ETH',
    standard: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com',
    explorer: 'https://arbiscan.io/tx/', minPriorityGwei: 0
  },
  base: {
    id: 'base', rotulo: 'Base', name: 'Base', kind: 'evm', chainId: 8453, symbol: 'ETH', opStack: true,
    standard: 'Base', rpc: 'https://base-rpc.publicnode.com',
    explorer: 'https://basescan.org/tx/', minPriorityGwei: 0.001
  },
  optimism: {
    id: 'optimism', rotulo: 'Optimism', name: 'Optimism', kind: 'evm', chainId: 10, symbol: 'ETH', opStack: true,
    standard: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com',
    explorer: 'https://optimistic.etherscan.io/tx/', minPriorityGwei: 0.001
  },
  bitcoin: {
    id: 'bitcoin', rotulo: 'Bitcoin', name: 'Bitcoin', kind: 'utxo', coin: 'btc', symbol: 'BTC',
    standard: 'Bitcoin', rpc: 'https://mempool.space/api', explorer: 'https://mempool.space/tx/', lento: 30000
  },
  litecoin: {
    id: 'litecoin', rotulo: 'Litecoin', name: 'Litecoin', kind: 'utxo', coin: 'ltc', symbol: 'LTC',
    standard: 'Litecoin', rpc: 'https://litecoinspace.org/api', explorer: 'https://litecoinspace.org/tx/', lento: 30000
  },
  dogecoin: {
    id: 'dogecoin', rotulo: 'Dogecoin', name: 'Dogecoin', kind: 'utxo', coin: 'doge', symbol: 'DOGE',
    standard: 'Dogecoin', rpc: 'https://api.bitcore.io/api/DOGE/mainnet', explorer: 'https://blockchair.com/dogecoin/transaction/', lento: 30000
  },
  bitcoincash: {
    id: 'bitcoincash', rotulo: 'Bitcoin Cash', name: 'Bitcoin Cash', kind: 'utxo', coin: 'bch', symbol: 'BCH',
    standard: 'Bitcoin Cash', rpc: 'https://api.bitcore.io/api/BCH/mainnet', explorer: 'https://blockchair.com/bitcoin-cash/transaction/', lento: 30000
  },
  solana: {
    id: 'solana', rotulo: 'Solana', name: 'Solana', kind: 'solana', symbol: 'SOL',
    standard: 'SPL', rpc: 'https://api.mainnet-beta.solana.com', explorer: 'https://solscan.io/tx/', lento: 6000
  },
  xrp: {
    id: 'xrp', rotulo: 'XRP Ledger', name: 'XRP Ledger', kind: 'xrp', symbol: 'XRP', memo: 'tag',
    standard: 'XRP', rpc: 'wss://xrplcluster.com', explorer: 'https://livenet.xrpl.org/transactions/', lento: 10000
  },
  ton: {
    id: 'ton', rotulo: 'TON', name: 'TON', kind: 'ton', symbol: 'TON', memo: 'comentario',
    standard: 'TON', rpc: 'https://toncenter.com/api/v2/jsonRPC', explorer: 'https://tonviewer.com/', lento: 20000
  },
  cardano: {
    id: 'cardano', rotulo: 'Cardano', name: 'Cardano', kind: 'cardano', symbol: 'ADA',
    standard: 'Cardano', rpc: 'https://api.koios.rest/api/v1', explorer: 'https://cardanoscan.io/transaction/', lento: 30000
  },
  tron: {
    id: 'tron', rotulo: 'Tron (TRC-20)', name: 'Tron', kind: 'tron', symbol: 'TRX',
    standard: 'TRC-20', rpc: 'https://api.trongrid.io',
    explorer: 'https://tronscan.org/#/transaction/'
  }
};

// decimals: para tokens o app sempre lê o valor direto do contrato (o número aqui é só referência).
const ASSETS = [
  { id: 'btc',  symbol: 'BTC',  name: 'Bitcoin',      network: 'bitcoin',     native: true, decimals: 8 },
  { id: 'eth',  symbol: 'ETH',  name: 'Ethereum',     network: 'ethereum',    native: true, decimals: 18 },
  { id: 'ada',  symbol: 'ADA',  name: 'Cardano',      network: 'cardano',     native: true, decimals: 6 },
  { id: 'bch',  symbol: 'BCH',  name: 'Bitcoin Cash', network: 'bitcoincash', native: true, decimals: 8 },
  { id: 'ltc',  symbol: 'LTC',  name: 'Litecoin',     network: 'litecoin',    native: true, decimals: 8 },
  { id: 'doge', symbol: 'DOGE', name: 'Dogecoin',     network: 'dogecoin',    native: true, decimals: 8 },
  { id: 'xrp',  symbol: 'XRP',  name: 'XRP',          network: 'xrp',         native: true, decimals: 6 },

  // USDT
  { id: 'usdt-tron',    symbol: 'USDT', name: 'Tether', network: 'tron',     contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
  { id: 'usdt-bsc',     symbol: 'USDT', name: 'Tether', network: 'bsc',      contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  { id: 'usdt-eth',     symbol: 'USDT', name: 'Tether', network: 'ethereum', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { id: 'usdt-polygon', symbol: 'USDT', name: 'Tether', network: 'polygon',  contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },

  { id: 'bnb',  symbol: 'BNB',  name: 'Binance Coin', network: 'bsc',  native: true, decimals: 18 },
  { id: 'trx',  symbol: 'TRX',  name: 'Tron',         network: 'tron', native: true, decimals: 6 },

  // USDC
  { id: 'usdc-eth',     symbol: 'USDC', name: 'USD Coin', network: 'ethereum', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { id: 'usdc-bsc',     symbol: 'USDC', name: 'USD Coin', network: 'bsc',      contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  { id: 'usdc-polygon', symbol: 'USDC', name: 'USD Coin', network: 'polygon',  contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  { id: 'usdc-tron',    symbol: 'USDC', name: 'USD Coin', network: 'tron',     contract: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', decimals: 6,
    aviso: 'A Circle (emissora do USDC) parou de dar suporte ao USDC na rede Tron. Prefira outra rede para USDC.' },

  { id: 'lblock', symbol: 'LBLOCK', name: 'Lucky Block (V2)', network: 'ethereum', contract: '0x2b867efd2de4ad2b583ca0cb3df9c4040ef4d329', decimals: null },
  { id: 'sol',  symbol: 'SOL',  name: 'Solana',                network: 'solana',    native: true, decimals: 9 },
  { id: 'avax', symbol: 'AVAX', name: 'Avalanche',             network: 'avalanche', native: true, decimals: 18 },
  { id: 'pol',  symbol: 'POL',  name: 'Polygon (antigo MATIC)', network: 'polygon',  native: true, decimals: 18 },
  { id: 'shib', symbol: 'SHIB', name: 'Shiba Inu', network: 'ethereum', contract: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', decimals: 18 },
  { id: 'pepe', symbol: 'PEPE', name: 'Pepe',      network: 'ethereum', contract: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', decimals: 18 },
  { id: 'bonk', symbol: 'BONK', name: 'Bonk',      network: 'solana',   contract: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
  { id: 'ton',  symbol: 'TON',  name: 'Toncoin',   network: 'ton',      native: true, decimals: 9 },
  { id: 'usdt-ton', symbol: 'USDT', name: 'Tether', network: 'ton', contract: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', decimals: 6 },

  // Redes de segunda camada do Ethereum (mesmo endereço 0x...)
  { id: 'eth-arb',  symbol: 'ETH',  name: 'Ethereum', network: 'arbitrum', native: true, decimals: 18 },
  { id: 'usdc-arb', symbol: 'USDC', name: 'USD Coin', network: 'arbitrum', contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  { id: 'usdt-arb', symbol: 'USDT', name: 'Tether',   network: 'arbitrum', contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
  { id: 'eth-base',  symbol: 'ETH',  name: 'Ethereum', network: 'base', native: true, decimals: 18 },
  { id: 'usdc-base', symbol: 'USDC', name: 'USD Coin', network: 'base', contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  { id: 'eth-op',  symbol: 'ETH',  name: 'Ethereum', network: 'optimism', native: true, decimals: 18 },
  { id: 'usdc-op', symbol: 'USDC', name: 'USD Coin', network: 'optimism', contract: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
  { id: 'usdt-op', symbol: 'USDT', name: 'Tether',   network: 'optimism', contract: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },

  // USDT e USDC na Solana
  { id: 'usdt-sol', symbol: 'USDT', name: 'Tether',   network: 'solana', contract: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  { id: 'usdc-sol', symbol: 'USDC', name: 'USD Coin', network: 'solana', contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 }
];

module.exports = { NETWORKS, ASSETS };
