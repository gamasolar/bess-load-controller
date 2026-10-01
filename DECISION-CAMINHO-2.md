# DECISION-2026-10-01 — Caminho 2: controle local por cabo (MikroTik + PLC + Pi/N100)

> **Proposto por:** Claude, a partir das conversas de 17/09 a 01/10 com Fernando
> **Data:** 2026-10-01
> **Status:** PROPOSTA — aguardando aprovação do operador. Nada aqui está implementado.
> **Companion:** `CLAUDE.md` §4 (incidentes 30/08 e 17-18/09), §14 (disciplina), `DECISION-RESPECT-CONFIG.md`
> **Hardware já comprado:** 2× Raspberry Pi 3 Model B (kit com fonte/case/dissipador) · 2× MikroTik hAP ax lite (L41G-2axD)

---

## Sumário executivo

A automação atual da bomba da Barragem depende de três coisas frágeis em série: **Wi-Fi** (ESP8266 que às vezes não reassocia), **internet da planta** (Starlink com CGNAT que pisca 17× por madrugada) e **servidor remoto** (o `control-engine` roda no gamaserver). Em 29/08 e em 17/09 essa cadeia quebrou. Na segunda vez a bomba ficou presa em ON por 10 h e o desfecho foi BESS em proteção, Black Start presencial e SOC em 9 %.

Este documento propõe tirar as três dependências do caminho da proteção da bateria:

| Hoje | Proposto |
|---|---|
| Comando por Wi-Fi (Sonoff) | **Comando por cabo** (contato seco de PLC/concentrador) |
| Decisão no gamaserver, via internet | **Decisão local**, no equipamento da planta |
| SOC pela FusionSolar (15 min, rate limit) | **SOC por Modbus TCP do SmartLogger** (segundos, sem cota) |
| Sessão MQTT cai a cada troca de IP | **WireGuard** no MikroTik — túnel sobrevive à troca de IP |
| Alarme só no dashboard | Telegram (fora deste doc, mas pré-requisito) |

O dashboard **continua existindo** — vira supervisor: mostra, registra, permite alterar a faixa e comandar manualmente. Deixa de ser quem decide.

**Custo aproximado:** Barragem R$ 3.000–4.000 · Piscinão R$ 1.000–1.500 (hardware já comprado não contado).

---

## 1. Por que agora — os dois incidentes

### 1.1 29-30/08 — dispositivo mudo 20 h, sem alarme

Sonoff `DVES_65A7F8` fechou a conexão às 23:54 e nunca mais tentou. Zero alarme por 16 h. Reboot presencial resolveu. Saiu daí o alarme `AUTOMACAO_OFFLINE` (15 min).

### 1.2 17-18/09 — bomba presa em ON, Black Start

| Hora | Evento |
|---|---|
| 17/09 09:18 | dispositivo caiu **com a bomba ligada** |
| 09:33 | alarme abriu (funcionou) — ninguém viu, Telegram ausente |
| 09:18 → 19:35 | bomba rodou 10 h; à noite bateria a −47 kW, ~30 pp/h |
| 19:35 | operador desligou o BESS pelo app FusionSolar a 26 % |
| 18/09 03:57 | telemetria cega; BESS em proteção |
| 18/09 manhã | visita presencial, Black Start; SOC voltou em **9 %** |
| 18/09 | Sonoff reiniciado presencialmente **não voltou** — dado como morto |

**Lição operacional registrada:** desligar o BESS pelo app numa planta off-grid **não é estacionamento seguro** — o gabinete continua consumindo da própria bateria (BMS, térmica) sem chance de recarga, e termina em proteção. O que para a bomba sem matar a planta é **contato físico na bomba**.

### 1.3 O que o log do broker mostrou (madrugada de 16/09)

17 quedas entre 00:16 e 05:29, todas `exceeded timeout`, reconexão em 1–13 s, **10 IPs públicos distintos** — assinatura de Starlink/CGNAT re-registrando, não de dispositivo. A FusionSolar não enxerga quedas < 2 min (o SmartLogger reenvia), então cruzar com ela não prova nada nessa escala.

---

## 2. Arquitetura proposta

```
                      ┌─────────────────────────────┐
                      │   Dashboard (gamaserver)    │  SUPERVISOR
                      │   lê por Modbus TCP via VPN │  mostra · registra · config · comando manual
                      └──────────────┬──────────────┘
                                     │ WireGuard (wg1 10.10.0.0/24 já existe)
                                     ▼
                      ┌─────────────────────────────┐
                      │  MikroTik hAP ax lite       │  REDE
                      │  WAN ← roteador Starlink    │  túnel sobrevive à troca de IP
                      │  LAN: 3 portas (+ switch)   │
                      └──┬──────────┬───────────┬───┘
                         │          │           │ Ethernet
          ┌──────────────▼──┐  ┌────▼─────┐  ┌──▼──────────────────┐
          │ SmartLogger 3000│  │ PLC /    │  │ Pi 3B ou N100       │  TELEMETRIA
          │ Modbus TCP:     │  │ concen-  │  │ lê tudo, publica,   │  + ponte
          │ SOC, PV, carga  │  │ trador   │  │ estação via RS485   │
          └─────────────────┘  └──┬───┬───┘  └─────────────────────┘
                                  │   │
                            contator   contato auxiliar
                            da bomba   (retorno: bomba ligou de fato)
```

**Regra única de autoridade:** quem decide ligar/desligar pela faixa de SOC é **um** equipamento na planta. O dashboard nunca mais briga com ele (incidente de 30/04 foram duas lógicas na mesma bomba).

---

## 3. Hardware

### 3.1 Já comprado

**MikroTik hAP ax lite (L41G-2axD)** — 4 portas Gigabit, Wi-Fi 6 só 2,4 GHz, RouterOS 7 (WireGuard nativo), alimentação USB-C 5 V ou PoE-in na ether1. **Sem PoE-out**: cada equipamento precisa de alimentação própria. Com 1 porta WAN sobram 3 LAN — SmartLogger + PLC + Pi ocupam as três; o Shelly 3EM (LAN) ou qualquer quinto cabo exige um **switch Gigabit de 5 portas** (~R$ 80). O Wi-Fi 2,4 GHz serve só para o curativo Tasmota (§7).

**Raspberry Pi 3 Model B** (2×) — 1 vai para o Piscinão; o outro é **reserva**. Na Barragem o cérebro é o N100 (§3.2) por causa do cartão SD: Pi 3B boota de SD, a Barragem tem cortes abruptos, SD corrompe. Onde o Pi ficar: **boot por SSD USB** (~R$ 150) ou, no mínimo, filesystem em leitura + `log2ram`.

### 3.2 A comprar — Barragem (planta crítica)

| Função | Recomendação | Alternativa | Ref. |
|---|---|---|---|
| **Proteção e comando da bomba** | **Siemens LOGO! 8.3 12/24RCE** — Ethernet, Modbus TCP cliente+servidor, 4 relés 10 A, 8 DI (4 viram AI 0–10 V), expansível, lógica em blocos | KinCony KC868-A8v3 (§3.3) | R$ 1.200–1.800 |
| **Cérebro / telemetria / ponte** | **Mini PC fanless Intel N100 + SSD**, 12 V, ~8 W, watchdog na BIOS | Pi 3B + SSD USB | R$ 800–1.000 |
| **Medição da bomba** | **Shelly Pro 3EM + 3 TCs** (trifásico, LAN) | — | R$ 700–1.000 |
| **Estação solarimétrica** | adaptador **USB-RS485** no N100 (ou porta EMI do SmartLogger se a estação for compatível) | Waveshare RS485→PoE ETH se os sensores ficarem longe | R$ 30 |
| Switch Gigabit 5 portas | qualquer | — | R$ 80 |
| Fonte 24 V DC do nobreak | para LOGO!/PLC | — | R$ 100 |

Por que LOGO! na Barragem: é o único da lista em que a proteção **não depende de nada que possa travar** — lê o SOC do SmartLogger por Modbus TCP e abre o contator sozinho, sem Linux, sem SD, sem internet. Representante no Brasil. O **POWR316D** da pendência §7.15 está descartado: é monofásico, a bomba de 30 cv é trifásica.

### 3.3 A comprar — Piscinão (sem bomba automatizada ainda)

| Função | Recomendação | Ref. |
|---|---|---|
| Concentrador de I/O | **KinCony KC868-A8v3** — exigir no anúncio **"A8v3"**, **"W5500"** e **"RS485"**. Ethernet, 8 relés 250 V/10 A COM/NO/NC, 8 DI, RS485, 12/24 V, DIN, ESPHome. **Não** é o A6 (só Wi-Fi) nem o A8 antigo (LAN8720, 2 DI, RF 433, sem RS485) | US$ 80 |
| Cérebro | Pi 3B (comprado) + SSD USB | R$ 150 |
| Sensor analógico, se houver | Waveshare Modbus RTU Analog Input 8CH no RS485 do A8v3 | R$ 150 |

Se o Piscinão virar crítico, migra para LOGO! e o A8v3 vira reserva.

### 3.4 Descartados, e por quê

| | Motivo |
|---|---|
| Qualquer coisa **Wi-Fi** na cadeia de comando (Sonoff, POWR316D, Waveshare ESP32-S3, KC868-A6) | causa raiz dos dois incidentes |
| ~~Waveshare Modbus POE ETH Relay (B)~~ **reabilitado 01/10** | Eu tinha descartado por "sem estado seguro". **Errado:** o comando *Flash ON* (coil `0x0200+ch`, duração `N × 100 ms`, máx. `0x7FFF` ≈ 54 min — verificado na wiki Waveshare) é um **dead-man switch**: o Pi manda "ligado por 5 min" a cada 60 s; se Pi e VPS sumirem, o relé abre sozinho em ≤ 5 min. Terceira camada **sem firmware**. Vira a opção mais barata viável (~R$ 250–300). Exigir a versão **(B)** (8 DI para o retorno do contator). Alimentar por 7–36 V do nobreak — o hAP ax lite não tem PoE-out. Sem RS485/AI: estação via USB-RS485 no Pi. Pendente: confirmar corrente dos contatos (tipicamente 10 A/250 V AC, folga para bobina de contator) e se o relé aceita 2 clientes TCP simultâneos (Pi + VPS). |
| KC868-A16v3 | saída MOSFET (DC), não relé — não aciona bobina 220 V direto |
| Relé no GPIO do Pi | sem isolamento; Pi vira ponto único de falha da bomba |
| ADAM-6266 / Moxa / PiXtend / Revolution Pi | mais robustos, mais caros; voltam se o LOGO!/A8v3 falhar em campo |

---

## 4. Software

### 4.1 Lógica embarcada (LOGO! na Barragem)

Reproduz **literalmente** o `decideAction` atual — `DECISION-RESPECT-CONFIG.md` vale para o PLC:

```
BLACKOUT : SOC ≤ socBlackout            → abre relé (sempre)
TURN_OFF : bomba ON  ∧ SOC ≤ socMinDesliga → abre relé
TURN_ON  : bomba OFF ∧ SOC ≥ socMinReliga ∧ dentro da janela horária → fecha relé
cooldown : respeitado entre manobras
SOC inválido / SmartLogger mudo > N min   → abre relé (estado seguro)
```

Sem projeção, sem ETA, sem margem — §14 continua valendo dentro do PLC. Os parâmetros ficam em registradores Modbus do LOGO! que o dashboard escreve; a UI atual de configuração continua sendo o lugar onde o operador muda a faixa.

### 4.2 Dashboard

- **Um driver Modbus TCP** (`server/modbus.ts`, `modbus-serial`) serve para SmartLogger **e** LOGO!/A8v3. Stack única.
- `pollSite` passa a ter **fonte preferencial Modbus** com **fallback FusionSolar** quando o Modbus não responder. A FusionSolar não sai — vira segunda opinião.
- `control-engine` ganha um modo **SUPERVISOR**: não envia comando automático; registra o que o PLC fez (eventos/ações) e o que *faria*. O comando manual da UI vai para o PLC por Modbus.
- Alarmes novos: `PLC_OFFLINE`, `MODBUS_SMARTLOGGER_OFFLINE`, `DIVERGENCIA_RETORNO` (relé fechou, contato auxiliar não confirmou).
- `mqtt-tasmota.ts` fica intocado até o curativo (§7) sair de cena.

### 4.3 Pi / N100

Serviço Python ou Node que: lê a estação por RS485, lê o PLC e o SmartLogger, publica no broker (local ou remoto via túnel), expõe healthcheck. Watchdog de hardware ativado (`/dev/watchdog` no Pi; BIOS no N100). Sem decisão de bomba.

---

## 5. Fases e critérios de saída (modo sombra, §14)

| Fase | O que entra | Sai quando |
|---|---|---|
| **0 — Pré-requisitos** | Telegram configurado; curativo Tasmota instalado | alarme chega no celular; bomba volta a ter proteção de SOC |
| **A — Rede e leitura** | MikroTik + WireGuard; Modbus TCP habilitado no SmartLogger; N100/Pi lendo | 14 dias com SOC Modbus vs FusionSolar divergindo < 2 pp; túnel sem queda > 5 min |
| **B — PLC em sombra** | LOGO! instalado, lê SOC, **relé não ligado ao contator**; loga decisões | 14 dias em que decisão do PLC == decisão do dashboard em 100 % dos eventos de borda |
| **C — PLC assume** | relé no contator; dashboard em SUPERVISOR; curativo Tasmota removido | 30 dias sem divergência de retorno e sem intervenção manual |
| **D — Piscinão** | repete A→C com A8v3 | idem |

Cada fase: 1 mudança, validada, antes da próxima. Reversão de C = religar o Tasmota no contator e voltar `control-engine` para AUTO — 30 min, sem código.

---

## 6. Roteiro da visita técnica (Barragem)

1. **Antes de ir:** configurar MikroTik em bancada (WireGuard peer no gamaserver, DHCP, firewall via WG — usar `helios_mk_template_hardening`); gravar programa do LOGO! em bancada e testar com SOC simulado.
2. **Energia:** 24 V DC a partir do nobreak para LOGO!, MikroTik (USB-C) e N100. Nada no circuito do inversor.
3. **Rede:** Starlink → MikroTik WAN; SmartLogger, LOGO!, N100 nas LAN (+ switch se precisar).
4. **SmartLogger:** habilitar Modbus TCP (firmware V300R024C10SPC211 suporta); anotar IP, unit-id e registradores de SOC/PV/carga; testar leitura do N100.
5. **Quadro da bomba:** instalar **chave seccionadora/manual** acessível (lição de 17/09); relé do LOGO! → bobina do contator; contato auxiliar → DI do LOGO!; TCs do 3EM.
6. **Validação no local:** ligar/desligar pela UI, confirmar retorno; cortar internet e confirmar que o LOGO! segue lendo SOC; simular SOC baixo e confirmar abertura.
7. **Starlink:** app → Estatísticas → Quedas, registrar a causa das quedas de madrugada.
8. Retirar o Sonoff morto.

---

## 7. Curativo até o hardware chegar

Qualquer Sonoff/Tasmota do Mercado Livre, configurado com o tópico `bess_sonoff` e o broker atual, devolve a proteção de SOC **sem uma linha de código**. Não é solução — é para não passar semanas com a bomba na mão. Sai na fase C.

---

## 8. Pendências que este doc não resolve

- `CLAUDE.md` §7.13/14/15 ficam substituídas por este doc quando aprovado.
- Auto Black Start (§7.6) continua sem resposta — o chamado Huawei segue pendente.
- TLS no broker (§5) fica mais fácil com o túnel: o MQTT pode passar a trafegar só dentro do WireGuard.

---

## 9. Decisão do operador

- [ ] Aprovado como está
- [ ] Aprovado com mudanças: ________________________________
- [ ] Barragem com KC868-A8v3 em vez de LOGO! (economia ~R$ 1.000, proteção passa a depender do firmware ESPHome)
- [ ] Rejeitado

*Após aprovação: atualizar `CLAUDE.md` §4 (timeline), §7 (pendências) e iniciar Fase 0.*

---

## Apêndice A — Pesquisa: SmartLogger3000 V300R024C10SPC211 + LUNA2000-215-2S10 falam Modbus TCP com terceiros? (2026-10-01)

Fontes lidas na íntegra (texto extraído dos PDFs): SmartLogger3000 User Manual Issue 20 (2024-04) e Issue 23 (2024-12); SmartLogger ModBus Interface Definitions Issue 35/37 (2020); LUNA2000B e LUNA2000C ESS Modbus Port Definitions (2023); LUNA2000-(107-215) Smart String ESS User Manual Issue 04 (2024-12); LUNA2000-(107-215) C&I On-Grid Solution (SmartLogger3000) Issue 06 (2025-06) e Issue 09 (2026-01); LUNA2000-215-2S10 C&I **Microgrid** Solution Issue 02 (2025-02); C&I Microgrid Quick Guide (2024-04); C&I On-Grid Quick Guide 215KWH (2024-08).

### A.1 Resposta curta

**Sim, com uma condição que muda o plano.** O SmartLogger3000 expõe Modbus TCP para terceiros (porta 502) e o firmware V300R024C10 está na faixa suportada. **Mas** o modo de microrrede da Huawei (**MGCC Mode**) — que é o que dá *auto black start* em off-grid — **desliga o Modbus TCP de terceiros**. Os dois recursos são mutuamente exclusivos segundo a Huawei. A Barragem tem que escolher.

### A.2 O que está confirmado

| Pergunta | Resposta | Fonte |
|---|---|---|
| SmartLogger3000 aceita cliente Modbus TCP de terceiros? | **Sim.** `Settings > Comm. Param. > Modbus TCP`; porta **502** (configurável para 1502); `Link setting` = `Enable(Limited)` com **whitelist de até 5 IPs** de cliente, ou `Enable(Unlimited)`; `Address mode` = *Communication address* (unit id = endereço do dispositivo) ou *Logical address* (SmartLogger = id 0); `Fast scheduling` (V300R023C00+). **Vem desabilitado de fábrica**: Huawei avisa que o protocolo não tem autenticação nem criptografia e que o usuário assume o risco. | Manual i23 §6.3.3 Método 2, p.125; i20 p.129–141 |
| V300R024C10SPC211 serve? | **Sim.** O manual i23 cobre V300R024C10; o manual da solução C&I exige "V300R024 ou superior" para o SmartLogger enxergar o ESS 215. | Manual i23; C&I Solution i09 §6.2 |
| O 215-2S10 é visto pelo SmartLogger como ESS? | **Sim** (máx. 20 ESS por SmartLogger, FE ring via RCM WAN1/LAN1). O 215-2S10 fala **Modbus TCP** como protocolo de sistema. | ESS Manual i04 §12 (specs), §7 cabos |
| Dá para ler o ESS **direto**, sem SmartLogger? | **Não, para terceiros.** O Modbus-TCP "northbound" do BCU é autenticado por **certificado** (BCU↔SACU, app↔BCU). Os documentos públicos de portas Modbus do ESS cobrem só **LUNA2000-200KWH-2H0/2H1** (LUNA2000B) e contêineres (LUNA2000C) — nenhum cita o 215-2S10. | ESS Manual i04 Apêndice E; LUNA2000B §1.1 Tabela 1-1 |
| Modbus RTU na porta COM do SmartLogger para terceiros? | **Não documentado.** As COM são para o SmartLogger ser *mestre* (EMI, medidores, inversores de terceiros). A saída para terceiros é Modbus TCP ou IEC104, só em WAN/LAN/SFP. | Manual i20 |

### A.3 O achado que muda o plano: MGCC × Modbus TCP

Texto literal do manual (i20 Tabela 6-8, repetido no manual de microrrede 215-2S10 e no Quick Guide):

> **MGCC Mode under Microgrid** — The default value is Disable. When MGCC Mode is enabled, **Modbus TCP, IEC 104, and GOOSE settings are disabled** and the SmartLogger does not respond to scheduling commands from the EMS. Enable this function only when the EMS is not required. If you forcibly enable both the MGCC mode and the Modbus TCP, IEC 104, and GOOSE settings, **the microgrid may be unstable.**

E sobre black start (Quick Guide §Black Start):

> When MGCC Mode is set to Enable and Microgrid scenario is set to Off-grid, if the solar irradiance recovers for inverters and no PCS is running, [...] black start is automatically triggered.

Ou seja:

- **Auto black start em off-grid = MGCC Mode Enable + Microgrid scenario Off-grid.** No cenário off-grid puro **não é exigido** relé de proteção nem STS (só o VSG on/off-grid exige). Isso enfraquece a hipótese do CLAUDE.md §6 de "hardware incompleto": pode ser só configuração.
- **MGCC Enable → sem Modbus TCP para o Pi/dashboard.** A FusionSolar (NMS Huawei) continua funcionando.
- O **botão físico BLACK START** do 215-2S10 (o que Fernando apertou em 18/09) existe independente do MGCC.

**Pergunta aberta para o operador (decide o desenho):** no WebUI do SmartLogger da Barragem, `Settings > Microgrid`: **MGCC Mode está Enable ou Disable?**

| Se MGCC está… | Caminho 2 fica… |
|---|---|
| **Disable** (provável — auto black start nunca funcionou) | como proposto: Modbus TCP via SmartLogger para o Pi. Trade-off: se um dia ligar MGCC para ter auto black start, perde o Modbus. |
| **Enable** | sem Modbus TCP. Alternativas: (a) manter FusionSolar como fonte de SOC (rate limit continua) e cabear só o comando; (b) desligar MGCC e aceitar black start manual (já é o que acontece hoje). |

### A.4 Lacuna que ficou

**Não consegui obter o mapa oficial de registradores do ESS C&I via SmartLogger** ("SmartLogger ModBus Interface Definitions" **Issue 43, 2023-10-21** ou posterior — as cópias públicas na Photomate/Zendesk e Scribd estão bloqueadas; as versões acessíveis, Issue 35/37 de 2020, antecedem o ESS C&I e não têm SOC). As definições de ESS que achei (LUNA2000B: SOC U16 % gain 1; carga/descarga I32 kW gain 1000; SOH; tensão/corrente de rack; status) são do **acesso direto ao ESS**, não via SmartLogger, e de outro modelo. **Pedir à Huawei Partners / ao instalador o PDF "SmartLogger ModBus Interface Definitions" mais recente** — é o item 1 da visita técnica, junto com habilitar o Modbus TCP e anotar o `logical address` do ESS.

### A.5 O que isso muda no roteiro da visita (§6, passo 4)

4. **SmartLogger:** (a) ler `Settings > Microgrid > MGCC Mode` e **anotar**; (b) se Disable, habilitar `Settings > Comm. Param. > Modbus TCP` com `Enable(Limited)` + IP do Pi na whitelist + `Logical address`; (c) ler o endereço lógico do ESS em `Monitoring`; (d) testar do Pi: ler SOC e comparar com o WebUI; (e) **não** mexer em MGCC sem decisão registrada — liga auto black start e derruba o Modbus.
