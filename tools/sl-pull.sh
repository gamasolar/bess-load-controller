#!/usr/bin/env bash
# Puxa os dados do SmartLogger gravados no Pi (memória de redundância) para o
# armazenamento central no servidor. Append-only: nunca apaga o que já está aqui.
set -uo pipefail
KEY=/home/gama/.ssh/id_bess_pi
SRC="gama@192.168.88.248:/var/lib/bess/"
DST="/opt/bess-dashboard/storage-data/smartlogger/pi/"
mkdir -p "$DST"
ts=$(date '+%Y-%m-%d %H:%M:%S')
if rsync -az --timeout=30 \
   -e "ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new" \
   "$SRC" "$DST" 2>/tmp/sl-pull.err; then
  echo "$ts OK ($(du -sh "$DST" 2>/dev/null | cut -f1) em disco)"
else
  echo "$ts FALHA rc=$? — $(tr '\n' ' ' </tmp/sl-pull.err | cut -c1-120)"
fi
