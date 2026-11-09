#!/bin/bash
t() { code=$(curl -s -o /tmp/r -w '%{http_code}' -m 15 "$@"); echo "$code $(head -c 140 /tmp/r | tr '\n' ' ') <= ${@: -1}"; }
D=DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC
B=qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6
t https://api.bitcore.io/api/DOGE/mainnet/address/$D/balance
t "https://api.bitcore.io/api/DOGE/mainnet/address/$D/?unspent=true&limit=5"
t https://api.bitcore.io/api/DOGE/mainnet/fee/2
t https://api.bitcore.io/api/BCH/mainnet/address/$B/balance
t https://api.bitcore.io/api/BCH/mainnet/fee/2
t https://api.blockchair.com/bitcoin-cash/dashboards/address/$B
t https://api.fullstack.cash/v5/electrumx/balance/bitcoincash:$B
t https://bch1.trezor.io/api/v2/address/bitcoincash:$B
t https://dogechain.info/api/v1/address/balance/$D
