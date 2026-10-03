/**
 * Mapa de registradores Modbus do Huawei SmartLogger3000.
 *
 * Fonte: "SmartLogger V300R024C00SPC100 ModBus Interface Definitions",
 * Issue 47 (2024-09-19). PDFs em `gdrive:TI/CLAUDE SERVIDOR/arquivos bess`.
 * Resumo navegável em `docs/huawei/SMARTLOGGER-MODBUS.md`.
 *
 * ATENÇÃO À VERSÃO: o documento é da V300R024C00SPC100; os SmartLoggers
 * instalados rodam V300R024C10SPC211 (mais nova). O histórico do documento
 * (Issues 24→47) só ACRESCENTA registradores, então a expectativa é de
 * compatibilidade — mas cada endereço precisa ser confirmado na planta
 * (ver `server/tools/smartlogger-probe.ts`).
 *
 * Endereços são os decimais literais do documento (ex.: SOC = 40515), que é
 * o que vai no quadro: o exemplo oficial lê "32306/0x7E32" enviando 7E 32.
 * Não subtrair 40001 nem 1.
 *
 * Dados em big-endian; U32/I32/I64 com a palavra mais significativa primeiro.
 */

export type RegType = "U16" | "I16" | "U32" | "I32" | "U64" | "I64" | "STR";

export interface RegisterDef {
  /** Chave estável usada no código. */
  key: string;
  address: number;
  /** Número de registradores de 16 bits. */
  quantity: number;
  type: RegType;
  /** Divisor: valor físico = bruto / gain. */
  gain: number;
  unit: string;
  /** Descrição em português, para a sonda e a documentação. */
  label: string;
  /** Issue do documento em que o registrador aparece (se relevante). */
  sinceIssue?: number;
  /** Tabela de enumeração, quando o valor é um código. */
  enum?: Record<number, string>;
  note?: string;
}

/** No Modbus TCP do SmartLogger, o próprio logger responde no Unit ID 0 (§4.2.1). */
export const SMARTLOGGER_UNIT_ID = 0;
/** Dispositivos conectados (inversores, ESS, EMI, medidor) usam o endereço lógico 1–247. */
export const DEVICE_UNIT_ID_MIN = 1;
export const DEVICE_UNIT_ID_MAX = 247;

const FLAG_INVALID_OR_TRUE: Record<number, string> = { 0: "inválido/não", 1: "sim" };

/**
 * Registradores de nível de PLANTA (Unit ID 0) — Tabela 2-1 do documento.
 * Só os de leitura (RO) ou RW que é seguro LER. Nenhum é escrito por este código.
 */
export const PLANT_REGISTERS: RegisterDef[] = [
  // ── Essenciais para o controle da bomba ─────────────────────────────
  { key: "soc", address: 40515, quantity: 1, type: "U16", gain: 10, unit: "%", sinceIssue: 39,
    label: "SOC agregado da planta",
    note: "Resolução de 0,1 % (a FusionSolar entrega inteiro). Com um único ESS, é o SOC do ESS." },
  { key: "essActivePowerKw", address: 40392, quantity: 2, type: "I32", gain: 1000, unit: "kW", sinceIssue: 40,
    label: "Potência ativa do ESS (saída real)",
    note: "Convenção Huawei: positivo = saída = DESCARGA; negativo = carga. O banco do dashboard usa o inverso. Validar em campo." },
  { key: "batteryChargeDischargeKw", address: 40507, quantity: 2, type: "I32", gain: 1000, unit: "kW", sinceIssue: 47,
    label: "Potência de carga/descarga da bateria",
    note: "Novo na Issue 47. O documento não define a polaridade. Comparar com 40392; não somar os dois." },
  { key: "pvActivePowerKw", address: 40388, quantity: 2, type: "U32", gain: 1000, unit: "kW", sinceIssue: 40,
    label: "Potência ativa fotovoltaica (saída real)" },
  { key: "totalActivePowerKw", address: 40525, quantity: 2, type: "I32", gain: 1000, unit: "kW",
    label: "Potência ativa total de inversores + PCS",
    note: "Em planta ilhada (off-grid) equivale à carga atendida. Não há registrador de 'carga' no SmartLogger." },

  // ── Limites e capacidade do ESS ─────────────────────────────────────
  { key: "soh", address: 40516, quantity: 1, type: "U16", gain: 10, unit: "%", sinceIssue: 40, label: "SOH agregado" },
  { key: "soe", address: 40517, quantity: 1, type: "U16", gain: 10, unit: "%", sinceIssue: 40, label: "SOE agregado" },
  { key: "essEndOfDischargeSoc", address: 40217, quantity: 1, type: "U16", gain: 10, unit: "%", sinceIssue: 40,
    label: "SOC de fim de descarga do array",
    note: "Limite configurado no próprio ESS; abaixo dele o BMS corta. Útil para alertar antes da proteção." },
  { key: "essEndOfChargeSoc", address: 40218, quantity: 1, type: "U16", gain: 10, unit: "%", sinceIssue: 40,
    label: "SOC de fim de carga do array" },
  { key: "chargeableCapacityKwh", address: 40480, quantity: 2, type: "U32", gain: 1000, unit: "kWh", sinceIssue: 39,
    label: "Capacidade ainda carregável" },
  { key: "dischargeableCapacityKwh", address: 40482, quantity: 2, type: "U32", gain: 1000, unit: "kWh", sinceIssue: 39,
    label: "Capacidade ainda descarregável",
    note: "Energia utilizável em kWh — mede autonomia melhor que o SOC em %." },
  { key: "ratedEssCapacityKwh", address: 40484, quantity: 2, type: "U32", gain: 1000, unit: "kWh", sinceIssue: 39,
    label: "Capacidade nominal do ESS" },
  { key: "ratedEssCapacityAh", address: 40518, quantity: 2, type: "U32", gain: 10, unit: "Ah", sinceIssue: 40,
    label: "Capacidade nominal do ESS em Ah" },
  { key: "maxChargePowerKw", address: 40490, quantity: 2, type: "U32", gain: 1000, unit: "kW", sinceIssue: 39,
    label: "Potência máxima de carga em tempo real" },
  { key: "maxDischargePowerKw", address: 40492, quantity: 2, type: "U32", gain: 1000, unit: "kW", sinceIssue: 39,
    label: "Potência máxima de descarga em tempo real",
    note: "Cai quando o ESS limita por temperatura/SOC. Se ficar abaixo da potência da bomba, a planta não sustenta a carga." },
  { key: "stableChargePowerKw", address: 40494, quantity: 2, type: "U32", gain: 1000, unit: "kW", sinceIssue: 40,
    label: "Maior potência estável de carga" },
  { key: "stableDischargePowerKw", address: 40496, quantity: 2, type: "U32", gain: 1000, unit: "kW", sinceIssue: 40,
    label: "Maior potência estável de descarga" },
  { key: "ratedEssPowerKw", address: 40398, quantity: 2, type: "U32", gain: 1000, unit: "kW", sinceIssue: 40,
    label: "Potência nominal do ESS" },
  { key: "ratedPvPowerKw", address: 40396, quantity: 2, type: "U32", gain: 1000, unit: "kW", sinceIssue: 40,
    label: "Potência nominal fotovoltaica" },
  { key: "maxPvActivePowerKw", address: 40400, quantity: 2, type: "U32", gain: 1000, unit: "kW", sinceIssue: 40,
    label: "Potência fotovoltaica máxima disponível" },

  // ── Energia ─────────────────────────────────────────────────────────
  { key: "energyChargedTodayKwh", address: 40468, quantity: 2, type: "U32", gain: 100, unit: "kWh", sinceIssue: 40,
    label: "Energia carregada hoje" },
  { key: "energyDischargedTodayKwh", address: 40470, quantity: 2, type: "U32", gain: 100, unit: "kWh", sinceIssue: 40,
    label: "Energia descarregada hoje" },
  { key: "totalEnergyChargedKwh", address: 40472, quantity: 4, type: "I64", gain: 100, unit: "kWh", sinceIssue: 40,
    label: "Energia total carregada" },
  { key: "totalEnergyDischargedKwh", address: 40476, quantity: 4, type: "I64", gain: 100, unit: "kWh", sinceIssue: 40,
    label: "Energia total descarregada" },
  { key: "yieldTodayKwh", address: 40562, quantity: 2, type: "U32", gain: 10, unit: "kWh",
    label: "Geração de hoje (inversores/PCS)" },
  { key: "totalYieldKwh", address: 40560, quantity: 2, type: "U32", gain: 10, unit: "kWh",
    label: "Geração total (inversores/PCS)" },
  { key: "generationHoursToday", address: 40564, quantity: 2, type: "U32", gain: 10, unit: "h",
    label: "Horas de geração hoje" },

  // ── Estado de operação ──────────────────────────────────────────────
  { key: "runningPvInverters", address: 40206, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "Inversores FV em operação" },
  { key: "runningEssPcs", address: 40207, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "PCS do ESS em operação",
    note: "Zero com a planta desligada/em proteção. Sinal direto de que o ESS parou." },
  { key: "arrayInOperation", address: 40535, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "Array em operação", enum: FLAG_INVALID_OR_TRUE },
  { key: "arrayShutDown", address: 40536, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "Array totalmente parado", enum: FLAG_INVALID_OR_TRUE },
  { key: "pvInOperation", address: 40537, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "Algum inversor FV em operação", enum: FLAG_INVALID_OR_TRUE },
  { key: "pvShutDown", address: 40538, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "Todos os inversores FV parados", enum: FLAG_INVALID_OR_TRUE },
  { key: "essPcsInOperation", address: 40539, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "Algum PCS do ESS em operação", enum: FLAG_INVALID_OR_TRUE },
  { key: "essPcsShutDown", address: 40540, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "Todos os PCS do ESS parados (inclui standby e falha)", enum: FLAG_INVALID_OR_TRUE,
    note: "0 significa 'inválido', não 'o oposto'. Usar junto com 40539 e 40207." },
  { key: "blackStartStatus", address: 44361, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "Estado do black start do array",
    enum: {
      0: "não iniciado", 1: "preparando", 2: "pronto para black start",
      3: "estabelecendo tensão", 4: "tensão estabelecida", 5: "black start falhou",
    } },
  { key: "pcsWorkingMode", address: 44365, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "Modo de trabalho do PCS", enum: { 0: "PQ (segue a rede)", 1: "VSG (forma a rede)" },
    note: "Off-grid exige VSG." },
  { key: "workingMode", address: 42256, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 40,
    label: "Modo de controle do ESS",
    enum: {
      0: "sem controle", 2: "máximo autoconsumo", 4: "tudo para a rede", 5: "tarifa horária (TOU)",
      6: "carga/descarga por despacho da rede", 7: "TOU com potência fixa",
    },
    note: "RW no documento. Aqui só é LIDO." },
  { key: "activePowerControlMode", address: 40737, quantity: 1, type: "U16", gain: 1, unit: "",
    label: "Modo de controle de potência ativa",
    enum: {
      0: "sem restrição", 1: "despacho por DI", 3: "limite percentual (malha aberta)",
      4: "despacho por comunicação remota", 6: "conexão à rede com potência limitada (kW)",
      200: "controle remoto de saída", 65533: "SmartLogger escravo", 65534: "sem despacho",
    } },
  { key: "modbusFastScheduling", address: 45282, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 47,
    label: "Fast scheduling do Modbus TCP", enum: { 0: "desabilitado", 1: "habilitado" } },

  // ── Armadilha: desligamento do array por perda de comunicação ───────
  { key: "commTimeoutShutdownEnabled", address: 41947, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 35,
    label: "Desligar o array ao perder a comunicação com o mestre",
    enum: { 0: "desabilitado", 1: "habilitado" },
    note: "PERIGO se estiver 1: quando o nosso Pi parar de consultar, o SmartLogger desliga a planta (alarme 1148). Tem que ficar 0." },
  { key: "commTimeoutDetectionS", address: 41948, quantity: 1, type: "U16", gain: 1, unit: "s", sinceIssue: 35,
    label: "Tempo para detectar perda de comunicação (60–1800 s)" },
  { key: "commRecoveryStartupEnabled", address: 41949, quantity: 1, type: "U16", gain: 1, unit: "", sinceIssue: 35,
    label: "Religar o array quando a comunicação voltar", enum: { 0: "desabilitado", 1: "habilitado" } },

  // ── Elétrica no ponto de saída ──────────────────────────────────────
  { key: "pvReactivePowerKvar", address: 40390, quantity: 2, type: "I32", gain: 1000, unit: "kVar", sinceIssue: 40,
    label: "Potência reativa fotovoltaica" },
  { key: "essReactivePowerKvar", address: 40394, quantity: 2, type: "I32", gain: 1000, unit: "kVar", sinceIssue: 40,
    label: "Potência reativa do ESS" },
  { key: "totalReactivePowerKvar", address: 40544, quantity: 2, type: "I32", gain: 1000, unit: "kVar",
    label: "Potência reativa total" },
  { key: "powerFactor", address: 40532, quantity: 1, type: "I16", gain: 1000, unit: "",
    label: "Fator de potência" },
  { key: "currentA", address: 40572, quantity: 1, type: "I16", gain: 1, unit: "A", label: "Corrente fase A (soma inversores/PCS)" },
  { key: "currentB", address: 40573, quantity: 1, type: "I16", gain: 1, unit: "A", label: "Corrente fase B" },
  { key: "currentC", address: 40574, quantity: 1, type: "I16", gain: 1, unit: "A", label: "Corrente fase C" },
  { key: "voltageAB", address: 40575, quantity: 1, type: "U16", gain: 10, unit: "V", label: "Tensão de linha A-B",
    note: "Tensão do barramento CA. Zero = planta apagada. Queda antes do colapso é sinal precoce." },
  { key: "voltageBC", address: 40576, quantity: 1, type: "U16", gain: 10, unit: "V", label: "Tensão de linha B-C" },
  { key: "voltageCA", address: 40577, quantity: 1, type: "U16", gain: 10, unit: "V", label: "Tensão de linha C-A" },
  { key: "pvInputPowerKw", address: 40521, quantity: 2, type: "U32", gain: 1000, unit: "kW",
    label: "Potência CC de entrada dos inversores (só FV)" },
  { key: "pvDcCurrentA", address: 40554, quantity: 2, type: "I32", gain: 10, unit: "A",
    label: "Corrente CC total (faixa estendida)" },
  { key: "inverterEfficiency", address: 40685, quantity: 1, type: "U16", gain: 100, unit: "%",
    label: "Eficiência dos inversores" },

  // ── Identidade, relógio e entradas do próprio SmartLogger ───────────
  { key: "esn", address: 40713, quantity: 10, type: "STR", gain: 1, unit: "", label: "Número de série do SmartLogger" },
  { key: "utcEpoch", address: 40000, quantity: 2, type: "U32", gain: 1, unit: "s", label: "Data/hora (epoch UTC)",
    note: "RW no documento. Aqui só é LIDO — serve para medir desvio de relógio." },
  { key: "timeZoneOffsetS", address: 40005, quantity: 2, type: "I32", gain: 1, unit: "s", label: "Fuso horário (offset em s)" },
  { key: "localEpoch", address: 40009, quantity: 2, type: "U32", gain: 1, unit: "s", label: "Hora local (epoch)" },
  { key: "diGroupState", address: 40700, quantity: 1, type: "U16", gain: 1, unit: "bits",
    label: "Estado das entradas digitais DI1–DI8 do SmartLogger",
    note: "Bit 0 = DI1 … bit 7 = DI8; 1 = ligada. O SmartLogger tem DIs próprias — um contato seco ligado ali é legível por aqui." },
  { key: "lockingStatus", address: 40699, quantity: 1, type: "U16", gain: 1, unit: "",
    label: "Estado de bloqueio", enum: { 0: "bloqueado", 1: "desbloqueado" } },
  { key: "activeAlarmSeq", address: 40568, quantity: 2, type: "U32", gain: 1, unit: "",
    label: "Nº de sequência de alarme ativo",
    note: "Muda quando entra/sai alarme. Não é código de alarme — serve de gatilho para reler os bitfields 50000+." },
  { key: "historicalAlarmSeq", address: 40570, quantity: 2, type: "U32", gain: 1, unit: "",
    label: "Nº de sequência de alarme histórico" },
  { key: "statusInfo", address: 40578, quantity: 1, type: "U16", gain: 1, unit: "bits", sinceIssue: 40,
    label: "Informação de status (override de controle emergencial)" },
];

/** Bitfields de alarme do SmartLogger (Unit ID 0). A Tabela 2-1 lista 50000–50006; a tabela de alarmes usa até 50007. */
export const ALARM_REGISTER_FIRST = 50000;
export const ALARM_REGISTER_LAST = 50007;

export type AlarmSeverity = "Major" | "Minor" | "Warning" | "Adaptable";

export interface AlarmBitDef {
  register: number;
  bit: number;
  alarmId: number;
  subId: number;
  severity: AlarmSeverity;
  /** Nome/causa em português. */
  label: string;
  /** Relevante para planta off-grid com ESS (destacar na sonda e nos alertas). */
  relevant?: boolean;
}

/**
 * Tabela 2-2 do documento. Onde a fonte atribui DOIS alarmes ao mesmo bit
 * (50002/6, 50005/13, 50005/14), ambos são listados — o decodificador devolve
 * todos os candidatos e marca a ambiguidade em vez de escolher um.
 */
export const ALARM_BITS: AlarmBitDef[] = [
  { register: 50000, bit: 3, alarmId: 1100, subId: 4, severity: "Major", label: "Despacho ativo anormal: combinação de DIs não configurada" },
  { register: 50000, bit: 4, alarmId: 1100, subId: 5, severity: "Major", label: "Despacho ativo anormal: sem comandos do despacho remoto" },
  { register: 50000, bit: 11, alarmId: 1101, subId: 4, severity: "Major", label: "Despacho reativo anormal: combinação de DIs não configurada" },
  { register: 50000, bit: 12, alarmId: 1101, subId: 5, severity: "Major", label: "Despacho reativo anormal: sem comandos do despacho remoto" },

  { register: 50001, bit: 1, alarmId: 1103, subId: 1, severity: "Major", label: "Disjuntor geral CA no ponto de conexão aberto" },
  { register: 50001, bit: 2, alarmId: 1104, subId: 1, severity: "Major", label: "Cubículo anormal no ponto de conexão" },
  { register: 50001, bit: 3, alarmId: 1105, subId: 1, severity: "Major", label: "Conflito de endereço: o endereço do SmartLogger colide com o de um dispositivo", relevant: true },
  { register: 50001, bit: 4, alarmId: 1106, subId: 1, severity: "Major", label: "Falha do DPS CA da caixa de comunicação" },
  { register: 50001, bit: 5, alarmId: 1107, subId: 1, severity: "Adaptable", label: "Alarme personalizado da DI1" },
  { register: 50001, bit: 6, alarmId: 1108, subId: 1, severity: "Adaptable", label: "Alarme personalizado da DI2" },
  { register: 50001, bit: 7, alarmId: 1109, subId: 1, severity: "Adaptable", label: "Alarme personalizado da DI3" },
  { register: 50001, bit: 8, alarmId: 1110, subId: 1, severity: "Adaptable", label: "Alarme personalizado da DI4" },
  { register: 50001, bit: 9, alarmId: 1111, subId: 1, severity: "Adaptable", label: "Alarme personalizado da DI5" },
  { register: 50001, bit: 10, alarmId: 1112, subId: 1, severity: "Adaptable", label: "Alarme personalizado da DI6" },
  { register: 50001, bit: 11, alarmId: 1113, subId: 1, severity: "Adaptable", label: "Alarme personalizado da DI7" },
  { register: 50001, bit: 12, alarmId: 1114, subId: 1, severity: "Adaptable", label: "Alarme personalizado da DI8" },
  { register: 50001, bit: 13, alarmId: 1115, subId: 1, severity: "Major", label: "Falha da fonte 24 V da caixa de comunicação" },
  { register: 50001, bit: 14, alarmId: 1119, subId: 1, severity: "Warning", label: "Licença expirando" },

  { register: 50002, bit: 0, alarmId: 1116, subId: 1, severity: "Warning", label: "Certificado da WebUI ainda não válido" },
  { register: 50002, bit: 1, alarmId: 1117, subId: 1, severity: "Warning", label: "Certificado da WebUI perto de expirar" },
  { register: 50002, bit: 2, alarmId: 1118, subId: 1, severity: "Major", label: "Certificado da WebUI expirado" },
  { register: 50002, bit: 3, alarmId: 1120, subId: 1, severity: "Warning", label: "Certificado do sistema de gerenciamento ainda não válido" },
  { register: 50002, bit: 4, alarmId: 1121, subId: 1, severity: "Warning", label: "Certificado do sistema de gerenciamento perto de expirar" },
  { register: 50002, bit: 5, alarmId: 1122, subId: 1, severity: "Major", label: "Certificado do sistema de gerenciamento expirado", relevant: true },
  { register: 50002, bit: 6, alarmId: 1122, subId: 1, severity: "Major", label: "Certificado do sistema de gerenciamento expirado (1ª ocorrência na tabela)" },
  { register: 50002, bit: 6, alarmId: 1123, subId: 1, severity: "Warning", label: "Certificado de controle remoto ainda não válido" },
  { register: 50002, bit: 7, alarmId: 1124, subId: 1, severity: "Warning", label: "Certificado de controle remoto perto de expirar" },
  { register: 50002, bit: 8, alarmId: 1125, subId: 1, severity: "Major", label: "Certificado de controle remoto expirado" },
  { register: 50002, bit: 9, alarmId: 1126, subId: 1, severity: "Warning", label: "Certificado ESGCC ainda não válido" },
  { register: 50002, bit: 10, alarmId: 1127, subId: 1, severity: "Warning", label: "Certificado ESGCC perto de expirar" },
  { register: 50002, bit: 11, alarmId: 1128, subId: 1, severity: "Major", label: "Certificado ESGCC expirado" },
  { register: 50002, bit: 12, alarmId: 1129, subId: 1, severity: "Warning", label: "Certificado do SmartLogger ainda não válido" },
  { register: 50002, bit: 13, alarmId: 1130, subId: 1, severity: "Warning", label: "Certificado do SmartLogger perto de expirar" },
  { register: 50002, bit: 14, alarmId: 1131, subId: 1, severity: "Major", label: "Certificado do SmartLogger expirado" },
  { register: 50002, bit: 15, alarmId: 1132, subId: 1, severity: "Major", label: "Cabos do Smart Rack Controller fora do barramento CC", relevant: true },

  { register: 50003, bit: 0, alarmId: 1120, subId: 2, severity: "Warning", label: "Certificado de assinatura do gerenciamento 1 ainda não válido" },
  { register: 50003, bit: 1, alarmId: 1121, subId: 2, severity: "Warning", label: "Certificado de assinatura do gerenciamento 1 perto de expirar" },
  { register: 50003, bit: 2, alarmId: 1122, subId: 2, severity: "Major", label: "Certificado de assinatura do gerenciamento 1 expirado" },
  { register: 50003, bit: 3, alarmId: 1134, subId: 1, severity: "Major", label: "Cabos do Smart PCS fora do barramento CC", relevant: true },
  { register: 50003, bit: 5, alarmId: 1120, subId: 3, severity: "Warning", label: "Certificado de assinatura SPPC perto de expirar" },

  { register: 50004, bit: 0, alarmId: 1133, subId: 1, severity: "Major", label: "Rastreador fora do controle do algoritmo" },
  { register: 50004, bit: 1, alarmId: 1135, subId: 1, severity: "Major", label: "Capacidade de licença SDS insuficiente" },

  { register: 50005, bit: 0, alarmId: 1140, subId: 1, severity: "Minor", label: "Black start falhou: comando fora da sequência de tempo", relevant: true },
  { register: 50005, bit: 1, alarmId: 1140, subId: 2, severity: "Minor", label: "Black start falhou: estado do array não atende às condições", relevant: true },
  { register: 50005, bit: 2, alarmId: 1140, subId: 3, severity: "Minor", label: "Black start falhou: nenhum ESS disponível", relevant: true },
  { register: 50005, bit: 3, alarmId: 1140, subId: 4, severity: "Minor", label: "Black start falhou: o ESS não suporta black start", relevant: true },
  { register: 50005, bit: 4, alarmId: 1140, subId: 5, severity: "Minor", label: "Black start falhou: o PCS não suporta black start", relevant: true },
  { register: 50005, bit: 5, alarmId: 1140, subId: 6, severity: "Minor", label: "Black start falhou: falha no black start do ESS", relevant: true },
  { register: 50005, bit: 6, alarmId: 1140, subId: 7, severity: "Minor", label: "Black start falhou: nenhum PCS disponível", relevant: true },
  { register: 50005, bit: 7, alarmId: 1140, subId: 8, severity: "Minor", label: "Black start falhou: falha no black start do PCS", relevant: true },
  { register: 50005, bit: 8, alarmId: 1141, subId: 1, severity: "Major", label: "STS aberta: proteção desligou PCS e ESS", relevant: true },
  { register: 50005, bit: 9, alarmId: 1142, subId: 1, severity: "Major", label: "Falha ao abrir a chave do ponto de conexão (contato seco)" },
  { register: 50005, bit: 10, alarmId: 1142, subId: 2, severity: "Major", label: "Falha ao fechar a chave do ponto de conexão (contato seco)" },
  { register: 50005, bit: 11, alarmId: 1142, subId: 3, severity: "Major", label: "Falha ao abrir a chave via relé de proteção" },
  { register: 50005, bit: 12, alarmId: 1142, subId: 4, severity: "Major", label: "Falha ao fechar a chave via relé de proteção" },
  { register: 50005, bit: 13, alarmId: 1141, subId: 2, severity: "Major", label: "PCS desligado por contato seco do compartimento de baterias ou por bloqueio do BMS", relevant: true },
  { register: 50005, bit: 13, alarmId: 1142, subId: 5, severity: "Major", label: "Falha na verificação de sincronismo do relé de proteção de terceiros" },
  { register: 50005, bit: 14, alarmId: 1141, subId: 3, severity: "Major", label: "PCS desligado por perda de comunicação com o BMS", relevant: true },
  { register: 50005, bit: 14, alarmId: 1143, subId: 1, severity: "Major", label: "Isolação do sistema para a terra diminuiu" },
  { register: 50005, bit: 15, alarmId: 1145, subId: 1, severity: "Major", label: "Falha ao partir o gerador por contato seco" },

  { register: 50006, bit: 0, alarmId: 1144, subId: 1, severity: "Major", label: "Falha ao abrir a chave de carga", relevant: true },
  { register: 50006, bit: 1, alarmId: 1144, subId: 2, severity: "Major", label: "Falha ao fechar a chave de carga", relevant: true },
  { register: 50006, bit: 2, alarmId: 1146, subId: 1, severity: "Major", label: "Falha de sincronismo ao passar de off-grid para on-grid" },
  { register: 50006, bit: 3, alarmId: 1146, subId: 2, severity: "Major", label: "Falha de ajuste de potência ao passar de on-grid para off-grid" },
  { register: 50006, bit: 4, alarmId: 1147, subId: 1, severity: "Major", label: "Black start do sistema falhou: SOC médio abaixo do mínimo exigido", relevant: true },
  { register: 50006, bit: 5, alarmId: 1148, subId: 1, severity: "Major", label: "Array desligado por falha: comunicação com PPC/NMS anormal", relevant: true },
  { register: 50006, bit: 6, alarmId: 1145, subId: 2, severity: "Major", label: "Falha ao parar o gerador por contato seco" },
  { register: 50006, bit: 7, alarmId: 1150, subId: 1, severity: "Major", label: "Controle de potência anormal no ponto de conexão (limite de corrente)" },
  { register: 50006, bit: 8, alarmId: 1152, subId: 1, severity: "Major", label: "Controle do ESS anormal: modo configurado não suportado pelo ESS", relevant: true },
  { register: 50006, bit: 9, alarmId: 1149, subId: 1, severity: "Minor", label: "Temperatura alta no gabinete de comunicação (ventilador)", relevant: true },
  { register: 50006, bit: 10, alarmId: 1160, subId: 1, severity: "Warning", label: "Versão de software do módulo de expansão incompatível" },
  { register: 50006, bit: 11, alarmId: 1161, subId: 1, severity: "Major", label: "Teste de entrada do cluster de baterias falhou", relevant: true },
  { register: 50006, bit: 12, alarmId: 1162, subId: 1, severity: "Major", label: "Teste Fast IO do cluster de baterias falhou" },

  { register: 50007, bit: 0, alarmId: 1163, subId: 1, severity: "Major", label: "Topologia do array anormal: falha no teste de cabos do gabinete de baterias" },
  { register: 50007, bit: 1, alarmId: 1163, subId: 2, severity: "Major", label: "Topologia do array anormal: nº de PCS em paralelo no barramento CC incorreto" },
  { register: 50007, bit: 2, alarmId: 1164, subId: 1, severity: "Major", label: "Falha na partida do compartimento de baterias", relevant: true },
  { register: 50007, bit: 3, alarmId: 1165, subId: 1, severity: "Major", label: "Parâmetros VSG inconsistentes entre PCS" },
  { register: 50007, bit: 4, alarmId: 1165, subId: 2, severity: "Major", label: "Parâmetros GFM inconsistentes" },
  { register: 50007, bit: 5, alarmId: 1154, subId: 1, severity: "Major", label: "Comunicação anormal com inversor", relevant: true },
  { register: 50007, bit: 6, alarmId: 1154, subId: 2, severity: "Major", label: "Comunicação anormal com PCS", relevant: true },
  { register: 50007, bit: 7, alarmId: 1154, subId: 3, severity: "Major", label: "Comunicação anormal com a bateria", relevant: true },
  { register: 50007, bit: 8, alarmId: 1154, subId: 4, severity: "Major", label: "Comunicação anormal com módulo", relevant: true },
  { register: 50007, bit: 9, alarmId: 1154, subId: 5, severity: "Major", label: "Comunicação anormal com medidor" },
  { register: 50007, bit: 10, alarmId: 1154, subId: 6, severity: "Major", label: "Comunicação anormal com PID" },
  { register: 50007, bit: 11, alarmId: 1154, subId: 7, severity: "Major", label: "Comunicação anormal com STS" },
  { register: 50007, bit: 12, alarmId: 1154, subId: 8, severity: "Major", label: "Comunicação MBUS externa anormal" },
  { register: 50007, bit: 13, alarmId: 1154, subId: 9, severity: "Major", label: "Comunicação anormal com o BMS", relevant: true },
  { register: 50007, bit: 14, alarmId: 1166, subId: 1, severity: "Minor", label: "Equalização de SOC falhou" },
  { register: 50007, bit: 15, alarmId: 1167, subId: 1, severity: "Major", label: "Sequência de fases CA inconsistente no array" },
];

/**
 * Registradores PÚBLICOS (Tabela 2-6): o SmartLogger responde por eles em nome
 * de QUALQUER dispositivo conectado, no Unit ID do dispositivo. Servem para
 * descobrir quem está em cada endereço lógico sem depender da WebUI.
 */
export const DEVICE_PUBLIC_REGISTERS: RegisterDef[] = [
  { key: "connectionStatus", address: 65534, quantity: 1, type: "U16", gain: 1, unit: "",
    label: "Estado da conexão", enum: { 0xb000: "desconectado", 0xb001: "online" } },
  { key: "serialNumber", address: 65510, quantity: 10, type: "STR", gain: 1, unit: "", sinceIssue: 47,
    label: "Número de série do dispositivo" },
  { key: "equipmentType", address: 65520, quantity: 1, type: "U16", gain: 1, unit: "", label: "Tipo de equipamento (código)" },
  { key: "portNumber", address: 65522, quantity: 1, type: "U16", gain: 1, unit: "", label: "Porta" },
  { key: "physicalAddress", address: 65523, quantity: 1, type: "U16", gain: 1, unit: "", label: "Endereço físico (comunicação)" },
  { key: "alias", address: 65524, quantity: 10, type: "STR", gain: 1, unit: "", label: "Apelido do dispositivo" },
  { key: "activeAlarmSeq", address: 65500, quantity: 2, type: "U32", gain: 1, unit: "", label: "Nº de sequência de alarme ativo" },
  { key: "historicalAlarmSeq", address: 65502, quantity: 2, type: "U32", gain: 1, unit: "", label: "Nº de sequência de alarme histórico" },
];

export const DEVICE_CONNECTION_ONLINE = 0xb001;
export const DEVICE_CONNECTION_OFFLINE = 0xb000;

/**
 * Estação meteorológica / EMI (Tabela 2-4), no Unit ID = endereço RS485 do EMI.
 * Se a estação solarimétrica for ligada à porta COM do SmartLogger, os dados
 * saem por este mesmo Modbus TCP — sem hardware extra no Pi.
 */
export const EMI_REGISTERS: RegisterDef[] = [
  { key: "windSpeed", address: 40031, quantity: 1, type: "I16", gain: 10, unit: "m/s", label: "Velocidade do vento" },
  { key: "windDirection", address: 40032, quantity: 1, type: "I16", gain: 1, unit: "°", label: "Direção do vento" },
  { key: "moduleTemperature", address: 40033, quantity: 1, type: "I16", gain: 10, unit: "°C", label: "Temperatura do módulo FV" },
  { key: "ambientTemperature", address: 40034, quantity: 1, type: "I16", gain: 10, unit: "°C", label: "Temperatura ambiente" },
  { key: "irradiance", address: 40035, quantity: 1, type: "I16", gain: 10, unit: "W/m²", label: "Irradiância total" },
  { key: "dailyIrradiationMj", address: 40036, quantity: 2, type: "U32", gain: 1000, unit: "MJ/m²", label: "Irradiação diária" },
  { key: "irradiance2", address: 40038, quantity: 1, type: "I16", gain: 10, unit: "W/m²", label: "Irradiância total 2" },
  { key: "dailyIrradiation2Mj", address: 40039, quantity: 2, type: "U32", gain: 1000, unit: "MJ/m²", label: "Irradiação diária 2" },
  { key: "custom1", address: 40041, quantity: 1, type: "I16", gain: 10, unit: "", label: "Personalizado 1" },
  { key: "custom2", address: 40042, quantity: 1, type: "I16", gain: 10, unit: "", label: "Personalizado 2" },
  { key: "dailyIrradiationKwh", address: 40043, quantity: 2, type: "U32", gain: 1000, unit: "kWh/m²", label: "Irradiação diária (kWh/m²)" },
  { key: "dailyIrradiation2Kwh", address: 40045, quantity: 2, type: "U32", gain: 1000, unit: "kWh/m²", label: "Irradiação diária 2 (kWh/m²)" },
];

/** Medidor de energia (Tabela 2-5), no Unit ID = endereço RS485 do medidor. Positivo = exporta para a rede. */
export const METER_REGISTERS: RegisterDef[] = [
  { key: "voltageA", address: 32260, quantity: 2, type: "U32", gain: 100, unit: "V", label: "Tensão fase A" },
  { key: "voltageB", address: 32262, quantity: 2, type: "U32", gain: 100, unit: "V", label: "Tensão fase B" },
  { key: "voltageC", address: 32264, quantity: 2, type: "U32", gain: 100, unit: "V", label: "Tensão fase C" },
  { key: "currentA", address: 32272, quantity: 2, type: "I32", gain: 10, unit: "A", label: "Corrente fase A" },
  { key: "currentB", address: 32274, quantity: 2, type: "I32", gain: 10, unit: "A", label: "Corrente fase B" },
  { key: "currentC", address: 32276, quantity: 2, type: "I32", gain: 10, unit: "A", label: "Corrente fase C" },
  { key: "activePowerKw", address: 32278, quantity: 2, type: "I32", gain: 1000, unit: "kW", label: "Potência ativa" },
  { key: "reactivePowerKvar", address: 32280, quantity: 2, type: "I32", gain: 1000, unit: "kVar", label: "Potência reativa" },
  { key: "powerFactor", address: 32284, quantity: 1, type: "I16", gain: 1000, unit: "", label: "Fator de potência" },
  { key: "apparentPowerKva", address: 32287, quantity: 2, type: "I32", gain: 1000, unit: "kVA", label: "Potência aparente" },
  { key: "activePowerAKw", address: 32335, quantity: 2, type: "I32", gain: 1000, unit: "kW", label: "Potência ativa fase A" },
  { key: "activePowerBKw", address: 32337, quantity: 2, type: "I32", gain: 1000, unit: "kW", label: "Potência ativa fase B" },
  { key: "activePowerCKw", address: 32339, quantity: 2, type: "I32", gain: 1000, unit: "kW", label: "Potência ativa fase C" },
  { key: "totalActiveEnergyKwh", address: 32341, quantity: 4, type: "I64", gain: 100, unit: "kWh", label: "Energia ativa total" },
  { key: "negativeActiveEnergyKwh", address: 32349, quantity: 4, type: "I64", gain: 100, unit: "kWh", label: "Energia ativa negativa (importada)" },
  { key: "positiveActiveEnergyKwh", address: 32357, quantity: 4, type: "I64", gain: 100, unit: "kWh", label: "Energia ativa positiva (exportada)" },
];

export type WriteRisk = "desliga a planta" | "altera o controle" | "destrutivo" | "configuração";

export interface WriteRegisterDoc {
  address: number;
  name: string;
  risk: WriteRisk;
  why: string;
}

/**
 * Registradores de ESCRITA do SmartLogger — documentados aqui para que ninguém
 * os use por engano. NENHUM código deste repositório escreve neles; o cliente
 * Modbus (`modbus-tcp.ts`) nem implementa as funções de escrita.
 */
export const WRITE_REGISTERS: WriteRegisterDoc[] = [
  { address: 40196, name: "Desligar inversores FV", risk: "desliga a planta", why: "Escrever 0 para todos os inversores FV." },
  { address: 40197, name: "Ligar inversores FV", risk: "altera o controle", why: "Escrever 0 parte todos os inversores FV." },
  { address: 40198, name: "Desligar ESS", risk: "desliga a planta", why: "Equivale ao 'desligar BESS' do app: em off-grid leva à proteção e a black start presencial (incidente de 17-18/09/2026)." },
  { address: 40199, name: "Ligar ESS", risk: "altera o controle", why: "Parte os ESS. Em off-grid a carga parte junto." },
  { address: 40200, name: "Ligar inversores e ESS", risk: "altera o controle", why: "Partida geral." },
  { address: 40201, name: "Desligar inversores e ESS", risk: "desliga a planta", why: "Parada geral — apaga a planta ilhada." },
  { address: 40202, name: "Ligar/desligar (0 desliga, 1 liga)", risk: "desliga a planta", why: "Parada/partida geral por valor." },
  { address: 40203, name: "Ligar/desligar invertido (0 liga, 1 desliga)", risk: "desliga a planta", why: "Mesmo efeito, lógica invertida — fácil de errar." },
  { address: 40204, name: "Transfer trip", risk: "desliga a planta", why: "Desliga por falha e deixa de responder a comando de partida." },
  { address: 40205, name: "Reset do array", risk: "desliga a planta", why: "Reinicia o array." },
  { address: 40378, name: "Ajuste de potência FV (kW)", risk: "altera o controle", why: "Limita a geração." },
  { address: 40380, name: "Ajuste de potência FV (%)", risk: "altera o controle", why: "Limita a geração." },
  { address: 40381, name: "Ajuste de potência do ESS (kW)", risk: "altera o controle", why: "Força carga/descarga." },
  { address: 40383, name: "Ajuste de potência do ESS (%)", risk: "altera o controle", why: "Negativo = carga. Força carga/descarga." },
  { address: 40384, name: "Ajuste de reativo FV", risk: "altera o controle", why: "Altera o reativo." },
  { address: 40386, name: "Ajuste de reativo do ESS", risk: "altera o controle", why: "Altera o reativo." },
  { address: 40420, name: "Ajuste de potência ativa", risk: "altera o controle", why: "Despacho de potência de todos os inversores/PCS." },
  { address: 40422, name: "Ajuste de potência reativa", risk: "altera o controle", why: "Despacho de reativo." },
  { address: 40424, name: "Ajuste de potência ativa (U32)", risk: "altera o controle", why: "Despacho de potência." },
  { address: 40426, name: "Ajuste de potência reativa", risk: "altera o controle", why: "Despacho de reativo." },
  { address: 40428, name: "Ajuste de potência ativa (%)", risk: "altera o controle", why: "Despacho percentual." },
  { address: 40429, name: "Ajuste de fator de potência", risk: "altera o controle", why: "Altera o reativo." },
  { address: 40430, name: "Ajuste de potência ativa (prioridade máxima)", risk: "altera o controle", why: "Bloqueia todas as outras interfaces de ajuste até receber 0x7FFFFFFF." },
  { address: 40432, name: "Ajuste de potência reativa (prioridade máxima)", risk: "altera o controle", why: "Bloqueia as outras interfaces de reativo." },
  { address: 40723, name: "Reset do sistema", risk: "desliga a planta", why: "Reinicia o SmartLogger; o campo de dados nem é conferido." },
  { address: 40724, name: "Busca rápida de dispositivos", risk: "configuração", why: "Realoca endereços e busca dispositivos — pode mudar os Unit IDs." },
  { address: 40725, name: "Operação em dispositivo", risk: "destrutivo", why: "Tipo 0 APAGA o inversor identificado pelo ESN." },
  { address: 41124, name: "Coeficiente de CO2", risk: "configuração", why: "Só estatística, mas é configuração do cliente." },
  { address: 41889, name: "Modo de controle de potência ativa", risk: "altera o controle", why: "Muda a estratégia de despacho." },
  { address: 41947, name: "Desligar o array ao perder comunicação", risk: "desliga a planta", why: "Se ligado, a planta desliga quando o mestre Modbus parar de consultar." },
  { address: 41948, name: "Tempo de detecção de perda de comunicação", risk: "configuração", why: "Ligado ao 41947." },
  { address: 41949, name: "Religar o array ao recuperar comunicação", risk: "altera o controle", why: "Partida automática — a carga parte junto." },
  { address: 42017, name: "Relógio do sistema (ano…segundo, 42017–42022)", risk: "configuração", why: "Altera o relógio e o carimbo dos dados." },
  { address: 42256, name: "Modo de trabalho do ESS", risk: "altera o controle", why: "Troca a estratégia de carga/descarga." },
  { address: 42728, name: "Gradiente de potência ativa", risk: "altera o controle", why: "Altera a rampa." },
  { address: 42730, name: "Controle de inspeção", risk: "altera o controle", why: "Inicia/para inspeção." },
  { address: 42779, name: "Varredura de curva I-V", risk: "altera o controle", why: "Interrompe a geração durante a varredura." },
  { address: 44165, name: "Modo de controle de potência reativa", risk: "altera o controle", why: "Muda a estratégia de reativo." },
  { address: 44360, name: "Black start do array", risk: "altera o controle", why: "1 = preparar, 2 = estabelecer tensão. Energiza a planta e a carga parte junto. Só com operador ciente e carga desconectada." },
  { address: 44362, name: "Black start em um clique", risk: "altera o controle", why: "Mesmo efeito, sequência automática (Issue 45). Só com operador ciente e carga desconectada." },
  { address: 44365, name: "Modo de trabalho do PCS (PQ/VSG)", risk: "desliga a planta", why: "Em off-grid o PCS precisa formar a rede (VSG); trocar derruba a planta." },
  { address: 44366, name: "Ajuste de tensão do VSG", risk: "altera o controle", why: "Altera a tensão da microrrede." },
  { address: 44367, name: "Ajuste de frequência do VSG", risk: "altera o controle", why: "Altera a frequência da microrrede." },
  { address: 44373, name: "Ligar PCS do subarray", risk: "altera o controle", why: "Parte os PCS." },
  { address: 44374, name: "Desligar PCS do subarray", risk: "desliga a planta", why: "Para os PCS — apaga a planta ilhada." },
  { address: 44375, name: "Adaptação do inversor FV à microrrede", risk: "altera o controle", why: "Muda o comportamento dos inversores FV em microrrede." },
  { address: 44376, name: "Estado da chave de conexão à rede", risk: "altera o controle", why: "Informa on-grid/off-grid ao SmartLogger; muda a estratégia." },
  { address: 40000, name: "Data/hora, cidade, horário de verão (40000–40004)", risk: "configuração", why: "Altera o relógio." },
  { address: 65490, name: "SN do dispositivo a substituir", risk: "configuração", why: "Usado na troca de equipamento." },
  { address: 65504, name: "Informação de localização", risk: "configuração", why: "Metadado do dispositivo." },
  { address: 65524, name: "Apelido do dispositivo", risk: "configuração", why: "Renomeia o dispositivo na Huawei." },
];
