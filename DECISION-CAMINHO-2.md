# DECISION-2026-10-01 — Caminho 2: controle local por cabo (MikroTik + Pi + relé Modbus)

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

**Custo aproximado (revisado 01/10):** Barragem **R$ 700–900** (2× Waveshare + SSD + USB-RS485) · Piscinão R$ 450–600 · opcional Shelly 3EM R$ 700–1.000. Hardware já comprado não contado.

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

## 2. Arquitetura proposta (revisada 2026-10-01 — Pi primário, VPS reserva, Waveshare como braço)

```
 BARRAGEM (planta)                                           VPS (gamaserver)
 ─────────────────────────────────────────────────           ──────────────────────────────
                                                             Dashboard = SUPERVISOR + RESERVA
  Starlink ──► MikroTik hAP ax lite ◄═══ WireGuard ════════► mostra · histórico · config ·
               │ (túnel sobrevive à troca de IP do CGNAT)    comando manual.
               │                                             Assume a bomba SÓ se o Pi ficar
               │ cabo ethernet (3 portas LAN)                5 min sem heartbeat; devolve
     ┌─────────┼───────────────────┐                         quando o heartbeat volta.
     ▼         ▼                   ▼
 SmartLogger   Raspberry Pi 3B     Waveshare Modbus POE ETH Relay (B)
 3000          (boot por SSD USB)  8 relés + 8 entradas digitais
 ───────────   CÉREBRO             BRAÇO (burro, sem lógica)
 SOC, PV,      roda o MESMO        relé 1 ─► bobina do contator ─► inversores de frequência ─► bombas
 carga,        control-engine      entrada 1 ◄── contato auxiliar (bomba ligou de fato?)
 bateria       da VPS; lê tudo,    comando "Flash ON 5 min" re-armado a cada 60 s
 (Modbus TCP   decide, atua,       ⇒ sem Pi E sem VPS, o relé abre sozinho em ≤ 5 min
  se MGCC off) publica, heartbeat  alimentação 7–36 V do nobreak (hAP não tem PoE-out)
      ▲
      │ USB-RS485: estação solarimétrica (sensores Modbus RTU)
```

**Três camadas, uma lógica só:**

| Camada | Quem | Quando age |
|---|---|---|
| 1 — Primária | **Pi** na planta, mesmo código do `control-engine` | sempre que estiver vivo |
| 2 — Reserva | **VPS** pelo túnel | só após 5 min sem heartbeat do Pi; devolve ao Pi quando ele volta |
| 3 — Último recurso | **Waveshare** sozinho (Flash ON expira) | se Pi e VPS sumirem — abre o relé, bomba para |

**Regra de autoridade:** nunca os dois cérebros ativos ao mesmo tempo (incidente de 30/04 foram duas lógicas na mesma bomba). O heartbeat é a única chave de troca.

### 2.1 O que é lido, de onde, e se vai funcionar

| Dado | Fonte | Status |
|---|---|---|
| Bomba ligou de fato (contato auxiliar) | entrada digital do Waveshare | ✅ é fio — funciona |
| Estado do relé | Waveshare, Modbus TCP | ✅ |
| SOC, PV, carga, bateria **em segundos, sem cota** | SmartLogger, Modbus TCP | ⚠️ depende só de `MGCC Mode = Disable`. O mapa de registradores chegou em 03/10 (Issue 47) e o leitor está pronto e testado — ver `docs/huawei/SMARTLOGGER-MODBUS.md` |
| SOC etc. — **fallback** | FusionSolar, como hoje | ✅ funciona hoje (15 min, rate limit); continua existindo |
| Estação solarimétrica | USB-RS485 no Pi | ✅ se sensores Modbus RTU; analógicos exigem módulo extra |
| Potência real da bomba (kW) | — | ❌ não nesta configuração (Shelly Pro 3EM, opcional) |

**Atuação e proteção funcionam independentemente do Modbus do SmartLogger.** O Modbus só melhora a *qualidade* do SOC; se não vier, a leitura fica como hoje e a atuação fica muito melhor que hoje.

---

## 3. Hardware

### 3.1 Já comprado

**MikroTik hAP ax lite (L41G-2axD)** — 4 portas Gigabit, Wi-Fi 6 só 2,4 GHz, RouterOS 7 (WireGuard nativo), alimentação USB-C 5 V ou PoE-in na ether1. **Sem PoE-out**: cada equipamento precisa de alimentação própria. Com 1 porta WAN sobram 3 LAN — SmartLogger + Waveshare + Pi ocupam as três; o Shelly 3EM (LAN) ou qualquer quinto cabo exige um **switch Gigabit de 5 portas** (~R$ 80). O Wi-Fi 2,4 GHz serve só para o curativo Tasmota (§7).

**Raspberry Pi 3 Model B** (2×) — **1 na Barragem (cérebro), 1 no Piscinão.** Decisão do operador (01/10): o Pi é o primário na planta e a VPS é a reserva viva; isso torna o ponto fraco do Pi (cartão SD + cortes abruptos de energia) tolerável — se ele morrer, a VPS assume e o Waveshare abre o relé no pior caso. Mesmo assim: **boot por SSD USB** (~R$ 150) nos dois, watchdog de hardware (`/dev/watchdog`) ativado. O N100 saiu da lista.

### 3.2 A comprar — Barragem (planta crítica) — revisado 01/10

| Função | Escolha | Ref. |
|---|---|---|
| **Atuação + retorno do contator** | **Waveshare Modbus POE ETH Relay (B)** — 8 relés, 8 DI, Modbus TCP, DIN. Título do anúncio confirmado: *"Módulo de Relé Ethernet de 8 Canais (B) com Entrada Digital, Modbus RTU/TCP, PoE, Trilho"*. Variante **com fonte** (ou alimentar 12/24 V do nobreak); **2 unidades** (1 reserva) | R$ 250–300 cada |
| **Cérebro** | Pi 3B (comprado) + **SSD USB** | R$ 150 |
| **Estação solarimétrica** | adaptador USB-RS485 no Pi (ou porta EMI do SmartLogger se compatível) | R$ 30 |
| Switch Gigabit 5 portas | só se passar de 3 cabos na LAN | R$ 80 |
| *(opcional)* Medição da bomba | Shelly Pro 3EM + 3 TCs (trifásico, LAN) — o POWR316D da §7.15 está descartado: monofásico | R$ 700–1.000 |

Alternativas que perderam para o Waveshare nesta arquitetura (todas válidas, mais caras): **KinCony KC868-A8v3** (US$ 80, ESP32 + RS485 + regra em ESPHome), **ADAM-6266** (~R$ 1.700, watchdog de posição segura em hardware), **Siemens LOGO! 8.3** (~R$ 1.500, lógica embarcada — a opção "sem Linux", se um dia o Pi provar insuficiente).

### 3.3 A comprar — Piscinão (sem bomba automatizada ainda)

| Função | Recomendação | Ref. |
|---|---|---|
| Concentrador de I/O | **KinCony KC868-A8v3** — exigir no anúncio **"A8v3"**, **"W5500"** e **"RS485"**. Ethernet, 8 relés 250 V/10 A COM/NO/NC, 8 DI, RS485, 12/24 V, DIN, ESPHome. **Não** é o A6 (só Wi-Fi) nem o A8 antigo (LAN8720, 2 DI, RF 433, sem RS485) | US$ 80 |
| Cérebro | Pi 3B (comprado) + SSD USB | R$ 150 |
| Sensor analógico, se houver | Waveshare Modbus RTU Analog Input 8CH no RS485 do A8v3 | R$ 150 |

Alternativa mais barata e idêntica à Barragem: Waveshare (B) + USB-RS485 no Pi. O A8v3 só compensa se a estação do Piscinão precisar de entradas analógicas no concentrador.

### 3.4 Descartados, e por quê

| | Motivo |
|---|---|
| Qualquer coisa **Wi-Fi** na cadeia de comando (Sonoff, POWR316D, Waveshare ESP32-S3, KC868-A6) | causa raiz dos dois incidentes |
| ~~Waveshare Modbus POE ETH Relay (B)~~ **reabilitado 01/10** | Eu tinha descartado por "sem estado seguro". **Errado:** o comando *Flash ON* (coil `0x0200+ch`, duração `N × 100 ms`, máx. `0x7FFF` ≈ 54 min — verificado na wiki Waveshare) é um **dead-man switch**: o Pi manda "ligado por 5 min" a cada 60 s; se Pi e VPS sumirem, o relé abre sozinho em ≤ 5 min. Terceira camada **sem firmware**. Vira a opção mais barata viável (~R$ 250–300). Exigir a versão **(B)** (8 DI para o retorno do contator). Alimentar por 7–36 V do nobreak — o hAP ax lite não tem PoE-out. Sem RS485/AI: estação via USB-RS485 no Pi. **Confirmado na wiki da versão (B) em 02/10:** contatos **1NO+1NC, ≤10 A 250 V AC / 30 V DC**; **8 DI 5–36 V**, NPN/PNP, optoacoplador bidirecional, lidas por função `02` em `0x0000–0x0007`; Flash ON `0x0200–0x0207` e Flash OFF `0x0400–0x0407`; modos de entrada Normal (padrão) / Linkage / Toggle / Edge em `0x1000–0x1007` — **manter Normal**; Modbus TCP porta 502, unit id `0x01`, IP de fábrica `192.168.1.254`, **modo Modbus TCP precisa ser ativado pelo software Vircom (Windows)**; PoE 802.3af ou 7–36 V, 0,5–3,8 W. **Não documentado:** conexões TCP simultâneas e estado dos relés ao energizar — testar em bancada. |
| KC868-A16v3 | saída MOSFET (DC), não relé — não aciona bobina 220 V direto |
| Relé no GPIO do Pi | sem isolamento; Pi vira ponto único de falha da bomba |
| ADAM-6266 / Moxa / PiXtend / Revolution Pi / LOGO! | mais robustos, mais caros; voltam se o Waveshare ou o Pi falharem em campo |

### 3.5 Waveshare (B) — notas de integração (do manual PT-BR, 02/10)

Fonte: `gdrive:TI/CLAUDE SERVIDOR/waveshare manual/manual_modbus_poe_eth_relay_b_ptbr.{md,pdf}` (compilado da wiki e da ficha oficiais, SKU 27876).

- **De fábrica ele NÃO fala Modbus TCP**: fala Modbus **RTU encapsulado em TCP** (`Transfer Protocol = None`, com CRC, porta própria — o exemplo oficial usa 4196). Para Modbus TCP na **502** é preciso selecionar `Modbus TCP protocol` no VirCom. Qualquer um dos dois serve ao Pi; escolher um e não misturar (cliente Modbus TCP na porta RTU não responde).
- **`Modbus Gateway Type = Multi-host non-storage`** é obrigatório nos dois casos. É a configuração de **múltiplos clientes** — indício forte de que Pi + VPS simultâneos funcionam; o tipo "com armazenamento" faz sondagens que o relé não responde. Segue como teste de bancada.
- **IP:** não presumir. `192.168.1.254` é só o valor pós-reset; achar pelo `Auto Search` do VirCom ou pelo lease DHCP no MikroTik. Depois de conhecido o IP, há **interface web** de configuração (senha vazia ou `123456` conforme o lote — **definir senha**).
- **Flash ON é FC05 com valor não booleano** (`0x0200+canal`, valor = N × 100 ms; 300 s = `0x0BB8`). Bibliotecas Modbus genéricas só enviam `FF00`/`0000` no FC05 e **rejeitam** isso — o driver precisa montar o quadro na mão (12 bytes em Modbus TCP: MBAP + `01 05 02 00 0B B8`).
- **Eco não prova comutação.** Em modo Linkage o relé ecoa a escrita e não comuta. Sempre confirmar por FC01 (estado da bobina) **e** pela entrada digital do contato auxiliar — é o alarme `DIVERGENCIA_RETORNO`. Na partida, ler `0x1000–0x1007` e exigir modo `0` (Normal) nos canais usados; ler `0x8000` e exigir protocolo V2 (`0x00C8`).
- **Contato auxiliar do contator = entrada de contato seco:** ligar entre `DIx` e `DGND`, deixando o borne `COM` **das entradas** sem ligação. Esse COM não é o comum do relé.
- **Bobina de contator é carga indutiva:** ao abrir o relé, o campo da bobina devolve um pico de tensão que fagulha nos contatos (desgaste) e gera ruído que pode travar eletrônica próxima. Prever **supressor** em paralelo com a bobina (módulo RC ou varistor de encaixe do fabricante do contator, R$ 10–30). Recomendado, não obrigatório. Fusível/disjuntor no circuito de comando; interromper a fase pelo par COM–NO.
- **Rede:** web admin e portas de controle sem criptografia. No MikroTik, liberar o relé só para o IP do Pi e para o IP da VPS no túnel; nada exposto à internet.
- Físico: 175 × 90 × 40 mm, trilho DIN, −15 a 70 °C, 0,5–3,8 W. Estado dos relés ao energizar segue **não documentado** (teste de bancada).

### 3.6 Cadeia de acionamento real e opção futura (informado pelo operador, 02/10)

O contator **não aciona as bombas diretamente**: ele alimenta os **inversores de frequência** de cada bomba. A cadeia é `relé → bobina do contator → inversores → bombas`. Hoje ligar/desligar a bomba significa **energizar/desenergizar os inversores**, que partem sozinhos ao receber energia (por isso a bomba voltou a rodar no instante do Black Start em 18/09).

Para 1–2 manobras por dia isso é aceitável; o que os fabricantes de inversor desaconselham é ciclar a alimentação várias vezes por hora (estresse do circuito de pré-carga). Consequência para o software: **o cooldown entre manobras continua obrigatório**, inclusive depois de uma abertura pelo dead-man — nunca refechar o relé em seguida.

| | Cortar a alimentação do inversor (hoje) | Comandar pela entrada digital do inversor |
|---|---|---|
| Partida/parada | secas | em rampa, suave para a tubulação |
| Consumo noturno | zero (inversor desligado) | inversor em espera |
| Supressor | recomendado | desnecessário (sinal de baixa corrente) |
| Bombas | as duas juntas | 1 relé por inversor: dá para ligar só uma |
| Mudança no quadro | nenhuma | refazer o comando dos inversores |

**Decisão para a instalação inicial:** manter como está — só trocar o dispositivo Wi-Fi pelo Waveshare, com supressor na bobina. A segunda coluna fica registrada como melhoria futura (escalonar bombas com SOC baixo); o Waveshare tem relés sobrando para isso.

---

## 4. Software

### 4.1 Lógica (no Pi — o mesmo `control-engine` da VPS)

O Pi roda **o mesmo código** que a VPS (`server/control-engine.ts`), não uma reimplementação. É isso que torna o failover seguro: os dois decidem exatamente igual. `DECISION-RESPECT-CONFIG.md` vale sem alteração:

```
BLACKOUT : SOC ≤ socBlackout               → abre relé (sempre)
TURN_OFF : bomba ON  ∧ SOC ≤ socMinDesliga → abre relé
TURN_ON  : bomba OFF ∧ SOC ≥ socMinReliga ∧ janela horária ∧ SOC REAL → fecha relé
cooldown : respeitado
SOC inválido / fonte muda > N min          → abre relé (estado seguro)
```

Atuação = escrever no Waveshare **"Flash ON, 300 s"** (coil `0x0200`, valor 3000) a cada 60 s enquanto a decisão for ON; para desligar, escrever OFF. Heartbeat para a VPS a cada 60 s (MQTT pelo túnel).

### 4.2 Dashboard (VPS)

- **Driver Modbus TCP** único (`server/modbus.ts`, `modbus-serial`) para SmartLogger e Waveshare.
- `control-engine` ganha modo **STANDBY**: enquanto o heartbeat do Pi chega, só registra (eventos, ações do Pi, o que *faria*). Sem heartbeat por 5 min → assume: passa a escrever no Waveshare pelo túnel, com o mesmo Flash ON. Heartbeat volta → devolve e registra `FAILOVER_RETURN`.
- `pollSite`: fonte preferencial Modbus (pelo Pi ou direto via túnel), **fallback FusionSolar**. A FusionSolar não sai.
- Comando manual da UI → vai ao Pi; se o Pi estiver mudo, direto ao Waveshare.
- Alarmes novos: `PI_OFFLINE` (heartbeat parado), `FAILOVER_ATIVO`, `RELE_OFFLINE`, `MODBUS_SMARTLOGGER_OFFLINE`, `DIVERGENCIA_RETORNO` (relé fechou, contato auxiliar não confirmou).
- `mqtt-tasmota.ts` fica intocado até o curativo (§7) sair de cena.

### 4.3 Pi

Serviço Node (mesmo repo, `USE_LOCAL_CONTROL=true`): lê SmartLogger (Modbus TCP) e estação (RS485), decide, atua no Waveshare, publica telemetria e heartbeat para a VPS. `/dev/watchdog` ativado; estado seguro na partida (abre o relé antes de ler SOC válido). Filesystem em SSD USB.

### 4.4 Teste de bancada obrigatório antes da visita

0. Waveshare: achar pelo `Auto Search` do **VirCom** (Windows); IP fixo na LAN da planta; `Transfer Protocol = Modbus TCP protocol` (porta 502) e **`Multi-host non-storage`**; definir senha da web; ler `0x8000` (V2) e `0x1000–0x1007` (modo Normal nos 8 canais). Tudo **sem carga ligada**.
1. Waveshare: ligar/desligar por Modbus TCP; **Flash ON 300 s expira sozinho** (cronometrar); **estado dos relés ao energizar** (tem que ser aberto); dois clientes TCP simultâneos (Pi + VPS). **Se só aceitar 1 conexão:** o Pi abre e fecha o socket a cada escrita (60 s) em vez de mantê-lo aberto, e a VPS em STANDBY não conecta — assim o socket está livre quando ela precisar assumir.
1b. Entrada digital com contato seco entre `DI1` e `DGND` (COM das entradas solto): ler por função 02. Enviar Flash ON com quadro montado à mão (`01 05 02 00 0B B8`) e confirmar por FC01 + DI.
2. Pi: matar o processo com o relé armado → relé abre em ≤ 5 min; religar → re-arma.
3. Failover: cortar o heartbeat → VPS assume em 5 min; devolver → VPS para de atuar.
4. Divergência: fechar relé sem contato auxiliar → alarme.

---

## 5. Fases e critérios de saída (modo sombra, §14)

| Fase | O que entra | Sai quando |
|---|---|---|
| **0 — Pré-requisitos** | Telegram configurado; curativo Tasmota instalado | alarme chega no celular; bomba volta a ter proteção de SOC |
| **A — Rede e leitura** | MikroTik + WireGuard; Modbus TCP habilitado no SmartLogger; Pi lendo | 14 dias com SOC Modbus vs FusionSolar divergindo < 2 pp; túnel sem queda > 5 min |
| **B — Pi em sombra** | Pi + Waveshare instalados, **relé não ligado ao contator**; Pi loga o que faria; VPS segue mandando no Tasmota | 14 dias em que decisão do Pi == decisão da VPS em 100 % dos eventos de borda |
| **C — Pi assume** | relé do Waveshare no contator; VPS em STANDBY; curativo Tasmota removido | 30 dias sem divergência de retorno, 1 failover simulado com sucesso |
| **D — Piscinão** | repete A→C com o 2º Pi + Waveshare | idem |

Cada fase: 1 mudança, validada, antes da próxima. Reversão de C = religar o Tasmota no contator e tirar a VPS de STANDBY — 30 min, sem código.

---

## 6. Roteiro da visita técnica (Barragem)

1. **Antes de ir:** configurar MikroTik em bancada (WireGuard peer no gamaserver, DHCP, firewall via WG — usar `helios_mk_template_hardening`); rodar o teste de bancada da §4.4 (Waveshare + Pi + failover).
2. **Energia:** 12/24 V DC a partir do nobreak para Waveshare e Pi; MikroTik por USB-C. Nada no circuito do inversor.
3. **Rede:** Starlink → MikroTik WAN; SmartLogger, Waveshare, Pi nas 3 LAN.
4. **SmartLogger:** ver Apêndice A.5 (MGCC primeiro; depois Modbus TCP com whitelist do Pi); rodar a sonda e seguir o roteiro de validação de `docs/huawei/SMARTLOGGER-MODBUS.md` §10.
5. **Quadro da bomba:** instalar **chave seccionadora/manual** acessível (lição de 17/09); relé 1 do Waveshare → bobina do contator que alimenta os inversores, **com supressor na bobina**; contato auxiliar → entrada 1 do Waveshare. Anotar marca/modelo dos inversores e como está o comando de partida (§3.6).
6. **Validação no local:** ligar/desligar pela UI, confirmar retorno; cortar internet e confirmar que o Pi segue lendo SOC e atuando; parar o Pi e cronometrar o relé abrir.
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
- [ ] Trocar o Waveshare por KC868-A8v3 / ADAM-6266 / LOGO! (mais caro; ver §3.2)
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

### A.4 Lacuna fechada em 2026-10-03

O operador obteve o **"SmartLogger V300R024C00SPC100 ModBus Interface Definitions", Issue 47 (2024-09-19)**, e a Issue 43. Li a Issue 47 inteira; o resumo de trabalho está em `docs/huawei/SMARTLOGGER-MODBUS.md` e o mapa, tipado, em `server/smartlogger-map.ts`.

Registradores do controle, todos no Unit ID 0: SOC `40515` (U16, ÷10, resolução 0,1 %), potência do ESS `40392` e `40507` (I32, ÷1000 kW), geração `40388`, potência total `40525` (a carga, em planta ilhada), capacidade ainda descarregável `40482`, SOC de fim de descarga `40217`, PCS em operação `40207`.

Pronto e testado contra um SmartLogger simulado (57 testes): cliente Modbus TCP **só de leitura** (`server/modbus-tcp.ts`), leitura em blocos com queda para registrador individual, decodificação de alarmes, descoberta de Unit IDs e calibração automática do sinal da potência. **Nada disso está ligado ao servidor em produção**; entra na Fase A, com autorização do operador.

Diferença de versão: o documento é da `V300R024C00SPC100`; o instalado é `V300R024C10SPC211`. A validação é o roteiro da sonda.

**O que continua faltando**, sem bloquear o controle: o mapa interno da bateria ("LUNA2000B ESS Modbus Port Definitions" para `V200R024C00SPC410`), para temperatura por rack e alarmes do BMS.

### A.5 O que isso muda no roteiro da visita (§6, passo 4)

4. **SmartLogger:** (a) ler `Settings > Microgrid > MGCC Mode` e **anotar**; (b) se Disable, habilitar `Settings > Comm. Param. > Modbus TCP` com `Enable(Limited)` + IP do Pi na whitelist + `Logical address`; (c) ler o endereço lógico do ESS em `Monitoring`; (d) testar do Pi: ler SOC e comparar com o WebUI; (e) **não** mexer em MGCC sem decisão registrada — liga auto black start e derruba o Modbus.

### A.6 O que a Issue 47 acrescenta ao plano

1. **Black start comandado por terceiros.** O mapa tem `44360` (black start), `44361` (estado) e `44362` (black start em um clique, Issue 45). Isso suaviza a escolha do A.3: com o MGCC desligado perde-se o black start *automático*, mas pode existir o black start *remoto, disparado pelo operador*. Não validado no LUNA2000-215-2S10, é uma escrita e energiza a planta com a bomba partindo junto. Fica como item de investigação na visita, só lendo `44361` e os alarmes 1140/1147 antes e depois de um black start pelo botão físico.
2. **Armadilha a conferir na visita:** `41947` (desligar o array ao perder a comunicação com o mestre). Se estiver ligado, uma queda do Pi apaga a planta. Tem que estar em `0`.
3. **Causa do Auto Black Start nunca ter funcionado** (CLAUDE.md §7.6): os alarmes `1140/4` "o ESS não suporta black start" e `1147` "SOC abaixo do mínimo" dão a resposta por leitura.
4. **Estação solarimétrica pelo próprio SmartLogger:** ligada à porta COM dele, os dados saem pelo mesmo Modbus (`40031`–`40046`). Dispensa o adaptador USB-RS485 no Pi.
5. **Unit IDs sem depender da WebUI:** a sonda varre os registradores públicos (`65534`, `65510`) e casa pelo número de série.
6. **Sinal:** Huawei usa positivo = descarga; o banco do dashboard usa positivo = carga. Calibrar com `--watch` antes de gravar.

