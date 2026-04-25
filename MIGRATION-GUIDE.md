# BESS Load Controller Dashboard — Guia Completo de Migração Self-Hosted

**Versão:** 1.0 | **Data:** 21 de Abril de 2026 | **Autor:** Manus AI

---

## 1. Visão Geral do Projeto

O BESS Load Controller Dashboard é um sistema de monitoramento e controle em tempo real para sistemas de armazenamento de energia por bateria (Battery Energy Storage Systems). O sistema gerencia duas usinas solares com baterias LUNA2000-215KWH da Huawei, controlando cargas elétricas (bombas d'água) com base no estado de carga (SOC) das baterias.

### 1.1 Funcionalidades Implementadas

O sistema possui as seguintes funcionalidades operacionais, todas testadas com 143 testes unitários:

| Funcionalidade | Descrição | Status |
|---|---|---|
| **Monitoramento SOC** | Leitura em tempo real do estado de carga via FusionSolar API | Operacional (sujeito a rate limit) |
| **Controle de Carga** | Liga/desliga bombas via MQTT → Sonoff POWR316D | Operacional |
| **Auto-fetch** | Coleta automática de dados FusionSolar a cada 6 minutos | Operacional |
| **Alarmes** | Detecção automática de condições anormais (SOC baixo, temperatura, etc.) | Operacional |
| **Relatórios** | Geração automática de relatórios diários e semanais | Operacional |
| **Diagrama de Fluxo** | Visualização em tempo real do fluxo de energia (PV → BESS → Carga) | Operacional |
| **Histórico** | Gráficos de tendência de SOC, potência e temperatura | Operacional |
| **Entrada Manual SOC** | Fallback para inserir SOC manualmente quando API bloqueada | Operacional |
| **Config Device IDs** | Interface para configurar IDs de dispositivos FusionSolar | Operacional |
| **Rate Limit Protection** | Backoff exponencial, serialização de chamadas, delay entre requests | Operacional |

### 1.2 Sites Monitorados

| Site | Slug | Baterias | Bombas | PlantCode FusionSolar |
|---|---|---|---|---|
| BESS - Daniel Medeiros (Piscinão) | `piscinao` | 2x LUNA2000-215KWH (430 kWh) | 1x 100cv | `NE=54175048` |
| BESS - Daniel Medeiros (Barragem) | `barragem` | 1x LUNA2000-215KWH (215 kWh) | 2x 30cv | `NE=54174510` |

**Device IDs FusionSolar (configurados no banco de dados):**

| Site | Battery Device IDs | Inverter Device IDs |
|---|---|---|
| Piscinão | `54175052`, `54175053` | `54175054`, `54175055` |
| Barragem | `54174514` | `54174515`, `54174516` |

Estes IDs são usados para chamar `getDevRealKpi` e obter SOC, potência da bateria, temperatura e dados do inversor em tempo real. Sem eles, o sistema cai no fallback station-level que não retorna SOC.

---

## 2. Arquitetura Técnica

### 2.1 Stack Tecnológica

| Camada | Tecnologia | Versão |
|---|---|---|
| **Frontend** | React 19 + Tailwind CSS 4 + shadcn/ui | React 19.2, Tailwind 4.1 |
| **Backend** | Express 4 + tRPC 11 | Express 4.21, tRPC 11.6 |
| **Banco de Dados** | MySQL 8 (via Drizzle ORM) | Drizzle 0.44 |
| **Runtime** | Node.js 22 | 22.13.0 |
| **Package Manager** | pnpm 10 | 10.4.1 |
| **Build** | Vite 7 + esbuild | Vite 7.1, esbuild 0.25 |
| **Testes** | Vitest 2 | 2.1.4 |
| **MQTT** | mqtt.js 5 | 5.15.1 |

### 2.2 Estrutura de Arquivos (Arquivos Relevantes)

```
bess-dashboard/
├── client/                          # Frontend React
│   ├── index.html                   # HTML principal (Google Fonts: Inter, JetBrains Mono)
│   ├── src/
│   │   ├── App.tsx                  # Rotas (wouter): /, /site/:slug, /historico, /relatorios, /sistema
│   │   ├── main.tsx                 # Providers (tRPC, QueryClient, ThemeProvider)
│   │   ├── index.css                # Tema dark OKLCH + tokens CSS
│   │   ├── const.ts                 # ⚠️ MANUS: getLoginUrl() → OAuth Manus (PRECISA SUBSTITUIR)
│   │   ├── _core/hooks/useAuth.ts   # ⚠️ MANUS: Hook de autenticação (PRECISA SUBSTITUIR)
│   │   ├── lib/trpc.ts              # Cliente tRPC tipado
│   │   ├── lib/report-pdf.ts        # Geração de PDF de relatórios (jsPDF)
│   │   ├── pages/
│   │   │   ├── Overview.tsx         # Dashboard principal (cards SOC, alarmes, sites)
│   │   │   ├── SiteDashboard.tsx    # Dashboard por site (fluxo energia, controles)
│   │   │   ├── History.tsx          # Gráficos históricos (recharts)
│   │   │   ├── Reports.tsx          # Relatórios diários/semanais
│   │   │   ├── SystemInfo.tsx       # Config FusionSolar, MQTT, Device IDs
│   │   │   └── ComponentShowcase.tsx # Showcase de componentes (pode remover)
│   │   └── components/
│   │       ├── DashboardLayout.tsx   # ⚠️ MANUS: Sidebar com auth Manus (PRECISA ADAPTAR)
│   │       ├── EnergyFlowDiagram.tsx # Diagrama SVG animado de fluxo de energia
│   │       ├── EnergyTrendChart.tsx  # Gráfico de tendência (recharts)
│   │       └── ui/                   # shadcn/ui components (NÃO MODIFICAR)
│   └── public/                       # Arquivos estáticos (favicon, robots.txt)
│
├── server/                           # Backend Express + tRPC
│   ├── routers.ts                    # ✅ CORE: Todas as procedures tRPC (1331 linhas)
│   ├── db.ts                         # ✅ CORE: Helpers de banco de dados (685 linhas)
│   ├── fusionsolar.ts                # ✅ CORE: Cliente FusionSolar API (549 linhas)
│   ├── mqtt-tasmota.ts               # ✅ CORE: Cliente MQTT Tasmota/Sonoff (417 linhas)
│   ├── report-generator.ts           # ✅ CORE: Gerador de relatórios (394 linhas)
│   ├── storage.ts                    # ⚠️ MANUS: Storage S3 via Forge (PRECISA SUBSTITUIR)
│   ├── _core/                        # ⚠️ MANUS: Framework Manus (PRECISA ADAPTAR)
│   │   ├── index.ts                  # Entry point do servidor
│   │   ├── env.ts                    # Variáveis de ambiente
│   │   ├── context.ts                # Contexto tRPC (auth)
│   │   ├── trpc.ts                   # Definição de procedures (public/protected/admin)
│   │   ├── oauth.ts                  # ⚠️ MANUS: OAuth callback (SUBSTITUIR)
│   │   ├── sdk.ts                    # ⚠️ MANUS: SDK OAuth Manus (SUBSTITUIR)
│   │   ├── cookies.ts                # Cookie handling
│   │   ├── notification.ts           # ⚠️ MANUS: notifyOwner via Forge (SUBSTITUIR)
│   │   ├── storageProxy.ts           # ⚠️ MANUS: Proxy /manus-storage/ (SUBSTITUIR)
│   │   ├── llm.ts                    # ⚠️ MANUS: LLM helper (NÃO USADO no BESS)
│   │   ├── imageGeneration.ts        # ⚠️ MANUS: Image gen (NÃO USADO no BESS)
│   │   ├── map.ts                    # ⚠️ MANUS: Google Maps proxy (NÃO USADO no BESS)
│   │   ├── dataApi.ts                # ⚠️ MANUS: Data API helper (NÃO USADO no BESS)
│   │   ├── voiceTranscription.ts     # ⚠️ MANUS: Voice transcription (NÃO USADO no BESS)
│   │   ├── vite.ts                   # ✅ OK: Vite dev/prod server (funciona standalone)
│   │   ├── systemRouter.ts           # ⚠️ MANUS: notifyOwner mutation (ADAPTAR)
│   │   └── types/                    # Tipos TypeScript
│   └── *.test.ts                     # 11 arquivos de teste (143 testes)
│
├── drizzle/                          # Schema e migrações do banco
│   ├── schema.ts                     # ✅ CORE: Definição de todas as tabelas
│   ├── relations.ts                  # Relações entre tabelas
│   ├── 0000-0008_*.sql               # Migrações SQL
│   └── meta/                         # Metadados Drizzle
│
├── shared/                           # Código compartilhado frontend/backend
│   ├── const.ts                      # Constantes (COOKIE_NAME, timeouts)
│   ├── types.ts                      # Re-exports de tipos
│   └── energy-flow-logic.ts          # ✅ CORE: Lógica de fluxo de energia
│
├── package.json                      # Dependências e scripts
├── drizzle.config.ts                 # Config Drizzle (MySQL)
├── vite.config.ts                    # ⚠️ MANUS: Contém plugins Manus (LIMPAR)
├── vitest.config.ts                  # Config de testes
├── tsconfig.json                     # Config TypeScript
└── todo.md                           # Histórico de todas as features implementadas
```

### 2.3 Esquema do Banco de Dados

O banco utiliza MySQL 8 com Drizzle ORM. As tabelas são:

| Tabela | Descrição | Colunas Principais |
|---|---|---|
| `users` | Usuários autenticados | openId, name, email, role (admin/user) |
| `bess_sites` | Sites monitorados (Piscinão, Barragem) | slug, name, batteryCount, batteryModel, pumpCount, pumpPower, fusionsolarPlantCode, fusionsolarDeviceIds, fusionsolarInverterIds, mqttTopic |
| `bess_state` | Estado em tempo real por site | siteId, loadStatus, mode, currentSoc, currentBatteryPower, currentPvPower, currentLoadPower, healthStatus, mqttConnected, sonoffPower, socSource |
| `bess_config` | Configuração de limites por site | siteId, socLowLimit, socHighLimit, cooldownMinutes, lowReadingsRequired, highReadingsRequired, presetName |
| `bess_readings` | Leituras históricas (timeseries) | siteId, soc, batteryPower, pvPower, loadPower, temperature, soh, source |
| `bess_events` | Eventos do sistema | siteId, type, description, metadata |
| `bess_alarms` | Alarmes ativos/resolvidos | siteId, severity, type, description, active, openedAt, closedAt |
| `bess_reports` | Relatórios diários/semanais | siteId, reportType, periodStart, periodEnd, avgSoc, minSoc, maxSoc, etc. |
| `bess_settings` | Configurações globais (key-value) | key, value, description |

---

## 3. Dependências da Plataforma Manus

A tabela abaixo classifica cada dependência e indica a ação necessária para migração:

| Dependência | Arquivos Afetados | Criticidade | Ação |
|---|---|---|---|
| **OAuth Manus** | `server/_core/oauth.ts`, `server/_core/sdk.ts`, `client/src/const.ts`, `client/src/_core/hooks/useAuth.ts`, `client/src/components/DashboardLayout.tsx`, `client/src/main.tsx` | **ALTA** | Substituir por auth email/senha com bcrypt + JWT |
| **Banco de Dados TiDB** | `server/db.ts`, `drizzle.config.ts` | **ALTA** | Instalar MySQL 8 local, mudar `DATABASE_URL` |
| **Storage S3 (Forge)** | `server/storage.ts`, `server/_core/storageProxy.ts` | **BAIXA** | Substituir por filesystem local (usado apenas em relatórios) |
| **Notifications (Forge)** | `server/_core/notification.ts`, `server/routers.ts:69`, `server/report-generator.ts:234` | **MÉDIA** | Substituir por Nodemailer, Telegram Bot ou WhatsApp |
| **Vite Plugin Manus** | `vite.config.ts` | **BAIXA** | Remover `vite-plugin-manus-runtime` |
| **Analytics (Umami)** | `client/index.html` | **BAIXA** | Remover script ou configurar Umami próprio |
| **LLM, ImageGen, Maps, Voice, DataAPI** | `server/_core/llm.ts`, etc. | **NENHUMA** | Não são usados no BESS — podem ser deletados |

### 3.1 Variáveis de Ambiente

As variáveis de ambiente se dividem em dois grupos:

**Variáveis que FUNCIONAM sem alteração (suas credenciais):**

```env
# FusionSolar Northbound API
FUSIONSOLAR_BASE_URL=https://la5.fusionsolar.huawei.com/thirdData
FUSIONSOLAR_USERNAME=<seu_usuario_fusionsolar>
FUSIONSOLAR_SYSTEM_CODE=<seu_system_code_fusionsolar>

# MQTT Broker (Mosquitto no seu servidor)
MQTT_BROKER_HOST=92.112.179.225
MQTT_BROKER_PORT=1883
MQTT_USERNAME=<seu_usuario_mqtt>
MQTT_PASSWORD=<sua_senha_mqtt>
```

**Variáveis que PRECISAM ser substituídas:**

```env
# Banco de dados — trocar por MySQL local
DATABASE_URL=mysql://bess_user:SENHA_FORTE@localhost:3306/bess_dashboard

# Autenticação — gerar novo secret
JWT_SECRET=<gerar_com_openssl_rand_-hex_32>

# Remover completamente (Manus-specific):
# VITE_APP_ID, OAUTH_SERVER_URL, VITE_OAUTH_PORTAL_URL
# OWNER_OPEN_ID, OWNER_NAME
# BUILT_IN_FORGE_API_URL, BUILT_IN_FORGE_API_KEY
# VITE_FRONTEND_FORGE_API_KEY, VITE_FRONTEND_FORGE_API_URL
# VITE_ANALYTICS_ENDPOINT, VITE_ANALYTICS_WEBSITE_ID
```

---

## 4. Comunicação com Equipamentos

Esta seção documenta como o sistema se comunica com os equipamentos reais. **Nenhuma dessas comunicações depende da plataforma Manus** — todas funcionam diretamente.

### 4.1 FusionSolar Northbound API

O arquivo `server/fusionsolar.ts` implementa um cliente completo para a API Northbound da Huawei FusionSolar. A comunicação é feita via HTTPS diretamente para `la5.fusionsolar.huawei.com`.

**Endpoints utilizados:**

| Endpoint | Método | Descrição |
|---|---|---|
| `/thirdData/login` | POST | Autenticação (retorna XSRF-TOKEN cookie) |
| `/thirdData/getStationRealKpi` | POST | Dados real-time da planta (potência, energia) |
| `/thirdData/getStationHourKpi` | POST | Dados horários da planta |
| `/thirdData/getDevRealKpi` | POST | Dados real-time de dispositivo (SOC bateria, potência inversor) |
| `/thirdData/getDevList` | POST | Lista de dispositivos da planta |
| `/thirdData/getAlarmList` | POST | Alarmes ativos da planta |

**Rate Limits implementados:**

O sistema respeita os limites da Huawei com as seguintes proteções:

- Delay de 10 segundos entre chamadas API individuais
- Backoff exponencial em erro 407 (1min → 2min → 4min → max 10min)
- Login interval de 25 minutos (sessão dura 30min)
- Auto-fetch a cada 15 minutos (2 sites × 3 chamadas = 6 chamadas/ciclo)
- Serialização de chamadas (sem concorrência)
- Skip de chamada redundante quando dados device-level disponíveis

**Fluxo de dados:**

```
FusionSolar API → fusionsolar.ts (getFullTelemetry) → routers.ts (fetchFusionSolarData)
    → db.ts (insertReading, upsertState) → MySQL → Frontend (via tRPC queries)
```

### 4.2 MQTT / Sonoff POWR316D (Tasmota)

O arquivo `server/mqtt-tasmota.ts` implementa a comunicação MQTT com os relés Sonoff POWR316D que controlam as bombas d'água. Os Sonoffs rodam firmware Tasmota e se comunicam via MQTT com o broker Mosquitto no servidor `92.112.179.225:1883`.

**Tópicos MQTT:**

| Tópico | Direção | Descrição |
|---|---|---|
| `cmnd/<topic>/POWER` | Dashboard → Sonoff | Comando ON/OFF |
| `stat/<topic>/POWER` | Sonoff → Dashboard | Confirmação de estado |
| `stat/<topic>/RESULT` | Sonoff → Dashboard | Resultado de comando |
| `tele/<topic>/STATE` | Sonoff → Dashboard | Telemetria periódica |
| `tele/<topic>/LWT` | Sonoff → Dashboard | Last Will (Online/Offline) |

**Tópicos configurados por site:**

- Piscinão: `sonoff_piscinao` (1x bomba 100cv)
- Barragem: `sonoff_barragem` (2x bombas 30cv)

**Fluxo de controle:**

```
Frontend (botão Liga/Desliga) → tRPC mutation (toggleLoad)
    → mqtt-tasmota.ts (publishCommand) → MQTT Broker (92.112.179.225:1883)
    → Sonoff POWR316D → Relé → Bomba d'água
```

**Fluxo de estado:**

```
Sonoff POWR316D → MQTT (stat/tele topics) → mqtt-tasmota.ts (onMessage)
    → db.ts (upsertState) → MySQL → Frontend (polling a cada 30s)
```

### 4.3 Lógica de Controle Automático

O controle automático de carga está implementado em `server/routers.ts` na procedure `evaluateAndControl`. A lógica funciona assim:

1. Se SOC < `socLowLimit` (padrão 15%) por N leituras consecutivas → **DESLIGA** a carga
2. Se SOC > `socHighLimit` (padrão 20%) por N leituras consecutivas → **LIGA** a carga
3. Cooldown de 5 minutos entre manobras para evitar chaveamento excessivo
4. Modo pode ser "auto" (decisão automática) ou "manual" (operador controla)

---

## 5. Modificações Necessárias para Migração

### 5.1 Substituir Autenticação OAuth Manus por Email/Senha

Esta é a modificação mais significativa. O sistema atual usa OAuth Manus para autenticação. Para self-hosted, é necessário implementar autenticação local com email/senha.

**Arquivos a criar:**

1. `server/auth.ts` — Novo módulo de autenticação com bcrypt + JWT
2. `client/src/pages/Login.tsx` — Página de login

**Arquivos a modificar:**

1. `server/_core/sdk.ts` — Substituir `authenticateRequest()` por verificação JWT local
2. `server/_core/oauth.ts` — Substituir callback OAuth por rotas `/api/auth/login` e `/api/auth/register`
3. `server/_core/context.ts` — Adaptar `createContext()` para ler JWT do cookie
4. `client/src/const.ts` — Remover `getLoginUrl()`, substituir por `/login`
5. `client/src/_core/hooks/useAuth.ts` — Adaptar para usar auth local
6. `client/src/main.tsx` — Redirecionar para `/login` em vez de OAuth
7. `client/src/components/DashboardLayout.tsx` — Adaptar botão de login/logout

**Dependências a instalar:**

```bash
pnpm add bcryptjs
pnpm add -D @types/bcryptjs
```

**Schema a adicionar em `drizzle/schema.ts`:**

```typescript
// Adicionar campo passwordHash à tabela users
passwordHash: varchar("passwordHash", { length: 255 }),
```

### 5.2 Instalar MySQL 8 Local

O sistema usa MySQL via Drizzle ORM. A migração é direta:

```bash
# No servidor Ubuntu
sudo apt update && sudo apt install mysql-server -y
sudo mysql_secure_installation

# Criar banco e usuário
sudo mysql -e "CREATE DATABASE bess_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'bess_user'@'localhost' IDENTIFIED BY 'SENHA_FORTE_AQUI';"
sudo mysql -e "GRANT ALL PRIVILEGES ON bess_dashboard.* TO 'bess_user'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"
```

A `DATABASE_URL` no `.env` será:

```
DATABASE_URL=mysql://bess_user:SENHA_FORTE_AQUI@localhost:3306/bess_dashboard
```

Depois de configurar, rodar as migrações:

```bash
cd /opt/bess-dashboard
pnpm db:push
```

### 5.3 Substituir Storage S3 por Filesystem Local

O storage S3 é usado apenas no `report-generator.ts` para salvar relatórios. Pode ser substituído por filesystem local.

**Arquivo a modificar:** `server/storage.ts`

Substituir o conteúdo por:

```typescript
import fs from "fs";
import path from "path";
import crypto from "crypto";

const STORAGE_DIR = path.resolve(process.cwd(), "storage-data");

function ensureDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  ensureDir();
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  const key = lastDot === -1
    ? `${relKey}_${hash}`
    : `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
  const filePath = path.join(STORAGE_DIR, key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, data);
  return { key, url: `/storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  return { key: relKey, url: `/storage/${relKey}` };
}
```

**Adicionar rota estática em `server/_core/index.ts`:**

```typescript
// Substituir registerStorageProxy(app) por:
app.use("/storage", express.static(path.resolve(process.cwd(), "storage-data")));
```

### 5.4 Substituir Notificações

O `notifyOwner()` é chamado em dois lugares:

1. `server/routers.ts:69` — Quando um alarme crítico é detectado
2. `server/report-generator.ts:234` — Quando um relatório é gerado

**Opção A — Telegram Bot (recomendado):**

```typescript
// server/notifications.ts
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

export async function notifyOwner(payload: { title: string; content: string }): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    const text = `*${payload.title}*\n\n${payload.content}`;
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" }),
    });
    return true;
  } catch { return false; }
}
```

**Opção B — Email (Nodemailer):**

```bash
pnpm add nodemailer
pnpm add -D @types/nodemailer
```

### 5.5 Limpar vite.config.ts

Remover os plugins específicos da plataforma Manus:

- Remover `vite-plugin-manus-runtime` do import e do array `plugins`
- Remover `@builder.io/vite-plugin-jsx-loc` (não é necessário)
- Remover os hosts `.manus.computer` e `.manuspre.computer` do `allowedHosts`
- Manter apenas `react()`, `tailwindcss()` nos plugins

### 5.6 Limpar client/index.html

Remover o script de analytics Umami (linhas com `VITE_ANALYTICS_ENDPOINT`).

---

## 6. Guia de Implantação no Servidor Ubuntu

### 6.1 Pré-requisitos

- Ubuntu 22.04 LTS ou 24.04 LTS
- Node.js 22 (via NodeSource ou nvm)
- MySQL 8
- pnpm 10
- Nginx (reverse proxy)
- Certbot ou Cloudflare Tunnel (HTTPS)

### 6.2 Instalação Passo a Passo

```bash
# 1. Instalar Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Instalar pnpm
npm install -g pnpm@10

# 3. Instalar MySQL 8
sudo apt install -y mysql-server
sudo mysql_secure_installation

# 4. Criar banco de dados
sudo mysql -e "CREATE DATABASE bess_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'bess_user'@'localhost' IDENTIFIED BY 'SENHA_FORTE';"
sudo mysql -e "GRANT ALL PRIVILEGES ON bess_dashboard.* TO 'bess_user'@'localhost';"

# 5. Clonar o repositório
cd /opt
sudo git clone https://github.com/gamasolar/bess-controller.git bess-dashboard
sudo chown -R $USER:$USER /opt/bess-dashboard
cd /opt/bess-dashboard/dashboard

# 6. Instalar dependências
pnpm install

# 7. Criar arquivo .env
cat > .env << 'EOF'
NODE_ENV=production
DATABASE_URL=mysql://bess_user:SENHA_FORTE@localhost:3306/bess_dashboard
JWT_SECRET=$(openssl rand -hex 32)
FUSIONSOLAR_BASE_URL=https://la5.fusionsolar.huawei.com/thirdData
FUSIONSOLAR_USERNAME=<SEU_USUARIO>
FUSIONSOLAR_SYSTEM_CODE=<SEU_SYSTEM_CODE>
MQTT_BROKER_HOST=92.112.179.225
MQTT_BROKER_PORT=1883
MQTT_USERNAME=<SEU_USUARIO_MQTT>
MQTT_PASSWORD=<SUA_SENHA_MQTT>
EOF

# 8. Rodar migrações do banco
pnpm db:push

# 9. Build de produção
pnpm build

# 10. Testar
pnpm start
```

### 6.3 Configurar systemd

```bash
sudo cat > /etc/systemd/system/bess-dashboard.service << 'EOF'
[Unit]
Description=BESS Load Controller Dashboard
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=gamaserver
WorkingDirectory=/opt/bess-dashboard
EnvironmentFile=/opt/bess-dashboard/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bess-dashboard

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable bess-dashboard
sudo systemctl start bess-dashboard
```

### 6.4 Configurar Nginx

```nginx
server {
    listen 80;
    server_name bess.gamatech.cloud;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Ou via Cloudflare Tunnel (se já configurado):

```yaml
# /etc/cloudflared/config.yml — adicionar entrada
ingress:
  - hostname: bess.gamatech.cloud
    service: http://localhost:3000
```

### 6.5 Seed de Dados Iniciais

Após a migração, os sites precisam ser inseridos no banco. O sistema faz isso automaticamente no boot via `server/routers.ts` (função `seedSites`), que cria os registros de Piscinão e Barragem se não existirem.

**Importante:** Após o seed, configure os Device IDs via página Sistema do dashboard ou diretamente no banco:

```sql
-- Piscinão
UPDATE bess_sites SET
  fusionsolarPlantCode = 'NE=54175048',
  fusionsolarDeviceIds = '["54175052","54175053"]',
  fusionsolarInverterIds = '["54175054","54175055"]'
WHERE slug = 'piscinao';

-- Barragem
UPDATE bess_sites SET
  fusionsolarPlantCode = 'NE=54174510',
  fusionsolarDeviceIds = '["54174514"]',
  fusionsolarInverterIds = '["54174515","54174516"]'
WHERE slug = 'barragem';
```

Sem esses Device IDs, o SOC não será atualizado automaticamente.

---

## 7. Testes

O projeto possui 143 testes em 11 arquivos:

| Arquivo | Testes | Descrição |
|---|---|---|
| `auth.logout.test.ts` | 3 | Autenticação e logout |
| `bess.test.ts` | 32 | Endpoints principais (sites, detail, config, alarms) |
| `fusionsolar.test.ts` | 3 | Credenciais FusionSolar e MQTT |
| `autofetch.test.ts` | 8 | Lógica de auto-fetch e pvPower |
| `energy-flow.test.ts` | 12 | Lógica de fluxo de energia |
| `energy-trend.test.ts` | 15 | Gráficos de tendência |
| `load-control.test.ts` | 18 | Controle de carga automático |
| `mqtt-dispatch.test.ts` | 12 | Dispatch MQTT |
| `mqtt-sync.test.ts` | 16 | Sincronização MQTT |
| `reports.test.ts` | 16 | Geração de relatórios |
| `manual-soc.test.ts` | 8 | Entrada manual de SOC e config device IDs |

Para rodar os testes:

```bash
pnpm test
```

Os testes que chamam a FusionSolar API real podem falhar com timeout se o rate limit estiver ativo. Isso é esperado e não indica problema no código.

---

## 8. Notas Importantes

### 8.1 Rate Limit FusionSolar

A API FusionSolar tem limites fixos baseados no número de plantas. Para 2 plantas, o limite é de aproximadamente 1 chamada a cada 5 minutos por planta. O sistema já implementa todas as proteções necessárias (backoff exponencial, serialização, delays). Se o rate limit 407 persistir, aguarde 10-30 minutos sem fazer chamadas e o sistema se recupera automaticamente.

### 8.2 MQTT Broker

O broker MQTT está no IP `92.112.179.225:1883`. Se o servidor mudar de IP, atualizar a variável `MQTT_BROKER_HOST` no `.env`. Os Sonoffs precisam estar configurados no Tasmota para se conectar ao mesmo broker.

### 8.3 Dados Existentes

Os dados no banco Manus (TiDB) não serão migrados automaticamente. O novo banco começará vazio. Os sites serão recriados automaticamente pelo seed, mas o histórico de leituras, eventos e relatórios começará do zero.

### 8.4 Pacotes Manus-Specific no package.json

Os seguintes pacotes podem ser removidos do `package.json` após a migração:

```
devDependencies:
  - @builder.io/vite-plugin-jsx-loc (plugin de desenvolvimento Manus)
  - vite-plugin-manus-runtime (runtime Manus)

dependencies:
  - @aws-sdk/client-s3 (se usar filesystem local)
  - @aws-sdk/s3-request-presigner (se usar filesystem local)
```
