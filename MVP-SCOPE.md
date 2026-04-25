# MVP-SCOPE.md — Refactor BESS Dashboard v2

> **Versão:** 2.0 (refactor completo de UI + lógica de controle)
> **Status:** Especificação fechada · pronta pra implementação
> **Decisão:** Refactor agressivo (opção A do escopo). Descartar tudo do v1 que não estiver listado abaixo.
> **Operador:** Fernando (gamasolar) · 2026-04-25

---

## 1. Propósito do sistema

Dashboard de **automação supervisionada** pra 2 plantas BESS (Battery Energy Storage System) que controlam bombas d'água de irrigação. O sistema:

1. **Monitora** SOC das baterias via FusionSolar API
2. **Controla** automaticamente liga/desliga das bombas via MQTT (Sonoff Tasmota), respeitando faixas de SOC e horários
3. **Permite intervenção manual** do operador, com avisos quando contraria a lógica automática
4. **Protege contra blackout** com limite absoluto de SOC (override manual e automático)
5. **Adapta a frequência de chamadas** à FusionSolar baseado em proximidade de limites
6. **Estima SOC** quando a API FusionSolar falha temporariamente (Coulomb counting simples)

A UI é secundária; o cérebro é a lógica de controle. Tela enxuta serve operador (não é dashboard de visualização).

---

## 2. Caso de uso principal

> Fernando deixa o sistema rodando em **AUTO** 99% do tempo. Eventualmente abre o dashboard pra:
> 1. Ver status atual rapidamente (SOC, bomba, próxima ação prevista)
> 2. Ajustar parâmetros operacionais (limites de SOC, horários)
> 3. Forçar uma ação manual em situações específicas (ex: usar bateria à noite)
> 4. Verificar histórico de ações automáticas (auditoria)

---

## 3. Regras de controle automático

### 3.1 Parâmetros configuráveis (por planta)

| Parâmetro | Default | Descrição |
|---|---|---|
| `socMinDesliga` | 25% | Bomba desliga em modo AUTO se SOC ≤ esse valor |
| `socMinReliga` | 30% | Bomba religa em modo AUTO se SOC ≥ esse valor |
| `socBlackout` | 15% | Limite absoluto. Força DESLIGA em qualquer modo |
| `horarioLiberacao` | 06:00 | A partir desse horário, religamento auto está liberado |
| `horarioCorte` | 17:30 | Após esse horário, AUTO não tenta mais religar até o `horarioLiberacao` do dia seguinte |
| `margemZonaCritica` | 5pp | Define zona crítica = `socMinDesliga` ± 5pp |
| `intervaloPadrao` | 15min | Frequência de chamada à FusionSolar fora da zona crítica |
| `intervaloCritico` | 2min | Frequência de chamada à FusionSolar dentro da zona crítica |
| `cooldownAcao` | 5min | Tempo mínimo entre 2 ações automáticas consecutivas |
| `maxSemTelemetria` | 30min | Tempo sem dado fresco da FusionSolar antes de cair pra Coulomb estimado |

**Validações ao salvar:**
- `socMinReliga > socMinDesliga + 3pp` (histerese mínima, evita flapping)
- `socMinDesliga > socBlackout + 5pp` (margem mínima de segurança)
- `horarioCorte > horarioLiberacao`

### 3.2 Lógica de decisão (rodada a cada novo SOC ou a cada ciclo)

**Sempre, em qualquer modo:**

```
SE soc <= socBlackout:
    DESLIGA bomba
    LOG "Blackout protection: SOC=X% <= blackout=Y%"
    FIM
```

**Modo AUTO:**

```
SE bomba == ON E soc <= socMinDesliga:
    DESLIGA
    LOG "Auto desligou: SOC=X% <= mín=Y%"
    cooldownAteAté = agora + cooldownAcao
    
SE bomba == OFF E soc >= socMinReliga E hora_atual entre [horarioLiberacao, horarioCorte]:
    LIGA
    LOG "Auto ligou: SOC=X% >= reLiga=Y%, dentro do horário"
    cooldownAteAté = agora + cooldownAcao

SE bomba == OFF E hora_atual >= horarioCorte:
    NÃO faz nada (aguarda amanhã)
```

**Modo MANUAL:**

```
Sistema obedece o último comando do operador.
Reavalia continuamente apenas a regra de blackout.
Polling FusionSolar continua adaptativo (igual AUTO) mesmo em manual.
```

### 3.3 Polling adaptativo da FusionSolar

```
zonaCritica = soc <= (socMinDesliga + margemZonaCritica)
intervalo = zonaCritica ? intervaloCritico : intervaloPadrao
```

Aplica a chamada `getBatteryRealKpi(deviceIds)` (apenas SOC, sem `getFullTelemetry`).

### 3.4 Fallback Coulomb counting (simples)

Quando `now - lastTelemetryAt > maxSemTelemetria`:

1. Calcula `taxa_descarga` baseado nas **últimas 6 leituras reais** com bomba no mesmo estado (ON ou OFF):
   - `taxa = (soc_mais_velho - soc_mais_recente) / minutos_decorridos` em pp/min
2. Estima SOC atual: `soc_estimado = ultimo_soc_real - taxa × minutos_desde_ultima_leitura`
3. Sistema continua tomando decisões com `soc_estimado`, **marcando claramente na UI** que é estimativa
4. Quando API volta:
   - Se `|soc_real - soc_estimado| > 5pp` → log `IMPLAUSIBLE_SOC_DRIFT` (apenas warn, não bloqueia operação)
   - Atualiza histórico de leituras

**Comportamento se não há histórico suficiente** (menos de 6 leituras válidas):
- Não tem como estimar
- Ação: **DESLIGA conservador** + alerta visual "Sem dado real de SOC e sem histórico suficiente"

---

## 4. Modo manual: confirmações obrigatórias

Quando operador tenta forçar uma ação que viola lógica AUTO, sistema exibe **modal de confirmação** com texto claro:

### 4.1 Ligar bomba com SOC abaixo do limite mínimo (mas acima do blackout)

> **⚠️ Atenção: bateria abaixo do limite operacional**
>
> SOC atual: **22%** (mínimo configurado: 25%)
>
> O sistema desligará automaticamente quando atingir o blackout (15%).
> Estima-se que isso aconteça em **~35 minutos** (taxa atual: -0.2pp/min).
>
> Confirma ligar a bomba?
>
> `[Cancelar]` `[Ligar mesmo assim]`

### 4.2 Ligar fora do horário de liberação (à noite/madrugada)

> **⚠️ Atenção: fora do horário de operação automática**
>
> Horário atual: **18:42** (corte automático: 17:30)
>
> Em modo AUTO, o sistema só religaria amanhã às 06:00.
>
> Confirma ligar a bomba agora? O sistema continuará monitorando o SOC e desligará se atingir o mínimo.
>
> `[Cancelar]` `[Ligar manual]`

### 4.3 Desligar bomba que está em ciclo automático

> **Confirma desligar a bomba?**
>
> A bomba está ligada por decisão automática (SOC=42% >= religa em 30%).
> Após desligar, o sistema só religará automaticamente quando SOC voltar a 30%.
>
> `[Cancelar]` `[Desligar]`

---

## 5. UI — Tela única por planta

### 5.1 Tela principal (Home)

Layout vertical, mobile-first, expansível em desktop. **Uma "card" por planta**, empilhadas verticalmente.

```
┌──────────────────────────────────────────┐
│  BESS Controller     🟢 AUTO   [trocar]  │  ← header global
├──────────────────────────────────────────┤
│                                          │
│  BARRAGEM                  ⚙   📋        │  ← nome + ações da planta
│                                          │
│  ┌────────────────────────────────────┐  │
│  │                                    │  │
│  │           42%                      │  │  ← SOC grande
│  │     ████████░░░░░░░░               │  │  ← barra
│  │                                    │  │
│  │     ≈ 84 kWh restantes             │  │  ← cálculo: 200 × 0.42
│  │     atualizado há 1 min            │  │  ← freshness
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Bomba                                   │
│  ┌────────────────────────────────────┐  │
│  │   🟢 LIGADA                        │  │
│  │   Ligada há: 2h 15min              │  │  ← C2
│  │   Total hoje: 4h 30min             │  │
│  │   Consumo: ~2.8 kW                 │  │  ← se Sonoff reportar (POWR316D)
│  │                                    │  │
│  │            [ DESLIGAR ]            │  │  ← botão grande
│  └────────────────────────────────────┘  │
│                                          │
│  Próxima ação automática                 │
│  ┌────────────────────────────────────┐  │
│  │  Desliga se SOC ≤ 25%              │  │
│  │  Margem atual: 17pp                │  │
│  │  ⏱ Estimativa noturna: ~85 min     │  │  ← B1 só à noite
│  └────────────────────────────────────┘  │
│                                          │
├──────────────────────────────────────────┤
│  PISCINÃO                  ⚙   📋        │
│  (mesma estrutura)                       │
│  Bomba: 🔘 Sem hardware MQTT             │  ← Piscinão sem Sonoff
└──────────────────────────────────────────┘
```

**Estados visuais da bomba:**

| Estado | Cor | Ícone | Texto |
|---|---|---|---|
| Ligada | Verde | 🟢 | LIGADA |
| Desligada | Cinza | ⚪ | DESLIGADA |
| Mudando estado (ação enviada, aguardando confirmação MQTT) | Amarelo, pulsando | 🟡 | LIGANDO... / DESLIGANDO... |
| Sem hardware (Piscinão hoje) | Cinza claro | 🔘 | SEM HARDWARE |
| Sonoff offline | Vermelho | ❌ | SONOFF OFFLINE |

**Estados visuais do SOC:**

| Faixa | Cor barra | Quando |
|---|---|---|
| Verde | acima de `socMinReliga + 10pp` | normal |
| Amarelo | entre `socMinReliga + 10pp` e zona crítica | atenção |
| Laranja | em zona crítica (≤ `socMinDesliga + margemZonaCritica`) | crítico |
| Vermelho | abaixo de `socMinDesliga` | abaixo do mínimo (modo manual) |
| Vermelho pulsando | abaixo de `socBlackout + 3pp` | pré-blackout |

**Indicador de freshness:**

| Idade do dado | Texto | Cor |
|---|---|---|
| ≤ 3 min | "atualizado há X min" | normal |
| 3-10 min | "atualizado há X min" | amarelo |
| 10-30 min | "⚠ dado antigo (X min)" | laranja |
| > 30 min | "⚠ usando estimativa Coulomb" | vermelho + ícone alerta |

### 5.2 Banner de alerta (topo)

Banner colorido aparece no topo quando:

- 🟡 **SOC em zona crítica:** "Bateria em 28% (zona crítica). Bomba pode desligar em breve."
- 🔴 **Bomba desligada por blackout:** "BLACKOUT: bomba Barragem desligada às 16:45 (SOC=14%)."
- 🔴 **API FusionSolar offline:** "Sem comunicação com FusionSolar há 35min. Operando com SOC estimado."
- 🟠 **Sonoff offline:** "Sonoff Barragem offline há 8min. Estado da bomba pode estar desatualizado."
- 🟢 **Ação automática recente:** "Bomba Barragem ligada automaticamente às 06:12 (SOC=68%)."

Banners desaparecem automaticamente após resolução, exceto blackout que fica até operador clicar "OK ciente".

### 5.3 Modal de configurações (clica no ⚙ da planta)

Form simples, agrupado por seção:

```
CONFIGURAÇÕES — BARRAGEM
─────────────────────────────────

LIMITES DE SOC
  SOC mínimo (desliga):     [ 25 ] %
  SOC religa:                [ 30 ] %
  SOC blackout:              [ 15 ] %
  Margem zona crítica:       [  5 ] pp

HORÁRIOS
  Liberação manhã:           [ 06:00 ]
  Corte tarde:               [ 17:30 ]

POLLING FUSIONSOLAR
  Intervalo padrão:          [ 15 ] min
  Intervalo zona crítica:    [  2 ] min
  Tempo máximo sem dado:     [ 30 ] min

PROTEÇÃO
  Cooldown entre ações:      [  5 ] min

[Cancelar]                  [Salvar]
```

Validações em tempo real (mostrar mensagem de erro se viola regras de §3.1).

### 5.4 Modal de histórico (clica no 📋 da planta)

Lista das últimas 50 ações, em ordem reversa (mais recente em cima):

```
HISTÓRICO — BARRAGEM
────────────────────────────────────────
🟢 25/04 14:32  AUTO   Ligou bomba     (SOC=42%, dentro do horário)
🔴 24/04 16:45  AUTO   Desligou bomba  (SOC=24%, abaixo do mínimo)
👤 24/04 18:30  MANUAL Ligou bomba     (Fernando, c/ aviso de blackout)
🚨 23/04 16:50  AUTO   BLACKOUT        (SOC=14%, força desligamento)
⚠ 23/04 12:15  ALERTA Sonoff offline  (15 min sem heartbeat)
🟢 23/04 06:12  AUTO   Ligou bomba     (SOC=68%, liberação manhã)
...
```

Cada linha clicável pra ver detalhes (modal com snapshot do estado completo no momento da ação).

### 5.5 Toggle de modo (header global)

```
🟢 AUTO    ⚪ MANUAL
```

Trocar pra MANUAL pede confirmação:
> "Em modo MANUAL, o sistema não tomará decisões automáticas. Apenas a proteção de blackout (SOC ≤ 15%) continua ativa. Confirma?"

Trocar pra AUTO é direto.

---

## 6. Cálculos de derivados (mostrados na UI)

| Campo | Fórmula |
|---|---|
| `kWh restantes` | `bessCapacityKwh × bessCount × (soc / 100)` |
| `kWh utilizáveis até desligar (AUTO)` | `bessCapacityKwh × bessCount × ((soc - socMinDesliga) / 100)` |
| `kWh utilizáveis até blackout (MANUAL)` | `bessCapacityKwh × bessCount × ((soc - socBlackout) / 100)` |
| `tempo até desligar (noite, com bomba ON)` | `(soc - socMinDesliga) / taxa_descarga_pp_por_min` em min |
| `tempo até blackout (noite, com bomba ON)` | `(soc - socBlackout) / taxa_descarga_pp_por_min` em min |
| `tempo bomba ligada hoje` | acumulado desde 00:00 do ON_time atual + ON_times anteriores |

Tempo restante **só mostra** se:
- Hora local está entre 18:00 e 06:00 (período noturno, sem aporte solar previsível), OU
- Modo MANUAL com bomba ON e SOC abaixo de `socMinReliga`

Senão, mostra "—" ou esconde o campo. Razão: durante o dia, geração solar é variável e estimativa fica sem sentido.

---

## 7. Schema de banco — adições/alterações

### 7.1 Nova tabela `bess_config` (substitui campos hardcoded)

```sql
CREATE TABLE bess_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  siteId INT NOT NULL,
  socMinDesliga INT NOT NULL DEFAULT 25,
  socMinReliga INT NOT NULL DEFAULT 30,
  socBlackout INT NOT NULL DEFAULT 15,
  horarioLiberacao VARCHAR(5) NOT NULL DEFAULT '06:00',
  horarioCorte VARCHAR(5) NOT NULL DEFAULT '17:30',
  margemZonaCritica INT NOT NULL DEFAULT 5,
  intervaloPadrao INT NOT NULL DEFAULT 15,
  intervaloCritico INT NOT NULL DEFAULT 2,
  cooldownAcao INT NOT NULL DEFAULT 5,
  maxSemTelemetria INT NOT NULL DEFAULT 30,
  controlMode ENUM('AUTO','MANUAL') NOT NULL DEFAULT 'AUTO',
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (siteId) REFERENCES bess_sites(id),
  UNIQUE KEY (siteId)
);
```

### 7.2 Tabela `bess_actions` (histórico, substitui `bess_events`)

```sql
CREATE TABLE bess_actions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  siteId INT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source ENUM('AUTO','MANUAL','BLACKOUT','SYSTEM') NOT NULL,
  action ENUM('TURN_ON','TURN_OFF','MODE_CHANGE','CONFIG_CHANGE','ALERT') NOT NULL,
  socAtTime INT,
  socSource ENUM('REAL','ESTIMATED') DEFAULT 'REAL',
  pumpStateBefore ENUM('ON','OFF','UNKNOWN'),
  pumpStateAfter ENUM('ON','OFF','UNKNOWN'),
  reason VARCHAR(255),
  userId INT NULL,
  metadata JSON,
  FOREIGN KEY (siteId) REFERENCES bess_sites(id),
  INDEX (siteId, timestamp DESC)
);
```

### 7.3 Adições em `bess_state` (estado atual em cache)

```sql
ALTER TABLE bess_state ADD COLUMN socEstimated FLOAT NULL;
ALTER TABLE bess_state ADD COLUMN lastEstimateAt TIMESTAMP NULL;
ALTER TABLE bess_state ADD COLUMN dischargeRatePpPerMin FLOAT NULL;
ALTER TABLE bess_state ADD COLUMN cooldownUntil TIMESTAMP NULL;
ALTER TABLE bess_state ADD COLUMN pumpOnSinceTimestamp TIMESTAMP NULL;
ALTER TABLE bess_state ADD COLUMN pumpOnSecondsToday INT DEFAULT 0;
```

---

## 8. APIs (tRPC)

Manter o que já existe, adicionar/refatorar:

```typescript
// Substitui muitos endpoints de v1
bess: {
  // Lê estado completo de uma planta
  getSiteStatus: query({ slug }) => {
    site: { slug, name, bessCapacityKwh, bessCount },
    config: { socMinDesliga, socMinReliga, ... },
    state: {
      soc: number,
      socSource: 'REAL' | 'ESTIMATED',
      lastTelemetryAt: Date,
      pumpState: 'ON' | 'OFF' | 'UNKNOWN',
      pumpOnSince: Date | null,
      pumpOnSecondsToday: number,
      dischargeRatePpPerMin: number | null,
      controlMode: 'AUTO' | 'MANUAL',
      cooldownUntil: Date | null,
    },
    derived: {
      kwhRemaining: number,
      kwhUntilOffline: number,  // até socMinDesliga
      kwhUntilBlackout: number,
      minutesUntilOffline: number | null,  // só se noturno
      minutesUntilBlackout: number | null,
      zoneCritical: boolean,
      zoneStatus: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'BELOW_MIN' | 'PRE_BLACKOUT',
    },
    nextAction: {
      type: 'WILL_TURN_OFF' | 'WILL_TURN_ON' | 'WAITING_MORNING' | 'WAITING_RECHARGE' | 'NONE',
      atSoc: number | null,
      message: string,
    }
  }

  // Trocar modo
  setControlMode: mutation({ slug, mode: 'AUTO' | 'MANUAL' }) => { ok: true }

  // Atualizar config
  updateConfig: mutation({ slug, config: Partial<BessConfig> }) => { ok: true, validationErrors?: string[] }

  // Comando manual de bomba
  setPump: mutation({ slug, state: 'ON' | 'OFF', confirmedOverrides?: ['BELOW_MIN_SOC', 'OUTSIDE_HOURS'] }) => 
    { ok: true, requiredConfirmations?: ['BELOW_MIN_SOC' | 'OUTSIDE_HOURS' | ...] }
    // Se requer confirmação e não veio, retorna a lista. Frontend mostra modal e re-chama.

  // Histórico de ações
  getActions: query({ slug, limit: 50 }) => Action[]

  // Banner de alerta (poll do frontend)
  getAlerts: query() => Alert[]  // global, não por site
}
```

---

## 9. Critérios de aceitação do MVP

✅ **Pronto = todos abaixo verdadeiros:**

1. Operador acessa `https://bess.gamasolar.com.br/login`, faz login, vê tela única com 2 cards (Barragem + Piscinão)
2. Card mostra SOC %, kWh restantes, freshness, estado bomba, tempo bomba ligada hoje
3. Toggle de bomba funciona (com confirmação se aplicável)
4. Toggle de modo AUTO/MANUAL funciona, com confirmação ao ir pra MANUAL
5. Botão ⚙ abre modal de configurações editáveis com validação
6. Botão 📋 abre histórico das últimas 50 ações
7. Banner de alerta aparece quando SOC entra zona crítica, em blackout, e quando API offline
8. Sistema decide AUTO corretamente conforme regras §3.2
9. Cooldown de ações funciona (verificável no log)
10. Polling adaptativo funciona (verificável no log: intervalo muda quando entra zona crítica)
11. Coulomb counting estima SOC quando API falha por > 30min, e marca claramente na UI
12. Ações manuais de noite ou abaixo do mínimo exigem confirmação clara
13. Mudanças de config se persistem e se aplicam imediatamente
14. Mobile (Android Chrome): tela legível e usável sem zoom
15. Desktop: 2 cards lado a lado quando tela > 768px

---

## 10. Fora do MVP (Fase 1.5 e Fase 2)

**Fase 1.5 (1-2 dias após MVP, opcional):**
- WhatsApp via Evolution API (notificações em grupo)

**Fase 2 (longo prazo):**
- Coulomb counting com aprendizado por horário do dia
- Modbus TCP gateway no SmartLogger 3000
- Sonoff Piscinão + POWR316D (medição de potência da bomba)
- Histórico longo + gráficos de SOC ao longo de dias/semanas
- Relatórios PDF
- Múltiplos usuários + página admin
- Página de "trocar minha senha" no frontend
- Telegram bot
- Email

---

## 11. Riscos conhecidos e mitigações

| Risco | Mitigação |
|---|---|
| Refactor quebra auth atual | NÃO mexer em `server/auth.ts` nem em `server/_core/` exceto adicionar `app.set('trust proxy', 1)` que já está | 
| Refactor quebra MQTT que já funciona | NÃO mexer em `server/mqtt-tasmota.ts`. Refatorar apenas a camada acima | 
| Refactor quebra FusionSolar device-IDs longos | Manter `server/fusionsolar.ts` com `getBatteryRealKpi` e `discoverDeviceIds` (usa IDs longos via `dev.id`) | 
| Migration nova quebra dados existentes | Schema novo é additive (novas tabelas + ALTER ADD COLUMN). Nenhum DROP. | 
| Sistema toma decisão errada e desliga bomba indevidamente | Validar lógica em testes unitários antes de subir | 
| Nova UI fica feia em mobile | Mobile-first, testar no Chrome Android antes de marcar pronto | 

---

## 12. Estimativa de esforço

| Etapa | Tempo |
|---|---|
| Setup branch, novo schema, migrations | 30 min |
| Backend: nova lógica de controle (`server/control-engine.ts`) | 3-4 h |
| Backend: Coulomb estimator simples (`server/soc-estimator.ts`) | 1-2 h |
| Backend: poll scheduler adaptativo (`server/poll-scheduler.ts`) | 1-2 h |
| Backend: refactor de tRPC (`bess.getSiteStatus`, `setPump`, etc.) | 2-3 h |
| Frontend: novo Home com 2 cards | 3-4 h |
| Frontend: modal de configurações | 1-2 h |
| Frontend: modal de histórico | 1 h |
| Frontend: banner de alertas | 1 h |
| Frontend: confirmações de ação manual | 1 h |
| Frontend: estilos mobile-first + responsive | 2 h |
| Testes manuais e ajustes | 2-3 h |
| Deploy e validação em produção | 1 h |
| **TOTAL** | **20-26 h** (3-4 dias de trabalho focado) |

---

*Especificação fechada em 2026-04-25 com Fernando. Próximos passos: ver `MVP-PLAN.md` (plano técnico) e `MVP-PROMPT.md` (prompt pronto pra Claude).*
