# DEPLOY.md — Self-hosted deployment em `gamaserver`

Este guia foi escrito **especificamente** para o servidor `gamaserver` da
gamasolar, identificado durante a fase de diagnóstico:

| Item | Valor |
|---|---|
| OS | Ubuntu 22.04.5 LTS (kernel 5.15) |
| Hardware | AMD Ryzen 9 7900X, 62 GB RAM, 1 TB / + 1.8 TB /mnt/data |
| User | `gama` (não criar `gamaserver`) |
| Path | `/opt/bess-dashboard` |
| Node | v22.22.0 ✅ já instalado |
| pnpm | 10.28.2 ✅ já instalado |
| MySQL | 8.0.45 ✅ já instalado, rodando local |
| nginx | 1.18.0 ✅ ativo (sites: `sigas`, `000-block-direct`) |
| Cloudflared | 2026.2.0 ✅ ativo (tunnel `81148dc9-3c80-...`) |
| Hostname público | `bess.gamasolar.com.br` |
| Porta interna | **3010** (3000 já está ocupada por PM2 / easypanel) |
| Broker MQTT | `92.112.179.225:1883` (remoto, no `srv769185`) |
| User MQTT | `bess_user` / `@Gamasolar203050` |

## Outros serviços rodando que NÃO devemos quebrar

- `sigas.gamasolar.com.br` (nginx local + Let's Encrypt + porta 4002/3001)
- `helios.gamasolar.com.br` (via tunnel → 8443)
- `nexus.gamasolar.com.br` (via tunnel → 3000 PM2)
- `cafeespecial.gamasolar.com.br` (via tunnel → 18080 caddy)
- `ssh.gamasolar.com.br` (via tunnel → 22)
- ~22 containers Docker (helios-*, gama-*, cafe-*)
- MySQL bancos: `helios_gama`, `nexusgd`
- PostgreSQL: `nexusgama` (em container `gama-db`)

---

## 0 · Pré-requisitos (já cumpridos)

Estes itens **já estão instalados/configurados** no servidor — não precisa repetir:

- ✅ Node 22, pnpm 10, MySQL 8, nginx, cloudflared
- ✅ User `gama` com sudo
- ✅ Cloudflare Tunnel ativo

## 1 · Database MySQL (FEITO durante o setup)

```sql
CREATE DATABASE bess_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'bess_user'@'localhost' IDENTIFIED BY '<senha-gerada>';
GRANT ALL PRIVILEGES ON bess_dashboard.* TO 'bess_user'@'localhost';
FLUSH PRIVILEGES;
```

> A senha é gerada uma única vez via `openssl rand -base64 24` no provisionamento. Anotar e guardar.

## 2 · Subir o código

```bash
# Upload (do seu computador local):
scp bess-dashboard-self-hosted.zip gama@<IP_GAMASERVER>:/tmp/

# Já no gamaserver:
sudo mkdir -p /opt/bess-dashboard
sudo chown gama:gama /opt/bess-dashboard

cd /tmp
unzip -q bess-dashboard-self-hosted.zip
mv bess-controller-main/dashboard/* /opt/bess-dashboard/
mv bess-controller-main/dashboard/.[!.]* /opt/bess-dashboard/ 2>/dev/null || true
rm -rf bess-controller-main bess-dashboard-self-hosted.zip

cd /opt/bess-dashboard
ls -la
```

## 3 · `.env`

```bash
cp .env.example .env
nano .env
```

Conteúdo (substituir os `CHANGE_ME`):

```env
NODE_ENV=production
PORT=3010

DATABASE_URL=mysql://bess_user:<SENHA_DO_PASSO_1>@localhost:3306/bess_dashboard

JWT_SECRET=<gerar com: openssl rand -hex 32>

ALLOW_SIGNUP=true

FUSIONSOLAR_BASE_URL=https://la5.fusionsolar.huawei.com/thirdData
FUSIONSOLAR_USERNAME=<conta Northbound>
FUSIONSOLAR_SYSTEM_CODE=<senha Northbound>

MQTT_BROKER_HOST=92.112.179.225
MQTT_BROKER_PORT=1883
MQTT_USERNAME=bess_user
MQTT_PASSWORD=@Gamasolar203050

# Telegram opcional
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## 4 · Build

```bash
cd /opt/bess-dashboard
pnpm install --no-frozen-lockfile
pnpm build
```

`pnpm install` vai regenerar o `pnpm-lock.yaml` (esperado — adicionei `bcryptjs`, removi AWS SDK).

## 5 · Schema + dados iniciais

### 5.1 — Aplicar migrations Drizzle

```bash
cd /opt/bess-dashboard
pnpm db:push
```

> Se conflitar com a migration manual `drizzle/0009_add_password_hash.sql`, **apague** o arquivo antes (`rm drizzle/0009_add_password_hash.sql`) e deixe o `drizzle-kit` gerar do snapshot.

### 5.2 — Smoke test em foreground

```bash
PORT=3010 pnpm start
```

Em outra sessão SSH:

```bash
curl -s http://localhost:3010/api/auth/status | jq
# Esperado: { "hasUsers": false, "signupAllowed": true }
```

`Ctrl+C` para parar.

### 5.3 — Configurar Device IDs FusionSolar (formato LONG)

> ⚠️ **Use os IDs longos** (`1000000054174514`) — a API rejeita os IDs curtos do portal (`54174514`).

Primeiro inicie o serviço uma vez para criar as linhas das duas plantas (`piscinao`, `barragem`), depois aplique:

```bash
# Após pelo menos um boot bem-sucedido do serviço:
sudo mysql bess_dashboard <<'SQL'
UPDATE bess_sites SET
  fusionsolarPlantCode   = 'NE=54175048',
  fusionsolarDeviceIds   = '["1000000054175052","1000000054175053"]',
  fusionsolarInverterIds = '["1000000054175054","1000000054175055"]'
WHERE slug = 'piscinao';

UPDATE bess_sites SET
  fusionsolarPlantCode   = 'NE=54174510',
  fusionsolarDeviceIds   = '["1000000054174514"]',
  fusionsolarInverterIds = '["1000000054174515","1000000054174516"]'
WHERE slug = 'barragem';
SQL
```

## 6 · systemd

```bash
sudo cp /opt/bess-dashboard/deploy/bess-dashboard.service /etc/systemd/system/
```

**Importante:** o `.service` template está com `User=gamaserver`. Edite para `User=gama`:

```bash
sudo sed -i 's/^User=gamaserver$/User=gama/' /etc/systemd/system/bess-dashboard.service
sudo systemctl daemon-reload
sudo systemctl enable bess-dashboard
sudo systemctl start bess-dashboard
sudo systemctl status bess-dashboard --no-pager
```

Logs:

```bash
sudo journalctl -u bess-dashboard -f
```

## 7 · nginx — adicionar site

> Não usar Let's Encrypt local. TLS é feito no edge da Cloudflare; o nginx só expõe HTTP em `127.0.0.1:80` consumido pelo cloudflared.

Crie `/etc/nginx/sites-available/bess`:

```nginx
server {
    listen 127.0.0.1:80;
    server_name bess.gamasolar.com.br;

    client_max_body_size 50M;

    access_log /var/log/nginx/bess_access.log;
    error_log  /var/log/nginx/bess_error.log warn;

    # Bloqueia arquivos ocultos / scans
    location ~ /\. { return 404; }
    location ~ \.(env|git|bak|sql|sqlite|log|ini|conf|yml|yaml|php)$ { return 404; }

    # WebSocket-friendly proxy ao Node em :3010
    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Habilita:

```bash
sudo ln -s /etc/nginx/sites-available/bess /etc/nginx/sites-enabled/bess
sudo nginx -t          # valida
sudo systemctl reload nginx   # aplica sem downtime
```

> ⚠️ Esse server escuta APENAS em `127.0.0.1:80`, não na porta pública. O `000-block-direct` (default_server na 80) continua bloqueando acessos diretos por IP. O cloudflared acessa pelo loopback.

## 8 · Cloudflare Tunnel — adicionar ingress

```bash
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak-$(date +%F)
sudo nano /etc/cloudflared/config.yml
```

**Inserir o novo ingress ANTES do `http_status:404`:**

```yaml
  - hostname: bess.gamasolar.com.br
    service: http://127.0.0.1:80
    originRequest:
      httpHostHeader: bess.gamasolar.com.br
  - service: http_status:404
```

Validar e aplicar:

```bash
sudo cloudflared tunnel ingress validate
sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager | head -15
```

> **Esse restart causa ~5s de downtime em TODOS os outros sites do tunnel** (sigas, helios, nexus, cafeespecial, ssh). Agendar fora de horário comercial se houver usuários ativos.

## 9 · DNS Cloudflare

O subdomínio `bess.gamasolar.com.br` precisa apontar para o tunnel. Pelo CLI:

```bash
sudo cloudflared tunnel route dns 81148dc9-3c80-4132-ac00-6d704e2e971b bess.gamasolar.com.br
```

Ou via Cloudflare Dashboard:
1. DNS → Add record
2. Type: `CNAME`
3. Name: `bess`
4. Target: `81148dc9-3c80-4132-ac00-6d704e2e971b.cfargotunnel.com`
5. Proxy: ✅ ON (laranja)

Testar:

```bash
dig +short bess.gamasolar.com.br
curl -sI https://bess.gamasolar.com.br
# Esperado: HTTP/2 200 (ou 3xx para /login)
```

## 10 · Primeiro login

`https://bess.gamasolar.com.br/login` no navegador.

Como `users` está vazia, a página entra em modo **"Criar admin"**. Preencha nome, email, senha (≥ 8 chars). O primeiro registro vira `role=admin`.

Depois, para impedir cadastros adicionais:

```bash
sudo sed -i 's|^ALLOW_SIGNUP=.*|ALLOW_SIGNUP=false|' /opt/bess-dashboard/.env
sudo systemctl restart bess-dashboard
```

## 11 · Validações operacionais

```bash
# Service
systemctl status bess-dashboard
journalctl -u bess-dashboard -f

# HTTP local (deve responder 200)
curl -sI http://127.0.0.1:3010

# tRPC health
curl -s 'http://127.0.0.1:3010/api/trpc/system.health?input=%7B%7D'

# Auth status
curl -s http://127.0.0.1:3010/api/auth/status

# MQTT (do gamaserver, falando com o broker remoto)
mosquitto_sub -h 92.112.179.225 -p 1883 -u bess_user -P '@Gamasolar203050' \
  -t 'tele/bess_sonoff/LWT' -C 1 -W 5
# Esperado: Online

# Verificar logs FusionSolar (após o primeiro auto-fetch a cada 15min)
journalctl -u bess-dashboard | grep -i "fusionsolar\|battery_soc"
```

## 12 · Atualização

```bash
cd /opt/bess-dashboard
git pull
pnpm install --no-frozen-lockfile
pnpm db:push           # apenas se schema mudou
pnpm build
sudo systemctl restart bess-dashboard
```

---

## Troubleshooting específico ao gamaserver

**`Connection refused: 127.0.0.1:3010`** ao acessar via nginx
→ Service caiu. `journalctl -u bess-dashboard -n 50` mostra o motivo. Frequentemente é `.env` mal formatado ou `DATABASE_URL` errado.

**Tunnel sobe mas `bess.gamasolar.com.br` retorna 502**
→ DNS apontando, tunnel ativo, mas nginx não está respondendo na porta esperada. Cheque `nginx -T | grep bess` e o teste local: `curl -H "Host: bess.gamasolar.com.br" http://127.0.0.1:80`.

**Helios ou outros sites caem após o restart cloudflared**
→ Erro de YAML no `config.yml` impediu cloudflared de subir. Restaure: `sudo cp /etc/cloudflared/config.yml.bak-* /etc/cloudflared/config.yml && sudo systemctl restart cloudflared`.

**`pnpm install` falha com erros de hash de lockfile**
→ Use `--no-frozen-lockfile` (já no comando do passo 4). Houve mudanças de dependências em relação ao lockfile original.

**`pnpm db:push` reclama de migration duplicada na 0009**
→ Apague o arquivo manual: `rm drizzle/0009_add_password_hash.sql` e reaplique `pnpm db:push`. O drizzle-kit gera um snapshot+SQL próprios.

**MQTT timeout a partir do gamaserver**
→ Firewall do `srv769185` (broker) precisa aceitar conexões da IP pública do gamaserver. Se `srv769185` tem `ufw` ativo, libere a 1883 ou trate via cloudflared/Tailscale (recomendado, evita exposição pública do broker).

**Sonoff online mas dashboard não vê estado da bomba**
→ Topic do Sonoff é `bess_sonoff` (não `tasmota_barragem` ou similar). Verifique no banco: `SELECT slug, mqttTopic FROM bess_sites;` — deve estar configurado.

---

## Pendências conhecidas (separadas do deploy)

1. **Mosquitto config duplicada** em `srv769185` (`/etc/mosquitto/conf.d/bess.conf` duplica `password_file` com `/etc/mosquitto/mosquitto.conf`). Broker subiu na raspa; pode não voltar em próximo reboot. Tratar antes de reboot agendado do `srv769185`.

2. **Sonoff Basic** sem medição de energia (`Sonoff Basic`, não POWR316D). Trocar quando houver visita à planta.

3. **Apenas 1 Sonoff configurado** no broker (provavelmente Barragem). Piscinão sem hardware de controle automatizado — manual via dashboard apenas.

4. **Modbus TCP no SmartLogger** ainda não habilitado. Caminho 2 da arquitetura, depende de visita técnica.

5. **Coulomb counting + poll adaptativo** (Caminho 1) ainda não implementado — vai numa próxima entrega.
