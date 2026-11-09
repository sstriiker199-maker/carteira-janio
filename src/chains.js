// Redes e moedas da Etapa 1.
// "rpc" é o servidor público padrão de cada rede; dá para trocar em Configurações.

const NETWORKS = {
  ethereum: {
    id: 'ethereum', name: 'Ethereum', kind: 'evm', chainId: 1, symbol: 'ETH',
    standard: 'ERC-20', rpc: 'https://ethereum-rpc.publicnode.com',
    explorer: 'https://etherscan.io/tx/', minPriorityGwei: 0.05
  },
  bsc: {
    id: 'bsc', name: 'BNB Chain', kind: 'evm', chainId: 56, symbol: 'BNB',
    standard: 'BEP-20', rpc: 'https://bsc-rpc.publicnode.com',
    explorer: 'https://bscscan.com/tx/', minPriorityGwei: 0.1
  },
  polygon: {
    id: 'polygon', name: 'Polygon', kind: 'evm', chainId: 137, symbol: 'POL',
    standard: 'Polygon (ERC-20)', rpc: 'https://polygon-bor-rpc.publicnode.com',
    explorer: 'https://polygonscan.com/tx/', minPriorityGwei: 30
  },
  avalanche: {
    id: 'avalanche', name: 'Avalanche C-Chain', kind: 'evm', chainId: 43114, symbol: 'AVAX',
    standard: 'Avalanche C-Chain', rpc: 'https://avalanche-c-chain-rpc.publicnode.com',
    explorer: 'https://snowtrace.io/tx/', minPriorityGwei: 0
  },
  tron: {
    id: 'tron', name: 'Tron', kind: 'tron', symbol: 'TRX',
    standard: 'TRC-20', rpc: 'https://api.trongrid.io',
    explorer: 'https://tronscan.org/#/transaction/'
  }
};

// decimals: para tokens o app sempre lê o valor direto do contrato (o número aqui é só referência).
const ASSETS = [
  // Moedas principais de cada rede
  { id: 'eth',  symbol: 'ETH',  name: 'Ethereum',              network: 'ethereum',  native: true, decimals: 18 },
  { id: 'bnb',  symbol: 'BNB',  name: 'Binance Coin',          network: 'bsc',       native: true, decimals: 18 },
  { id: 'pol',  symbol: 'POL',  name: 'Polygon (antigo MATIC)', network: 'polygon',  native: true, decimals: 18 },
  { id: 'avax', symbol: 'AVAX', name: 'Avalanche',             network: 'avalanche', native: true, decimals: 18 },
  { id: 'trx',  symbol: 'TRX',  name: 'Tron',                  network: 'tron',      native: true, decimals: 6 },

  // USDT
  { id: 'usdt-eth',     symbol: 'USDT', name: 'Tether', network: 'ethereum', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { id: 'usdt-bsc',     symbol: 'USDT', name: 'Tether', network: 'bsc',      contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  { id: 'usdt-polygon', symbol: 'USDT', name: 'Tether', network: 'polygon',  contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
  { id: 'usdt-tron',    symbol: 'USDT', name: 'Tether', network: 'tron',     contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },

  // USDC
  { id: 'usdc-eth',     symbol: 'USDC', name: 'USD Coin', network: 'ethereum', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { id: 'usdc-bsc',     symbol: 'USDC', name: 'USD Coin', network: 'bsc',      contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  { id: 'usdc-polygon', symbol: 'USDC', name: 'USD Coin', network: 'polygon',  contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  { id: 'usdc-tron',    symbol: 'USDC', name: 'USD Coin', network: 'tron',     contract: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', decimals: 6,
    aviso: 'A Circle (emissora do USDC) parou de dar suporte ao USDC na rede Tron. Prefira outra rede para USDC.' },

  // Tokens na rede Ethereum
  { id: 'shib',   symbol: 'SHIB',   name: 'Shiba Inu',         network: 'ethereum', contract: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', decimals: 18 },
  { id: 'pepe',   symbol: 'PEPE',   name: 'Pepe',              network: 'ethereum', contract: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', decimals: 18 },
  { id: 'lblock', symbol: 'LBLOCK', name: 'Lucky Block (V2)',  network: 'ethereum', contract: '0x2b867efd2de4ad2b583ca0cb3df9c4040ef4d329', decimals: null }
];

module.exports = { NETWORKS, ASSETS };
