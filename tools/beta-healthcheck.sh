#!/usr/bin/env bash
# Checagem automática do painel BESS (beta) — roda por cron a cada 3h.
# Só leitura; manda WhatsApp (rotulado como diagnóstico) só se achar anomalia.
# Lógica em server/tools/beta-healthcheck.ts. Cron tem PATH/HOME mínimos — fixados aqui.
set -uo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export HOME="/home/gama"
cd /opt/bess-dashboard || exit 1
set -a; . ./.env; set +a
exec /usr/bin/pnpm tsx server/tools/beta-healthcheck.ts
