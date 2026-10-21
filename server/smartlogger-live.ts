/**
 * Leitura AO VIVO do SmartLogger, direto da usina por Modbus TCP (rede
 * privada WireGuard). É a "camada 1" da escada de fontes combinada com o
 * operador: o servidor lê o SmartLogger a cada ~10 s (tela ao vivo) e grava
 * a cada ~30 s em `smartlogger_live`. Independe do Pi: se o Pi travar,
 * reiniciar ou desligar, esta leitura não pisca, porque nunca dependeu dele.
 *
 * SOMENTE LEITURA. Reusa `readPlantSnapshot` sobre o cliente Modbus que só
 * implementa 0x03/0x2B. NÃO toca em bess_state / bess_readings nem no
 * control-engine (caminho crítico, CLAUDE.md §14): só alimenta a tabela
 * própria e o cache em memória que a tela vai consumir depois.
 *
 * Config (no .env):
 *   SMARTLOGGER_HOSTS=barragem=192.168.88.250            (slug=host[:porta], vírgula separa)
 *   SMARTLOGGER_LIVE=off                                 (desliga tudo; padrão ligado se há hosts)
 *   SMARTLOGGER_LIVE_INTERVAL_MS=10000                   (ritmo da leitura/tela)
 *   SMARTLOGGER_LIVE_STORE_MS=30000                      (ritmo de gravação no banco)
 */

import { getDb, getAllSites } from "./db";
import { smartloggerLive, type InsertSmartloggerLive } from "../drizzle/schema";
import { ModbusTcpReader } from "./modbus-tcp";
import { readPlantSnapshot, type RegisterValue } from "./smartlogger";

/** Grandezas lidas a cada ciclo. Enxuto de propósito: sem alarmes por tick (são 8 reads a mais). */
const LIVE_KEYS = [
  "soc", "soh", "essActivePowerKw", "pvActivePowerKw", "totalActivePowerKw",
  "dischargeableCapacityKwh", "maxDischargePowerKw", "runningEssPcs", "voltageAB", "activeAlarmSeq",
] as const;

export interface SiteModbusTarget {
  slug: string;
  host: string;
  port: number;
}

/** Converte um RegisterValue em número finito ou null (nunca NaN/Infinity/string). */
function n(v: RegisterValue | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Mapeia o retrato Modbus para as colunas de `smartlogger_live`. Puro — testável. */
export function snapshotToRow(
  siteId: number,
  readAt: Date,
  values: Record<string, RegisterValue>,
): Omit<InsertSmartloggerLive, "id" | "createdAt"> {
  return {
    siteId,
    source: "direct",
    readAt,
    ok: true,
    soc: n(values.soc),
    soh: n(values.soh),
    essPowerKw: n(values.essActivePowerKw),
    pvPowerKw: n(values.pvActivePowerKw),
    loadKw: n(values.totalActivePowerKw),
    dischargeableKwh: n(values.dischargeableCapacityKwh),
    maxDischargeKw: n(values.maxDischargePowerKw),
    pcsRunning: n(values.runningEssPcs),
    voltageAbV: n(values.voltageAB),
    alarmSeq: n(values.activeAlarmSeq),
    err: null,
  };
}

/**
 * Lê `SMARTLOGGER_HOSTS` no formato `slug=host[:porta]`, vírgula separando.
 * Ignora entradas malformadas. Puro — testável.
 */
export function parseHosts(raw: string | undefined): Array<{ slug: string; host: string; port: number }> {
  const out: Array<{ slug: string; host: string; port: number }> = [];
  for (const part of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const slug = part.slice(0, eq).trim();
    const addr = part.slice(eq + 1).trim();
    if (!slug || !addr) continue;
    const colon = addr.lastIndexOf(":");
    const host = colon > 0 ? addr.slice(0, colon) : addr;
    const port = colon > 0 ? Number(addr.slice(colon + 1)) : 502;
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    out.push({ slug, host, port });
  }
  return out;
}

export function isSmartloggerLiveEnabled(): boolean {
  if ((process.env.SMARTLOGGER_LIVE ?? "on").trim().toLowerCase() === "off") return false;
  return parseHosts(process.env.SMARTLOGGER_HOSTS).length > 0;
}

/** Retrato em memória da leitura mais recente de um site (o que a tela vai ler). */
export interface LiveSnapshot {
  slug: string;
  siteId: number;
  source: "direct";
  readAt: Date;
  ok: boolean;
  err: string | null;
  values: Omit<InsertSmartloggerLive, "id" | "createdAt" | "siteId" | "source" | "readAt" | "ok" | "err">;
}

interface SiteRunner {
  target: SiteModbusTarget;
  siteId: number;
  reader: ModbusTcpReader;
  latest: LiveSnapshot | null;
  inFlight: boolean;
  readTimer: ReturnType<typeof setInterval> | null;
  storeTimer: ReturnType<typeof setInterval> | null;
  lastErrLoggedAt: number;
}

const _runners = new Map<string, SiteRunner>();
let _started = false;

/** Leitura mais recente em memória de um site (null se nunca leu). Para a tela/escada de fontes. */
export function getLiveSnapshot(slug: string): LiveSnapshot | null {
  return _runners.get(slug)?.latest ?? null;
}

const READ_MS = () => Math.max(2000, Number(process.env.SMARTLOGGER_LIVE_INTERVAL_MS) || 10_000);
const STORE_MS = () => Math.max(5000, Number(process.env.SMARTLOGGER_LIVE_STORE_MS) || 30_000);

async function readOnce(r: SiteRunner): Promise<void> {
  if (r.inFlight) return; // nunca sobrepor ciclos (leitura lenta não acumula)
  r.inFlight = true;
  try {
    const snap = await readPlantSnapshot(r.reader, { keys: LIVE_KEYS, withAlarms: false });
    const row = snapshotToRow(r.siteId, snap.readAt, snap.values);
    const { siteId: _s, source: _src, readAt: _r, ok: _ok, err: _e, ...values } = row;
    void _s; void _src; void _r; void _ok; void _e;
    r.latest = { slug: r.target.slug, siteId: r.siteId, source: "direct", readAt: snap.readAt, ok: true, err: null, values };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    r.latest = {
      slug: r.target.slug, siteId: r.siteId, source: "direct", readAt: new Date(), ok: false,
      err: msg.slice(0, 120),
      values: { soc: null, soh: null, essPowerKw: null, pvPowerKw: null, loadKw: null, dischargeableKwh: null, maxDischargeKw: null, pcsRunning: null, voltageAbV: null, alarmSeq: null },
    };
    const now = Date.now();
    if (now - r.lastErrLoggedAt > 60_000) { // no máximo 1 log de erro por minuto por site
      r.lastErrLoggedAt = now;
      console.warn(`[SmartloggerLive] ${r.target.slug}: leitura falhou — ${msg.slice(0, 120)}`);
    }
  } finally {
    r.inFlight = false;
  }
}

async function storeOnce(r: SiteRunner): Promise<void> {
  const snap = r.latest;
  if (!snap) return;
  const db = await getDb();
  if (!db) return;
  try {
    const row: InsertSmartloggerLive = {
      siteId: r.siteId, source: snap.source, readAt: snap.readAt, ok: snap.ok, err: snap.err, ...snap.values,
    };
    await db.insert(smartloggerLive).values(row);
  } catch (e) {
    const now = Date.now();
    if (now - r.lastErrLoggedAt > 60_000) {
      r.lastErrLoggedAt = now;
      console.warn(`[SmartloggerLive] ${r.target.slug}: gravação falhou — ${e instanceof Error ? e.message : e}`);
    }
  }
}

export async function startSmartloggerLive(): Promise<void> {
  if (_started) return;
  if (!isSmartloggerLiveEnabled()) {
    console.log("[SmartloggerLive] desativado (sem SMARTLOGGER_HOSTS ou SMARTLOGGER_LIVE=off)");
    return;
  }
  const db = await getDb();
  if (!db) { console.warn("[SmartloggerLive] DB indisponível — desativado"); return; }

  const sites = await getAllSites();
  const bySlug = new Map(sites.map((s) => [s.slug, s]));
  const targets = parseHosts(process.env.SMARTLOGGER_HOSTS);
  const readMs = READ_MS();
  const storeMs = STORE_MS();

  for (const t of targets) {
    const site = bySlug.get(t.slug);
    if (!site) { console.warn(`[SmartloggerLive] slug "${t.slug}" não existe em bess_sites — ignorado`); continue; }
    const reader = new ModbusTcpReader({ host: t.host, port: t.port });
    const r: SiteRunner = {
      target: { slug: t.slug, host: t.host, port: t.port },
      siteId: site.id, reader, latest: null, inFlight: false,
      readTimer: null, storeTimer: null, lastErrLoggedAt: 0,
    };
    _runners.set(t.slug, r);
    void readOnce(r); // primeira leitura imediata
    r.readTimer = setInterval(() => void readOnce(r), readMs);
    r.storeTimer = setInterval(() => void storeOnce(r), storeMs);
    console.log(`[SmartloggerLive] ${t.slug}: lendo ${t.host}:${t.port} a cada ${readMs / 1000}s, gravando a cada ${storeMs / 1000}s`);
  }
  _started = _runners.size > 0;
}

export function stopSmartloggerLive(): void {
  for (const r of Array.from(_runners.values())) {
    if (r.readTimer) clearInterval(r.readTimer);
    if (r.storeTimer) clearInterval(r.storeTimer);
    r.reader.close();
  }
  _runners.clear();
  _started = false;
}
