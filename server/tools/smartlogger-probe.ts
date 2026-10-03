/**
 * Sonda de campo do Huawei SmartLogger3000 — SOMENTE LEITURA.
 *
 * Uso (a partir da raiz do repositório):
 *
 *   pnpm tsx server/tools/smartlogger-probe.ts --host 192.168.8.10
 *   pnpm tsx server/tools/smartlogger-probe.ts --host 192.168.8.10 --scan 1-30
 *   pnpm tsx server/tools/smartlogger-probe.ts --host 192.168.8.10 --watch 10 --samples 30
 *   pnpm tsx server/tools/smartlogger-probe.ts --host 192.168.8.10 --emi 5
 *   pnpm tsx server/tools/smartlogger-probe.ts --host 192.168.8.10 --json > retrato.json
 *
 * Para levar a um computador sem o repositório (um arquivo só, sem dependências):
 *
 *   npx esbuild server/tools/smartlogger-probe.ts --bundle --platform=node --format=esm \
 *       --outfile=smartlogger-probe.mjs
 *   node smartlogger-probe.mjs --host 192.168.8.10
 *
 * O que ela faz: lê o retrato da planta, decodifica alarmes, descobre os
 * dispositivos e seus Unit IDs, e no modo --watch calibra o sinal da potência
 * do ESS contra os contadores de energia. Não escreve nada: o cliente Modbus
 * só implementa as funções 0x03 e 0x2B.
 */

import { pathToFileURL } from "node:url";
import { ModbusTcpReader, DEFAULT_PORT, DEFAULT_TIMEOUT_MS } from "../modbus-tcp";
import { EMI_REGISTERS, METER_REGISTERS, PLANT_REGISTERS, type RegisterDef } from "../smartlogger-map";
import {
  CONTROL_KEYS, describeValue, inferEssSign, readDeviceList, readPlantSnapshot, readRegisters, scanDevices,
  type PlantSnapshot, type RegisterValue, type SignSample,
} from "../smartlogger";

export interface ProbeArgs {
  host: string;
  port: number;
  timeoutMs: number;
  scanFrom: number;
  scanTo: number;
  scan: boolean;
  watchS: number | null;
  samples: number;
  json: boolean;
  maxGap: number;
  emiUnit: number | null;
  meterUnit: number | null;
  help: boolean;
}

export function parseArgs(argv: string[]): ProbeArgs {
  const a: ProbeArgs = {
    host: "", port: DEFAULT_PORT, timeoutMs: DEFAULT_TIMEOUT_MS, scanFrom: 1, scanTo: 20, scan: true,
    watchS: null, samples: 30, json: false, maxGap: 0, emiUnit: null, meterUnit: null, help: false,
  };
  const int = (name: string, v: string | undefined, min: number, max: number): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name}: esperava inteiro entre ${min} e ${max}, veio "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    switch (k) {
      case "--host": a.host = next() ?? ""; break;
      case "--port": a.port = int("--port", next(), 1, 65535); break;
      case "--timeout": a.timeoutMs = int("--timeout", next(), 100, 60000); break;
      case "--scan": {
        const m = /^(\d+)-(\d+)$/.exec(next() ?? "");
        if (!m) throw new Error("--scan: use o formato 1-20");
        a.scanFrom = int("--scan início", m[1], 1, 247);
        a.scanTo = int("--scan fim", m[2], a.scanFrom, 247);
        break;
      }
      case "--no-scan": a.scan = false; break;
      case "--watch": a.watchS = int("--watch", next(), 1, 3600); break;
      case "--samples": a.samples = int("--samples", next(), 2, 100000); break;
      case "--gap": a.maxGap = int("--gap", next(), 0, 120); break;
      case "--emi": a.emiUnit = int("--emi", next(), 1, 247); break;
      case "--meter": a.meterUnit = int("--meter", next(), 1, 247); break;
      case "--json": a.json = true; break;
      case "-h": case "--help": a.help = true; break;
      default: throw new Error(`Opção desconhecida: ${k}`);
    }
  }
  if (!a.help && !a.host) throw new Error("Informe --host <ip do SmartLogger>");
  return a;
}

const HELP = `Sonda do SmartLogger3000 — somente leitura (Modbus TCP, funções 0x03 e 0x2B)

  --host <ip>        IP do SmartLogger (obrigatório)
  --port <n>         porta Modbus TCP (padrão 502)
  --timeout <ms>     tempo de espera por resposta (padrão 5000, o que a Huawei define)
  --scan <a-b>       faixa de Unit IDs a varrer atrás de dispositivos (padrão 1-20)
  --no-scan          não varrer dispositivos
  --watch <s>        acompanhar a cada <s> segundos e calibrar o sinal da potência do ESS
  --samples <n>      número de amostras no --watch (padrão 30)
  --emi <unit>       ler a estação meteorológica nesse Unit ID
  --meter <unit>     ler o medidor de energia nesse Unit ID
  --gap <n>          permitir até n endereços não documentados no meio de um bloco (padrão 0)
  --json             saída em JSON
`;

// ── Formatação ─────────────────────────────────────────────────────────

function fmt(def: RegisterDef, v: RegisterValue): string {
  if (v === null || v === undefined) return "—";
  const text = describeValue(def, v);
  if (text) return `${v}  (${text})`;
  if (typeof v === "string") return v || "(vazio)";
  const digits = def.gain >= 1000 ? 3 : def.gain >= 100 ? 2 : def.gain >= 10 ? 1 : 0;
  return `${v.toFixed(digits)}${def.unit && def.unit !== "bits" ? " " + def.unit : ""}`;
}

function table(defs: RegisterDef[], values: Record<string, RegisterValue>, errors: Record<string, string>): string {
  const rows = defs.map((d) => {
    const val = errors[d.key] ? `AUSENTE — ${errors[d.key]}` : fmt(d, values[d.key]);
    return `  ${String(d.address).padStart(5)}  ${d.label.padEnd(58).slice(0, 58)}  ${val}`;
  });
  return rows.join("\n");
}

export function renderSnapshot(snap: PlantSnapshot): string {
  const v = snap.values;
  const def = (k: string) => PLANT_REGISTERS.find((d) => d.key === k)!;
  const line = (k: string) => `  ${def(k).label.padEnd(46)} ${snap.errors[k] ? "AUSENTE" : fmt(def(k), v[k])}`;
  const out: string[] = [];

  out.push("── O ESSENCIAL ─────────────────────────────────────────────────────────");
  for (const k of ["soc", "essActivePowerKw", "batteryChargeDischargeKw", "pvActivePowerKw", "totalActivePowerKw"]) out.push(line(k));
  out.push(`  ${"Carga estimada (FV + saída do ESS) [derivado]".padEnd(46)} ${snap.derived.loadKw === null ? "—" : snap.derived.loadKw.toFixed(3) + " kW"}`);
  for (const k of ["dischargeableCapacityKwh", "essEndOfDischargeSoc", "maxDischargePowerKw", "runningEssPcs", "pcsWorkingMode", "blackStartStatus"]) out.push(line(k));

  out.push("");
  out.push("── AVISOS ──────────────────────────────────────────────────────────────");
  out.push(snap.warnings.length ? snap.warnings.map((w) => "  ! " + w).join("\n") : "  nenhum");

  out.push("");
  out.push("── ALARMES ATIVOS DO SMARTLOGGER (50000–50007) ─────────────────────────");
  const words = Object.entries(snap.alarmWords)
    .map(([reg, w]) => `${reg}=${w === null ? "ausente" : "0x" + w.toString(16).padStart(4, "0")}`).join("  ");
  out.push("  " + words);
  if (snap.alarms.length === 0) out.push("  nenhum alarme ativo");
  for (const al of snap.alarms) {
    out.push(`  [${al.severity}] ${al.alarmId}/${al.subId} ${al.label}${al.ambiguous ? "  (bit ambíguo no documento)" : ""}`);
  }
  for (const b of snap.unknownAlarmBits) out.push(`  [?] bit ${b.bit} do registrador ${b.register} ligado e não documentado na Issue 47`);

  out.push("");
  out.push("── TODOS OS REGISTRADORES DE PLANTA (Unit ID 0) ────────────────────────");
  out.push(table(PLANT_REGISTERS, v, snap.errors));
  const missing = Object.keys(snap.errors).length;
  out.push("");
  out.push(`  ${PLANT_REGISTERS.length - missing} de ${PLANT_REGISTERS.length} registradores responderam; ${snap.requests} requisições.`);
  return out.join("\n");
}

// ── Execução ───────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runReport(reader: ModbusTcpReader, args: ProbeArgs): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const log = (s: string) => { if (!args.json) console.log(s); };

  const snap = await readPlantSnapshot(reader, { maxGap: args.maxGap });
  result.snapshot = snap;
  log(renderSnapshot(snap));

  log("");
  log("── DISPOSITIVOS ────────────────────────────────────────────────────────");
  try {
    const list = await readDeviceList(reader);
    result.deviceList = list;
    log(`  Lista do SmartLogger (função 0x2B): ${list.count ?? "?"} dispositivo(s)`);
    for (const d of list.devices) {
      log(`    nº ${d.deviceNumber ?? "?"}  ${(d.model ?? "?").padEnd(22)} ${(d.softwareVersion ?? "").padEnd(20)} SN ${d.esn ?? "?"}`);
    }
  } catch (e) {
    result.deviceListError = (e as Error).message;
    log(`  Lista pela função 0x2B indisponível neste firmware: ${(e as Error).message}`);
  }

  if (args.scan) {
    const found = await scanDevices(reader, args.scanFrom, args.scanTo);
    result.devices = found;
    log(`  Varredura dos Unit IDs ${args.scanFrom}–${args.scanTo}: ${found.length} dispositivo(s)`);
    for (const d of found) {
      log(
        `    Unit ID ${String(d.unitId).padStart(3)}  ${d.online ? "online " : "OFFLINE"}  SN ${String(d.values.serialNumber ?? "?").padEnd(20)} ` +
        `apelido "${d.values.alias ?? ""}"  tipo ${d.values.equipmentType ?? "?"}  porta ${d.values.portNumber ?? "?"}  end. físico ${d.values.physicalAddress ?? "?"}`,
      );
    }
    if (found.length === 0) log("    nenhum — confira o Address mode (Logical address) e a faixa de --scan");
  }

  for (const [label, unit, defs] of [["ESTAÇÃO METEOROLÓGICA (EMI)", args.emiUnit, EMI_REGISTERS], ["MEDIDOR", args.meterUnit, METER_REGISTERS]] as const) {
    if (unit === null) continue;
    log("");
    log(`── ${label} — Unit ID ${unit} ──`);
    const res = await readRegisters(reader, unit, defs);
    result[label] = res;
    log(table(defs, res.values, res.errors));
  }

  log("");
  const sent = Array.from(reader.sentFunctionCodes.entries());
  log(`Funções Modbus enviadas: ${sent.map(([fc, n]) => `0x${fc.toString(16).padStart(2, "0")}×${n}`).join(", ")} — nenhuma escrita.`);
  return result;
}

async function runWatch(reader: ModbusTcpReader, args: ProbeArgs): Promise<Record<string, unknown>> {
  const a: SignSample[] = [];
  const b: SignSample[] = [];
  const log = (s: string) => { if (!args.json) console.log(s); };
  log(`Acompanhando a cada ${args.watchS} s, ${args.samples} amostras. Ctrl+C para parar.`);
  log("  hora      SOC %   ESS 40392 kW   bat 40507 kW   FV kW    carga kW   carreg. hoje   descarr. hoje   PCS");
  for (let i = 0; i < args.samples; i++) {
    const snap = await readPlantSnapshot(reader, { keys: CONTROL_KEYS, withAlarms: false });
    const v = snap.values;
    const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);
    const f = (x: number | null, d: number, w: number) => (x === null ? "—" : x.toFixed(d)).padStart(w);
    const base = { t: snap.readAt.getTime(), chargedTodayKwh: n("energyChargedTodayKwh"), dischargedTodayKwh: n("energyDischargedTodayKwh") };
    a.push({ ...base, essPowerKw: n("essActivePowerKw") });
    b.push({ ...base, essPowerKw: n("batteryChargeDischargeKw") });
    log(
      `  ${snap.readAt.toTimeString().slice(0, 8)}  ${f(n("soc"), 1, 5)}  ${f(n("essActivePowerKw"), 3, 12)}  ${f(n("batteryChargeDischargeKw"), 3, 13)}  ` +
      `${f(n("pvActivePowerKw"), 2, 7)}  ${f(snap.derived.loadKw, 2, 9)}  ${f(base.chargedTodayKwh, 2, 13)}  ${f(base.dischargedTodayKwh, 2, 14)}  ${f(n("runningEssPcs"), 0, 4)}`,
    );
    if (i < args.samples - 1) await sleep(args.watchS! * 1000);
  }
  const s392 = inferEssSign(a);
  const s507 = inferEssSign(b);
  log("");
  log("── CALIBRAÇÃO DO SINAL (potência × contadores de energia) ──────────────");
  log(`  40392 Potência ativa do ESS:        ${s392.convention} — ${s392.reason}`);
  log(`  40507 Carga/descarga da bateria:    ${s507.convention} — ${s507.reason}`);
  log("  O banco do dashboard usa positivo = carga. Se aqui der 'positivo = descarga', o valor entra com o sinal trocado.");
  log("  Para fechar a calibração, repita em um período de CARGA (dia, FV sobrando) e em um de DESCARGA (noite ou bomba ligada).");
  return { samples: a, sign40392: s392, sign40507: s507 };
}

export async function main(argv: string[]): Promise<number> {
  let args: ProbeArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message + "\n\n" + HELP);
    return 2;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  const reader = new ModbusTcpReader({ host: args.host, port: args.port, timeoutMs: args.timeoutMs });
  if (!args.json) {
    console.log(`Sonda do SmartLogger — SOMENTE LEITURA — ${args.host}:${args.port} — ${new Date().toISOString()}`);
    console.log("");
  }
  try {
    const result = args.watchS !== null ? await runWatch(reader, args) : await runReport(reader, args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`\nFALHA: ${msg}`);
    console.error(
      "Verifique: (1) Settings > Comm. Param. > Modbus TCP com Link setting em Enable(Limited) e o IP desta máquina na lista; " +
      "(2) Address mode em Logical address; (3) MGCC Mode em Disable — com MGCC ligado o SmartLogger desliga o Modbus TCP; " +
      "(4) rota/firewall até o SmartLogger na porta " + args.port + ".",
    );
    return 1;
  } finally {
    reader.close();
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
