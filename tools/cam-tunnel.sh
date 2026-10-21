#!/bin/bash
# Túnel SSH do gamaserver até a LAN da Barragem, passando pela VPS (que tem rota
# para 192.168.88.0/24 pelo WireGuard). Provisório até a rota do wg2 ser
# persistida no gamaserver (precisa de sudo). Roda pelo cron a cada minuto e só
# sobe se não estiver de pé. Portas locais:
#   127.0.0.1:18080 -> câmera Barragem :80  (HTTP, ONVIF, snapshot)
#   127.0.0.1:18554 -> câmera Barragem :554 (RTSP)
# DESATIVADO 18/10/2026: a câmera agora é acessada direto por WireGuard (wg1 → MikroTik
# da Barragem 10.10.0.5, LAN 192.168.88.0/24). Mantido como reserva; para religar o
# túnel, apague as 2 linhas abaixo. Mata um túnel que tenha ficado de pé.
pkill -f "ssh -N -L 127.0.0.1:18080:192.168.88.253:80" 2>/dev/null
exit 0

VPS=root@92.112.179.225
CAM=192.168.88.253
if pgrep -f "ssh -N -L 127.0.0.1:18080:${CAM}:80" >/dev/null; then exit 0; fi
exec ssh -N -L 127.0.0.1:18080:${CAM}:80 -L 127.0.0.1:18554:${CAM}:554 \
  -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  -o BatchMode=yes -o ConnectTimeout=15 "$VPS" >>/opt/bess-dashboard/storage-data/cam-tunnel.log 2>&1
