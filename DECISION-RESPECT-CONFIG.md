# DECISION-2026-04-30 — Respeitar a faixa configurada, sem invenções

> **Decisão tomada por:** Fernando (operador/dono do projeto)
> **Data:** 2026-05-01 ~02:00 BRT, após incidente da Barragem em 2026-04-30
> **Status:** APROVADA. Aguardando implementação na próxima sessão de trabalho.
> **Companion:** este arquivo + `MVP-SCOPE.md` original + `CLAUDE.md`

---

## A regra fundamental

**O sistema deve respeitar a faixa configurada pelo operador. Ponto final.**

Se o operador configura `socMinDesliga=20` e `socMinReliga=25`, o código:

- **Desliga em SOC=20%**, não em 33%
- **Religa em SOC=25%**, não em outro valor
- **Não inventa** "projeção", "ETA", "descarga estimada" ou "antecipação" pra mudar esses valores
- **Não pula consulta** de inversor pra "economizar" e operar cego

A faixa configurada **é** a regra. Não existe "regra inteligente em cima da faixa". A inteligência está em o operador escolher a faixa certa pra cada planta, e isso é decisão dele. O código serve.

---

## Por que essa decisão (incidente de 2026-04-30)

Entre 17:41 e 18:25, a bomba da Barragem oscilou (4 ações em 45min) e desligou em SOC=19%, ignorando os parâmetros configurados (20/25/15). Os logs mostram:

| Hora | Ação | SOC real | Razão registrada |
|---|---|---|---|
| 17:41 | TURN_OFF | **33%** | "Projeção: SOC 21% em 30min ≤ 21%" |
| 17:47 | TURN_ON | 32% | "AUTO religa: SOC 32% ≥ 25%" |
| 17:53 | TURN_OFF | **31%** | "Projeção: SOC 18.9% em 30min ≤ 21%" |
| 17:59 | TURN_ON | 30% | "AUTO religa: SOC 30% ≥ 25%" |
| 18:25 | TURN_OFF | 19% | "Projeção: SOC 18.2% em 2min ≤ 21%" |

**O sistema desligou 3 vezes sem nem chegar perto do `socMinDesliga=20%`.**

Causas técnicas identificadas (commits recentes que adicionaram complexidade pós-MVP):

- **`cf18fab` (overshoot crítico):** projeção de SOC futuro 30min à frente, dispara TURN_OFF antecipado.
- **`8196dfc` (ETA-based polling):** watchdog antecipa polls baseado em descarga estimada, causou storm de 4×407 entre 17:52–17:55.
- **`dc3a52e` (skip getInverterRealKpi):** quando SOC ≤ socMinDesliga + margemZonaCritica, sistema deliberadamente para de coletar dados de PV/load. Resultado: `pvPower` e `loadPower` permanentemente NULL desde 17:56:49 até depois do TURN_OFF de 18:25.

Combinação: sistema ficou **cego em PV/load por 30 minutos** durante a fase mais crítica da operação, e tomou a decisão final de TURN_OFF (18:25) sem visibilidade. As features foram adicionadas com boa intenção (proteger contra overshoot do BMS) mas o **resultado prático foi menos previsibilidade**, não mais segurança.

---

## Lógica nova (= MVP original, sem adições posteriores)

### Parâmetros — MANTIDOS COMO ESTÃO

A configuração da Barragem continua **20/25/15**. É a sua decisão de operador, e ela é deliberada — você quer **maximizar uso da bateria**, mantendo apenas a margem de 5pp do blackout absoluto.

| Parâmetro | Valor (Barragem) | Mantém |
|---|---|---|
| `socBlackout` | 15% | ✅ |
| `socMinDesliga` | 20% | ✅ |
| `socMinReliga` | 25% | ✅ |
| `cooldownAcao` | 5 min | ✅ |
| `intervaloPadrao` | 15 min | ✅ |
| `intervaloCritico` | 1 min | ✅ |
| `horarioLiberacao` | 06:00 | ✅ |
| `horarioCorte` | 19:00 | ✅ |
| `maxSemTelemetria` | 30 min | ✅ |

Se em algum momento você quiser mudar, **mexe na UI**. O código não tem o direito de inventar valores diferentes.

### Decisão (lógica única, simples)

Pseudocódigo definitivo:

```
A CADA POLL DE SOC:

  1. Se SOC ≤ socBlackout:
       DESLIGA  (sempre, qualquer modo)

  2. Se sem SOC disponível (nem real nem estimável):
       NÃO faz nada

  3. Se em cooldown (ação recente):
       NÃO faz nada

  4. Se modo MANUAL:
       NÃO faz nada (operador decide)

  5. Se modo AUTO:
       Se bomba ON e SOC ≤ socMinDesliga:
         DESLIGA
       Se bomba OFF e SOC ≥ socMinReliga e dentro da janela horária:
         LIGA
       Senão:
         NÃO faz nada
```

**Sem projeção. Sem ETA. Sem zona crítica adaptativa. Sem skip de inverter. Sem watchdog antecipando polls.**

### O que isso muda na prática

Mesmo dia, mesma bateria, mesmo consumo, sem complexidade adicionada:

```
17:00  SOC=49%  bomba ON     (irrigando, longe do mínimo)
17:33  SOC=37%  bomba ON
17:41  SOC=33%  bomba ON     ← antes desligou aqui sem motivo
18:11  SOC=26%  bomba ON
18:20  SOC=22%  bomba ON
~18:30 SOC=20%  → TURN_OFF   ← bate o limite que VOCÊ configurou
~18:30 sol já se pôs, SOC fica parado
~06:00 amanhã, SOC sobe pelo solar até 25%, religa
```

**Um único ciclo ON→OFF no dia.** Bateria usada até 20% (sua escolha). Sem flapping. Motor da bomba protegido por simplicidade da decisão. Você dorme em paz.

---

## Exceção controlada: estimativa por taxa (fallback)

A única lógica que **continua existindo** é a estimativa Coulomb counting **APENAS quando o sinal real falha**. E mesmo nesse caso, a faixa configurada é respeitada literalmente — não há margem extra.

### Quando entra em modo estimativa

```
SE (now - lastTelemetryAt) > maxSemTelemetria  (default 30 min)
  E lastTelemetryAt existe (tem alguma leitura real anterior)
  E há ≥ 3 leituras reais válidas com bomba no estado atual:

  → Calcular taxa e estimar SOC

SENÃO (sem histórico suficiente):
  → SOC_estimado = null
  → Sistema continua operando com último SOC conhecido
  → DESLIGA quando ultimo_SOC_real (que vai envelhecendo) atingir socMinDesliga
  → Rede de segurança absoluta: socBlackout=15%
```

### Como calcula a taxa

```
1. Pegar últimas 6 leituras reais com bomba no MESMO estado atual (ON ou OFF)
2. Taxa = (SOC_mais_velho - SOC_mais_recente) / minutos_entre_eles
   → unidade: pp/min
3. SOC_estimado = ultimo_SOC_real + (taxa × minutos_decorridos)
   (taxa é negativa quando descarregando, positiva quando carregando)
```

Exemplo concreto:

```
Histórico (todas com bomba ON):
  14:00  SOC=45%
  14:15  SOC=42%
  14:30  SOC=39%  ← último real
  
API cai. Sistema esperou 30min sem nova leitura.

15:00 (agora). Sistema calcula:
  Taxa = (45 - 39) / 30min = 0.2 pp/min de descarga
  SOC_estimado = 39 - (0.2 × 30) = 33%
  
Decisão: bomba ON + SOC_estimado=33% > socMinDesliga=20% → NÃO faz nada
```

### Sem histórico suficiente (< 3 leituras válidas)

Esse cenário é **raro mas crítico**. Acontece quando:
- Sistema acabou de subir após reboot
- Bomba mudou de estado e ainda não tem 3 leituras no novo estado
- Várias falhas seguidas de API limparam o histórico válido

Comportamento:
- **Não estima.** SOC = `null` (regra 2 do pseudocódigo principal).
- Bomba **mantém o estado atual** (sem ação automática).
- Sistema continua tentando puxar dado real da API a cada `intervaloPadrao`.
- Quando API voltar, sistema decide normalmente baseado no SOC real.

**A bomba NÃO desliga preventivamente nesse cenário.** Ela continua no estado em que estava. Razão: sem dados, qualquer decisão é chute. Melhor manter operação até que blackout (regra 1) eventualmente proteja a bateria, OU até que API volte.

> **Atenção operador:** se acontecer um período longo sem dado nem histórico (raro), monitore a UI. Sistema avisará via banner "Sem comunicação com FusionSolar há Xmin, sem histórico pra estimar". Você pode forçar manual se necessário.

### Como decide com SOC estimado

**Igualzinho ao real.** Mesmo limite, sem margem extra:

```
TURN_OFF se SOC_estimado <= socMinDesliga  (= 20%, não 21%, não 25%)
TURN_ON  se SOC_estimado >= socMinReliga  (= 25%, e só dentro da janela)
```

A estimativa não desliga antes do limite. A "inteligência" que estamos removendo era desligar antes do limite quando tinha dado real. Estimativa **substitui o dado real, não muda a regra**.

### Quando a API volta

```
1. Compara SOC_estimado com SOC_real recém-chegado
2. Se |drift| > 5pp:
     log WARN: "IMPLAUSIBLE_SOC_DRIFT: estimou X, real Y"
     (não bloqueia operação, só registra)
3. Atualiza histórico de leituras com o SOC real
4. Próxima estimativa usará taxa atualizada
```

### Registro

`bess_actions.socSource` deve ser `'REAL'` ou `'ESTIMATED'` em cada decisão, pra rastreabilidade.

---

## O que precisa ser removido

### 1. Projeção SOC futuro no `decideAction`

Arquivo: `server/control-engine.ts` (linhas ~99-157)

Remover o bloco `if (pumpState === "ON" && battPower != null && battPower < 0)` que calcula `projectedSoc = soc + (battPower × horizonMin / 60) / capacityKwh × 100` e dispara TURN_OFF antecipado.

A bomba só desliga quando SOC chega no `socMinDesliga` configurado, **não antes**.

### 2. Margem de overshoot de 1pp (`SAFETY_MARGIN_PP`)

Mesma origem da projeção, no mesmo arquivo. Remove o `+ SAFETY_MARGIN_PP` no threshold efetivo. Threshold efetivo é o `socMinDesliga` configurado, sem ajuste.

### 3. Skip de `getInverterRealKpi` em zona crítica

Arquivo: `server/poll-scheduler.ts` (linhas ~332-351)

Remover o `if (!shouldFetchInverter)` que pula consulta de inversor. Sempre consultar inverter (com pause de 5s antes pra respeitar rate limit). Se tomar 407 ocasional, registra warn e segue — **não vira regra permanente de skip**.

Resultado esperado: `pvPower` e `loadPower` raramente NULL.

### 4. ETA-based polling adaptativo

Arquivo: `server/poll-scheduler.ts`

Remover lógica de "intervalo correto" calculado com base em descarga + ETA até limiar. Polling fixo conforme `intervaloPadrao` ou `intervaloCritico` (sem watchdog antecipando).

A "zona crítica" continua existindo como conceito de polling — quando SOC ≤ `socMinDesliga + margemZonaCritica`, intervalo passa de 15min pra 1min. **Mas o intervalo crítico é apenas pra polling**, não muda decisão. E é fixo (1min), não calculado dinamicamente por ETA.

---

## Plano de execução (próxima sessão de trabalho)

### Passo 0 — Investigar pvPower NULL

Antes de qualquer mudança, verificar se `pvPower` e `loadPower` voltaram a ser coletados normalmente quando SOC subiu acima de 30% pela manhã. Se não voltaram, a investigação muda de prioridade — pode ter outro bug além do skip.

### Passo 1 — Listar arquivos que serão modificados + diff

Antes de **qualquer** mudança no código, o Claude da próxima sessão deve:

1. Listar todos os arquivos que vai modificar
2. Mostrar o diff de cada um (o que sai, o que entra)
3. **Aguardar autorização explícita do Fernando**

Não execute nada antes disso. Se houver dúvida, pergunte.

### Passo 2 — Remover features na ordem (menor risco primeiro)

1. **Skip de inverter (item 3)** — remover. Resolve `pvPower NULL`.
2. **Projeção SOC + margem 1pp (itens 1 e 2)** — remover. Resolve TURN_OFF antecipado.
3. **ETA-based polling (item 4)** — remover. Resolve storm de 407.

Cada passo: 1 commit atômico, build, deploy, **observação 24h** antes do próximo passo.

### Passo 3 — Validar fallback Coulomb

Confirmar que a lógica de estimativa (item §"Exceção controlada") está implementada e funciona. Se já existe e está correta, manter. Se existe mas tem bugs, corrigir. Se não existe, implementar conforme spec acima.

Teste manual: simular API offline (parar tunnel temporariamente ou mock) e verificar que sistema continua operando com `socSource='ESTIMATED'` e respeita os limites configurados.

### Passo 4 — Atualizar `CLAUDE.md`

Remover menções a:
- "projeção de SOC futuro"
- "ETA-based polling"
- "overshoot crítico"
- "skip de inverter em zona crítica"

Adicionar:
- Regra fundamental: respeitar a faixa configurada
- Fallback Coulomb existe, mas usa o mesmo limite (não desliga antes)
- Polling adaptativo continua existindo (15min normal, 1min crítico) mas é fixo, não dinâmico

### Passo 5 — Validar 1 semana

Critérios:

- ✅ Bomba desliga **somente** quando SOC ≤ 20% (Barragem)
- ✅ Bomba religa **somente** quando SOC ≥ 25% e dentro da janela 06:00-19:00
- ✅ `bess_actions.reason` nunca contém "Projeção"
- ✅ `pvPower` e `loadPower` raramente NULL
- ✅ Sem storm de HTTP 407
- ✅ Cooldown de 5min funcionando entre ações
- ✅ Quando API falha > 30min, sistema usa estimativa e respeita os mesmos limites
- ✅ Quando API falha sem histórico, sistema mantém último estado e respeita socBlackout

---

## Sobre flapping (se acontecer)

A faixa **20-25** é apertada (5pp de histerese). Em transições de crepúsculo (sol indo embora + bomba ainda ligada + SOC oscilando perto do limite), pode haver oscilação.

**Solução errada:** voltar com lógica preditiva, ou afrouxar threshold por código.

**Solução certa:** você ajusta na UI. Sobe `socMinReliga` pra 28%, 30%, ou o que quiser. Observa. Decide. Os parâmetros são SEUS. O código respeita.

---

## Notas pro Claude da próxima sessão

1. **A decisão do Fernando é deliberada.** Ele sabe que a faixa 20-25 é apertada. Ele sabe o trade-off. Ele quer **respeito à configuração**, não "inteligência" que ignora a configuração. Não tente argumentar pra preservar features que ignoram a faixa.

2. **A única lógica adicional permitida é o fallback Coulomb** (estimativa quando API falha), e mesmo essa **respeita os mesmos limites**, sem margem extra.

3. **Antes de qualquer mudança em código:** lista de arquivos + diff proposto + autorização explícita. Sem exceção.

4. **Vai por ordem (item 3 → 1 → 2 → 4).** Commit atômico a cada item. Sem big bang.

5. **Quando concluir:** atualiza `CLAUDE.md` removendo menções às features deletadas.

6. **Não introduz feature nova durante o refactor.** Só remoção e a manutenção do fallback Coulomb.

7. **Dúvida sobre o que fazer:** abre o `MVP-SCOPE.md` original (§3.2). A lógica está lá. Tudo que está fora dela foi adicionado depois e está sob suspeita.

---

*Documento final. Pronto pra anexar à próxima sessão de implementação. Bomba operando normalmente esta noite (OFF, sem ação até amanhecer). Refactor pode ser feito amanhã com calma.*
