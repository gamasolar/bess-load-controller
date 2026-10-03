/**
 * Captura do pacote bruto que a FusionSolar já entrega a cada consulta.
 *
 * O ciclo de controle chama `getDevRealKpi` para baterias e inversores e
 * aproveita meia dúzia de campos. O resto (temperatura, tensões, correntes,
 * strings, estado, valores individuais de cada bateria) era descartado. Esta
 * captura guarda TUDO, por equipamento, SEM fazer nenhuma consulta a mais.
 *
 * Regra de ouro: telemetria nunca pode afetar o controle da bomba. Nada aqui
 * lança exceção para quem chama, nada aqui é lido pelo control-engine.
 * Desligar: variável de ambiente TELEMETRY_CAPTURE=off.
 */

import { getAllSites } from "./db";
import { kindFromDevTypeId, type DeviceKind } from "./telemetry-catalog";
import { dbTelemetryStore, type TelemetryStore } from "./telemetry-store";

/** Item devolvido pelo `getDevRealKpi` da Northbound. */
export interface RawKpiItem {
  devId?: number | string;
  sn?: string;
  collectTime?: number | string;
  dataItemMap?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SiteResolution {
  siteId: number;
}

export interface CaptureDeps {
  store: TelemetryStore;
  /** A que planta pertence este devId? null = equipamento desconhecido (não grava). */
  resolveSite: (devId: string) => Promise<SiteResolution | null>;
  now: () => Date;
  log: (msg: string) => void;
}

export interface CaptureResult {
  received: number;
  stored: number;
  duplicates: number;
  skipped: number;
}

/** Remove campos sem valor: a Huawei manda null para o que o equipamento não mede. */
export function compactData(map: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    if (typeof v === "string" && (v === "" || v === "N/A")) continue;
    out[k] = v;
  }
  return out;
}

/** Instante da medição: o collectTime da Huawei se for plausível; senão, agora. */
export function resolveCollectedAt(collectTime: unknown, now: Date): Date {
  const ms = typeof collectTime === "string" ? Number(collectTime) : collectTime;
  if (typeof ms === "number" && Number.isFinite(ms)) {
    const skew = ms - now.getTime();
    // aceita até 1 dia no passado e 10 min no futuro (relógios desalinhados)
    if (skew > -86_400_000 && skew < 600_000) return new Date(ms);
  }
  return now;
}

export function createFusionSolarCapture(deps: CaptureDeps) {
  return async function capture(devTypeId: number, items: unknown): Promise<CaptureResult> {
    const result: CaptureResult = { received: 0, stored: 0, duplicates: 0, skipped: 0 };
    if (!Array.isArray(items)) return result;
    const kind: DeviceKind = kindFromDevTypeId(devTypeId);
    for (const raw of items as RawKpiItem[]) {
      result.received++;
      try {
        const devId = raw?.devId != null ? String(raw.devId) : "";
        const data = compactData(raw?.dataItemMap ?? {});
        if (!devId || Object.keys(data).length === 0) { result.skipped++; continue; }
        const site = await deps.resolveSite(devId);
        if (!site) { result.skipped++; continue; }
        const deviceId = await deps.store.upsertDevice({
          siteId: site.siteId, source: "fusionsolar", externalId: devId, kind, devTypeId,
          serial: typeof raw.sn === "string" && raw.sn ? raw.sn : null,
        });
        if (deviceId === null) { result.skipped++; continue; }
        const inserted = await deps.store.insertSample(deviceId, resolveCollectedAt(raw.collectTime, deps.now()), data);
        if (inserted) result.stored++; else result.duplicates++;
      } catch (e) {
        result.skipped++;
        deps.log(`[Telemetria] falha ao gravar amostra: ${(e as Error).message}`);
      }
    }
    return result;
  };
}

// ── Instância de produção ──────────────────────────────────────────────

const SITE_CACHE_MS = 5 * 60_000;
let siteCache: { at: number; map: Map<string, number> } | null = null;

function parseIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

async function resolveSiteFromDb(devId: string): Promise<SiteResolution | null> {
  const now = Date.now();
  if (!siteCache || now - siteCache.at > SITE_CACHE_MS) {
    const map = new Map<string, number>();
    for (const site of await getAllSites()) {
      for (const id of parseIds(site.fusionsolarDeviceIds)) map.set(id, site.id);
      for (const id of parseIds(site.fusionsolarInverterIds)) map.set(id, site.id);
    }
    siteCache = { at: now, map };
  }
  const siteId = siteCache.map.get(devId);
  return siteId === undefined ? null : { siteId };
}

let lastLogAt = 0;
const throttledLog = (msg: string) => {
  const now = Date.now();
  if (now - lastLogAt < 60_000) return;
  lastLogAt = now;
  console.warn(msg);
};

const productionCapture = createFusionSolarCapture({
  store: dbTelemetryStore,
  resolveSite: resolveSiteFromDb,
  now: () => new Date(),
  log: throttledLog,
});

export function isTelemetryCaptureEnabled(): boolean {
  return (process.env.TELEMETRY_CAPTURE ?? "on").toLowerCase() !== "off";
}

/** Ponto de entrada usado pelo listener do FusionSolarClient. Nunca lança. */
export async function captureFusionSolarKpi(devTypeId: number, items: unknown): Promise<void> {
  if (!isTelemetryCaptureEnabled()) return;
  try {
    await productionCapture(devTypeId, items);
  } catch (e) {
    throttledLog(`[Telemetria] captura falhou: ${(e as Error).message}`);
  }
}
