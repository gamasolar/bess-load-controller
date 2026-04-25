# CLAUDE.md — BESS Load Controller Dashboard

> **Para outro Claude (ou humano técnico) que abre este projeto pela primeira vez.**
> Última atualização: 2026-04-25 · Última sessão: deploy self-hosted concluído em `gamaserver` + bugfixes de cookie/passwordHash.

---

## 1. Sumário em 60 segundos

O que é: dashboard web (React + Express + tRPC + MySQL) que monitora 2 plantas BESS (Battery Energy Storage System) Huawei LUNA2000-215KWH e controla cargas elétricas (bomba d'água) via Sonoff/Tasmota MQTT, baseado no SOC (state of charge) das baterias lido da FusionSolar Northbound API.

Onde roda: VPS `gamaserver` (Ubuntu 22.04, AMD Ryzen 9 7900X), instalação direta no host (não-Docker), em `/opt/bess-dashboard`, porta interna **3010**, exposto via Cloudflare Tunnel em `https://bess.gamasolar.com.br`.

Status atual: dashboard rodando, login funcional, MQTT conectado, Sonoff da Barragem responde. **Ainda sem credenciais FusionSolar configuradas** — telemetria SOC virá vazia até preencher `.env`. Auto-fetch a cada 6min em standby.

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
| (futuro) | Caminho 1 | Coulomb counting + poll adaptativo + alarme Sonoff offline. Não implementado ainda. |
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

**Capacidade útil das baterias** (pra quando Caminho 1 for implementado): 200 kWh por bateria LUNA2000-215KWH (datasheet Huawei). Piscinão = 400 kWh úteis (2 baterias), Barragem = 200 kWh úteis (1 bateria). 1pp de SOC ≈ 4 kWh em Piscinão, 2 kWh em Barragem.

---

## 6. Estado atual (o que funciona / o que não)

✅ **Funciona:**
- Auth local, login navegador, JWT cookies (`Secure; HttpOnly; SameSite=None`)
- Frontend React carrega, /login, /, /site/:slug
- tRPC: auth.me, auth.logout, system.health, bess.* (todos os endpoints, mas alguns retornam vazio sem dados)
- MySQL connection pool
- MQTT conexão ao broker remoto + polling de 30s do Sonoff
- Sonoff da Barragem reporta `OFF` (estado real)
- systemd com restart automático
- nginx reverse proxy
- Cloudflare Tunnel + DNS

❌ **Não funciona ainda (pendente):**
- FusionSolar telemetria → falta `FUSIONSOLAR_USERNAME` + `FUSIONSOLAR_SYSTEM_CODE` no `.env`
- Telegram notifications → falta `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
- Controle automático da bomba (depende do SOC vir do FusionSolar)
- Sonoff no Piscinão (não existe hardware ainda)
- Tela de "trocar minha senha" (não foi implementada — workaround é via SQL com bcrypt)

⚠️ **Conhecidos & não-resolvidos:**
- Mosquitto config duplicada em `srv769185` (`/etc/mosquitto/conf.d/bess.conf` duplica `password_file` e `persistence_location`). Broker subiu na raspa; pode não voltar em próximo reboot daquele servidor.
- Senha MySQL `bess_user` apareceu em chat (`<redacted — ver .env>`). Decisão Fernando 2026-04-25: NÃO rotacionar (fica no histórico mas a string não vai pro git). Rotacionar antes de produção crítica/se houver indício de uso indevido.
- Sonoff atual é **Sonoff Basic**, sem medição de energia (esperado-se POWR316D pelo código). Ligar/desligar funciona; telemetria de potência não vem.
- `[MqttSync] DIVERGÊNCIA barragem: sistema=on sonoff=OFF` aparece em log — resíduo de testes manuais antigos. MqttSync auto-corrige no próximo ciclo.
- Pasta `client/public/__manus__/debug-collector.js` (25KB) era resíduo Manus — **já removida** de `dist/` mas pode voltar se rebuildar do `client/`. Removí-la também de `client/public/` no próximo deploy.

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

### 🟡 Importantes (não bloqueiam mas são qualidade)

3. **Mosquitto config duplicada em `srv769185`.** Cuidar antes de qualquer reboot daquela máquina.

4. **Credenciais FusionSolar Northbound no `.env`.** Sem isso, dashboard fica sem SOC e load-control não funciona. Conta Northbound se cria no portal FusionSolar (Sistema → Empresa → Northbound), com permissão de leitura para a planta e dispositivos tipo Battery/ESS.

5. **Implementar Caminho 1** (Coulomb counting + poll adaptativo + alarme Sonoff offline). Mitiga rate limit FusionSolar mantendo SOC estimado fresh entre fetches reais. Especificação detalhada na conversa de 2026-04-22 — resumo:
   - Novo módulo `server/soc-estimator.ts`
   - Novo módulo `server/poll-scheduler.ts`
   - Schema: `bess_sites.usableCapacityKwh` (default 200), `bess_state.estimatedSoc/lastEstimateAt/estimateDriftPp`
   - Heurística de zonas: crítica (±3pp do limite, poll 5min), atenção (±8pp, 10min), estável (20min)
   - Alarme `IMPLAUSIBLE_SOC_DRIFT` se drift > 5pp
   - Decisão híbrida: usa estimativa se `lastTelemetryAt < 10min`, senão tenta fetch real com timeout 30s

### 🟢 Médio prazo

6. **Visita técnica à Barragem** pra: (a) habilitar Modbus TCP no SmartLogger 3000 (firmware V300R024C10SPC211 confirmado-suporta), (b) instalar Pi/Teltonika com tunnel reverso, (c) migrar SOC para leitura Modbus direta (Caminho 2 = solução definitiva pra rate limit).
7. **Adicionar Sonoff (POWR316D) no Piscinão.**
8. **Trocar Sonoff Basic da Barragem por POWR316D** pra ter medição de potência da bomba.
9. **Página de "Alterar senha"** no frontend (atual é via SQL).
10. **Tela mostrando SOC estimado vs real** com badge de "fresh há X min" (depende de Caminho 1).
11. **Export CSV** de leituras para calibração offline.
12. **Investigar `[Notification] Telegram returned 401`** mesmo com TELEGRAM_BOT_TOKEN vazio. O `notification.ts` deveria fazer return early. Provavelmente bug no caminho de checagem — inspecionar log e corrigir.

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
- Esperado eventualmente. `server/fusionsolar.ts` tem backoff exponencial 1min→2min→4min→max 10min. **Não diminuir intervalos** — Huawei rate limit é fixo, não pode ser elevado. Caminho 1 (Coulomb counting) mitiga isso.

**"SOC ignorado — fonte='unknown'"**
- Esperado se `.env` não tem credenciais FusionSolar. LoadControl recusa decidir sem dado real. Preencher `FUSIONSOLAR_USERNAME` e `FUSIONSOLAR_SYSTEM_CODE`, restart, esperar 6min do auto-fetch.

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

*Este arquivo é a fonte de verdade pra contexto operacional do projeto. Atualizar a cada sessão significativa. Última atualização: 2026-04-25.*
