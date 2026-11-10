# Wallet Pessoal

Carteira de criptomoedas para Windows (Electron + Node.js). Cria várias carteiras a partir de uma frase secreta só, recebe, envia, troca (swap) e mostra os saldos ao vivo.

**Moedas e redes:** BTC, ETH (Ethereum, Arbitrum, Base, Optimism), BNB, POL, AVAX, TRX, SOL, BONK, XRP, TON, ADA, LTC, DOGE, BCH, SHIB, PEPE, Lucky Block V2, USDT (Tron, BNB, Ethereum, Polygon, Arbitrum, Optimism, Solana, TON) e USDC (Ethereum, BNB, Polygon, Tron, Arbitrum, Base, Optimism, Solana).

**Funções:** várias carteiras numa frase, importar da MetaMask (frase ou chave), saldos e preços ao vivo, receber com QR Code, enviar com taxa Econômica/Normal/Rápida em dólar, verificação de endereço (bloqueia rede errada), carteira de taxas automática, Envio rápido, Envios múltiplos, Juntar saldos, Favoritos com Envio Express, comparador de trocas com 11 serviços (SideShift, THORChain, LI.FI, ChangeNOW, Jupiter, STON.fi, deBridge, Exolix, SimpleSwap, StealthEX, LetsExchange), Mercado, Atividade, avisos no Windows e por Gmail, bloqueio automático e atualização automática.

## Montar o programa a partir do código (Windows)

1. Instale o **Node.js 22 LTS**: https://nodejs.org (deixe as opções padrão).
2. Extraia este .zip numa pasta, por exemplo `C:\wallet-pessoal`.
3. Abra o **Prompt de Comando** nessa pasta (na barra de endereço da pasta, digite `cmd` e Enter).
4. Rode, um de cada vez:
   ```
   npm install
   npm start
   ```
   O `npm install` baixa as bibliotecas (leva alguns minutos). O `npm start` abre o programa para testar.
5. Para gerar o instalador `.exe`:
   ```
   npm run dist
   ```
   O instalador fica na pasta `dist`.

## Atualização automática

O programa procura atualizações no GitHub configurado em `src/updater.js` (lista `FONTES`) e em `package.json` → `build.publish`. Quem for usar outra cópia deve trocar esses dados para o próprio repositório do GitHub, ou apagar a lista para não receber atualizações de ninguém.

## Segurança

- A frase secreta de 12 palavras gera **todas** as carteiras. Anote em papel e guarde bem; quem tiver a frase tem o dinheiro.
- Ela fica só no computador, criptografada com a sua senha (scrypt + AES-256-GCM), em `%APPDATA%\Carteira Janio\carteiras.json`.
- As chaves de API e a senha do Gmail ficam cifradas pelo próprio Windows.
- Ative o bloqueio automático em Configurações → Segurança.
- Teste com valores pequenos antes de mover quantias grandes.

## Publicar uma versão nova (para quem mantém o repositório)

Aumente `version` no `package.json` e envie para o GitHub. O GitHub Actions monta o instalador e publica em Releases (`.github/workflows/release.yml`).
