#!/bin/bash
# Failover do Auto Posto Amaral: direto (wg1, métrica 1) ⇄ relay VPS (wg2, métrica 10).
# Roda como root pelo cron a cada minuto. Critério: idade do último handshake do peer
# direto no wg1. > MAX_AGE s → relay na frente; ≤ MAX_AGE → direto na frente.
set -u
PEER="PUB_WG_DIRECT_APA"          # chave pública do wg-direct do MK (ajustada na instalação)
NETS="192.168.11.0/24 10.0.0.0/24"
MAX_AGE=150
TAG=wg-apa-failover

now=$(date +%s)
hs=$(wg show wg1 latest-handshakes | awk -v k="$PEER" '$1==k{print $2}')
hs=${hs:-0}
age=$((now - hs))

# métrica atual do direto: 1 = direto na frente, 20 = relay na frente
cur=$(ip route show 192.168.11.0/24 dev wg1 | grep -o 'metric [0-9]*' | awk '{print $2}' | head -1)
cur=${cur:-1}

# `ip route replace` só substitui rota com a MESMA métrica; por isso apaga e recria.
setmetric() {
  for n in $NETS; do
    while ip route del "$n" dev wg1 2>/dev/null; do :; done
    ip route add "$n" dev wg1 metric "$1"
  done
}

if [ "$age" -gt "$MAX_AGE" ] && [ "$cur" != "20" ]; then
  setmetric 20
  logger -t "$TAG" "direto sem handshake ha ${age}s: relay (wg2) na frente"
elif [ "$age" -le "$MAX_AGE" ] && [ "$cur" != "1" ]; then
  setmetric 1
  logger -t "$TAG" "direto de volta (handshake ha ${age}s): wg1 na frente"
fi
