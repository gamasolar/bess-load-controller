# Variáveis de Ambiente — BESS Dashboard Self-Hosted

Este arquivo documenta todas as variáveis de ambiente necessárias para rodar o BESS Dashboard em servidor próprio. No deploy self-hosted, crie um arquivo `.env` na raiz do projeto com estas variáveis.

## Variáveis Obrigatórias

```env
# ── Servidor ──────────────────────────────────────────────────
NODE_ENV=production

# ── Banco de Dados (MySQL 8) ─────────────────────────────────
# Formato: mysql://USUARIO:SENHA@HOST:PORTA/BANCO
DATABASE_URL=mysql://bess_user:SENHA_FORTE_AQUI@localhost:3306/bess_dashboard

# ── Autenticação (JWT) ───────────────────────────────────────
# Gerar com: openssl rand -hex 32
JWT_SECRET=GERAR_COM_OPENSSL_RAND_HEX_32

# ── FusionSolar Northbound API ───────────────────────────────
FUSIONSOLAR_BASE_URL=https://la5.fusionsolar.huawei.com/thirdData
FUSIONSOLAR_USERNAME=SEU_USUARIO_FUSIONSOLAR
FUSIONSOLAR_SYSTEM_CODE=SEU_SYSTEM_CODE_FUSIONSOLAR

# ── MQTT Broker (Mosquitto) ──────────────────────────────────
MQTT_BROKER_HOST=92.112.179.225
MQTT_BROKER_PORT=1883
MQTT_USERNAME=SEU_USUARIO_MQTT
MQTT_PASSWORD=SUA_SENHA_MQTT
```

## Variáveis Opcionais

```env
# ── Porta do Servidor (padrão: 3000) ─────────────────────────
# PORT=3000

# ── Notificações via Telegram ────────────────────────────────
# Criar bot via @BotFather no Telegram
# Obter chat_id: https://api.telegram.org/bot<TOKEN>/getUpdates
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## Variáveis Removidas (plataforma Manus)

As seguintes variáveis **NÃO são necessárias** no deploy self-hosted e devem ser removidas do código durante a migração:

| Variável | Motivo |
|---|---|
| `VITE_APP_ID` | OAuth Manus (substituído por auth local) |
| `OAUTH_SERVER_URL` | OAuth Manus |
| `VITE_OAUTH_PORTAL_URL` | OAuth Manus |
| `OWNER_OPEN_ID` | Identidade Manus |
| `OWNER_NAME` | Identidade Manus |
| `BUILT_IN_FORGE_API_URL` | API Forge Manus (S3, LLM, etc.) |
| `BUILT_IN_FORGE_API_KEY` | API Forge Manus |
| `VITE_FRONTEND_FORGE_API_KEY` | API Forge frontend |
| `VITE_FRONTEND_FORGE_API_URL` | API Forge frontend |
| `VITE_ANALYTICS_ENDPOINT` | Umami analytics |
| `VITE_ANALYTICS_WEBSITE_ID` | Umami analytics |
| `VITE_APP_LOGO` | Logo via CDN Manus |
| `VITE_APP_TITLE` | Título gerenciado pelo Manus |
