/**
 * Catálogo de pontos de telemetria.
 *
 * As amostras são gravadas BRUTAS (`telemetry_samples.data`), exatamente como
 * a fonte entregou. Este catálogo traduz cada campo bruto em algo exibível:
 * nome em português, unidade, grupo e, quando preciso, conversão de valor.
 * Campo que o catálogo não conhece NÃO é descartado — sai no grupo "outros"
 * com o nome original. Assim um firmware novo ou um campo inesperado aparece
 * na tela no mesmo dia, sem migração de dados.
 */

import { PLANT_REGISTERS, EMI_REGISTERS, METER_REGISTERS, type RegisterDef } from "./smartlogger-map";
import { SUN2000_ID_REGISTERS, SUN2000_REALTIME_REGISTERS, describeSun2000Status } from "./sun2000-map";

export type TelemetrySource = "fusionsolar" | "modbus";
export type DeviceKind = "inverter" | "ess" | "plant" | "emi" | "meter" | "relay" | "other";

export type PointGroup =
  | "estado"
  | "potência"
  | "bateria"
  | "rede"
  | "temperatura"
  | "strings"
  | "energia"
  | "limites"
  | "alarmes"
  | "identificação"
  | "outros";

/** Ordem de exibição dos grupos. */
export const GROUP_ORDER: PointGroup[] = [
  "estado", "potência", "bateria", "temperatura", "rede", "strings", "energia", "limites", "alarmes", "identificação", "outros",
];

export interface TelemetryPoint {
  /** Nome do campo como está gravado. */
  rawKey: string;
  label: string;
  unit: string;
  group: PointGroup;
  /** Valor para exibir (já convertido, se o catálogo define conversão). */
  value: number | string | null;
  /** Texto de enumeração (estado, modo), quando existe. */
  text: string | null;
  /** O catálogo conhece este campo? Falso = veio da fonte sem estar mapeado. */
  known: boolean;
}

interface PointSpec {
  label: string;
  unit: string;
  group: PointGroup;
  /** Conversão do valor bruto para o exibido. */
  convert?: (raw: number) => number;
  /** Texto para códigos. */
  text?: (raw: number) => string | null;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

// ── FusionSolar (Northbound) ───────────────────────────────────────────

const FS_RUN_STATE: Record<number, string> = { 0: "desconectado", 1: "conectado" };

const FS_INVERTER: Record<string, PointSpec> = {
  inverter_state: { label: "Estado do inversor", unit: "", group: "estado", text: describeSun2000Status },
  run_state: { label: "Comunicação com a nuvem", unit: "", group: "estado", text: (v) => FS_RUN_STATE[v] ?? null },
  active_power: { label: "Potência ativa", unit: "kW", group: "potência" },
  reactive_power: { label: "Potência reativa", unit: "kVar", group: "potência" },
  mppt_power: { label: "Potência CC de entrada", unit: "kW", group: "potência" },
  power_factor: { label: "Fator de potência", unit: "", group: "rede" },
  elec_freq: { label: "Frequência", unit: "Hz", group: "rede" },
  efficiency: { label: "Eficiência", unit: "%", group: "potência" },
  temperature: { label: "Temperatura interna", unit: "°C", group: "temperatura" },
  ab_u: { label: "Tensão de linha A-B", unit: "V", group: "rede" },
  bc_u: { label: "Tensão de linha B-C", unit: "V", group: "rede" },
  ca_u: { label: "Tensão de linha C-A", unit: "V", group: "rede" },
  a_u: { label: "Tensão de fase A", unit: "V", group: "rede" },
  b_u: { label: "Tensão de fase B", unit: "V", group: "rede" },
  c_u: { label: "Tensão de fase C", unit: "V", group: "rede" },
  a_i: { label: "Corrente de fase A", unit: "A", group: "rede" },
  b_i: { label: "Corrente de fase B", unit: "A", group: "rede" },
  c_i: { label: "Corrente de fase C", unit: "A", group: "rede" },
  day_cap: { label: "Energia gerada hoje", unit: "kWh", group: "energia" },
  total_cap: { label: "Energia gerada acumulada", unit: "kWh", group: "energia" },
  mppt_total_cap: { label: "Energia CC acumulada (MPPTs)", unit: "kWh", group: "energia" },
  open_time: { label: "Hora da partida", unit: "epoch ms", group: "estado" },
  close_time: { label: "Hora da parada", unit: "epoch ms", group: "estado" },
};

const FS_BATTERY_STATUS: Record<number, string> = {
  0: "offline", 1: "em espera", 2: "operando", 3: "falha", 4: "hibernando",
};
const FS_CH_DISCHARGE_MODEL: Record<number, string> = {
  0: "nenhum", 1: "carga/descarga forçada", 2: "tarifa horária", 3: "carga/descarga fixa", 4: "máximo autoconsumo",
};

const FS_BATTERY: Record<string, PointSpec> = {
  battery_soc: { label: "SOC", unit: "%", group: "bateria" },
  battery_soh: { label: "SOH", unit: "%", group: "bateria" },
  // A LUNA2000-215 reporta em watts, com positivo = descarga (validado em 2026-04-29).
  // A tela usa a convenção do sistema: kW, positivo = carga.
  ch_discharge_power: { label: "Potência da bateria (+ carga, − descarga)", unit: "kW", group: "bateria", convert: (w) => -w / 1000 },
  battery_power: { label: "Potência da bateria", unit: "kW", group: "bateria" },
  battery_status: { label: "Estado da bateria", unit: "", group: "estado", text: (v) => FS_BATTERY_STATUS[v] ?? null },
  run_state: { label: "Comunicação com a nuvem", unit: "", group: "estado", text: (v) => FS_RUN_STATE[v] ?? null },
  ch_discharge_model: { label: "Modo de carga/descarga", unit: "", group: "estado", text: (v) => FS_CH_DISCHARGE_MODEL[v] ?? null },
  battery_temperature: { label: "Temperatura da bateria", unit: "°C", group: "temperatura" },
  busbar_u: { label: "Tensão do barramento", unit: "V", group: "bateria" },
  bus_voltage: { label: "Tensão do barramento", unit: "V", group: "bateria" },
  charge_cap: { label: "Energia carregada", unit: "kWh", group: "energia" },
  discharge_cap: { label: "Energia descarregada", unit: "kWh", group: "energia" },
  max_charge_power: { label: "Potência máxima de carga", unit: "W", group: "limites" },
  max_discharge_power: { label: "Potência máxima de descarga", unit: "W", group: "limites" },
};

/** Campos por string/MPPT seguem um padrão: pv7_u, pv7_i, mppt_3_cap. */
function fsPatternSpec(key: string): PointSpec | null {
  let m = /^pv(\d+)_u$/.exec(key);
  if (m) return { label: `Tensão da string PV${m[1]}`, unit: "V", group: "strings" };
  m = /^pv(\d+)_i$/.exec(key);
  if (m) return { label: `Corrente da string PV${m[1]}`, unit: "A", group: "strings" };
  m = /^mppt_(\d+)_cap$/.exec(key);
  if (m) return { label: `Energia CC acumulada do MPPT ${m[1]}`, unit: "kWh", group: "energia" };
  if (/temp/i.test(key)) return { label: key, unit: "°C", group: "temperatura" };
  return null;
}

function fsSpec(kind: DeviceKind, key: string): PointSpec | null {
  const table = kind === "inverter" ? FS_INVERTER : kind === "ess" ? FS_BATTERY : {};
  return table[key] ?? fsPatternSpec(key);
}

// ── Modbus ─────────────────────────────────────────────────────────────

function groupForRegister(def: RegisterDef): PointGroup {
  const k = def.key;
  if (/^pv\d+(Voltage|Current)/.test(k)) return "strings";
  if (/Temperature/i.test(k)) return "temperatura";
  if (/^alarm|Alarm/.test(k)) return "alarmes";
  if (/^(soc|soh|soe)$|Capacity|essActive|batteryCharge|EndOf/.test(k)) return "bateria";
  if (/Kwh$|^yield|generationHours/.test(k)) return "energia";
  if (/^(max|stable|rated)/.test(k)) return "limites";
  if (/voltage|current|frequency|powerFactor|Reactive|insulation/i.test(k)) return "rede";
  if (/PowerKw$|efficiency/i.test(k)) return "potência";
  if (/model|serial|esn|firmware|software|partNumber|numberOf|Epoch$|timeZone/i.test(k)) return "identificação";
  return "estado";
}

const MODBUS_DEFS: Record<DeviceKind, RegisterDef[]> = {
  plant: PLANT_REGISTERS,
  inverter: [...SUN2000_ID_REGISTERS, ...SUN2000_REALTIME_REGISTERS],
  emi: EMI_REGISTERS,
  meter: METER_REGISTERS,
  ess: [],
  relay: [],
  other: [],
};

// ── API ────────────────────────────────────────────────────────────────

/**
 * Transforma uma amostra bruta na lista de pontos exibíveis, ordenada por
 * grupo. Todo campo da amostra aparece: conhecido ou não.
 */
export function describeSample(source: TelemetrySource, kind: DeviceKind, data: Record<string, unknown>): TelemetryPoint[] {
  const points: TelemetryPoint[] = [];
  const modbusDefs = source === "modbus" ? new Map(MODBUS_DEFS[kind].map((d) => [d.key, d])) : null;

  for (const [rawKey, rawValue] of Object.entries(data ?? {})) {
    if (rawValue === undefined) continue;
    const n = num(rawValue);

    if (modbusDefs) {
      const def = modbusDefs.get(rawKey);
      points.push({
        rawKey,
        label: def?.label ?? rawKey,
        unit: def?.unit && def.unit !== "bits" ? def.unit : "",
        group: def ? groupForRegister(def) : "outros",
        value: n ?? (typeof rawValue === "string" ? rawValue : null),
        text: def?.enum && n !== null ? def.enum[n] ?? `código ${n} (não documentado)` : null,
        known: !!def,
      });
      continue;
    }

    const spec = fsSpec(kind, rawKey);
    const value = n !== null ? (spec?.convert ? round(spec.convert(n)) : n) : typeof rawValue === "string" ? rawValue : null;
    points.push({
      rawKey,
      label: spec?.label ?? rawKey,
      unit: spec?.unit ?? "",
      group: spec?.group ?? "outros",
      value,
      text: spec?.text && n !== null ? spec.text(n) : null,
      known: !!spec,
    });
  }

  const order = new Map(GROUP_ORDER.map((g, i) => [g, i]));
  return points.sort(
    (a, b) => order.get(a.group)! - order.get(b.group)! || naturalCompare(a.label, b.label),
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** "PV2" antes de "PV10". */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
}

/** Classifica o tipo de equipamento pelo devTypeId da FusionSolar. */
export function kindFromDevTypeId(devTypeId: number): DeviceKind {
  switch (devTypeId) {
    case 1: // inversor string
    case 38: // inversor residencial
      return "inverter";
    case 39: // bateria residencial
    case 41: // ESS comercial/industrial
      return "ess";
    case 10: // estação meteorológica (EMI)
      return "emi";
    case 17: // medidor do ponto de conexão
    case 47: // sensor de potência
      return "meter";
    default:
      return "other";
  }
}

/** Resumo para cartões: os números que identificam a saúde do equipamento num relance. */
export function summarize(points: TelemetryPoint[]): {
  status: string | null;
  temperatures: { label: string; value: number }[];
  strings: { n: number; voltage: number | null; current: number | null }[];
} {
  // O estado de operação do equipamento vem antes de "comunicação com a nuvem".
  const STATUS_KEYS = ["inverter_state", "deviceStatus", "battery_status", "blackStartStatus"];
  const status =
    STATUS_KEYS.map((k) => points.find((p) => p.rawKey === k && p.text)).find(Boolean)?.text ??
    points.find((p) => p.group === "estado" && p.text)?.text ??
    null;
  const temperatures = points
    .filter((p) => p.group === "temperatura" && typeof p.value === "number")
    .map((p) => ({ label: p.label, value: p.value as number }));

  const byString = new Map<number, { n: number; voltage: number | null; current: number | null }>();
  for (const p of points) {
    if (p.group !== "strings") continue;
    const m = /PV(\d+)/.exec(p.label);
    if (!m) continue;
    const n = Number(m[1]);
    const s = byString.get(n) ?? { n, voltage: null, current: null };
    if (typeof p.value === "number") {
      if (p.unit === "V") s.voltage = p.value;
      if (p.unit === "A") s.current = p.value;
    }
    byString.set(n, s);
  }
  // string sem tensão nem corrente não está conectada: fora do resumo
  const strings = Array.from(byString.values()).filter((s) => (s.voltage ?? 0) !== 0 || (s.current ?? 0) !== 0).sort((a, b) => a.n - b.n);
  return { status, temperatures, strings };
}
