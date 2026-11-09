# Carteira Janio

Aplicativo de Windows para criar várias carteiras de criptomoedas (ex.: "Janio 1", "Janio 2"), receber e enviar.

**Etapa 1 – redes e moedas:**

| Rede | Moedas |
|---|---|
| Ethereum | ETH, USDT, USDC, SHIB, PEPE, Lucky Block (V2) |
| BNB Chain (BEP-20) | BNB, USDT, USDC |
| Polygon | POL (antigo MATIC), USDT, USDC |
| Avalanche C-Chain | AVAX |
| Tron (TRC-20) | TRX, USDT, USDC |

Próximas etapas: Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Solana, BONK, XRP, Cardano e TON.

## Como instalar
1. Abra a página **Releases** do repositório (menu à direita).
2. Baixe o arquivo **Carteira-Janio-Setup-x.x.x.exe** e abra.
3. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo** (aparece porque o app não tem certificado pago de assinatura).

## Atualizações
No app, clique em **Atualizações** (barra lateral). Quando houver versão nova: **Baixar atualização → Instalar e reiniciar**. Suas carteiras não são apagadas.

## Segurança
- A frase secreta de 12 palavras gera **todas** as carteiras. Anote em papel e guarde bem.
- Ela fica salva só no seu PC, criptografada com a sua senha, em `%APPDATA%\Carteira Janio\carteiras.json`.
- A mesma frase pode ser importada na MetaMask (redes 0x…) ou Trust Wallet. As carteiras seguem o padrão: Janio 1 = conta 1, Janio 2 = conta 2…
- **Teste com valores pequenos** antes de mover quantias grandes.

## Taxas
- Para enviar tokens (USDT, USDC, SHIB, PEPE…) é preciso ter a moeda principal da rede na mesma carteira: ETH na Ethereum, BNB na BNB Chain, POL na Polygon, TRX na Tron.
- USDT na Tron costuma custar alguns TRX por envio.
- A Circle parou de dar suporte ao USDC na rede Tron; prefira outra rede para USDC.

## Para desenvolvedores
```
npm install
npm start
```
Publicar versão nova: aumentar `version` no package.json, criar a tag `vX.Y.Z` e enviar. O GitHub Actions monta o instalador e publica em Releases.
