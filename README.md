# Wallet - Trabalho

Aplicativo de Windows para criar várias carteiras de criptomoedas (ex.: "Janio 1", "Janio 2"), receber e enviar.

**Moedas:** BTC, ETH, ADA, BCH, LTC, DOGE, XRP, USDT (Tron, BNB, Ethereum, Polygon), BNB, TRX, USDC (Ethereum, BNB, Polygon, Tron), Lucky Block V2, SOL, AVAX, POL, SHIB, PEPE, BONK e TON.

**Funções:** várias carteiras numa frase só, importar carteira (MetaMask), saldos ao vivo com preço e variação 24h, total em dólar, busca de moeda, receber com QR Code, enviar com taxa Econômica/Normal/Rápida em dólar, verificação de endereço, carteira de taxas automática, envios múltiplos, juntar saldos, favoritos, troca (swap) via SideShift, aba Mercado, aba Atividade, notificações no Windows e por Gmail, atualização automática.

## Como instalar
1. Abra a página **Releases** do repositório (menu à direita).
2. Baixe o arquivo **Wallet-Trabalho-Setup-x.x.x.exe** e abra.
3. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo** (aparece porque o app não tem certificado pago de assinatura).

## Atualizações
No app, clique em **Atualizações** (barra lateral). Quando houver versão nova: **Baixar atualização → Instalar e reiniciar**. Suas carteiras não são apagadas.

## Segurança
- A frase secreta de 12 palavras gera **todas** as carteiras. Anote em papel e guarde bem.
- Ela fica salva só no seu PC, criptografada com a sua senha, em `%APPDATA%\Wallet - Trabalho\carteiras.json`.
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
