#!/bin/bash
curl -s -m 20 https://sideshift.ai/api/v2/coins -o coins.json
python3 - <<'PY'
import json
d=json.load(open('coins.json'))
want={'BTC','ETH','ADA','BCH','LTC','DOGE','XRP','USDT','BNB','TRX','USDC','SOL','AVAX','POL','SHIB','PEPE','BONK','TON','LBLOCK'}
for c in d:
    if c['coin'].upper() in want:
        print(c['coin'], ','.join(c['networks']), 'memo:'+','.join(c.get('networksWithMemo',[]) or []))
PY
curl -s -m 20 https://sideshift.ai/api/v2/permissions; echo
