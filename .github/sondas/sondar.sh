#!/bin/bash
# Testa quais servidores gratuitos respondem
t() { code=$(curl -s -o /tmp/r -w '%{http_code}' -m 15 "$@"); echo "$code $(head -c 160 /tmp/r | tr '\n' ' ') <= ${@: -1}"; }
A_BTC=bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu
t https://mempool.space/api/address/$A_BTC
t https://mempool.space/api/v1/fees/recommended
t https://litecoinspace.org/api/address/ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh
t https://litecoinspace.org/api/v1/fees/recommended
t https://doge1.trezor.io/api/v2/address/DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC
t https://doge1.trezor.io/api/v2/estimatefee/2
t https://api.blockcypher.com/v1/doge/main/addrs/DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC/balance
t https://dogechain.info/api/v1/address/balance/DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC
t https://api.blockchair.com/dogecoin/dashboards/address/DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC
t https://bch1.trezor.io/api/v2/address/bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6
t https://api.fullstack.cash/v5/electrumx/balance/bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6
t https://api.blockchair.com/bitcoin-cash/dashboards/address/qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6
t https://ltc1.trezor.io/api/v2/address/ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh
t https://btc1.trezor.io/api/v2/address/$A_BTC
t https://api.koios.rest/api/v1/tip
t https://toncenter.com/api/v2/getAddressBalance?address=EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N
t https://toncenter.com/api/v3/walletInformation?address=EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N
t -X POST -H 'content-type: application/json' -d '{"method":"server_info","params":[{}]}' https://s1.ripple.com:51234/
t -X POST -H 'content-type: application/json' -d '{"method":"server_info","params":[{}]}' https://xrplcluster.com/
t -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' https://solana-rpc.publicnode.com
t -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' https://api.mainnet-beta.solana.com
