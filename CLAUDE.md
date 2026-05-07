# CLAUDE.md — BESS Load Controller Dashboard

> **Para outro Claude (ou humano técnico) que abre este projeto pela primeira vez.**
> Última atualização: 2026-05-01 · Última sessão: refactor MVP v2 (Passos 2-3) — removido projeção SOC, ETA polling, watchdog antecipa-polls, skip de inverter; soc-estimator corrigido. Restaurada filosofia "respeitar faixa configurada".

---

## 1. Sumário em 60 segundos

O que é: dashboard web (React + Express + tRPC + MySQL) que monitora 2 plantas BESS (Battery Energy Storage System) Huawei LUNA2000-215KWH e controla cargas elétricas (bomba d'água) via Sonoff/Tasmota MQTT, baseado no SOC (state of charge) das baterias lido da FusionSolar Northbound API.

Onde roda: VPS `gamaserver` (Ubuntu 22.04, AMD Ryzen 9 7900X), instalação direta no host (não-Docker), em `/opt/bess-dashboard`, porta interna **3010**, exposto via Cloudflare Tunnel em `https://bess.gamasolar.com.br`.

Status atual (2026-05-01): MVP v2 ativo (`USE_MVP_V2_CONTROL=true`). FusionSolar Northbound configurado. Controle automático da bomba operando: TURN_OFF quando `SOC ≤ socMinDesliga` literal, TURN_ON quando `SOC ≥ socMinReliga` + janela horária. Sem projeção, sem ETA, sem skip de inverter. Polling fixo (15min normal, 1min crítico). Coulomb counting de fallback se API offline > 30min com histórico ≥6 leituras pós-manobra.

Quem usa hoje: 1 usuário admin (`fernando@gamasolar.com.br`). `ALLOW_SIGNUP=false` — só admin cria contas via banco direto.

---

## 2. Stack & arquitetura

```
┌──────────────────────────┐
│  Browser do usuário      │
└──────┬───────────────────┘
       │ HTTPS
       ▼
┌──────────────────────────┐
│  Cloudflare Edge (TLS)   │
└──────┬───────────────────┘
       │ tunnel (QUIC)
       ▼
┌──────────────────────────┐
│  cloudflared @ gamaserver│
│  → ingress bess.* → :80  │
└──────┬───────────────────┘
       │ HTTP localhost:80
       ▼
┌──────────────────────────┐
│  nginx (sites/bess)      │
│  listen 127.0.0.1:80     │
│  proxy_pass → :3010      │
│  X-Forwarded-Proto: https│ (hardcoded — ver §10)
└──────┬───────────────────┘
       │ HTTP localhost:3010
       ▼
┌──────────────────────────┐
│  Node 22 / Express / tRPC│
│  systemd: bess-dashboard │
│  user: gama              │
│  working dir: /opt/...   │
└─┬──────────┬─────────────┘
  │          │
  │          ▼ MQTT (mqtt://92.112.179.225:1883)
  │     ┌────────────────────────┐
  │     │ Mosquitto remoto       │
  │     │ srv769185 (Easypanel)  │
  │     │ ↕ Sonoff Barragem      │
  │     │   topic: bess_sonoff   │
  │     └────────────────────────┘
  │
  ▼ MySQL local (3306)
┌──────────────────────────┐
│ db: bess_dashboard       │
│ 10 tabelas (users,       │
│ bess_sites, bess_state,  │
│ bess_readings, ...)      │
└──────────────────────────┘
```

**Stack:**
- Front: React 19 + Tailwind 4 + shadcn/ui + Recharts + wouter
- Back: Express 4 + tRPC 11 + Superjson
- DB: MySQL 8 via Drizzle ORM
- Build: Vite 7 + esbuild
- Pkg: pnpm 10 (lockfile regenerado pós-migração)
- Auth: bcryptjs + jose (JWT HS256, 1 ano)

**Origem:** projeto desenvolvido originalmente na plataforma Manus, **migrado para self-hosted** (vide §4 e `MIGRATION-CHANGELOG.md`).

---

## 3. Mapa do servidor

| Caminho | O quê |
|---|---|
| `/opt/bess-dashboard/` | código (owner `gama:gama`) |
| `/opt/bess-dashboard/.env` | secrets (chmod 600) |
| `/opt/bess-dashboard/dist/` | build de produção (servido pelo Express) |
| `/opt/bess-dashboard/storage-data/` | PDFs de relatórios (cresce no tempo) |
| `/etc/systemd/system/bess-dashboard.service` | unit (User=gama, Restart=always, hardening) |
| `/etc/nginx/sites-enabled/bess` | reverse proxy (loopback only) |
| `/etc/nginx/sites-available/bess` | mesma coisa, fonte do symlink |
| `/etc/cloudflared/config.yml` | ingress do tunnel (compartilhado com sigas/helios/nexus/etc) |
| `/etc/cloudflared/config.yml.bak-2026-04-24-2329` | backup pré-mudança (não apagar até estabilizar) |
| `/var/log/nginx/bess_access.log` `bess_error.log` | logs nginx do site |
| `journalctl -u bess-dashboard` | logs do dashboard |
| MySQL `bess_dashboard` | banco principal |
| MySQL user `bess_user@localhost` | acesso DB (senha no `.env`) |

**Outros serviços rodando na mesma VPS** (não tocar a menos que necessário):
- nginx + cloudflared servindo: `sigas`, `helios`, `nexus`, `cafeespecial`, `ssh`
- ~22 containers Docker (helios-*, gama-*, cafe-*, evolution-*)
- MySQL com bancos: `helios_gama`, `nexusgd`, `bess_dashboard`
- PostgreSQL: `nexusgama` em container `gama-db`

---

## 4. Histórico (timeline curta)

| Data | Sessão | Escopo |
|---|---|---|
| 2026-04-21 (Manus) | Build original | Dashboard React + tRPC + Drizzle/TiDB rodando em Manus |
| 2026-04-22 | Migração self-hosted | Auth OAuth → email/senha local; storage S3 → fs local; Forge notifications → Telegram; remoção de plugins Manus, AWS SDK, llm/imageGeneration/etc. Ver `MIGRATION-CHANGELOG.md`. |
| 2026-04-22 (mais tarde) | Fix FusionSolar device-IDs | Descoberta: API rejeita IDs curtos (`54174514`) que aparecem na URL do portal. Correção: usar IDs longos (`1000000054174514`) do campo `id` do `getDevList`. Edição cirúrgica em `server/fusionsolar.ts`. |
| 2026-04-24 | Deploy em gamaserver | MySQL `bess_dashboard` + user, código em `/opt`, `.env`, build, migrations, systemd, nginx, cloudflared, DNS via `cloudflared tunnel route dns`. |
| 2026-04-24 | Bugfixes pós-deploy | (a) `app.set('trust proxy', 1)` em `server/_core/index.ts`; (b) nginx `X-Forwarded-Proto $scheme` → `https` hardcoded (cloudflared sempre HTTPS); (c) `auth.me` redact de `passwordHash`. |
| 2026-04-26 | Credenciais FusionSolar Northbound | `FUSIONSOLAR_USERNAME=gamasolar_bess` no `.env`. SOC real fluindo. |
| 2026-04-29 | MVP v2 + features adaptativas | Implementado control-engine + poll-scheduler. Adicionados 3 commits adaptativos: `cf18fab` (projeção SOC futuro), `8196dfc` (ETA-based polling), `dc3a52e` (skip getInverterRealKpi). Cada um tentou mitigar incidente do dia anterior. |
| 2026-04-30 | Incidente Barragem | Flapping da bomba (4 ciclos ON/OFF em 45min) + storm de 407 (308 em 24h) + 30min sem visibilidade de PV/load. Causas: histerese assimétrica entre TURN_OFF projetivo e TURN_ON literal; watchdog antecipava polls quebrando rate limit do Huawei. |
| 2026-05-01 | Refactor de reversão | `DECISION-RESPECT-CONFIG.md` (Fernando) decidiu reverter ao MVP. Commits: `8c90eb7` (skip), `3c8611d` (projeção+margem), `55ab367` (ETA+watchdog), `72eb31a` (soc-estimator filtra por estado da bomba e retorna null sem histórico). 61 testes unitários verdes. |
| 2026-05-07 | Sessão extensa (8h+) | (a) Diagnóstico do incidente 05/02 (Black Start manual presencial — Auto Black Start nunca funcionou desde commissioning); descoberta arquitetural: LUNA2000-215-2S10 + SmartLogger3000 sem STS/Backup Box é arquitetura on-grid Huawei sendo operada off-grid puro. (b) INV1 da Barragem trocado fisicamente (novo devId `1000000055696640`, ESN `6T2529034582`); DB atualizado com 2 inversores ativos. (c) Rate limit FusionSolar: `API_CALL_DELAY_MS` 10s→70s (separa janelas `getBatteryRealKpi` e `getInverterRealKpi`). (d) Stage 1/2 polling implementado e revertido conscientemente (latência 1min < ruído BMS de 4pp = 25× maior). (e) NOPASSWD sudoers configurado (`gama` → `systemctl restart bess-dashboard` sem senha). (f) Feature DECISION-OVERSHOOT-COMPENSATION implementada em 6 etapas atômicas (schema → decideAction → log → UI → testes → validação): coluna `overshootFactor` adicionada, lógica de compensação proporcional `socMinDesliga + |batteryPower|*factor` aplicada APENAS na regra TURN_OFF AUTO, log condicional `[ControlEngine]` em poll-scheduler, campo configurável em `ConfigModalV2`, 5 testes novos (34/34 passing em control-engine), CLAUDE.md atualizado. (g) Investigação retroativa do TURN_OFF de 05/07 07:55 (SOC=20 com smd=22) revelou padrão NÃO previsto: overshoot do BMS LFP ocorre DURANTE a operação (não só pós-OFF como hipótese original assumia), invalidando parcialmente a fórmula linear `|bat|*factor`. Decisão final: feature fica dormente (`factor=0` nas duas plantas), disponível pra ativar quando houver dados melhores. (h) Investigação de histerese matinal (30 dias): `socMinReliga=35` atinge em 93% dos dias mas atrasa religa pra >9h em 5/6 casos — viola restrição operacional do operador (bomba precisa ligar até 8-9h). Decisão: manter Barragem em 20/30 conforme configurado pelo operador. (i) Conta secundária `projetos@gamasolar.com.br` (`userId=13`) identificada como segunda conta admin do operador (legítima). |
| (futuro) | Caminho 2 | Modbus TCP direto no SmartLogger 3000 — depende de visita técnica. |

---

## 5. Decisões importantes (e por quê)

**Por que self-hosted em vez de continuar na Manus.** Manus era plataforma de prototipagem; sem isolamento, sem controle de deploy, não sustenta produção real. Migração tirou: OAuth Manus, S3 Forge, Forge Notifications, plugins Vite Manus, Umami analytics, ~6 arquivos `_core/*` não usados pelo BESS.

**Por que `email` como `openId`.** A coluna `users.openId VARCHAR(64) UNIQUE NOT NULL` veio do schema OAuth Manus original. Em vez de redesenhar a tabela, normalizamos email (lowercase trim) como `openId`. Custa zero migração de dados e mantém compatibilidade.

**Primeiro user = admin.** Lógica em `server/auth.ts:registerAuthRoutes`. Se `count(users) == 0`, força `role=admin` no registro. Subsequentes ficam `role=user`. Após bootstrap, `ALLOW_SIGNUP=false` no `.env` desabilita signup público.

**Por que MQTT broker remoto (`92.112.179.225:1883`) em vez de local.** O Sonoff físico na Barragem está configurado pra falar com aquele broker (no servidor `srv769185` Easypanel). Mover o broker pro `gamaserver` exigiria reconfigurar Sonoff fisicamente, e ele tá em planta remota sem acesso fácil. **Trade-off aceito:** credenciais MQTT trafegam em texto puro pela internet pública (1883 sem TLS). Tratar quando virar prioridade — opções: TLS na 8883, mover broker via Cloudflare Tunnel TCP, VPN/Tailscale.

**Por que porta 3010 no Node.** A 3000 estava ocupada por outro projeto (Easypanel proxy / nexus PM2). 3010 é livre.

**Por que nginx local + cloudflared.** Cloudflared poderia falar direto com `127.0.0.1:3010`. Adicionamos nginx no meio porque: (a) consistência com outros sites do servidor (`sigas` usa nginx); (b) filtros de segurança (bloquear `/.env`, `/.git`); (c) headers explícitos. Custo: 1 hop extra de proxy. Aceitável.

**Por que `X-Forwarded-Proto: https` hardcoded em vez de `$scheme`.** O `$scheme` do nginx é `http` (cloudflared chama `http://127.0.0.1:80`). Mas o cliente original veio HTTPS pelo Cloudflare. Se mandarmos `http`, o Express em produção não marca cookie como `Secure`, e navegador rejeita `SameSite=None` sem `Secure`. Hardcode é seguro porque **só cloudflared chega nesse server block** (`listen 127.0.0.1:80`).

**Por que IDs longos FusionSolar.** A API Northbound `getDevRealKpi` retorna `EMPTY` quando chamada com o ID curto que aparece na URL do portal (`54174514`). Os IDs corretos são os do campo `id` retornado por `getDevList` (`1000000054174514`). Documentado em `MIGRATION-CHANGELOG.md` §9.

**SOC `source=unknown` é proteção, não bug.** Sem dados FusionSolar reais, `LoadControl.evaluateAndControl` recusa tomar decisão automática. Log típico: `[LoadControl] [AUTO] barragem: SOC ignorado — fonte="unknown"`. Vai sumir quando credenciais entrarem.

**Capacidade útil das baterias:** 200 kWh por bateria LUNA2000-215KWH (datasheet Huawei). Piscinão = 400 kWh úteis (2 baterias), Barragem = 200 kWh úteis (1 bateria). 1pp de SOC ≈ 4 kWh em Piscinão, 2 kWh em Barragem.

**A faixa configurada é a regra (decisão 2026-05-01).** Operador define `socMinDesliga` e `socMinReliga` na UI. Código respeita literalmente, sem inventar margens, projeções, ETAs ou skips. Bomba desliga em `SOC ≤ socMinDesliga`, religa em `SOC ≥ socMinReliga` (+ janela horária). A "inteligência" está em o operador escolher os valores certos. Histórico em `DECISION-RESPECT-CONFIG.md`.

**Por que removemos as features adaptativas (cf18fab, 8196dfc, dc3a52e).** Em 24-48h foram empilhadas 3 features pra resolver sintomas de incidentes anteriores. Resultado: interagiram causando flapping da bomba e cegueira em PV/load durante operação crítica. Custo da projeção: ~30% de capacidade útil sacrificada pra "proteger" contra overshoot do BMS — que é fenômeno físico não-linear (SOC pode saltar 5pp em 2min em SOC baixo), não pôde ser modelado por extrapolação de descarga linear. Lição: BMS overshoot resolve-se ajustando `socMinDesliga` na UI (ex.: 22-23) com base em medição empírica.

---

## 6. Estado atual (o que funciona / o que não)

✅ **Funciona:**
- Auth local, login navegador, JWT cookies (`Secure; HttpOnly; SameSite=None`)
- Frontend React carrega, /login, /, /site/:slug
- tRPC: auth.me, auth.logout, system.health, bess.*
- MySQL connection pool
- MQTT conexão ao broker remoto + polling de 30s do Sonoff
- Sonoff da Barragem reporta estado real
- systemd com restart automático, nginx reverse proxy, Cloudflare Tunnel
- **FusionSolar Northbound** ativo, SOC + battery_power + pv_power + load_power fluindo
- **Controle automático MVP v2** Barragem: TURN_OFF/TURN_ON literais conforme `socMinDesliga`/`socMinReliga` da config
- **Polling fixo** 15min (intervaloPadrao) ou 1min (intervaloCritico em zona crítica)
- **Coulomb counting** fallback funcional se API offline > 30min com histórico ≥ 6 leituras pós-manobra
- **`triggerSitePoll`** força reagendamento imediato após mudança de modo/config/comando manual
- **INV1 da Barragem corrigido no DB** (2026-05-07): trocado fisicamente, `fusionsolarInverterIds` atualizado pra `["1000000055696640","1000000054174515"]` — 2 inversores ativos somando PV correto.
- **`API_CALL_DELAY_MS=70s`** (2026-05-07) mitiga rate limit Huawei: `getDevRealKpi` é 1 call/janela rolante 60s POR ENDPOINT, e battery+inverter usam o mesmo endpoint. 70s = 60s da janela + 10s de margem clock-skew.
- **Feature de compensação de overshoot BMS** (2026-05-07) implementada e dormente: campo `bess_config.overshootFactor` com default 0; ativo só com factor>0 via UI. Ver §14.

❌ **Não funciona ainda (pendente):**
- Telegram notifications → falta `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
- Sonoff no Piscinão (não existe hardware ainda)
- Tela de "trocar minha senha" (não foi implementada — workaround é via SQL com bcrypt)
- **Auto Black Start nunca funcionou desde commissioning.** Arquitetura LUNA2000-215-2S10 + SmartLogger3000 sem STS/Backup Box é on-grid pela Huawei, sendo operada off-grid pura. Hipótese: cabeamento Enable+/Enable- ausente OU hardware incompleto pra essa modalidade. Black Start precisou ser feito manualmente presencial em 2026-05-02.

⚠️ **Conhecidos & não-resolvidos:**
- Mosquitto config duplicada em `srv769185` (`/etc/mosquitto/conf.d/bess.conf` duplica `password_file` e `persistence_location`). Broker subiu na raspa; pode não voltar em próximo reboot daquele servidor.
- Senha MySQL `bess_user` apareceu em chat (`<redacted — ver .env>`). Decisão Fernando 2026-04-25: NÃO rotacionar (fica no histórico mas a string não vai pro git). Rotacionar antes de produção crítica/se houver indício de uso indevido.
- Sonoff atual é **Sonoff Basic**, sem medição de energia (esperado-se POWR316D pelo código). Ligar/desligar funciona; telemetria de potência não vem.
- `[MqttSync] DIVERGÊNCIA barragem: sistema=on sonoff=OFF` aparece em log — resíduo de testes manuais antigos. MqttSync auto-corrige no próximo ciclo.
- Pasta `client/public/__manus__/debug-collector.js` (25KB) era resíduo Manus — **já removida** de `dist/` mas pode voltar se rebuildar do `client/`. Removí-la também de `client/public/` no próximo deploy.
- **BMS LFP apresenta dois fenômenos de overshoot:** (1) pós-desligamento clássico ~4pp; (2) durante operação prolongada em SOC baixo, saltos de 2-3pp em <3min — fenômeno (2) NÃO é capturado pela fórmula linear `|bat|*factor` da feature implementada. Documentado em investigação retroativa do TURN_OFF 2026-05-07 07:55.
- **Bug NaN em `server/fusionsolar.ts:397`** quando BMS retorna `ch_discharge_power=undefined` em proteção. Sistema fica cego pra readings durante proteção do BMS.
- **Operador opera com duas contas admin** (`userId=1` `fernando@` e `userId=13` `projetos@`). Ambas legítimas. Considera consolidar ou diferenciar nomes.

---

## 7. Pendências (em ordem de prioridade)

### 🔴 Urgentes (bloqueiam algo concreto)

1. **Rebuild + restart pós-bugfix do `auth.me`.** Edição em `server/routers.ts` foi feita via `sed` na sessão de 2026-04-24, mas `pnpm build` não foi executado depois. Sintoma: `auth.me` ainda retorna `passwordHash` no JSON. Comandos:
   ```bash
   cd /opt/bess-dashboard
   pnpm build
   sudo systemctl restart bess-dashboard
   ```
   Validar: `curl -s 'https://bess.gamasolar.com.br/api/trpc/auth.me?input=%7B%7D' -b /tmp/cookie.txt | grep -o passwordHash || echo OK`.

2. **Trocar senha MySQL `bess_user`** que apareceu em chat. Guia em §8 abaixo.

3. **Fix bug NaN em `fusionsolar.ts:397`.** Quando BMS entra em proteção, `ch_discharge_power=undefined` faz a fórmula `-undefined/1000 = NaN` e o sistema fica cego pra readings. Adicionar guard `?? null` antes da divisão. Sem isso, episódios de proteção BMS deixam o painel sem telemetria.

4. **Implementar `getAlarmList` polling periódico Huawei (5-10min) → `bess_alarms` com prefixo `HUAWEI_`.** Hoje só capturamos rate-limit; alarmes operacionais da Huawei (sobretemperatura, falha de inversor, BMS warning) não chegam. Endpoint já existe em `server/fusionsolar.ts:538`, falta integrar no scheduler.

5. **Implementar alertas Telegram/WhatsApp via Evolution API:** telemetria parada >30min, Sonoff offline >15min, SOC < threshold. Hoje sintoma de proteção BMS só descoberto a posteriori via log inspection.

6. **Abrir chamado Huawei Partners sobre Auto Black Start** em LUNA2000-215-2S10 + SmartLogger3000 sem STS/Backup Box. SN `BT25A1551919`, FW `V200R024C00SPC410`. Modalidade off-grid pura nunca operou Auto Black Start desde commissioning — confirmar se faltou cabeamento Enable+/Enable- ou se hardware é insuficiente.

### 🟡 Importantes (não bloqueiam mas são qualidade)

7. **Mosquitto config duplicada em `srv769185`.** Cuidar antes de qualquer reboot daquela máquina.

8. **Subir `intervaloCritico` na UI de 1min pra 2min (Barragem).** Em zona crítica com 1min × 2 calls/poll, estoura rate limit do Huawei (1 call por janela rolante de 60s, por endpoint, e `getBattery` + `getInverter` usam o MESMO endpoint `/getDevRealKpi`). Resultado: pv/load=NULL durante zona crítica + 407 nos logs. Fix da UI: subir `intervaloCritico` pra 2min. Custo: latência detecção sobe de 30s pra 60s mediano (~0.2pp em SOC ≈ irrelevante). **Não readicionar skip de inverter no código.**

9. **Bug raiz `loadStatus` dessincronizado pós-blackout** (`mqtt-sync.ts`). Após queda de energia, Sonoff volta em OFF mas `bess_state.loadStatus` continua ON. Alarmes DIVERGENCE abrem/fecham inconsistentemente. mqtt-sync auto-converge no próximo ciclo, mas timing/correção precisam ser auditados. **Não causado nem resolvido pelo refactor de 2026-05-01** — endereçar separadamente.

10. **Reconstruir histórico do drizzle-kit** pra refletir migrations ad-hoc aplicadas (`0009_add_password_hash`, `0011_users_invitations`, `0012_intervalo_noturno`, `0013_overshoot_factor`). Atualmente `_journal.json` rastreia só até `0010_mvp_v2_schema`, então `drizzle-kit generate` produz diff inflado (re-cria tabelas/colunas que já existem). Não bloqueia operação — time aplica SQL direto via `mysql` — mas dificulta uso futuro de `drizzle-kit` pra mudanças de schema. Estimativa: 1-2h em sprint específico de limpeza técnica, fora de pressão operacional.

11. **Corrigir/excluir 31 testes integração pré-existentes quebrados:** `bess.test.ts`, `energy-trend.test.ts`, `fusionsolar.test.ts`, `manual-soc.test.ts`, `reports.test.ts`. Necessitam setup de mocks de DB/env que não estão configurados. Não bloqueiam operação mas confundem CI/CD futuro. Estado em 2026-05-07: 206/237 passing, 31 falhando.

12. **Validação da feature overshoot compensation** (`DECISION-OVERSHOOT-COMPENSATION.md`): se ativar `overshootFactor>0`, coletar dados durante janela do doc (até 2026-05-21). **Atenção:** investigação retroativa de 2026-05-07 invalidou parcialmente a hipótese central (overshoot ocorre DURANTE operação, não só pós-OFF) — feature pode não ser ativada de fato. Decidir baseado em dados quando aparecer SOC baixo em condições controladas.

### 🟢 Médio prazo

13. **Visita técnica à Barragem** pra: (a) habilitar Modbus TCP no SmartLogger 3000 (firmware V300R024C10SPC211 confirmado-suporta), (b) instalar Pi/Teltonika com tunnel reverso, (c) migrar SOC para leitura Modbus direta (Caminho 2 = solução definitiva pra rate limit).
14. **Adicionar Sonoff (POWR316D) no Piscinão.**
15. **Trocar Sonoff Basic da Barragem por POWR316D** pra ter medição de potência da bomba.
16. **Página de "Alterar senha"** no frontend (atual é via SQL).
17. **Tela mostrando SOC estimado vs real** com badge de "fresh há X min" (depende de Caminho 1).
18. **Export CSV** de leituras para calibração offline.
19. **Investigar `[Notification] Telegram returned 401`** mesmo com TELEGRAM_BOT_TOKEN vazio. O `notification.ts` deveria fazer return early. Provavelmente bug no caminho de checagem — inspecionar log e corrigir.
20. **Considerar separar Starlink + roteador + auxiliares para circuito dedicado** (painel + bateria 100Ah, ~R$3-5k). Elimina ~150W consumo 24/7 da bateria principal e mantém observabilidade quando BESS entra em proteção (BMS desliga inversor → painel/internet caem juntos).
21. **Considerar consolidar contas admin do operador** (`userId=1` `fernando@gamasolar.com.br` e `userId=13` `projetos@gamasolar.com.br`) ou diferenciar nomes pra clareza nos logs (atualmente `bess_actions.metadata.userName` mostra "Fernando Lobo Praes" vs "Gama Solar" — segunda é genérica demais pra auditoria).

---

## 8. Comandos do dia-a-dia

```bash
# Logs em tempo real
sudo journalctl -u bess-dashboard -f

# Status
sudo systemctl status bess-dashboard

# Restart (após mudar .env ou rebuildar)
sudo systemctl restart bess-dashboard

# Deploy de nova versão
cd /opt/bess-dashboard
git pull   # se houver repo configurado
pnpm install --no-frozen-lockfile
pnpm db:push      # se schema mudou
pnpm build
sudo systemctl restart bess-dashboard

# MySQL — listar sites
sudo mysql bess_dashboard -e "SELECT id, slug, name, fusionsolarPlantCode FROM bess_sites;"

# MySQL — ver últimas leituras (depois de FusionSolar configurado)
sudo mysql bess_dashboard -e "
  SELECT s.slug, r.soc, r.batteryPower, r.source, r.createdAt
  FROM bess_readings r JOIN bess_sites s ON s.id = r.siteId
  ORDER BY r.createdAt DESC LIMIT 10;"

# MQTT — pingar broker remoto
mosquitto_sub -h 92.112.179.225 -p 1883 -u bess_user -P "$MQTT_PASS" \
  -t 'tele/bess_sonoff/LWT' -C 1 -W 5
# Esperado: Online

# MQTT — comandos manuais ao Sonoff (CUIDADO: liga/desliga bomba real, sem cooldown)
mosquitto_pub -h 92.112.179.225 -p 1883 -u bess_user -P "$MQTT_PASS" \
  -t 'cmnd/bess_sonoff/POWER' -m 'ON'   # liga
mosquitto_pub ... -m 'OFF'              # desliga
mosquitto_pub ... -m ''                 # status (não muda nada)

# Trocar senha MySQL bess_user
NEW_PWD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
echo "Anote: $NEW_PWD"
sudo mysql -e "ALTER USER 'bess_user'@'localhost' IDENTIFIED BY '$NEW_PWD';"
sudo sed -i "s|^DATABASE_URL=mysql://bess_user:[^@]*@|DATABASE_URL=mysql://bess_user:${NEW_PWD}@|" /opt/bess-dashboard/.env
sudo systemctl restart bess-dashboard
sleep 3
curl -s https://bess.gamasolar.com.br/api/auth/status

# Trocar senha de admin (no banco, via bcrypt local)
NEW_PASS='SuaSenhaForte'
HASH=$(node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" "$NEW_PASS")
sudo mysql bess_dashboard -e "
  UPDATE users SET passwordHash='$HASH' WHERE openId='fernando@gamasolar.com.br';"
history -c
```

---

## 9. Como debugar problemas comuns

**"Não loga, sempre volta pra tela de login"**
- Verifica que `set-cookie` tem `Secure`: `curl -v -X POST .../api/auth/login -d '...' 2>&1 | grep -i set-cookie`. Se faltar `Secure`, é problema de `X-Forwarded-Proto` no nginx (deve ser `https` hardcoded, não `$scheme`) OU `app.set('trust proxy', 1)` faltando em `server/_core/index.ts`.
- Verifica que `auth.me` retorna user, não null: `curl -s '.../api/trpc/auth.me?input=%7B%7D' -b cookie.txt`.

**Rate limit FusionSolar (HTTP 407 / `failCode: 407`)**
- Endpoint `/getDevRealKpi` aceita ~1 call por janela rolante de 60s, **por endpoint**. `getBatteryRealKpi` e `getInverterRealKpi` usam o MESMO endpoint. Em modo normal (`intervaloPadrao=15min` × 2 calls/poll) folga é enorme. Em zona crítica (`intervaloCritico=1min` × 2 calls/poll) estoura. Solução do operador: subir `intervaloCritico` na UI pra 2min. **Não readicionar skip de inverter no código** (causa cegueira de PV/load — incidente 30/04).
- 407 ocasional isolado: aceitável. `server/fusionsolar.ts` tem backoff de 60s.

**"AUTO religa: ... requer SOC REAL (atual: ESTIMATED)"**
- `decideAction` em `server/control-engine.ts` recusa religar baseado em SOC estimado. Permite religar só com leitura fresca (`lastTelemetryAt < 30min`). Se persistir, API pode estar offline > 30min — verificar `journalctl -u bess-dashboard | grep -i fusionsolar`.

**"Nenhuma condição satisfeita" / bomba não age esperado**
- `decideAction` é estritamente literal: TURN_OFF se `pumpState=ON ∧ SOC ≤ socMinDesliga`, TURN_ON se `pumpState=OFF ∧ SOC ≥ socMinReliga ∧ janela ∧ socSource=REAL`. Sem essas condições, não age. Verificar `bess_config.controlMode` (`AUTO` vs `MANUAL`), `bess_state.cooldownUntil` (cooldown ativo), `bess_state.lastTelemetryAt` (idade da leitura).

**Sonoff offline (`tele/bess_sonoff/LWT` retorna `Offline`)**
- Causa em ~99% dos casos: Starlink da planta intermitente, ou Sonoff caiu de Wi-Fi e precisa reboot físico. Não tem fix remoto — depende de alguém na planta.
- Verificar broker está ativo: `mosquitto_sub -h 92.112.179.225 ... '$SYS/broker/uptime' -C 1 -W 3`.

**`pnpm install` falha com lockfile error**
- Sempre usar `--no-frozen-lockfile`. Lockfile original é da versão Manus, foi regenerado na migração mas pode divergir de novo se mudar deps.

**`pnpm db:push` falha com migration duplicate (0009)**
- Apagar `drizzle/0009_add_password_hash.sql` (era patch manual, drizzle-kit gera automaticamente).
- Ou se já aplicou ambas, conferir `__drizzle_migrations` no banco.

**systemd unit falha com `status=226/NAMESPACE`**
- `ProtectSystem=strict` + `ReadWritePaths` exige que as pastas existam antes do start. Garantir `/opt/bess-dashboard/storage-data/` e `/opt/bess-dashboard/dist/` existam e sejam de `gama:gama`.

**Nginx config válida mas restart cloudflared derruba outros sites**
- `cloudflared` faz pequeno gap (~5s) ao recarregar config. Pra evitar: usar `cloudflared tunnel ingress validate` antes de reiniciar, ou agendar para horário fora de pico.

**Build TypeScript falha em `auth.logout.test.ts` com erro sobre `loginMethod` ou `passwordHash`**
- Mock de `User` precisa ter os campos novos do schema. Atualizar `passwordHash: null, loginMethod: "local"`.

---

## 10. Onde estão os segredos

- **Tudo em runtime:** `/opt/bess-dashboard/.env` (chmod 600, owner gama)
- **MySQL `bess_user`:** valor em `DATABASE_URL` no `.env`
- **JWT_SECRET:** valor no `.env`, gerado com `openssl rand -hex 32`. Rotacionar invalida todas as sessões ativas (todos os usuários precisam relogar).
- **MQTT broker:** `MQTT_USERNAME=bess_user` `MQTT_PASSWORD=...` no `.env`. Hash do user também está em `/etc/mosquitto/passwd` no servidor `srv769185`.
- **FusionSolar Northbound:** ainda não preenchido. Quando tiver, vai em `FUSIONSOLAR_USERNAME` e `FUSIONSOLAR_SYSTEM_CODE` no `.env`.
- **Telegram bot:** ainda não criado. Ver §11 abaixo se for criar.
- **SSH ao servidor:** via Cloudflare Tunnel — `ssh -o ProxyCommand="cloudflared.exe access ssh --hostname ssh.gamasolar.com.br" gama@ssh.gamasolar.com.br`.

---

## 11. Templates de resposta para problemas comuns

### "Quero adicionar credenciais FusionSolar"

```bash
sudo nano /opt/bess-dashboard/.env
# Preencher FUSIONSOLAR_USERNAME e FUSIONSOLAR_SYSTEM_CODE
sudo systemctl restart bess-dashboard
sleep 6
sudo journalctl -u bess-dashboard -f | grep -iE "fusionsolar|battery_soc"
# Em ~6min vê o primeiro fetch real
```

### "Quero criar um Telegram Bot"

1. No Telegram, conversa com `@BotFather` → `/newbot` → siga as instruções → copie o token.
2. Manda uma mensagem qualquer pro bot novo (ele só "vê" você depois disso).
3. Pega o chat_id: `curl https://api.telegram.org/bot<TOKEN>/getUpdates`. Procurar `"chat":{"id":...}`.
4. Edita `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_CHAT_ID=-100123...
   ```
5. `sudo systemctl restart bess-dashboard`.

### "Quero adicionar mais um usuário (admin ou comum)"

Como `ALLOW_SIGNUP=false`, não dá via UI. Solução SQL:

```bash
EMAIL='novo@gamasolar.com.br'
NAME='Nome do Novo'
PASS='SenhaInicial123'
ROLE='user'  # ou 'admin'
HASH=$(node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" "$PASS")
sudo mysql bess_dashboard -e "
  INSERT INTO users (openId, email, name, role, passwordHash, loginMethod, lastSignedIn)
  VALUES ('$EMAIL', '$EMAIL', '$NAME', '$ROLE', '$HASH', 'local', NOW());"
history -c
# Avisa o usuário pra trocar a senha (via SQL — não tem UI ainda)
```

### "Quero rotacionar JWT_SECRET (ex: depois de incidente)"

```bash
NEW_JWT=$(openssl rand -hex 32)
sudo sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$NEW_JWT|" /opt/bess-dashboard/.env
sudo systemctl restart bess-dashboard
# Todos os usuários precisarão relogar.
```

### "Cloudflare Tunnel está derrubado"

```bash
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -n 30 --no-pager
sudo cloudflared tunnel ingress validate
# Restaurar config se necessário:
# sudo cp /etc/cloudflared/config.yml.bak-* /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```

---

## 12. Para outro Claude que vai trabalhar aqui

**Antes de mexer em qualquer coisa:**

1. Leia o `MIGRATION-CHANGELOG.md` (na raiz do projeto) pra entender o que foi removido/adicionado vs versão Manus.
2. `journalctl -u bess-dashboard -n 100` pra ver estado atual de operação.
3. `systemctl is-active bess-dashboard nginx cloudflared mysql` pra confirmar que tudo está vivo.
4. **Não modifique** estes arquivos sem motivo forte:
   - `server/fusionsolar.ts` — exceto a parte de device-IDs já corrigida (interface tem campos `id`, `devDn`, `devId` opcionais).
   - `server/mqtt-tasmota.ts` — protocolo Tasmota delicado.
   - `server/report-generator.ts` — geração de PDF.
   - `server/db.ts` — accessors do banco; `upsertUser` aceita `passwordHash` corretamente.
   - `shared/energy-flow-logic.ts` — lógica de cálculo de fluxo.
   - `client/src/components/ui/` — primitives shadcn.
5. **Sempre que mudar código backend** (`server/*.ts`), rode `pnpm build` E `sudo systemctl restart bess-dashboard`. Edição direta em arquivo TS não é hot-reloaded em produção.
6. **Sempre que mudar schema** (`drizzle/schema.ts`), rode `pnpm db:push` antes de testar.
7. **Sempre que mudar `.env`**, rode `sudo systemctl restart bess-dashboard`.
8. **Em todo deploy de novo código**, depois do build verifique:
   - `curl -s https://bess.gamasolar.com.br/api/auth/status` retorna JSON
   - Login funciona em janela anônima
   - `journalctl -u bess-dashboard -n 30` sem stack traces

**Convenções do projeto:**

- Frontend usa wouter, não react-router. Routes em `client/src/App.tsx`.
- Tipo `User` em `drizzle/schema.ts`. Inclui `passwordHash` opcional.
- Auth client: `useAuth` hook em `client/src/_core/hooks/useAuth.ts`.
- Auth server: `server/auth.ts` (rotas), `server/_core/context.ts` (verifySession), `server/_core/cookies.ts` (helpers).
- tRPC routers em `server/routers.ts`. Todos sob o `appRouter` raiz com namespaces (`auth.*`, `bess.*`, `system.*`).
- Cookie: nome `app_session_id`, JWT HS256, 1 ano, `Secure HttpOnly SameSite=None`.
- Logs do dashboard prefixam por subsistema: `[Auth]`, `[FusionSolar]`, `[MQTT]`, `[MqttSync]`, `[LoadControl]`, `[AutoFetch]`, `[Reports]`, `[Notification]`, `[BESS]`.

**Coisas a NÃO fazer:**

- Não regerar `JWT_SECRET` casualmente — invalida todas as sessões.
- Não dropar tabelas — backup primeiro.
- Não aumentar a frequência de fetch FusionSolar (rate limit Huawei punitive).
- Não rebuildar com `pnpm install --frozen-lockfile` — vai falhar; sempre usar `--no-frozen-lockfile`.
- Não expor MQTT broker do `srv769185` mais do que já está — vide §5.
- Não esquecer `chmod 600 .env` se editar.
- Não commitar `.env`, `dist/`, `node_modules/`, `storage-data/`.

**Coisas pra confirmar antes de propor mudanças:**

- Esta é uma instalação **em produção** com 2 plantas reais, controlando bombas de irrigação reais. Mudanças críticas (schedulers, control loops, MQTT, FusionSolar) **podem ligar/desligar bomba** sem querer. Sempre raciocinar sobre impacto físico antes de aplicar.
- Sempre perguntar antes de apertar "deploy" em horário comercial.
- Para mudanças no `cloudflared/config.yml`, testar com `cloudflared tunnel ingress validate` antes de `systemctl restart`. Restart causa ~5s de downtime em **todos** os outros sites do tunnel (sigas, helios, nexus, cafeespecial, ssh).

---

## 13. Pra falar com o "user dono do projeto" (Fernando)

- Ele não é dev, é **fundador/operador**. Linguagem clara, sem jargão excessivo. Mas **não infantilizar** — ele entende stack quando explicada bem.
- Confirmar destrutivos antes de executar (especialmente coisas que afetam outros sites na mesma VPS).
- Quando der erro, **explicar a causa**, não só dar o fix. Ele quer entender pra não repetir.
- Linguagem: português brasileiro, tom direto e prestativo, sem floreio.

---

## 14. Disciplina pós-refactor (DECISION-RESPECT-CONFIG.md, 2026-05-01)

**Regra fundamental:** o código respeita a faixa configurada pelo operador na UI, sem inventar margens, projeções, antecipações ou skips. Inteligência é do operador escolher faixa certa pra cada planta.

**Quando aparecer problema operacional** (flapping, overshoot, ciclo curto, 407 sustentado):

1. Observar sintoma e medir (logs, queries DB)
2. Ajustar config na UI (`socMinDesliga`, `socMinReliga`, `cooldownAcao`, `intervaloCritico`)
3. Observar de novo por 24-48h
4. Documentar a descoberta em `DECISION-RESPECT-CONFIG.md` ou em sessão seguinte do CLAUDE.md
5. Só considerar mudança de código se config sozinha não resolver após ≥2 semanas, e mesmo aí: 1 mudança, validada 1-2 semanas antes da próxima

**Anti-padrão a evitar:** adicionar feature adaptativa (projeção, ETA, skip de coleta, watchdog antecipa) em resposta a incidente de 24h. Vimos no incidente 2026-04-29/30 que 3 features adaptativas empilhadas em 48h interagiram causando flapping da bomba e cegueira de PV/load. Reverter ao MVP foi a saída.

**Antes de modificar `decideAction`, `pickPollInterval` ou `pollSite`:** consultar `DECISION-RESPECT-CONFIG.md`. Mudanças nesses caminhos críticos exigem autorização explícita do operador, com diff mostrado antes da edição.

**Caminhos críticos protegidos:**
- `server/control-engine.ts:decideAction` — lógica linear de TURN_ON/TURN_OFF. Sem projeção, sem margem. **Exceção controlada (2026-05-07):** regra TURN_OFF AUTO recebeu bloco de compensação proporcional do overshoot BMS LFP — ver bloco abaixo.
- `server/poll-scheduler.ts:pickPollInterval` — cadência fixa por regras simples. Sem ETA, sem watchdog antecipando.
- `server/poll-scheduler.ts:pollSite` — sempre coleta `getBatteryRealKpi` + (com pause 5s) `getInverterRealKpi`. Sem skip.
- `server/soc-estimator.ts` — fallback Coulomb counting; retorna `null` se histórico insuficiente pós-manobra (não SOC velho).

**Exceção controlada — DECISION-OVERSHOOT-COMPENSATION.md (2026-05-07):**

`decideAction` ganhou compensação proporcional do overshoot do BMS LFP na regra de TURN_OFF AUTO. Quando bomba=ON + `currentBatteryPower<0` + `overshootFactor>0`, antecipa o desligamento em `|currentBatteryPower| × overshootFactor` pp pra absorver o salto pra baixo que o BMS faz quando descarga cessa.

- **Default:** `overshootFactor=0` na UI = feature desligada → comportamento idêntico ao `DECISION-RESPECT-CONFIG`. Operador habilita explicitamente em `/configuracoes` → "Compensação de overshoot".
- **Validação:** período de observação até **2026-05-21** (14 dias). Critérios de aceitação e reversão na seção 6 do doc. Reverter = setar `overshootFactor=0` na UI. **Sem rollback de código necessário.**
- **Não-negociáveis preservados:** sem ETA, sem projeção de SOC, sem compensação no TURN_ON, sem watchdog. Só TURN_OFF AUTO com fórmula determinística e configurável.
- **Auditoria:** cada TURN_OFF compensado registra a fórmula completa em `bess_actions.reason` (`socMinDesliga X + overshoot Ypp [descarga WkW × factor Z]`). Log adicional `[ControlEngine]` no poll quando `factor>0`.

---

*Este arquivo é a fonte de verdade pra contexto operacional do projeto. Atualizar a cada sessão significativa. Última atualização: 2026-05-01.*
