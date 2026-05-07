# DECISION-OVERSHOOT-COMPENSATION — Compensação dinâmica do overshoot BMS

> **Decisão tomada por:** Fernando (operador/integrador da planta)
> **Data:** 2026-05-07
> **Status:** APROVADA. Implementação autorizada com observação de 14 dias e critérios de reversão.
> **Companion:** este arquivo + `DECISION-RESPECT-CONFIG.md` + `MVP-SCOPE.md`
> **Contexto:** este documento ESTENDE — não substitui — o `DECISION-RESPECT-CONFIG.md`. O princípio "respeitar a faixa configurada" continua válido, com uma exceção controlada e documentada abaixo.

---

## Sumário executivo

A bateria Huawei LUNA2000-LFP apresenta um fenômeno conhecido de "overshoot" no SOC reportado pelo BMS. Durante descarga elétrica intensa, o BMS sobrestima o SOC. Após a descarga cessar (ou diminuir), o BMS recalibra a estimativa, fazendo o número "saltar" pra baixo de até 4-5pp em poucos minutos.

Esse overshoot **não é descarga elétrica real** (`batteryPower` confirma corrente próxima de zero durante o salto). É uma **correção de medição** característica da química LFP combinada com algoritmo Coulomb counting do BMS Huawei.

**Consequência operacional:** o sistema desliga a bomba quando SOC=25%, BMS recalibra, e SOC "vira" 21%. O operador configurou 25% como limite, mas o sistema efetivamente operou até 21% (ou abaixo).

**Decisão:** implementar lógica de **compensação proporcional à descarga** que ajusta o threshold de TURN_OFF baseado na intensidade da descarga corrente, antecipando o overshoot que ocorrerá após desligamento.

---

## 1. O problema, em detalhe técnico

### 1.1 Origem física do overshoot

Bateria LiFePO4 (LFP, química da LUNA2000) tem **curva de tensão extremamente plana** entre 20% e 80% de SOC. Em palavras: a tensão dos terminais varia muito pouco enquanto SOC desce de 80% pra 20%.

O BMS estima SOC por dois métodos combinados:

1. **Coulomb counting:** integra corrente que entra/sai ao longo do tempo. Acumula erro de medição.
2. **Open Circuit Voltage (OCV):** mede tensão quando bateria está em "repouso elétrico". Confiável, mas só funciona com corrente baixa por tempo suficiente.

Durante descarga alta (bomba ON consumindo 52kW), o BMS depende quase exclusivamente do **Coulomb counting**. O método acumula erro proporcional ao tempo e magnitude da descarga.

Quando a descarga cessa, a tensão estabiliza em poucos minutos. O BMS faz **leitura OCV** (mais confiável agora) e descobre que estava errado. **Corrige a estimativa de uma vez** → "salto" no SOC reportado.

### 1.2 Evidência observada na Barragem

Incidentes documentados em `bess_actions` e `bess_readings`:

**Incidente 2026-04-30:**
```
17:33  SOC=37%  Bat=-50.8 kW  bomba ON
17:41  SOC=33%  Bat=-51.8 kW  bomba ON  → TURN_OFF (acionado)
18:30  SOC=17%  Bat=-0.6 kW   bomba OFF (após desligar)
```
Salto observado pós-desligamento: **~4pp em 5min**, com `batteryPower` confirmando ~0kW (sem descarga real).

**Incidente 2026-05-02 (Black Start):**
```
00:01  SOC=14%  Bat=-0.07 kW  estável (auxiliares)
01:02  SOC=10%  Bat=NaN       → BMS entrou em proteção
```
Salto observado: **4pp em ~1h**, possivelmente recalibração antes da proteção total.

### 1.3 Hipótese sobre variação do overshoot

Operador (Fernando) observou em campo:

> "Quando acontecem essas falhas de SOC, geralmente é durante a utilização severa da bateria com carga"

Hipótese técnica decorrente: **magnitude do overshoot é proporcional à intensidade da descarga prévia.** Quanto maior a corrente de descarga (kW), maior o erro acumulado pelo Coulomb counting, e maior será a recalibração quando a descarga cessar.

Essa hipótese **ainda não foi validada com dados quantitativos**, mas será validada durante observação dos próximos 14 dias com a feature ativa.

---

## 2. Solução proposta: compensação proporcional à descarga

### 2.1 Fórmula

Adicionar campo configurável em `bess_config`:

```
overshoot_factor: número decimal (default 0.05)
unidade: pp por kW de descarga
faixa válida: 0.0 a 0.20
```

Lógica nova em `decideAction` (somente para regra TURN_OFF do controle AUTO):

```typescript
// Calcula overshoot estimado baseado na descarga atual
// Só aplica quando há descarga (batteryPower < 0) e bomba está ON
let overshoot_pp = 0;
if (
  config.controlMode === "AUTO" &&
  pumpState === "ON" &&
  state.currentBatteryPower !== null &&
  state.currentBatteryPower < 0 &&
  config.overshoot_factor > 0
) {
  const descarga_kw = Math.abs(state.currentBatteryPower);
  overshoot_pp = descarga_kw * config.overshoot_factor;
}

// Threshold efetivo de desligamento
const threshold_efetivo = config.socMinDesliga + overshoot_pp;

// Decisão de TURN_OFF
if (pumpState === "ON" && soc <= threshold_efetivo) {
  return {
    kind: "TURN_OFF",
    reason: `AUTO desliga: SOC ${soc.toFixed(1)}% <= ${threshold_efetivo.toFixed(1)}% ` +
            `(socMinDesliga ${config.socMinDesliga} + overshoot ${overshoot_pp.toFixed(1)}pp ` +
            `[descarga ${descarga_kw.toFixed(1)}kW × factor ${config.overshoot_factor}])`
  };
}
```

### 2.2 Comportamento esperado em diferentes condições

**Cenário 1 — Manhã ensolarada, bomba ON, PV alto:**
```
PV produz 30 kW
Bomba consome 52 kW
batteryPower = -22 kW (descarga líquida moderada)

socMinDesliga configurado: 25%
overshoot_factor: 0.05
overshoot_pp = 22 × 0.05 = 1.1pp
threshold_efetivo = 25 + 1.1 = 26.1%

→ TURN_OFF dispara em SOC ≤ 26%
→ BMS recalibra para ~25% (overshoot esperado de ~1pp)
→ SOC final próximo do que operador queria
```

**Cenário 2 — Fim de tarde, sol fraco, bomba puxando tudo:**
```
PV produz 5 kW
Bomba consome 52 kW
batteryPower = -47 kW (descarga pesada)

overshoot_pp = 47 × 0.05 = 2.4pp
threshold_efetivo = 25 + 2.4 = 27.4%

→ TURN_OFF dispara em SOC ≤ 27%
→ BMS recalibra para ~25% (overshoot esperado de ~2-3pp)
→ SOC final próximo do que operador queria
```

**Cenário 3 — Bomba OFF, noite:**
```
batteryPower = -0.07 kW (auxiliares)

Condição "pumpState === ON" não satisfeita
overshoot_pp = 0
threshold_efetivo = 25 + 0 = 25%

→ Lógica de compensação não aplica
→ Comportamento original do DECISION-RESPECT-CONFIG mantido
```

**Cenário 4 — Descarga sem bomba (cenário improvável mas possível):**
```
Bomba OFF, mas algo descarregando -10kW (carga inesperada)

Condição "pumpState === ON" não satisfeita
overshoot_pp = 0

→ Compensação não aplica
→ Sistema reage ao limite literal configurado
```

### 2.3 Por que a fórmula é segura

**Não é projeção:** não tenta prever o futuro. Usa medição atual de `batteryPower` para compensar erro conhecido do BMS no momento presente.

**Não é especulação:** baseada em fenômeno físico conhecido (Coulomb counting accumulating error proportional to current).

**Determinística:** mesma entrada (SOC + batteryPower + overshoot_factor) sempre produz mesma saída.

**100% configurável:** operador pode setar `overshoot_factor=0` para desligar feature e voltar ao comportamento puro do `DECISION-RESPECT-CONFIG`.

**Transparente:** cada decisão de TURN_OFF registra no `bess_actions.reason` o threshold efetivo e os componentes da fórmula. Auditável.

**Conservadora por design:** só aplica em direção segura (desligar ANTES, nunca DEPOIS do limite). Em caso de bug, sistema falha desligando cedo demais (perda de uso de bateria), nunca desligando tarde demais (risco de blackout).

---

## 3. Limites e ressalvas

### 3.1 O que esta solução NÃO faz

- Não compensa overshoot **fora do controle de TURN_OFF** (ex: TURN_ON usa SOC literal). Se BMS reportou 30% e SOC real é 26%, sistema vai religar bomba achando que está em 30% — pode oscilar.
- Não previne saltos de SOC durante descarga (BMS pode reportar 35% e cair pra 31% antes mesmo da bomba desligar — é o BMS recalibrando durante operação).
- Não substitui margem operacional. Se operador configurar `socMinDesliga=15` (perigoso), nenhuma compensação salva.
- Não considera temperatura, idade da bateria, ou outros fatores secundários que podem afetar overshoot.

### 3.2 Riscos identificados

**Risco 1 — Fórmula errada:**
Se overshoot real não é linear com batteryPower (pode ser logarítmico, ou ter componente quadrática, ou depender de SOC absoluto), a fórmula vai errar em alguma direção. Mitigação: observar 14 dias e ajustar `overshoot_factor` baseado em dados reais.

**Risco 2 — Subutilização da bateria:**
Se overshoot real é menor que estimado, sistema desliga bomba cedo demais. Em descarga típica de 50kW, factor=0.05 estima overshoot de 2.5pp. Se overshoot real é 1pp, sistema desperdiça ~1.5pp de capacidade útil por ciclo (~3 kWh em 215 kWh).

**Risco 3 — Subproteção (mais grave):**
Se overshoot real é maior que estimado (ex: factor=0.05 em descarga de 50kW estima 2.5pp, mas real foi 5pp), sistema ainda permite passar do limite. Mitigação: `socMinDesliga` continua sendo conservador (recomendado 25-28%).

**Risco 4 — Interação com cooldown:**
Sistema pode atingir threshold efetivo, desligar, e em seguida (após cooldown) o SOC reportado já caiu pelo overshoot. Religaria? Não — religar requer SOC ≥ socMinReliga, que é maior que socMinDesliga. Histerese natural protege.

### 3.3 Critérios de reversão

Esta feature deve ser **revertida** se durante os primeiros 14 dias de observação for verificado:

1. **Mais de 1 incidente de blackout BESS** no período (atualmente: 0 esperado)
2. **Mais de 3 ciclos curtos de bomba** (TURN_OFF e TURN_ON em < 30min) que não eram esperados
3. **Subutilização severa**: bomba desligando consistentemente com SOC > socMinDesliga + 5pp (indicando factor exagerado)
4. **Dados mostrarem que overshoot real não tem correlação com batteryPower** (fórmula errada de raiz)

Reversão = `overshoot_factor=0` na UI. Sistema volta ao comportamento puro do `DECISION-RESPECT-CONFIG`. Sem rollback de código.

---

## 4. Implementação técnica

### 4.1 Mudanças no schema

```sql
ALTER TABLE bess_config 
ADD COLUMN overshoot_factor DECIMAL(4,3) NOT NULL DEFAULT 0.000;
```

Default `0.000` (feature desligada por padrão, não-disruptivo). Operador habilita explicitamente via UI definindo valor > 0.

### 4.2 Mudanças no código

**Arquivo: `server/control-engine.ts`**

Modificar função `decideAction` adicionando bloco de compensação **APENAS na regra de TURN_OFF AUTO**:

```typescript
// (manter regras 1-4: blackout, sem-soc, cooldown, manual)

// Regra 5 modificada: AUTO desliga com compensação de overshoot
if (state.config.controlMode === "AUTO" && state.pumpState === "ON") {
  // Calcula overshoot esperado baseado na descarga atual
  let overshoot_pp = 0;
  if (
    state.currentBatteryPower !== null &&
    state.currentBatteryPower < 0 &&
    state.config.overshoot_factor > 0
  ) {
    const descarga_kw = Math.abs(state.currentBatteryPower);
    overshoot_pp = descarga_kw * state.config.overshoot_factor;
  }
  
  const threshold_efetivo = state.config.socMinDesliga + overshoot_pp;
  
  if (state.soc <= threshold_efetivo) {
    const reason = overshoot_pp > 0
      ? `AUTO desliga: SOC ${state.soc.toFixed(1)}% <= ${threshold_efetivo.toFixed(1)}% (socMinDesliga ${state.config.socMinDesliga} + overshoot ${overshoot_pp.toFixed(1)}pp [descarga ${Math.abs(state.currentBatteryPower!).toFixed(1)}kW × factor ${state.config.overshoot_factor}])`
      : `AUTO desliga: SOC ${state.soc.toFixed(1)}% <= socMinDesliga ${state.config.socMinDesliga}%`;
    
    return { kind: "TURN_OFF", reason };
  }
}

// Regra 6: TURN_ON (sem mudanças)
if (state.pumpState === "OFF" && state.soc >= state.config.socMinReliga) {
  // ... lógica existente sem alteração
}
```

**Arquivo: `client/src/components/v2/ConfigModalV2.tsx` (UI)**

Adicionar campo "Compensação de overshoot BMS" na aba de configurações:

- Tipo: number input
- Faixa: 0.000 a 0.200
- Step: 0.005
- Help text: "Fator de compensação para overshoot do BMS (pp por kW de descarga). Default 0.000 = desligado. Recomendado: 0.050 para LUNA2000-LFP. Maior valor = desliga bomba mais cedo durante descarga alta."

**Arquivo: `drizzle/schema.ts`**

Adicionar campo correspondente.

### 4.3 Logging adicional

Em cada poll, quando `overshoot_factor > 0`, adicionar log informativo:

```
[ControlEngine] barragem: SOC=28% Bat=-47kW overshoot_estimado=2.4pp threshold_efetivo=27.4%
```

Permite operador observar comportamento sem precisar entrar no banco.

### 4.4 Testes unitários

Adicionar em `server/control-engine.test.ts`:

```typescript
describe("decideAction with overshoot compensation", () => {
  it("aplica compensação quando bomba ON e descarregando", () => {
    const state = makeState({
      soc: 27,
      pumpState: "ON",
      currentBatteryPower: -47,
      config: { ...defaultConfig, socMinDesliga: 25, overshoot_factor: 0.05 }
    });
    
    const decision = decideAction(state, new Date());
    
    expect(decision.kind).toBe("TURN_OFF");
    expect(decision.reason).toContain("overshoot 2.4pp");
  });
  
  it("não aplica compensação quando bomba OFF", () => {
    const state = makeState({
      soc: 26,
      pumpState: "OFF",
      currentBatteryPower: -0.07,
      config: { ...defaultConfig, socMinDesliga: 25, overshoot_factor: 0.05 }
    });
    
    const decision = decideAction(state, new Date());
    
    // SOC=26 não >= socMinReliga (30), então NONE
    expect(decision.kind).toBe("NONE");
  });
  
  it("comporta como DECISION-RESPECT-CONFIG quando factor=0", () => {
    const state = makeState({
      soc: 25,
      pumpState: "ON",
      currentBatteryPower: -47,
      config: { ...defaultConfig, socMinDesliga: 25, overshoot_factor: 0 }
    });
    
    const decision = decideAction(state, new Date());
    
    expect(decision.kind).toBe("TURN_OFF");
    expect(decision.reason).not.toContain("overshoot");
  });
  
  it("dispara TURN_OFF antecipado em descarga alta", () => {
    const state = makeState({
      soc: 27,
      pumpState: "ON",
      currentBatteryPower: -50,
      config: { ...defaultConfig, socMinDesliga: 25, overshoot_factor: 0.05 }
    });
    
    const decision = decideAction(state, new Date());
    
    // threshold_efetivo = 25 + 2.5 = 27.5; SOC=27 ≤ 27.5
    expect(decision.kind).toBe("TURN_OFF");
  });
  
  it("não dispara TURN_OFF em descarga moderada quando SOC ainda longe", () => {
    const state = makeState({
      soc: 30,
      pumpState: "ON",
      currentBatteryPower: -50,
      config: { ...defaultConfig, socMinDesliga: 25, overshoot_factor: 0.05 }
    });
    
    const decision = decideAction(state, new Date());
    
    // threshold_efetivo = 27.5; SOC=30 > 27.5
    expect(decision.kind).toBe("NONE");
  });
});
```

---

## 5. Plano de implementação

### Fase 1 — Implementação (Claude do servidor)

**Antes de qualquer mudança:** listar arquivos a modificar, mostrar diff completo, aguardar autorização explícita do Fernando. Sem exceção.

**Ordem das mudanças (atômicas, 1 commit por etapa):**

1. **Migração schema:** adicionar coluna `overshoot_factor` em `bess_config` com default 0
2. **Lógica em `decideAction`:** adicionar bloco de compensação na regra de TURN_OFF AUTO
3. **Logging:** adicionar log informativo sobre overshoot estimado em cada poll
4. **UI:** adicionar campo configurável no `ConfigModalV2`
5. **Testes:** adicionar suite de testes em `control-engine.test.ts`
6. **Validação:** rodar todos os testes existentes (`pnpm test`) e confirmar zero quebras

Cada etapa: commit atômico, build, deploy se aplicável, validar antes de seguir.

### Fase 2 — Configuração inicial (Fernando)

Após implementação concluída, Fernando configura na UI:

```
socMinDesliga = 25  (mantém configuração atual)
overshoot_factor = 0.050  (valor inicial recomendado)
intervaloPadrao = 3min  (já decidido)
```

### Fase 3 — Observação (14 dias)

Durante 14 dias, **sem mudanças no código**:

**Métricas a coletar diariamente** (manual ou via query):

1. **Cada TURN_OFF:**
 - SOC no momento da ação
 - batteryPower no momento
 - overshoot_pp aplicado
 - threshold_efetivo
 - SOC 5min, 15min, 30min depois (quanto realmente desceu por overshoot real)

2. **Diferença real vs prevista:**
 - overshoot_real = SOC_acao - SOC_min_pos_acao
 - overshoot_previsto = batteryPower × overshoot_factor
 - delta = overshoot_real - overshoot_previsto

3. **Eventos críticos:**
 - Algum blackout BESS?
 - Algum ciclo curto inesperado?
 - Algum momento em que SOC passou abaixo de socMinDesliga?

### Fase 4 — Validação e ajuste (após 14 dias)

Análise dos dados coletados:

**Cenário A — overshoot_real ≈ overshoot_previsto (delta < 1pp):**
Fórmula está calibrada. Manter `overshoot_factor=0.05`.

**Cenário B — overshoot_real > overshoot_previsto (sistema permitindo passar):**
Subir factor pra 0.07 ou 0.08. Re-observar 14 dias.

**Cenário C — overshoot_real < overshoot_previsto (sistema desligando cedo demais):**
Baixar factor pra 0.03 ou 0.04. Re-observar 14 dias.

**Cenário D — overshoot_real não correlaciona com batteryPower:**
Fórmula linear errada. Reverter para `factor=0` e adotar Abordagem 3 do `DECISION-OVERSHOOT-COMPENSATION-PRELIMINAR` (subir socMinDesliga para 30% e aceitar).

---

## 6. Critérios de aceitação

A feature é considerada **bem-sucedida** após 14 dias se:

1. ✅ Zero blackouts BESS no período
2. ✅ Zero ciclos curtos inesperados (TURN_OFF seguido de TURN_ON em < 30min sem mudança de condição)
3. ✅ Em pelo menos 80% dos TURN_OFFs, SOC final pós-overshoot ficou entre `socMinDesliga - 2pp` e `socMinDesliga + 2pp`
4. ✅ Sistema continua respondendo dentro de 3min após mudança de condição
5. ✅ `bess_actions.reason` permite reconstruir cada decisão com transparência
6. ✅ Operador (Fernando) reporta sensação subjetiva de "sistema confiável" e ausência de surpresas

A feature é considerada **falha** e deve ser revertida (`factor=0`) se:

1. ❌ Algum blackout BESS no período
2. ❌ Operador precisou ir presencialmente alguma vez por causa de proteção do BMS
3. ❌ Subutilização severa: SOC final consistentemente acima de `socMinDesliga + 5pp`
4. ❌ Dados mostram que overshoot real é independente de batteryPower

---

## 7. Notas pro Claude do servidor

**Princípios não-negociáveis ao implementar:**

1. **Não toque em mais nada além do que está especificado neste documento.** Especificamente:
 - Não mexa no `poll-scheduler.ts` (já foi otimizado)
 - Não adicione "polling adaptativo ETA-based"
 - Não adicione "projeção de SOC futuro"
 - Não adicione "compensação de overshoot no TURN_ON" (só TURN_OFF AUTO)
 - Não estenda lógica de Coulomb counting
 - Não adicione logging excessivo (1 log por poll é suficiente)

2. **Antes de qualquer mudança no código:** lista de arquivos + diff completo + autorização explícita do Fernando. Sem exceção.

3. **Atomicidade:** cada uma das 6 etapas da Fase 1 é um commit separado. Build e teste entre cada commit.

4. **Defaults conservadores:** `overshoot_factor` default = 0.000 (feature desligada). Fernando habilita explicitamente.

5. **Resista ao impulso de "melhorar":**
 - Se quiser ajustar a fórmula, primeiro pergunte
 - Se quiser adicionar mais campos configuráveis, primeiro pergunte
 - Se quiser estender pra outros cenários (ex: TURN_ON), primeiro pergunte

6. **Atualize `CLAUDE.md`** com a nova feature, mencionando explicitamente:
 - É exceção controlada ao princípio do `DECISION-RESPECT-CONFIG`
 - Operador pode desligar com `factor=0`
 - Está em período de validação até 2026-05-21

7. **Critério de reversão é simples:** se durante os 14 dias acontecer qualquer um dos 4 itens da seção 6 ("falha"), Fernando vai mudar `overshoot_factor=0` na UI. Sistema volta ao comportamento original. Sem rollback de código necessário.

---

## 8. Decisão consciente do operador

Fernando, ao autorizar esta implementação, reconhece e aceita:

1. **Estamos implementando lógica nova baseada em hipótese, não em dados estatísticos prévios.** A correlação entre `batteryPower` e overshoot do BMS é hipótese baseada em química LFP e observação operacional, mas não foi quantitativamente verificada.

2. **A fórmula `overshoot_pp = |batteryPower| × 0.05` é aproximação inicial.** Pode estar errada. Calibração será feita durante observação de 14 dias.

3. **Esta feature pequena ESTENDE o `DECISION-RESPECT-CONFIG`, mas está dentro do espírito** porque é configurável (operador define), transparente (logs explicam cada decisão), e conservadora (falha desligando cedo, nunca tarde).

4. **Há risco de subutilização da bateria** em casos onde overshoot real é menor que previsto. Aceitável durante período de validação.

5. **Em caso de evidência de falha**, reverter para `factor=0` é simples e operador se compromete a fazê-lo se critérios de falha forem atingidos.

---

*Documento aprovado em 2026-05-07. Implementação aguardando início pelo Claude do servidor. Período de observação: até 2026-05-21. Validação e ajuste: 2026-05-22 em diante.*
