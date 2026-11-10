#!/bin/bash
t() { code=$(curl -s -o /tmp/r -w '%{http_code}' -m 15 "$@"); echo "$code $(head -c 120 /tmp/r | tr '\n' ' ') <= ${@: -1}"; }
Q="from_asset=BTC.BTC&to_asset=ETH.ETH&amount=1000000&destination=0x9858EfFD232B4033E47d90003D41EC34EcaEda94"
t "https://thornode.ninerealms.com/thorchain/quote/swap?$Q"
t "https://thornode-v2.ninerealms.com/thorchain/quote/swap?$Q"
t "https://thornode.thorchain.liquify.com/thorchain/quote/swap?$Q"
t "https://thornode.thorswap.net/thorchain/quote/swap?$Q"
t "https://api-thornode.thorchain.network/thorchain/quote/swap?$Q"
t "https://gateway.liquify.com/chain/thorchain_api/thorchain/quote/swap?$Q"
