# SmartLogger3000 por Modbus TCP — referência de trabalho

> **Fonte:** Huawei, *SmartLogger V300R024C00SPC100 ModBus Interface Definitions*, **Issue 47 (2024-09-19)**, 98 páginas. Lida na íntegra em 2026-10-03.
> **Também lida:** Issue 43 (2023-10-21) e a nota "Obter o Unit ID do BESS na WebUI".
> **Originais:** `gdrive:TI/CLAUDE SERVIDOR/arquivos bess` (no Windows: `G:\Meu Drive\TI\CLAUDE SERVIDOR\arquivos bess`). Os PDFs não são versionados aqui.
> **Código:** `server/smartlogger-map.ts` (mapa), `server/modbus-tcp.ts` (cliente só de leitura), `server/smartlogger.ts` (leitura e decodificação), `server/tools/smartlogger-probe.ts` (sonda de campo), `server/smartlogger.test.ts` (57 testes).
> **Plano onde isto se encaixa:** `DECISION-CAMINHO-2.md`, Fase A.

---

## 1. Veredito

**É o documento que faltava.** Ele dá, pelo cabo e sem cota, tudo o que o controle da bomba precisa e bastante coisa que a FusionSolar nunca entregou. A Issue 47 só acrescenta registradores em relação à 43; use a 47.

| Pergunta | Resposta |
|---|---|
| Tem o SOC? | Sim: `40515`, resolução de **0,1 %** (a FusionSolar entrega inteiro) |
| Tem a potência da bateria? | Sim, em dois registradores: `40392` e `40507` |
| Tem geração e carga? | Geração: `40388`. Carga não existe como registrador; em planta ilhada é FV + saída do ESS, e o `40525` dá a soma pronta |
| Dá para descobrir os Unit IDs sem a WebUI? | Sim, por varredura dos registradores públicos `65534`/`65510` e pela função `0x2B` |
| Tem alarmes? | Sim, os do SmartLogger, em `50000`–`50007`, com causa |
| Serve para o firmware instalado? | O documento é da `V300R024C00SPC100`; o instalado é `V300R024C10SPC211`, mais novo. O histórico só acrescenta registradores, então a expectativa é compatibilidade. **Confirmar na planta com a sonda.** |

O que **não** está nele: o mapa interno da bateria (temperatura por rack, tensão de célula, alarmes do BMS) e o mapa de cada inversor. Ver §9.

---

## 2. Como conectar

- **Habilitar no SmartLogger:** `Settings > Comm. Param. > Modbus TCP`. `Link setting` = **Enable(Limited)** com o IP do cliente na lista (até 5 clientes). `Address mode` = **Logical address**. Vem desligado de fábrica.
- **Porta 502.** Sem autenticação e sem criptografia: só dentro da LAN da planta ou do túnel WireGuard, nunca exposto.
- **`MGCC Mode` precisa estar em Disable.** Com MGCC ligado o SmartLogger desliga o Modbus TCP (ver `DECISION-CAMINHO-2.md`, Apêndice A.3).
- **Unit ID 0** é o próprio SmartLogger. **1–247** são os dispositivos, pelo endereço lógico que aparece na WebUI.
- **Endereço** é o decimal literal do documento. SOC é `40515`, que vai no quadro como `0x9E43`. Não subtrair 1 nem 40001.
- **Funções:** `0x03` (ler), `0x06` e `0x10` (escrever), `0x2B` (identificação). Este repositório só usa `0x03` e `0x2B`.
- **Limites:** até 125 registradores por leitura, quadro de até 256 bytes, **timeout de 5 s**. Dados em big-endian, palavra alta primeiro.
- **Tipos de acesso:** RO só aceita leitura. WO não aceita leitura. RW aceita as duas.

---

## 3. Registradores essenciais (Unit ID 0)

| Endereço | Qtde | Tipo | Ganho | Unidade | O que é |
|---:|:---:|:---:|---:|:---:|---|
| **40515** | 1 | U16 | 10 | % | **SOC** agregado da planta |
| **40392** | 2 | I32 | 1000 | kW | **Potência ativa do ESS** (saída real) |
| **40507** | 2 | I32 | 1000 | kW | **Potência de carga/descarga da bateria** (novo na Issue 47) |
| **40388** | 2 | U32 | 1000 | kW | **Potência fotovoltaica** (saída real) |
| **40525** | 2 | I32 | 1000 | kW | Potência ativa total de inversores + PCS (a **carga**, em planta ilhada) |
| 40482 | 2 | U32 | 1000 | kWh | Capacidade **ainda descarregável** (autonomia em kWh) |
| 40480 | 2 | U32 | 1000 | kWh | Capacidade ainda carregável |
| 40217 | 1 | U16 | 10 | % | **SOC de fim de descarga** configurado no ESS (onde o BMS corta) |
| 40218 | 1 | U16 | 10 | % | SOC de fim de carga |
| 40492 | 2 | U32 | 1000 | kW | Potência máxima de descarga em tempo real |
| 40490 | 2 | U32 | 1000 | kW | Potência máxima de carga em tempo real |
| 40516 / 40517 | 1 | U16 | 10 | % | SOH / SOE |
| 40468 / 40470 | 2 | U32 | 100 | kWh | Energia carregada / descarregada **hoje** |
| 40472 / 40476 | 4 | I64 | 100 | kWh | Energia total carregada / descarregada |
| 40207 | 1 | U16 | 1 | — | Quantidade de **PCS do ESS em operação** |
| 40539 / 40540 | 1 | U16 | — | — | Algum PCS em operação / todos os PCS parados (`0` = inválido, `1` = sim) |
| 44365 | 1 | U16 | — | — | Modo do PCS: `0` PQ, `1` VSG (off-grid exige VSG) |
| 44361 | 1 | U16 | — | — | **Estado do black start**: 0 não iniciado … 4 tensão estabelecida, 5 falhou |
| 40575–40577 | 1 | U16 | 10 | V | Tensões de linha A-B, B-C, C-A |
| 40572–40574 | 1 | I16 | 1 | A | Correntes das fases |
| 40568 | 2 | U32 | 1 | — | Nº de sequência de alarme ativo (muda quando entra ou sai alarme) |
| 40700 | 1 | U16 | — | bits | Estado das entradas DI1–DI8 **do próprio SmartLogger** |
| 40713 | 10 | STR | — | — | Número de série do SmartLogger |
| 40000 | 2 | U32 | 1 | s | Relógio do SmartLogger (epoch UTC) |

O mapa completo, com 65 registradores de planta, está em `server/smartlogger-map.ts`.

### O que isso entrega que hoje não existe

- **SOC a cada poucos segundos, sem cota**, com uma casa decimal. Acaba o rate limit e o ruído de 1 ponto inteiro.
- **Autonomia em kWh** (`40482`) em vez de só porcentagem.
- **O ponto em que o BMS corta** (`40217`). Hoje esse limite é inferido; aqui é lido.
- **Potência de descarga disponível** (`40492`): se cair abaixo da bomba, a planta não sustenta a carga.
- **Tensão do barramento CA**: zero é planta apagada; queda antes do colapso é sinal precoce.
- **Estado do black start com causa de falha** (alarmes 1140 e 1147). Responde à pendência antiga do Auto Black Start: se o motivo for "o ESS não suporta black start", o bit `50005/3` diz.

---

## 4. Sinal da potência: carga ou descarga

**Convenção Huawei: positivo = saída = descarga; negativo = carga.** O banco do dashboard usa o contrário (positivo = carga), então o valor entra com o sinal trocado.

Evidências no próprio documento: o `40383` diz "a negative value indicates charging"; o `40412` chama de "maximum charge power (negative value)"; o `40392` é "actual active **output** power". Uma integração de terceiros testada em hardware real do LUNA2000-215-2S10, via SmartLogger, declara "positive = discharge".

O `40507` não tem polaridade definida no documento. **Não presumir: calibrar na planta.** A sonda faz isso sozinha no modo `--watch`: compara o sinal da potência com qual contador de energia do dia está avançando (`40468` carga, `40470` descarga). Repetir em um período de carga e em um de descarga.

---

## 5. Descobrir os dispositivos e seus Unit IDs

Registradores **públicos** (Tabela 2-6): o SmartLogger responde por eles em nome de qualquer dispositivo, no Unit ID do dispositivo.

| Endereço | Qtde | O que é |
|---:|:---:|---|
| 65534 | 1 | Conexão: `0xB001` online, `0xB000` desconectado |
| 65510 | 10 | Número de série do dispositivo (novo na Issue 47) |
| 65520 | 1 | Tipo de equipamento (código) |
| 65522 / 65523 | 1 | Porta / endereço físico |
| 65524 | 10 | Apelido |
| 65500 / 65502 | 2 | Nº de sequência de alarme ativo / histórico |

A sonda varre os Unit IDs e lista quem responde, com número de série. Isso dispensa procurar o endereço lógico na WebUI: basta casar o SN com o inventário. Há também a lista pela função `0x2B` (objeto `0x87` = quantidade, `0x88` em diante = modelo, versão, ESN), que pode não existir em todo firmware; a sonda tenta e segue adiante se falhar.

Inventário conhecido da Barragem, pela nota recebida: SmartLogger `V300R024C10SPC211`, ESS LUNA2000-215-2S10 `V200R024C00SPC410`, inversores SUN2000-75KTL-M1 `V500R023C00SPC165`. Os quatro ESM são subordinados ao ESS, não quatro Unit IDs. Há um inversor marcado como offline ou em reparo.

---

## 6. Alarmes do SmartLogger

Bitfields em `50000`–`50007`. A Tabela 2-1 lista até `50006`; a tabela de alarmes usa `50007`. Ler os oito e tolerar a ausência do último. O decodificador está em `decodeAlarmWords`.

Os que importam para planta off-grid com ESS:

| Registrador / bit | Alarme | Significado |
|---|---|---|
| 50005 / 0–7 | 1140 | **Black start falhou**, com a causa: 3 "nenhum ESS disponível", 4 "o ESS não suporta black start", 5 "o PCS não suporta", 6 e 8 falha na execução |
| 50006 / 4 | 1147 | **Black start do sistema falhou: SOC médio abaixo do mínimo** |
| 50006 / 5 | 1148 | **Array desligado: comunicação com PPC/NMS anormal** (ver §7) |
| 50005 / 8, 13, 14 | 1141 | Proteção desligou PCS e ESS (STS aberta, contato seco do compartimento, perda do BMS) |
| 50007 / 7 e 13 | 1154 | Comunicação anormal com a bateria / com o BMS |
| 50007 / 5 e 6 | 1154 | Comunicação anormal com inversor / com PCS |
| 50007 / 2 | 1164 | Falha na partida do compartimento de baterias |
| 50006 / 0 e 1 | 1144 | Falha ao abrir / fechar a chave de carga |
| 50006 / 9 | 1149 | Temperatura alta no gabinete de comunicação |
| 50001 / 3 | 1105 | Conflito de endereço entre o SmartLogger e um dispositivo |

Três bits têm **dois alarmes cada no documento** (`50002/6`, `50005/13`, `50005/14`). O decodificador devolve os dois e marca como ambíguo.

Estes são os alarmes do SmartLogger. Os alarmes internos da bateria ficam no mapa do ESS, que não temos (§9).

---

## 7. Armadilhas

**Desligamento por perda de comunicação (`41947`).** Se estiver em `1`, o SmartLogger **desliga a planta** quando o mestre Modbus para de consultar por `41948` segundos (60 a 1800) e gera o alarme 1148. Com o Pi consultando, uma queda do Pi apagaria a Barragem. Tem que estar em `0`. A sonda lê e avisa.

**MGCC.** Ligado, desliga o Modbus TCP. Não há registrador para ler o estado do MGCC; conferir na WebUI.

**Registradores de escrita.** O mesmo mapa tem comandos que desligam o ESS (`40198`), param tudo (`40201`), reiniciam o SmartLogger (`40723`, sem conferir o dado), **apagam um inversor do cadastro** (`40725`) e trocam o modo do PCS (`44365`). Estão listados em `WRITE_REGISTERS` com o motivo. O cliente deste repositório não implementa escrita.

**`0` não é "não".** Nos indicadores `40535`–`40540`, `0` significa inválido. Usar `40539` junto com `40540` e `40207`.

**Um registrador ausente derruba o bloco.** Ler um endereço que o firmware não tem devolve exceção `0x02` para a requisição inteira. O leitor agrupa só endereços contíguos e, se um bloco falhar, refaz um por um.

**SOC é agregado.** Com um ESS (Barragem) é o SOC dele. Com dois (Piscinão) é a média; o SOC individual está no mapa do ESS.

---

## 8. Black start remoto: existe no mapa, não está implementado

| Endereço | Acesso | O que é |
|---:|:---:|---|
| 44360 | RW | Black start do array: `1` preparar, `2` estabelecer tensão |
| 44361 | RO | Estado: 0 não iniciado, 1 preparando, 2 pronto, 3 estabelecendo tensão, 4 tensão estabelecida, 5 falhou |
| 44362 | RW | **Black start em um clique** (Issue 45, 2024): escrever `0` |

Isso muda o quadro do Apêndice A.3 do plano. O auto black start depende do MGCC, e o MGCC desliga o Modbus. Mas o mapa Modbus oferece um black start **comandado por terceiros**, que é justamente o caso com MGCC desligado. Em tese, a viagem de 18/09/2026 para apertar o botão poderia ter sido um comando remoto, desde que o SmartLogger estivesse alcançável (ele fica no nobreak).

**Não está validado e não será feito sem decisão do operador.** Pontos em aberto:

- É uma escrita, e energiza a planta. Os inversores de frequência das bombas partem sozinhos ao receber energia: a bomba liga junto.
- Não se sabe se o LUNA2000-215-2S10 aceita. Os alarmes `1140/4` e `1140/5` existem exatamente para "o ESS não suporta" e "o PCS não suporta".
- O manual de microrrede pede a chave de carga desligada antes do black start e SOC acima de 2 %.

Caminho proposto: na visita técnica, com o operador presente e a chave da bomba aberta, ler `44361` e os alarmes `50005`/`50006` antes e depois de um black start pelo botão físico. Isso mostra o que o equipamento reporta, sem escrever nada. Só depois decidir se vale testar o comando.

---

## 9. O que ainda falta

| Falta | Para quê | Onde conseguir |
|---|---|---|
| **LUNA2000B ESS Modbus Port Definitions** para `V200R024C00SPC410` (ou a `SPC401` com o histórico de mudanças) | Temperatura, tensão e corrente por rack, SOC individual por ESS, alarmes do BMS | Huawei Partners ou instalador. A edição pública de 2023 cobre só os modelos de 200 kWh |
| **Solar Inverter Modbus Interface Definitions V3.0** | Potência, estado e alarmes de cada inversor | Público; a nota recebida cita os registradores `32080`, `32089`, `32008`–`32010`, que não conferi na fonte |

Nenhum dos dois bloqueia o controle da bomba. São para diagnóstico fino.

Estação solarimétrica: se for ligada à porta COM do SmartLogger, os dados saem por este mesmo Modbus, no Unit ID da estação (`40031` vento, `40033` temperatura do módulo, `40034` ambiente, `40035` irradiância, `40043` irradiação diária em kWh/m²). Dispensa o adaptador USB-RS485 no Pi.

---

## 10. Sonda de campo

Somente leitura. Roda de qualquer máquina que alcance o SmartLogger.

```bash
# retrato completo, alarmes e dispositivos
pnpm tsx server/tools/smartlogger-probe.ts --host <ip>

# varrer mais Unit IDs
pnpm tsx server/tools/smartlogger-probe.ts --host <ip> --scan 1-40

# acompanhar e calibrar o sinal da potência (30 amostras a cada 10 s)
pnpm tsx server/tools/smartlogger-probe.ts --host <ip> --watch 10 --samples 30

# estação meteorológica no Unit ID 5
pnpm tsx server/tools/smartlogger-probe.ts --host <ip> --emi 5

# guardar o retrato
pnpm tsx server/tools/smartlogger-probe.ts --host <ip> --json > retrato.json
```

Para levar a um notebook sem o repositório, gerar um arquivo único de 63 kB, sem dependências:

```bash
npx esbuild server/tools/smartlogger-probe.ts --bundle --platform=node --format=esm --outfile=smartlogger-probe.mjs
node smartlogger-probe.mjs --host <ip>
```

### Roteiro de validação na planta

1. WebUI: anotar `MGCC Mode`. Se Disable, habilitar Modbus TCP em Enable(Limited) com o IP da máquina da sonda, Logical address.
2. Rodar a sonda. Conferir **SOC, potência do ESS e geração contra a tela da WebUI**, no mesmo instante.
3. Conferir que `41947` está em `0`.
4. Anotar quais registradores vieram como AUSENTE: é a diferença real entre a Issue 47 e o firmware instalado.
5. Casar os números de série da varredura com o inventário e anotar o Unit ID do ESS e de cada inversor.
6. Rodar `--watch` com a bomba ligada (descarga) e, em outro momento, com sol sobrando (carga). Anotar a convenção de sinal de `40392` e `40507`.
7. Guardar o `--json` de cada execução.

### Cadência sugerida para a Fase A

Não há cota documentada. Conjunto de controle (`CONTROL_KEYS`, 10 registradores, 8 requisições) a cada 10 s. Retrato completo e alarmes a cada 60 s, ou quando `40568` mudar.
