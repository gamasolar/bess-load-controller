/**
 * Leitura do Huawei SmartLogger3000 por Modbus TCP — camada de alto nível.
 *
 * SOMENTE LEITURA. Não é importado pelo servidor em produção: é a base
 * preparada para a Fase A do DECISION-CAMINHO-2.md (Modbus como fonte
 * preferencial de SOC, com a FusionSolar de fallback). Ligar isto ao
 * `pollSite` é mudança em caminho crítico e exige autorização do operador
 * (CLAUDE.md §14).
 */

import {
  ModbusExceptionError,
  ModbusTcpReader,
  MAX_REGISTERS_PER_READ,
} from "./modbus-tcp";
import {
  ALARM_BITS,
  ALARM_REGISTER_FIRST,
  ALARM_REGISTER_LAST,
  DEVICE_CONNECTION_ONLINE,
  DEVICE_PUBLIC_REGISTERS,
  PLANT_REGISTERS,
  SMARTLOGGER_UNIT_ID,
  type AlarmBitDef,
  type RegisterDef,
} from "./smartlogger-map";

export type RegisterValue = number | string | null;

// ── Decodificação ──────────────────────────────────────────────────────

/** Converte os bytes de um registrador (big-endian) no valor físico (bruto / gain). */
export function decodeRegister(def: RegisterDef, data: Buffer): RegisterValue {
  if (data.length < def.quantity * 2) {
    throw new RangeError(`${def.key}: esperava ${def.quantity * 2} bytes, vieram ${data.length}`);
  }
  switch (def.type) {
    case "U16":
      return scale(data.readUInt16BE(0), def.gain);
    case "I16":
      return scale(data.readInt16BE(0), def.gain);
    case "U32":
      return scale(data.readUInt32BE(0), def.gain);
    case "I32":
      return scale(data.readInt32BE(0), def.gain);
    case "U64":
      return scale(Number(data.readBigUInt64BE(0)), def.gain);
    case "I64":
      return scale(Number(data.readBigInt64BE(0)), def.gain);
    case "STR":
      return data
        .subarray(0, def.quantity * 2)
        .toString("latin1")
        .replace(/\0+$/g, "")
        .replace(/[^\x20-\x7e]/g, "")
        .trim();
  }
}

function scale(raw: number, gain: number): number {
  return gain === 1 ? raw : raw / gain;
}

/** Texto da enumeração, quando o registrador tem uma. */
export function describeValue(def: RegisterDef, value: RegisterValue): string | null {
  if (def.enum && typeof value === "number") return def.enum[value] ?? `código ${value} (não documentado)`;
  return null;
}

// ── Leitura em grupos ──────────────────────────────────────────────────

export interface ReadGroup {
  start: number;
  quantity: number;
  defs: RegisterDef[];
}

/**
 * Agrupa registradores vizinhos numa única requisição. `maxGap` = quantos
 * endereços NÃO documentados podem ficar no meio de um bloco. O padrão é 0
 * (só endereços contíguos): ler um endereço inexistente devolve exceção 0x02
 * e derruba o bloco inteiro.
 */
export function planReadGroups(defs: RegisterDef[], maxGap = 0): ReadGroup[] {
  const sorted = [...defs].sort((a, b) => a.address - b.address);
  const groups: ReadGroup[] = [];
  for (const def of sorted) {
    const last = groups[groups.length - 1];
    if (last) {
      const lastEnd = last.start + last.quantity; // exclusivo
      const newEnd = def.address + def.quantity;
      if (def.address - lastEnd <= maxGap && def.address >= lastEnd && newEnd - last.start <= MAX_REGISTERS_PER_READ) {
        last.quantity = newEnd - last.start;
        last.defs.push(def);
        continue;
      }
    }
    groups.push({ start: def.address, quantity: def.quantity, defs: [def] });
  }
  return groups;
}

export interface ReadResult {
  values: Record<string, RegisterValue>;
  /** Registradores que falharam, com o motivo (ex.: endereço inexistente neste firmware). */
  errors: Record<string, string>;
  requests: number;
}

/**
 * Lê um conjunto de registradores. Se um bloco falhar com exceção Modbus,
 * refaz registrador por registrador — assim um endereço ausente no firmware
 * instalado não esconde os vizinhos.
 */
export async function readRegisters(
  reader: ModbusTcpReader,
  unitId: number,
  defs: RegisterDef[],
  opts: { maxGap?: number } = {},
): Promise<ReadResult> {
  const out: ReadResult = { values: {}, errors: {}, requests: 0 };
  for (const group of planReadGroups(defs, opts.maxGap ?? 0)) {
    try {
      out.requests++;
      const data = await reader.readHoldingRegisters(unitId, group.start, group.quantity);
      for (const def of group.defs) {
        const off = (def.address - group.start) * 2;
        out.values[def.key] = decodeRegister(def, data.subarray(off, off + def.quantity * 2));
      }
    } catch (e) {
      if (!(e instanceof ModbusExceptionError)) throw e; // timeout/queda de conexão: propaga
      if (group.defs.length === 1) {
        out.values[group.defs[0].key] = null;
        out.errors[group.defs[0].key] = e.message;
        continue;
      }
      for (const def of group.defs) {
        try {
          out.requests++;
          const data = await reader.readHoldingRegisters(unitId, def.address, def.quantity);
          out.values[def.key] = decodeRegister(def, data);
        } catch (e2) {
          if (!(e2 instanceof ModbusExceptionError)) throw e2;
          out.values[def.key] = null;
          out.errors[def.key] = e2.message;
        }
      }
    }
  }
  return out;
}

// ── Alarmes ────────────────────────────────────────────────────────────

export interface ActiveAlarm extends AlarmBitDef {
  /** O documento atribui mais de um alarme a este mesmo bit — não dá para saber qual é. */
  ambiguous: boolean;
}

/** Decodifica os bitfields 50000–50007. `words` mapeia endereço → valor U16. */
export function decodeAlarmWords(words: Record<number, number | null | undefined>): ActiveAlarm[] {
  const active: ActiveAlarm[] = [];
  for (const def of ALARM_BITS) {
    const word = words[def.register];
    if (word == null) continue;
    if (((word >> def.bit) & 1) !== 1) continue;
    const sameBit = ALARM_BITS.filter((d) => d.register === def.register && d.bit === def.bit);
    const distinct = new Set(sameBit.map((d) => `${d.alarmId}/${d.subId}`));
    active.push({ ...def, ambiguous: distinct.size > 1 });
  }
  return active;
}

/** Bits ligados que o documento não descreve (firmware mais novo que a Issue 47). */
export function unknownAlarmBits(words: Record<number, number | null | undefined>): { register: number; bit: number }[] {
  const out: { register: number; bit: number }[] = [];
  for (let reg = ALARM_REGISTER_FIRST; reg <= ALARM_REGISTER_LAST; reg++) {
    const word = words[reg];
    if (word == null) continue;
    for (let bit = 0; bit < 16; bit++) {
      if (((word >> bit) & 1) === 1 && !ALARM_BITS.some((d) => d.register === reg && d.bit === bit)) {
        out.push({ register: reg, bit });
      }
    }
  }
  return out;
}

export async function readAlarmWords(reader: ModbusTcpReader): Promise<Record<number, number | null>> {
  const words: Record<number, number | null> = {};
  for (let reg = ALARM_REGISTER_FIRST; reg <= ALARM_REGISTER_LAST; reg++) {
    try {
      const data = await reader.readHoldingRegisters(SMARTLOGGER_UNIT_ID, reg, 1);
      words[reg] = data.readUInt16BE(0);
    } catch (e) {
      if (!(e instanceof ModbusExceptionError)) throw e;
      words[reg] = null; // ex.: 50007 ausente em firmware anterior
    }
  }
  return words;
}

// ── Retrato da planta ──────────────────────────────────────────────────

export interface PlantSnapshot {
  readAt: Date;
  values: Record<string, RegisterValue>;
  errors: Record<string, string>;
  alarmWords: Record<number, number | null>;
  alarms: ActiveAlarm[];
  unknownAlarmBits: { register: number; bit: number }[];
  derived: PlantDerived;
  /** Problemas de plausibilidade encontrados nos valores lidos. */
  warnings: string[];
  requests: number;
}

export interface PlantDerived {
  /**
   * Carga estimada em planta ilhada = FV + saída do ESS (convenção Huawei:
   * saída do ESS positiva = descarga). Derivado, não medido.
   */
  loadKw: number | null;
  /** Desvio do relógio do SmartLogger em relação ao nosso, em segundos (positivo = SmartLogger adiantado). */
  clockSkewS: number | null;
  /** Diferença entre os dois registradores de potência do ESS (40507 − 40392), em kW. */
  essPowerDisagreementKw: number | null;
}

const num = (v: RegisterValue | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function derivePlant(values: Record<string, RegisterValue>, readAt: Date): PlantDerived {
  const pv = num(values.pvActivePowerKw);
  const ess = num(values.essActivePowerKw);
  const bat = num(values.batteryChargeDischargeKw);
  const utc = num(values.utcEpoch);
  return {
    loadKw: pv !== null && ess !== null ? round3(pv + ess) : null,
    clockSkewS: utc !== null && utc > 0 ? Math.round(utc - readAt.getTime() / 1000) : null,
    essPowerDisagreementKw: ess !== null && bat !== null ? round3(bat - ess) : null,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Checagens de plausibilidade — nunca corrigem o valor, só avisam. */
export function validateSnapshot(values: Record<string, RegisterValue>, derived: PlantDerived): string[] {
  const w: string[] = [];
  for (const key of ["soc", "soh", "soe", "essEndOfDischargeSoc", "essEndOfChargeSoc"]) {
    const v = num(values[key]);
    if (v !== null && (v < 0 || v > 100)) w.push(`${key} fora de 0–100 %: ${v} (valor inválido do equipamento?)`);
  }
  if (num(values.commTimeoutShutdownEnabled) === 1) {
    w.push(
      "PERIGO: 'desligar o array ao perder comunicação' (41947) está HABILITADO — se o mestre Modbus parar de consultar, " +
      `o SmartLogger desliga a planta após ${values.commTimeoutDetectionS ?? "?"} s.`,
    );
  }
  if (derived.clockSkewS !== null && Math.abs(derived.clockSkewS) > 120) {
    w.push(`Relógio do SmartLogger desviado em ${derived.clockSkewS} s.`);
  }
  if (derived.essPowerDisagreementKw !== null) {
    const ess = num(values.essActivePowerKw) ?? 0;
    const bat = num(values.batteryChargeDischargeKw) ?? 0;
    if (Math.abs(ess) > 1 && Math.abs(bat) > 1 && Math.sign(ess) !== Math.sign(bat)) {
      w.push(`40392 (${ess} kW) e 40507 (${bat} kW) têm sinais opostos — convenções diferentes; calibrar antes de usar.`);
    }
  }
  if (num(values.runningEssPcs) === 0 && num(values.essPcsShutDown) === 1) {
    w.push("Todos os PCS do ESS estão parados (planta apagada, em standby ou em proteção).");
  }
  if (num(values.pcsWorkingMode) === 0) {
    w.push("PCS em modo PQ (segue a rede). Planta off-grid precisa de VSG.");
  }
  return w;
}

/** Subconjunto mínimo para decidir a bomba: poucos registradores, poucas requisições. */
export const CONTROL_KEYS = [
  "soc", "essActivePowerKw", "batteryChargeDischargeKw", "pvActivePowerKw", "totalActivePowerKw",
  "runningEssPcs", "essPcsInOperation", "essPcsShutDown", "energyChargedTodayKwh", "energyDischargedTodayKwh",
] as const;

export async function readPlantSnapshot(
  reader: ModbusTcpReader,
  opts: { keys?: readonly string[]; maxGap?: number; withAlarms?: boolean } = {},
): Promise<PlantSnapshot> {
  const defs = opts.keys ? PLANT_REGISTERS.filter((d) => opts.keys!.includes(d.key)) : PLANT_REGISTERS;
  const readAt = new Date();
  const res = await readRegisters(reader, SMARTLOGGER_UNIT_ID, defs, { maxGap: opts.maxGap });
  const alarmWords = opts.withAlarms === false ? {} : await readAlarmWords(reader);
  const derived = derivePlant(res.values, readAt);
  return {
    readAt,
    values: res.values,
    errors: res.errors,
    alarmWords,
    alarms: decodeAlarmWords(alarmWords),
    unknownAlarmBits: unknownAlarmBits(alarmWords),
    derived,
    warnings: validateSnapshot(res.values, derived),
    requests: res.requests + Object.keys(alarmWords).length,
  };
}

// ── Descoberta de dispositivos ─────────────────────────────────────────

export interface DeviceInfo {
  unitId: number;
  online: boolean;
  values: Record<string, RegisterValue>;
  errors: Record<string, string>;
}

/**
 * Consulta os registradores públicos de um Unit ID. Devolve null se o
 * SmartLogger disser que não há dispositivo naquele endereço lógico.
 */
export async function readDevicePublic(reader: ModbusTcpReader, unitId: number): Promise<DeviceInfo | null> {
  const statusDef = DEVICE_PUBLIC_REGISTERS.find((d) => d.key === "connectionStatus")!;
  let status: number;
  try {
    const data = await reader.readHoldingRegisters(unitId, statusDef.address, 1);
    status = data.readUInt16BE(0);
  } catch (e) {
    if (e instanceof ModbusExceptionError) return null;
    throw e;
  }
  const rest = await readRegisters(
    reader,
    unitId,
    DEVICE_PUBLIC_REGISTERS.filter((d) => d.key !== "connectionStatus"),
  );
  return {
    unitId,
    online: status === DEVICE_CONNECTION_ONLINE,
    values: { connectionStatus: status, ...rest.values },
    errors: rest.errors,
  };
}

/** Varre uma faixa de endereços lógicos procurando dispositivos (ESS, inversores, EMI, medidor). */
export async function scanDevices(reader: ModbusTcpReader, from = 1, to = 20): Promise<DeviceInfo[]> {
  const found: DeviceInfo[] = [];
  for (let unit = from; unit <= to; unit++) {
    const info = await readDevicePublic(reader, unit);
    if (info) found.push(info);
  }
  return found;
}

export interface ListedDevice {
  objectId: number;
  raw: string;
  /** Atributos "rótulo=valor": 1 modelo, 2 versão, 3 protocolo, 4 ESN, 5 nº do dispositivo, 6 rede paralela. */
  attrs: Record<string, string>;
  model?: string;
  softwareVersion?: string;
  esn?: string;
  deviceNumber?: number;
}

export function parseDeviceDescription(objectId: number, raw: string): ListedDevice {
  const attrs: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) attrs[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const n = attrs["5"] !== undefined ? Number(attrs["5"]) : NaN;
  return {
    objectId,
    raw,
    attrs,
    model: attrs["1"],
    softwareVersion: attrs["2"],
    esn: attrs["4"],
    deviceNumber: Number.isFinite(n) ? n : undefined,
  };
}

/**
 * Lista de dispositivos pelo FC 0x2B (§4.3.6.2): objeto 0x87 = quantidade,
 * 0x88 em diante = descrição de cada um. Pode não ser suportado por todos os
 * firmwares — quem chama deve tratar a exceção e cair para `scanDevices`.
 */
export async function readDeviceList(
  reader: ModbusTcpReader,
  unitId = SMARTLOGGER_UNIT_ID,
): Promise<{ count: number | null; devices: ListedDevice[] }> {
  let count: number | null = null;
  const devices: ListedDevice[] = [];
  let objectId = 0x87;
  for (let guard = 0; guard < 130; guard++) {
    const res = await reader.readDeviceIdentification(unitId, 0x03, objectId);
    for (const obj of res.objects) {
      if (obj.id === 0x87) {
        count = obj.value.length ? obj.value.readUIntBE(0, Math.min(obj.value.length, 6)) : 0;
      } else if (obj.id >= 0x88) {
        devices.push(parseDeviceDescription(obj.id, obj.value.toString("latin1").replace(/\0+$/g, "")));
      }
    }
    if (!res.more || res.nextObjectId <= objectId) break;
    objectId = res.nextObjectId;
  }
  return { count, devices };
}

// ── Calibração do sinal da potência do ESS ─────────────────────────────

export interface SignSample {
  t: number;
  essPowerKw: number | null;
  chargedTodayKwh: number | null;
  dischargedTodayKwh: number | null;
}

export type SignConvention = "positivo = descarga" | "positivo = carga" | "indeterminado";

export interface SignInference {
  convention: SignConvention;
  /** Intervalos em que um contador de energia avançou e a potência tinha sinal claro. */
  evidence: { discharging: { positive: number; negative: number }; charging: { positive: number; negative: number } };
  reason: string;
}

/**
 * Descobre a polaridade de um registrador de potência do ESS olhando os
 * contadores de energia: se "descarregada hoje" avança enquanto a potência
 * é positiva, positivo = descarga. Não presume nada do documento.
 *
 * @param deadbandKw potência abaixo disso é tratada como zero (ruído).
 */
export function inferEssSign(samples: SignSample[], deadbandKw = 0.5): SignInference {
  const ev = { discharging: { positive: 0, negative: 0 }, charging: { positive: 0, negative: 0 } };
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.essPowerKw === null || b.essPowerKw === null) continue;
    if (a.chargedTodayKwh === null || b.chargedTodayKwh === null) continue;
    if (a.dischargedTodayKwh === null || b.dischargedTodayKwh === null) continue;
    const avg = (a.essPowerKw + b.essPowerKw) / 2;
    if (Math.abs(avg) < deadbandKw || Math.sign(a.essPowerKw) !== Math.sign(b.essPowerKw)) continue;
    const dCharge = b.chargedTodayKwh - a.chargedTodayKwh;
    const dDischarge = b.dischargedTodayKwh - a.dischargedTodayKwh;
    // virada do dia zera os contadores: ignora intervalos com contador andando para trás
    if (dCharge < 0 || dDischarge < 0) continue;
    const side = avg > 0 ? "positive" : "negative";
    if (dDischarge > 0 && dCharge === 0) ev.discharging[side]++;
    else if (dCharge > 0 && dDischarge === 0) ev.charging[side]++;
  }

  const forDischarge = ev.discharging.positive + ev.charging.negative; // apoia "positivo = descarga"
  const forCharge = ev.discharging.negative + ev.charging.positive; // apoia "positivo = carga"
  const total = forDischarge + forCharge;
  if (total < 3) {
    return { convention: "indeterminado", evidence: ev, reason: `Só ${total} intervalo(s) conclusivo(s); são necessários ao menos 3.` };
  }
  if (forDischarge > 0 && forCharge > 0) {
    return { convention: "indeterminado", evidence: ev, reason: `Evidência contraditória: ${forDischarge} a favor de descarga positiva, ${forCharge} contra.` };
  }
  return forDischarge > 0
    ? { convention: "positivo = descarga", evidence: ev, reason: `${forDischarge} intervalo(s) concordantes, nenhum contrário.` }
    : { convention: "positivo = carga", evidence: ev, reason: `${forCharge} intervalo(s) concordantes, nenhum contrário.` };
}
