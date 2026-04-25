# MVP-PLAN.md — Plano Técnico de Refactor BESS Dashboard v2

> **Companion ao `MVP-SCOPE.md`.** Este arquivo lista as tarefas técnicas em ordem, com dependências, validações e estimativas. Use junto com `MVP-PROMPT.md` (prompt pra Claude executar).

---

## Princípios

1. **Refactor incremental, não rewrite.** Mantém auth, MQTT, FusionSolar core. Refatora UI + lógica de controle + APIs.
2. **Schema additive.** Nada de DROP TABLE. Só novas tabelas + ALTER ADD COLUMN.
3. **Cada tarefa é testável isoladamente.** Backend antes de frontend pra poder validar via curl.
4. **Não toca em produção até passar todos os critérios de aceitação locais.**
5. **Branch única `mvp-v2`.** Merge em `main` só depois de validação completa.

---

## Pré-requisitos (já feitos no servidor)

✅ Repositório em `/opt/bess-dashboard/`
✅ Build funcional, systemd ativo
✅ MySQL `bess_dashboard` com 10 tabelas existentes
✅ FusionSolar device-IDs longos configurados
✅ MQTT Sonoff Barragem operacional
✅ Auth local + cookie Secure funcionais
✅ Cloudflare Tunnel + nginx em pé
✅ `CLAUDE.md` instalado (contexto pra Claude)

---

## Fase 0 — Branch e backup (15 min)

### 0.1 — Criar branch local

```bash
cd /opt/bess-dashboard
# Se ainda não tem git inicializado:
test -d .git || git init && git add -A && git commit -m "snapshot pre-mvp-v2"
git checkout -b mvp-v2
```

### 0.2 — Backup de banco

```bash
sudo mysqldump bess_dashboard > /tmp/bess_dashboard_pre_mvp_$(date +%F).sql
ls -lh /tmp/bess_dashboard_pre_mvp_*.sql
```

### 0.3 — Backup do .env

```bash
sudo cp /opt/bess-dashboard/.env /opt/bess-dashboard/.env.backup-pre-mvp
```

**Validação:** dump existe, branch ativa.

---

## Fase 1 — Schema novo (30 min)

### 1.1 — Adicionar campos em `bess_state`

Editar `drizzle/schema.ts`:

```typescript
export const bessState = mysqlTable("bess_state", {
  // ... campos existentes ...
  socEstimated: float("socEstimated"),
  lastEstimateAt: timestamp("lastEstimateAt"),
  dischargeRatePpPerMin: float("dischargeRatePpPerMin"),
  cooldownUntil: timestamp("cooldownUntil"),
  pumpOnSinceTimestamp: timestamp("pumpOnSinceTimestamp"),
  pumpOnSecondsToday: int("pumpOnSecondsToday").default(0),
});
```

### 1.2 — Criar tabela `bess_config`

```typescript
export const bessConfig = mysqlTable("bess_config", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull().unique(),
  socMinDesliga: int("socMinDesliga").notNull().default(25),
  socMinReliga: int("socMinReliga").notNull().default(30),
  socBlackout: int("socBlackout").notNull().default(15),
  horarioLiberacao: varchar("horarioLiberacao", { length: 5 }).notNull().default("06:00"),
  horarioCorte: varchar("horarioCorte", { length: 5 }).notNull().default("17:30"),
  margemZonaCritica: int("margemZonaCritica").notNull().default(5),
  intervaloPadrao: int("intervaloPadrao").notNull().default(15),
  intervaloCritico: int("intervaloCritico").notNull().default(2),
  cooldownAcao: int("cooldownAcao").notNull().default(5),
  maxSemTelemetria: int("maxSemTelemetria").notNull().default(30),
  controlMode: mysqlEnum("controlMode", ["AUTO", "MANUAL"]).notNull().default("AUTO"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
});
```

### 1.3 — Criar tabela `bess_actions`

```typescript
export const bessActions = mysqlTable("bess_actions", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
  source: mysqlEnum("source", ["AUTO", "MANUAL", "BLACKOUT", "SYSTEM"]).notNull(),
  action: mysqlEnum("action", ["TURN_ON", "TURN_OFF", "MODE_CHANGE", "CONFIG_CHANGE", "ALERT"]).notNull(),
  socAtTime: int("socAtTime"),
  socSource: mysqlEnum("socSource", ["REAL", "ESTIMATED"]).default("REAL"),
  pumpStateBefore: mysqlEnum("pumpStateBefore", ["ON", "OFF", "UNKNOWN"]),
  pumpStateAfter: mysqlEnum("pumpStateAfter", ["ON", "OFF", "UNKNOWN"]),
  reason: varchar("reason", { length: 255 }),
  userId: int("userId"),
  metadata: json("metadata"),
});
```

### 1.4 — Aplicar schema

```bash
cd /opt/bess-dashboard
pnpm db:push 2>&1 | tail -10
sudo mysql bess_dashboard -e "SHOW TABLES;"
sudo mysql bess_dashboard -e "DESCRIBE bess_config;"
sudo mysql bess_dashboard -e "DESCRIBE bess_actions;"
sudo mysql bess_dashboard -e "DESCRIBE bess_state;" | grep -E "estimat|cooldown|pumpOn"
```

### 1.5 — Seed de configs default pras 2 plantas

Adicionar em `server/db.ts` ou `server/_core/seed.ts`:

```typescript
export async function seedDefaultConfigs() {
  const sites = await db.select().from(bessSites);
  for (const site of sites) {
    const existing = await db.select().from(bessConfig).where(eq(bessConfig.siteId, site.id));
    if (existing.length === 0) {
      await db.insert(bessConfig).values({ siteId: site.id });
      console.log(`[Seed] Config default criada para site ${site.slug}`);
    }
  }
}
```

Chamar `seedDefaultConfigs()` no boot do servidor (depois do `seedMultiSiteData`).

**Validação:**
```bash
sudo mysql bess_dashboard -e "SELECT siteId, socMinDesliga, controlMode FROM bess_config;"
# Esperado: 2 linhas com defaults
```

---

## Fase 2 — Backend: módulos novos (4-6 h)

### 2.1 — `server/control-engine.ts` (lógica de decisão)

Funções principais:

```typescript
// Estado completo de um site, derivado de db state + config
async function getSiteRuntimeState(slug: string): Promise<SiteRuntimeState>

// Decide se sistema deve agir (ligar/desligar/nada)
function decideAction(state: SiteRuntimeState, now: Date): Decision

// Tipo Decision:
type Decision =
  | { kind: "NONE", reason: string }
  | { kind: "TURN_ON", reason: string }
  | { kind: "TURN_OFF", reason: string }

// Aplica decisão (envia comando MQTT, registra em bess_actions, atualiza bess_state)
async function applyDecision(slug: string, decision: Decision, source: ActionSource): Promise<void>

// Loop principal — chamado a cada novo dado de SOC
async function evaluateAndAct(slug: string): Promise<void>
```

**Regras de decisão (espelha §3.2 do escopo):**

```typescript
function decideAction(state, now) {
  // BLACKOUT — sempre primeiro
  if (state.soc <= state.config.socBlackout) {
    if (state.pumpState === "ON") {
      return { kind: "TURN_OFF", reason: "BLACKOUT: SOC <= socBlackout" };
    }
    return { kind: "NONE", reason: "Já desligado, em blackout" };
  }

  // Cooldown — não age se ainda em cooldown
  if (state.cooldownUntil && now < state.cooldownUntil) {
    return { kind: "NONE", reason: `cooldown até ${state.cooldownUntil.toISOString()}` };
  }

  // Manual — não tenta nada (exceto blackout, já tratado)
  if (state.config.controlMode === "MANUAL") {
    return { kind: "NONE", reason: "Modo manual" };
  }

  // AUTO — desliga se abaixo do mínimo
  if (state.pumpState === "ON" && state.soc <= state.config.socMinDesliga) {
    return { kind: "TURN_OFF", reason: `Auto: SOC ${state.soc}% <= mín ${state.config.socMinDesliga}%` };
  }

  // AUTO — religa se acima do religa E dentro do horário
  if (state.pumpState === "OFF" && state.soc >= state.config.socMinReliga) {
    const hourStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    if (hourStr >= state.config.horarioLiberacao && hourStr < state.config.horarioCorte) {
      return { kind: "TURN_ON", reason: `Auto: SOC ${state.soc}% >= religa ${state.config.socMinReliga}%, dentro do horário` };
    }
  }

  return { kind: "NONE", reason: "Nenhuma condição satisfeita" };
}
```

### 2.2 — `server/soc-estimator.ts` (Coulomb counting simples)

```typescript
// Calcula taxa de descarga/carga em pp/min com base nas últimas 6 leituras válidas
async function calculateDischargeRate(siteId: number, currentPumpState: "ON" | "OFF"): Promise<number | null>

// Estima SOC baseado em última leitura real + tempo decorrido + taxa
async function estimateCurrentSoc(siteId: number): Promise<{ soc: number, source: "REAL" | "ESTIMATED" } | null>

// Política de fallback: se não tem 6 leituras válidas, retorna null e sistema age conservador
```

### 2.3 — `server/poll-scheduler.ts` (polling adaptativo)

```typescript
// Decide se está em zona crítica
function isInCriticalZone(soc: number, socMinDesliga: number, margemZonaCritica: number): boolean

// Loop principal
async function startAdaptivePolling() {
  for each site:
    runtime = getSiteRuntimeState(site.slug)
    intervalo = isInCriticalZone(...) ? config.intervaloCritico : config.intervaloPadrao
    setTimeout(() => fetchAndEvaluate(site), intervalo * 60 * 1000)
}

// fetchAndEvaluate: chama getBatteryRealKpi (apenas SOC, sem getFullTelemetry)
// → atualiza bess_state com soc real
// → chama control-engine.evaluateAndAct(slug)
// → reagenda próximo poll baseado em zona crítica atual
```

### 2.4 — Modificar `server/_core/index.ts`

Substituir o auto-fetch antigo (que chama `getFullTelemetry`) pelo novo `startAdaptivePolling`. Mantém tudo mais.

### 2.5 — Modificar `server/routers.ts`

Substituir endpoints `bess.*` pelos novos da §8 do escopo. Apaga os endpoints v1 que não vão mais ser usados pelo frontend novo (ex: `bess.getFullTelemetry`).

**Validações de fase 2:**

```bash
# Build deve passar
cd /opt/bess-dashboard && pnpm build 2>&1 | tail -5

# Restart e ver logs
sudo systemctl restart bess-dashboard
sleep 5
sudo journalctl -u bess-dashboard -n 30 --no-pager
# Esperado: ver "[ControlEngine]", "[PollScheduler]", "[SocEstimator]" nos logs

# Testar endpoint novo
curl -s 'http://127.0.0.1:3010/api/trpc/bess.getSiteStatus?input=%7B%22json%22%3A%7B%22slug%22%3A%22barragem%22%7D%7D' | jq
# Esperado: JSON com site, config, state, derived, nextAction
```

---

## Fase 3 — Frontend: Home v2 (4-6 h)

### 3.1 — Limpar páginas antigas

Renomear `client/src/pages/Home.tsx` → `Home.v1.tsx.bak` e `client/src/pages/SiteDetails.tsx` → `SiteDetails.v1.tsx.bak`.

Criar `client/src/pages/Home.tsx` novo.

### 3.2 — Componentes

```
client/src/components/
  PlantCard.tsx          (1 card por planta, contém os elementos abaixo)
  SocBadge.tsx           (% grande + barra colorida)
  PumpControl.tsx        (estado atual + botão liga/desliga)
  ConfigModal.tsx        (modal de ⚙)
  HistoryModal.tsx       (modal de 📋)
  AlertBanner.tsx        (top, lista de alertas)
  ModeToggle.tsx         (header AUTO/MANUAL)
  ConfirmActionModal.tsx (modal de confirmação de ação manual)
  FreshnessIndicator.tsx (texto "atualizado há Xmin" com cor)
  TimeRemainingBadge.tsx (estimativa noturna)
```

### 3.3 — Hook `useSiteStatus(slug)` que faz polling de 30s no `bess.getSiteStatus`

### 3.4 — Hook `useGlobalAlerts()` que faz polling de 60s no `bess.getAlerts`

### 3.5 — Estilos com Tailwind, mobile-first

- Layout: `flex flex-col gap-4` mobile, `md:grid md:grid-cols-2` desktop
- SOC %: `text-6xl font-bold` mobile, `text-7xl` desktop
- Botões grandes pra touch: `min-h-[60px] text-lg`
- Cores conforme §5.1 do escopo

### 3.6 — Acessibilidade básica

- `aria-label` em botões icônicos (⚙, 📋)
- Contraste WCAG AA (text-foreground em bg-background)
- Focus visible em todos os interativos

**Validações de fase 3:**

```bash
pnpm build 2>&1 | tail -5
sudo systemctl restart bess-dashboard
# Abrir https://bess.gamasolar.com.br no navegador (anônimo)
# Validar:
# - Login funciona
# - Home aparece com 2 cards (Barragem com SOC, Piscinão "sem hardware")
# - Toggle de modo funciona
# - Botão liga/desliga bomba envia comando (validar via journalctl que MQTT publish saiu)
# - Modal de config abre, valida campos, salva
# - Modal de histórico mostra ações
# - Funciona em DevTools mobile (375x667)
```

---

## Fase 4 — Validação fim-a-fim (2-3 h)

### 4.1 — Cenários a testar manualmente

| # | Cenário | Como reproduzir | Esperado |
|---|---|---|---|
| 1 | Login novo | Abre janela anônima, loga | Vai pra Home com 2 cards |
| 2 | Modo AUTO ativa | SOC > religa, hora dentro | Bomba liga sozinha em < 15min |
| 3 | Modo AUTO desliga | SOC <= mín | Bomba desliga em < 15min |
| 4 | Cooldown | Forçar 2 ações em < 5min | 2ª ação ignorada com log "cooldown" |
| 5 | Polling rápido | SOC entrar em zona crítica | Logs mostram intervalo 2min |
| 6 | Manual + abaixo do mín | Trocar pra MANUAL, ligar c/ SOC < mín | Modal de confirmação aparece |
| 7 | Manual + à noite | Trocar pra MANUAL, ligar após 17:30 | Modal de confirmação aparece |
| 8 | Blackout absoluto | Forçar SOC = 14% via mock | Bomba desliga mesmo em manual |
| 9 | API offline | Parar FusionSolar mock | Após 30min, UI mostra "estimativa Coulomb" |
| 10 | Mobile | Abrir em Android Chrome | Tela usável, botões clicáveis |

### 4.2 — Testes unitários do `decideAction`

Criar `server/control-engine.test.ts` com pelo menos:

- Blackout sempre desliga
- AUTO desliga abaixo do mínimo
- AUTO religa acima do religa dentro do horário
- AUTO não religa fora do horário
- MANUAL ignora limites (exceto blackout)
- Cooldown bloqueia ação
- Histerese (religa precisa SOC > desliga + 3pp)

```bash
cd /opt/bess-dashboard
pnpm test 2>&1 | tail -20
```

---

## Fase 5 — Deploy e merge (1 h)

### 5.1 — Commit incremental (não tudo de uma vez)

```bash
cd /opt/bess-dashboard
git add drizzle/schema.ts drizzle/0010_*.sql
git commit -m "feat(schema): bess_config + bess_actions + bess_state extensions"

git add server/control-engine.ts server/soc-estimator.ts server/poll-scheduler.ts
git commit -m "feat(backend): control engine + SOC estimator + adaptive polling"

git add server/routers.ts server/_core/index.ts
git commit -m "feat(api): novos endpoints tRPC + integração control engine"

git add client/src/
git commit -m "feat(ui): Home v2 mobile-first + modais config/histórico"
```

### 5.2 — Merge na main e deploy

```bash
git checkout main
git merge mvp-v2 --no-ff -m "Merge MVP v2: refactor de UI + lógica de controle"
pnpm build
sudo systemctl restart bess-dashboard
sleep 5
curl -s https://bess.gamasolar.com.br/api/auth/status
```

### 5.3 — Atualizar `CLAUDE.md` com decisões/mudanças do MVP

Adicionar nova seção em `CLAUDE.md`:

```markdown
## 14. MVP v2 (2026-04-25 → ...)

Refactor completo de UI + lógica de controle. Ver:
- `MVP-SCOPE.md` — escopo fechado
- `MVP-PLAN.md` — plano técnico
- `MVP-PROMPT.md` — prompt usado pra implementar

Mudanças principais:
- Substituiu `getFullTelemetry` por `getBatteryRealKpi` (só SOC, mitiga rate limit)
- Adicionou Coulomb counting simples
- Adicionou `bess_config` (parâmetros editáveis)
- Adicionou `bess_actions` (auditoria)
- Refatorou tela inteira pra mobile-first
- Lógica AUTO/MANUAL com histerese e cooldown
```

---

## Estimativa total

| Fase | Tempo |
|---|---|
| 0 — Branch + backup | 15 min |
| 1 — Schema | 30 min |
| 2 — Backend novo | 4-6 h |
| 3 — Frontend novo | 4-6 h |
| 4 — Validação | 2-3 h |
| 5 — Deploy | 1 h |
| **Total** | **12-17 h focadas** (2-3 dias) |

---

## Checklist final (use antes de marcar MVP completo)

```
[ ] Backup MySQL criado em /tmp/
[ ] Backup .env criado
[ ] Branch mvp-v2 ativa
[ ] Schema novo aplicado (bess_config, bess_actions, ALTERs)
[ ] Seed de configs default rodando
[ ] control-engine.ts implementado e testado
[ ] soc-estimator.ts implementado
[ ] poll-scheduler.ts implementado e ativo
[ ] tRPC novos endpoints respondendo
[ ] Frontend Home v2 carregando
[ ] Login funciona em janela anônima
[ ] 2 cards aparecem (Barragem + Piscinão)
[ ] Toggle de bomba funciona com confirmação quando aplicável
[ ] Toggle de modo AUTO/MANUAL funciona
[ ] Modal de configurações funciona com validação
[ ] Modal de histórico mostra últimas ações
[ ] Banner de alerta aparece em zona crítica
[ ] Mobile Chrome: usável sem zoom
[ ] Desktop: 2 cards lado a lado em telas > 768px
[ ] Testes unitários do control-engine passam
[ ] Cenários manuais 1-10 testados e OK
[ ] Merge na main feito
[ ] CLAUDE.md atualizado
[ ] Sistema rodando estável 24h sem reinício de service
```
