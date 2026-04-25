# Prompt para o Claude — Migração Self-Hosted do BESS Dashboard

**Copie todo o conteúdo abaixo e cole como primeiro prompt em uma nova conversa com o Claude.**

---

## PROMPT INÍCIO

Você é um engenheiro de software sênior especializado em Node.js, React, TypeScript e DevOps. Vou te dar acesso a um repositório GitHub com um projeto completo chamado **BESS Load Controller Dashboard**. Sua missão é adaptar este projeto para rodar de forma self-hosted no meu servidor Ubuntu, removendo todas as dependências da plataforma Manus onde foi originalmente desenvolvido.

### Contexto do Projeto

O BESS Dashboard é um sistema de monitoramento e controle em tempo real para sistemas de armazenamento de energia por bateria (Battery Energy Storage Systems). Ele gerencia duas usinas solares com baterias LUNA2000-215KWH da Huawei, controlando cargas elétricas (bombas d'água) com base no estado de carga (SOC) das baterias.

O repositório está em: `https://github.com/gamasolar/bess-controller`

O código do dashboard está no diretório `dashboard/` dentro do repositório.

### Stack Tecnológica

- **Frontend:** React 19 + Tailwind CSS 4 + shadcn/ui + Recharts + wouter (router)
- **Backend:** Express 4 + tRPC 11 + Superjson
- **Banco de Dados:** MySQL 8 via Drizzle ORM (atualmente TiDB na nuvem Manus)
- **Runtime:** Node.js 22 + pnpm 10
- **Build:** Vite 7 + esbuild
- **Testes:** Vitest (143 testes)
- **Comunicação:** FusionSolar Northbound API (HTTPS) + MQTT/Tasmota (Sonoff POWR316D)

### Documentação Completa

O arquivo `MIGRATION-GUIDE.md` na raiz do repositório contém toda a documentação detalhada:
- Arquitetura completa do sistema
- Esquema do banco de dados (8 tabelas)
- Mapeamento de todas as dependências Manus vs self-hosted
- Variáveis de ambiente necessárias
- Documentação da comunicação com equipamentos (FusionSolar API + MQTT)
- Lógica de controle automático de carga
- Guia passo a passo de implantação

**LEIA O `MIGRATION-GUIDE.md` INTEIRO ANTES DE COMEÇAR.**

### Tarefas de Migração (em ordem)

Siga estas tarefas na ordem exata. Cada tarefa deve ser completada e testada antes de avançar para a próxima.

#### Tarefa 1 — Substituir Autenticação OAuth Manus por Email/Senha Local

Esta é a tarefa mais crítica. O sistema atual usa OAuth da plataforma Manus. Precisa ser substituído por autenticação local com email/senha + bcrypt + JWT.

**Arquivos a CRIAR:**
1. `server/auth.ts` — Módulo de autenticação com:
   - Função `hashPassword(password)` usando bcrypt
   - Função `verifyPassword(password, hash)` usando bcrypt
   - Função `createSession(userId)` que gera JWT com jose
   - Função `verifySession(token)` que valida JWT
   - Rotas Express: `POST /api/auth/login`, `POST /api/auth/register`
2. `client/src/pages/Login.tsx` — Página de login com formulário email/senha

**Arquivos a MODIFICAR:**
1. `drizzle/schema.ts` — Adicionar campo `passwordHash: varchar("passwordHash", { length: 255 })` à tabela `users`
2. `server/_core/context.ts` — Substituir `sdk.authenticateRequest()` por verificação JWT do cookie
3. `server/_core/oauth.ts` — Remover callback OAuth, registrar rotas `/api/auth/login` e `/api/auth/register`
4. `client/src/const.ts` — Remover `getLoginUrl()` que aponta para OAuth Manus, substituir por `/login`
5. `client/src/_core/hooks/useAuth.ts` — Adaptar para usar auth local (o hook `useAuth` usa `trpc.auth.me` e `trpc.auth.logout` que já existem no backend)
6. `client/src/main.tsx` — Redirecionar para `/login` em vez de OAuth portal
7. `client/src/components/DashboardLayout.tsx` — Adaptar botão de login/logout
8. `client/src/App.tsx` — Adicionar rota `/login` para a página Login

**Dependências a instalar:**
```bash
pnpm add bcryptjs
pnpm add -D @types/bcryptjs
```

**A biblioteca `jose` já está instalada** (usada para JWT no sistema atual).

**IMPORTANTE:** O primeiro usuário registrado deve ser automaticamente `admin`. Usuários subsequentes devem ser `user`. A tabela `users` já tem campo `role` com enum `admin`/`user`.

#### Tarefa 2 — Substituir Storage S3 por Filesystem Local

O storage S3 é usado apenas no `server/report-generator.ts` para salvar relatórios PDF.

**Arquivo a REESCREVER:** `server/storage.ts`

Substituir por filesystem local:
- `storagePut(key, data, contentType)` → salvar em `./storage-data/{key}`
- `storageGet(key)` → retornar URL `/storage/{key}`
- Adicionar rota estática `app.use("/storage", express.static("storage-data"))` no `server/_core/index.ts`
- Remover `registerStorageProxy(app)` do `server/_core/index.ts`

#### Tarefa 3 — Substituir Notificações

O `notifyOwner()` é chamado em:
- `server/routers.ts` — Quando alarme crítico é detectado
- `server/report-generator.ts` — Quando relatório é gerado

**Arquivo a REESCREVER:** `server/_core/notification.ts`

Implementar via Telegram Bot:
```typescript
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

#### Tarefa 4 — Limpar Dependências Manus

**`vite.config.ts`:**
- Remover import e uso de `vite-plugin-manus-runtime`
- Remover import e uso de `@builder.io/vite-plugin-jsx-loc`
- Remover hosts `.manus.computer` e `.manuspre.computer` do `allowedHosts`
- Manter apenas: `react()`, `tailwindcss()` nos plugins

**`client/index.html`:**
- Remover o script de analytics Umami (linhas com `VITE_ANALYTICS_ENDPOINT`)

**`package.json`:**
- Remover de devDependencies: `@builder.io/vite-plugin-jsx-loc`, `vite-plugin-manus-runtime`
- Remover de dependencies (se usar filesystem local): `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

**`server/_core/env.ts`:**
- Remover variáveis Manus-specific que não são mais usadas
- Manter: DATABASE_URL, JWT_SECRET, FUSIONSOLAR_*, MQTT_*

**Arquivos _core que podem ser DELETADOS** (não são usados no BESS):
- `server/_core/llm.ts`
- `server/_core/imageGeneration.ts`
- `server/_core/map.ts`
- `server/_core/dataApi.ts`
- `server/_core/voiceTranscription.ts`
- `server/_core/systemRouter.ts` (adaptar notifyOwner antes de deletar)

#### Tarefa 5 — Configurar Build de Produção

O `package.json` já tem scripts de build:
```json
"build": "vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
"start": "NODE_ENV=production node dist/index.js"
```

Verificar que:
1. `pnpm build` completa sem erros
2. `pnpm start` inicia o servidor em produção
3. O servidor NÃO usa porta hardcoded (deve usar `process.env.PORT || 3000`)

#### Tarefa 6 — Criar Arquivo .env.example

Criar `.env.example` com todas as variáveis necessárias:

```env
# Servidor
NODE_ENV=production
PORT=3000

# Banco de Dados (MySQL 8)
DATABASE_URL=mysql://bess_user:SENHA@localhost:3306/bess_dashboard

# Autenticação
JWT_SECRET=gerar_com_openssl_rand_-hex_32

# FusionSolar Northbound API
FUSIONSOLAR_BASE_URL=https://la5.fusionsolar.huawei.com/thirdData
FUSIONSOLAR_USERNAME=seu_usuario
FUSIONSOLAR_SYSTEM_CODE=seu_system_code

# MQTT Broker (Mosquitto)
MQTT_BROKER_HOST=92.112.179.225
MQTT_BROKER_PORT=1883
MQTT_USERNAME=seu_usuario_mqtt
MQTT_PASSWORD=sua_senha_mqtt

# Notificações (Telegram - opcional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

#### Tarefa 7 — Rodar Todos os Testes

```bash
pnpm test
```

Devem passar 143 testes (ou mais, se você adicionou testes para auth local). Alguns testes que chamam a FusionSolar API real podem dar timeout — isso é esperado e não indica problema.

#### Tarefa 8 — Configurar systemd e Nginx

Criar arquivo `deploy/bess-dashboard.service`:

```ini
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
```

Criar arquivo `deploy/nginx.conf`:

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

### Informações do Servidor de Destino

- **OS:** Ubuntu (22.04 ou 24.04)
- **Usuário:** gamaserver
- **Diretório de instalação:** /opt/bess-dashboard
- **Domínio:** bess.gamatech.cloud (via Cloudflare Tunnel)
- **MySQL:** Será instalado localmente
- **MQTT Broker:** Já rodando em 92.112.179.225:1883

### Regras de Desenvolvimento

1. **NÃO MODIFIQUE** os arquivos de lógica BESS que já funcionam: `server/fusionsolar.ts`, `server/mqtt-tasmota.ts`, `server/routers.ts` (exceto para remover imports de módulos Manus deletados), `server/report-generator.ts`, `server/db.ts`, `shared/energy-flow-logic.ts`
2. **NÃO MODIFIQUE** os componentes shadcn/ui em `client/src/components/ui/`
3. **MANTENHA** toda a lógica de rate limit da FusionSolar (backoff exponencial, delays, serialização)
4. **MANTENHA** toda a lógica MQTT/Tasmota (tópicos, comandos, telemetria)
5. **TESTE** cada modificação com `pnpm test` antes de avançar
6. **DOCUMENTE** cada alteração feita

### Ordem de Execução

1. Clone o repositório: `git clone https://github.com/gamasolar/bess-controller.git`
2. Acesse o diretório do dashboard: `cd bess-controller/dashboard`
3. Leia `MIGRATION-GUIDE.md` inteiro
4. Execute as Tarefas 1 a 8 na ordem
5. Faça commit e push de todas as alterações
6. Forneça instruções passo a passo para implantação no servidor

### Device IDs FusionSolar (JÁ CONFIGURADOS)

Estes IDs são essenciais para obter o SOC real das baterias. Devem ser configurados no banco após o seed:

| Site | Slug | PlantCode | Battery Device IDs | Inverter Device IDs |
|---|---|---|---|---|
| Piscinão | `piscinao` | `NE=54175048` | `54175052`, `54175053` | `54175054`, `54175055` |
| Barragem | `barragem` | `NE=54174510` | `54174514` | `54174515`, `54174516` |

SQL para configurar após seed:
```sql
UPDATE bess_sites SET fusionsolarPlantCode='NE=54175048', fusionsolarDeviceIds='["54175052","54175053"]', fusionsolarInverterIds='["54175054","54175055"]' WHERE slug='piscinao';
UPDATE bess_sites SET fusionsolarPlantCode='NE=54174510', fusionsolarDeviceIds='["54174514"]', fusionsolarInverterIds='["54174515","54174516"]' WHERE slug='barragem';
```

### Credenciais e Segredos

As credenciais reais de FusionSolar e MQTT serão fornecidas separadamente. Use placeholders no `.env.example`.

### Rate Limit FusionSolar

A API FusionSolar tem rate limit fixo (não pode ser aumentado). Para 2 plantas:
- Dados real-time: 1 chamada a cada 5 minutos por planta
- Concorrência: 1 requisição por minuto (global)
- O auto-fetch está configurado para 15 minutos
- O sistema implementa backoff exponencial (1min → 2min → 4min → max 10min) quando recebe erro 407
- **NÃO ALTERE** os delays e intervalos sem entender os limites da Huawei

## PROMPT FIM
