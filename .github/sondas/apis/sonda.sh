set +e
git clone -q --depth 1 https://github.com/EdgeApp/edge-exchange-plugins edge
git clone -q --depth 1 https://github.com/SwapzyCC/stealthex-sdk sx
echo "===ARQUIVOS EDGE"; ls edge/src/swap/central edge/src/mappings 2>/dev/null | tr '\n' ' '
for f in letsexchange exolix stealthex simpleswap; do
  for p in edge/src/swap/central/$f.ts; do [ -f $p ] && { echo "===FILE $p"; cat $p; }; done
  for p in edge/src/mappings/$f.ts; do [ -f $p ] && { echo "===FILE $p"; grep -E "bitcoin|ethereum|binancesmartchain|polygon|avalanche|tron|solana|ripple|ton|cardano|litecoin|dogecoin|bitcoincash|arbitrum|base|optimism|sui|aptos|cosmoshub|polkadot" $p | head -60; }; done
done
echo "===FILE sx types"; cat sx/src/types.ts 2>/dev/null | head -250; ls sx/src
