/**
 * Mapa de registradores Modbus do inversor Huawei SUN2000.
 *
 * Fonte: "Solar Inverter Modbus Interface Definitions (V3.0)", Issue 01
 * (2023-01-17), que lista o SUN2000-75KTL-M1 entre os modelos suportados.
 * Não é uma edição específica do firmware instalado (V500R023C00SPC165):
 * cada endereço precisa ser confirmado na planta com a sonda.
 *
 * Acesso: pelo SmartLogger, no Unit ID (endereço lógico) de cada inversor.
 * Somente leitura (FC 0x03).
 */

import type { RegisterDef } from "./smartlogger-map";

/** Número máximo de strings FV que o documento descreve (PV1…PV20). */
export const SUN2000_MAX_STRINGS = 20;

/** Identificação — muda raramente; ler uma vez por sessão. */
export const SUN2000_ID_REGISTERS: RegisterDef[] = [
  { key: "model", address: 30000, quantity: 15, type: "STR", gain: 1, unit: "", label: "Modelo" },
  { key: "serialNumber", address: 30015, quantity: 10, type: "STR", gain: 1, unit: "", label: "Número de série" },
  { key: "partNumber", address: 30025, quantity: 10, type: "STR", gain: 1, unit: "", label: "Código do produto (PN)" },
  { key: "firmwareVersion", address: 30035, quantity: 15, type: "STR", gain: 1, unit: "", label: "Versão de firmware" },
  { key: "softwareVersion", address: 30050, quantity: 15, type: "STR", gain: 1, unit: "", label: "Versão de software" },
  { key: "modelId", address: 30070, quantity: 1, type: "U16", gain: 1, unit: "", label: "ID do modelo",
    note: "O SUN2000-75KTL-M1 é o ID 147." },
  { key: "numberOfStrings", address: 30071, quantity: 1, type: "U16", gain: 1, unit: "", label: "Quantidade de strings FV" },
  { key: "numberOfMppts", address: 30072, quantity: 1, type: "U16", gain: 1, unit: "", label: "Quantidade de MPPTs" },
  { key: "ratedPowerKw", address: 30073, quantity: 2, type: "U32", gain: 1000, unit: "kW", label: "Potência nominal" },
  { key: "maxActivePowerKw", address: 30075, quantity: 2, type: "U32", gain: 1000, unit: "kW", label: "Potência ativa máxima (Pmax)" },
  { key: "maxApparentPowerKva", address: 30077, quantity: 2, type: "U32", gain: 1000, unit: "kVA", label: "Potência aparente máxima (Smax)" },
];

/**
 * Códigos de estado do inversor (registrador 32089; mesmo código do campo
 * `inverter_state` da FusionSolar). A edição V3.0 remete a um anexo que não
 * veio no PDF; a tabela abaixo é a das edições públicas anteriores do
 * protocolo SUN2000. Código fora dela é exibido cru.
 */
export const SUN2000_DEVICE_STATUS: Record<number, string> = {
  0x0000: "em espera: inicializando",
  0x0001: "em espera: medindo resistência de isolação",
  0x0002: "em espera: detectando irradiação",
  0x0003: "em espera: detectando a rede",
  0x0100: "partindo",
  0x0200: "conectado à rede",
  0x0201: "conectado: potência limitada",
  0x0202: "conectado: redução automática de potência",
  0x0203: "operando fora da rede (off-grid)",
  0x0300: "parado: falha",
  0x0301: "parado: comando",
  0x0302: "parado: OVGR",
  0x0303: "parado: comunicação desconectada",
  0x0304: "parado: potência limitada",
  0x0305: "parado: exige partida manual",
  0x0306: "parado: chaves CC abertas",
  0x0307: "parado: desligamento rápido",
  0x0308: "parado: potência de entrada insuficiente",
  0x0401: "despacho da rede: curva cosφ-P",
  0x0402: "despacho da rede: curva Q-U",
  0x0403: "despacho da rede: curva PF-U",
  0x0404: "despacho da rede: contato seco",
  0x0405: "despacho da rede: curva Q-P",
  0x0500: "pronto para inspeção pontual",
  0x0501: "em inspeção pontual",
  0x0600: "inspecionando",
  0x0700: "autoteste de AFCI",
  0x0800: "varredura de curva I-V",
  0x0900: "detecção de entrada CC",
  0x0a00: "operando: carga off-grid",
  0xa000: "em espera: sem irradiação",
};

function pvStringRegisters(): RegisterDef[] {
  const out: RegisterDef[] = [];
  for (let n = 1; n <= SUN2000_MAX_STRINGS; n++) {
    out.push({ key: `pv${n}VoltageV`, address: 32016 + (n - 1) * 2, quantity: 1, type: "I16", gain: 10, unit: "V", label: `Tensão da string PV${n}` });
    out.push({ key: `pv${n}CurrentA`, address: 32017 + (n - 1) * 2, quantity: 1, type: "I16", gain: 100, unit: "A", label: `Corrente da string PV${n}` });
  }
  return out;
}

/** Tempo real. As strings vão de PV1 a PV20; usar `numberOfStrings` para cortar. */
export const SUN2000_REALTIME_REGISTERS: RegisterDef[] = [
  { key: "deviceStatus", address: 32089, quantity: 1, type: "U16", gain: 1, unit: "", label: "Estado do inversor", enum: SUN2000_DEVICE_STATUS },
  { key: "activePowerKw", address: 32080, quantity: 2, type: "I32", gain: 1000, unit: "kW", label: "Potência ativa" },
  { key: "reactivePowerKvar", address: 32082, quantity: 2, type: "I32", gain: 1000, unit: "kVar", label: "Potência reativa" },
  { key: "dcPowerKw", address: 32064, quantity: 2, type: "I32", gain: 1000, unit: "kW", label: "Potência CC de entrada" },
  { key: "peakActivePowerTodayKw", address: 32078, quantity: 2, type: "I32", gain: 1000, unit: "kW", label: "Pico de potência ativa do dia" },
  { key: "powerFactor", address: 32084, quantity: 1, type: "I16", gain: 1000, unit: "", label: "Fator de potência" },
  { key: "gridFrequencyHz", address: 32085, quantity: 1, type: "U16", gain: 100, unit: "Hz", label: "Frequência" },
  { key: "efficiencyPct", address: 32086, quantity: 1, type: "U16", gain: 100, unit: "%", label: "Eficiência" },
  { key: "internalTemperatureC", address: 32087, quantity: 1, type: "I16", gain: 10, unit: "°C", label: "Temperatura interna" },
  { key: "insulationResistanceMohm", address: 32088, quantity: 1, type: "U16", gain: 1000, unit: "MΩ", label: "Resistência de isolação" },
  { key: "faultCode", address: 32090, quantity: 1, type: "U16", gain: 1, unit: "", label: "Código de falha (alarme de maior prioridade)" },
  { key: "voltageAB", address: 32066, quantity: 1, type: "U16", gain: 10, unit: "V", label: "Tensão de linha A-B" },
  { key: "voltageBC", address: 32067, quantity: 1, type: "U16", gain: 10, unit: "V", label: "Tensão de linha B-C" },
  { key: "voltageCA", address: 32068, quantity: 1, type: "U16", gain: 10, unit: "V", label: "Tensão de linha C-A" },
  { key: "voltageA", address: 32069, quantity: 1, type: "U16", gain: 10, unit: "V", label: "Tensão de fase A" },
  { key: "voltageB", address: 32070, quantity: 1, type: "U16", gain: 10, unit: "V", label: "Tensão de fase B" },
  { key: "voltageC", address: 32071, quantity: 1, type: "U16", gain: 10, unit: "V", label: "Tensão de fase C" },
  { key: "currentA", address: 32072, quantity: 2, type: "I32", gain: 1000, unit: "A", label: "Corrente de fase A" },
  { key: "currentB", address: 32074, quantity: 2, type: "I32", gain: 1000, unit: "A", label: "Corrente de fase B" },
  { key: "currentC", address: 32076, quantity: 2, type: "I32", gain: 1000, unit: "A", label: "Corrente de fase C" },
  { key: "busVoltageV", address: 32176, quantity: 1, type: "I16", gain: 10, unit: "V", label: "Tensão total do barramento CC" },
  { key: "startupEpoch", address: 32091, quantity: 2, type: "U32", gain: 1, unit: "s", label: "Hora da partida (epoch)" },
  { key: "shutdownEpoch", address: 32093, quantity: 2, type: "U32", gain: 1, unit: "s", label: "Hora da parada (epoch)" },
  { key: "totalYieldKwh", address: 32106, quantity: 2, type: "U32", gain: 100, unit: "kWh", label: "Energia gerada acumulada" },
  { key: "totalDcInputKwh", address: 32108, quantity: 2, type: "U32", gain: 100, unit: "kWh", label: "Energia CC de entrada acumulada" },
  { key: "yieldTodayKwh", address: 32114, quantity: 2, type: "U32", gain: 100, unit: "kWh", label: "Energia gerada hoje" },
  { key: "yieldMonthKwh", address: 32116, quantity: 2, type: "U32", gain: 100, unit: "kWh", label: "Energia gerada no mês" },
  { key: "yieldYearKwh", address: 32118, quantity: 2, type: "U32", gain: 100, unit: "kWh", label: "Energia gerada no ano" },
  { key: "criticalAlarmCount", address: 32151, quantity: 1, type: "U16", gain: 1, unit: "", label: "Alarmes críticos ativos" },
  { key: "majorAlarmCount", address: 32152, quantity: 1, type: "U16", gain: 1, unit: "", label: "Alarmes maiores ativos" },
  { key: "minorAlarmCount", address: 32153, quantity: 1, type: "U16", gain: 1, unit: "", label: "Alarmes menores ativos" },
  { key: "warningAlarmCount", address: 32154, quantity: 1, type: "U16", gain: 1, unit: "", label: "Avisos ativos" },
  { key: "latestActiveAlarmSeq", address: 32172, quantity: 2, type: "U32", gain: 1, unit: "", label: "Nº de sequência do último alarme ativo" },
  { key: "alarmWord1", address: 32008, quantity: 1, type: "U16", gain: 1, unit: "bits", label: "Alarmes 1 (bitfield)" },
  { key: "alarmWord2", address: 32009, quantity: 1, type: "U16", gain: 1, unit: "bits", label: "Alarmes 2 (bitfield)" },
  { key: "alarmWord3", address: 32010, quantity: 1, type: "U16", gain: 1, unit: "bits", label: "Alarmes 3 (bitfield)" },
  ...pvStringRegisters(),
];

export interface Sun2000AlarmDef {
  /** 1, 2 ou 3 → registradores 32008, 32009, 32010. */
  word: 1 | 2 | 3;
  bit: number;
  alarmId: number;
  severity: "Major" | "Minor" | "Warning";
  label: string;
}

/** Tabela 5-1 do documento (alarmes 1 a 3). */
export const SUN2000_ALARMS: Sun2000AlarmDef[] = [
  { word: 1, bit: 0, alarmId: 2001, severity: "Major", label: "Tensão de entrada da string alta" },
  { word: 1, bit: 1, alarmId: 2002, severity: "Major", label: "Arco elétrico CC" },
  { word: 1, bit: 2, alarmId: 2011, severity: "Major", label: "String com polaridade invertida" },
  { word: 1, bit: 3, alarmId: 2012, severity: "Warning", label: "Corrente reversa na string" },
  { word: 1, bit: 4, alarmId: 2013, severity: "Warning", label: "Potência anormal na string" },
  { word: 1, bit: 5, alarmId: 2021, severity: "Major", label: "Falha no autoteste de AFCI" },
  { word: 1, bit: 6, alarmId: 2031, severity: "Major", label: "Fase em curto com o terra (PE)" },
  { word: 1, bit: 7, alarmId: 2032, severity: "Major", label: "Perda da rede" },
  { word: 1, bit: 8, alarmId: 2033, severity: "Major", label: "Subtensão da rede" },
  { word: 1, bit: 9, alarmId: 2034, severity: "Major", label: "Sobretensão da rede" },
  { word: 1, bit: 10, alarmId: 2035, severity: "Major", label: "Desequilíbrio de tensão da rede" },
  { word: 1, bit: 11, alarmId: 2036, severity: "Major", label: "Sobrefrequência da rede" },
  { word: 1, bit: 12, alarmId: 2037, severity: "Major", label: "Subfrequência da rede" },
  { word: 1, bit: 13, alarmId: 2038, severity: "Major", label: "Frequência da rede instável" },
  { word: 1, bit: 14, alarmId: 2039, severity: "Major", label: "Sobrecorrente na saída" },
  { word: 1, bit: 15, alarmId: 2040, severity: "Major", label: "Componente CC alta na saída" },
  { word: 2, bit: 0, alarmId: 2051, severity: "Major", label: "Corrente residual anormal" },
  { word: 2, bit: 1, alarmId: 2061, severity: "Major", label: "Aterramento anormal" },
  { word: 2, bit: 2, alarmId: 2062, severity: "Major", label: "Resistência de isolação baixa" },
  { word: 2, bit: 3, alarmId: 2063, severity: "Minor", label: "Sobretemperatura" },
  { word: 2, bit: 4, alarmId: 2064, severity: "Major", label: "Falha do equipamento" },
  { word: 2, bit: 5, alarmId: 2065, severity: "Minor", label: "Falha de atualização ou versão incompatível" },
  { word: 2, bit: 6, alarmId: 2066, severity: "Warning", label: "Licença expirada" },
  { word: 2, bit: 7, alarmId: 61440, severity: "Minor", label: "Unidade de monitoramento com defeito" },
  { word: 2, bit: 8, alarmId: 2067, severity: "Major", label: "Coletor de potência com defeito" },
  { word: 2, bit: 9, alarmId: 2068, severity: "Minor", label: "Bateria anormal" },
  { word: 2, bit: 10, alarmId: 2070, severity: "Major", label: "Ilhamento ativo" },
  { word: 2, bit: 11, alarmId: 2071, severity: "Major", label: "Ilhamento passivo" },
  { word: 2, bit: 12, alarmId: 2072, severity: "Major", label: "Sobretensão CA transitória" },
  { word: 2, bit: 13, alarmId: 2075, severity: "Warning", label: "Curto na porta de periféricos" },
  { word: 2, bit: 14, alarmId: 2077, severity: "Major", label: "Sobrecarga na saída off-grid" },
  { word: 2, bit: 15, alarmId: 2080, severity: "Major", label: "Configuração anormal dos módulos FV" },
  { word: 3, bit: 0, alarmId: 2081, severity: "Warning", label: "Falha de otimizador" },
  { word: 3, bit: 1, alarmId: 2085, severity: "Minor", label: "PID interno operando de forma anormal" },
  { word: 3, bit: 2, alarmId: 2014, severity: "Major", label: "Tensão da string para o terra alta" },
  { word: 3, bit: 3, alarmId: 2086, severity: "Major", label: "Ventilador externo anormal" },
  { word: 3, bit: 4, alarmId: 2069, severity: "Major", label: "Bateria com polaridade invertida" },
  { word: 3, bit: 5, alarmId: 2082, severity: "Major", label: "Controlador on-grid/off-grid anormal" },
  { word: 3, bit: 6, alarmId: 2015, severity: "Warning", label: "Perda de string FV" },
  { word: 3, bit: 7, alarmId: 2087, severity: "Major", label: "Ventilador interno anormal" },
  { word: 3, bit: 8, alarmId: 2088, severity: "Major", label: "Unidade de proteção CC anormal" },
];

export interface Sun2000ActiveAlarm extends Sun2000AlarmDef {}

/** Decodifica os três bitfields de alarme do inversor. */
export function decodeSun2000Alarms(words: { 1?: number | null; 2?: number | null; 3?: number | null }): Sun2000ActiveAlarm[] {
  return SUN2000_ALARMS.filter((a) => {
    const w = words[a.word];
    return w != null && ((w >> a.bit) & 1) === 1;
  });
}

/** Texto do estado do inversor; código desconhecido volta em hexadecimal. */
export function describeSun2000Status(code: number | null | undefined): string | null {
  if (code == null || !Number.isFinite(code)) return null;
  return SUN2000_DEVICE_STATUS[code] ?? `código 0x${code.toString(16).padStart(4, "0")} (não documentado)`;
}
