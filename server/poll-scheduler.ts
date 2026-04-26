/**
 * Poll Scheduler — polling adaptativo da FusionSolar.
 *
 * Substitui o startAutoFetch v1 (intervalo fixo de 15min, fetch pesado via
 * getFullTelemetry). Aqui:
 *   - Intervalo varia por site: intervaloPadrao quando SOC tranquilo,
 *     intervaloCritico quando perto do limite (zona crítica).
 *   - Fetch leve: getBatteryRealKpi (só SOC + power + temp) em vez de
 *     getFullTelemetry, mitigando rate limit do Northbound.
 *   - Após cada poll: chama control-engine.evaluateAndAct(slug).
 *
 * Cada site roda em seu próprio loop (setTimeout reagendado), não há
 * setInterval global — assim sites em zona crítica polam mais rápido
 * sem afetar os outros.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { bessSites, bessReadings, bessState } from "../drizzle/schema";
import { getFusionSolarClient, isFusionSolarConfigured } from "./fusionsolar";
import { evaluateAndAct } from "./control-engine";
import { getSiteRuntimeState } from "./control-engine";

const DELAY_BETWEEN_SITES_MS = 15_000; // respeitar rate limit Northbound (10s+)

const _siteTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
let _started = false;

export function isInCriticalZone(
  soc: number,
  socMinDesliga: number,
  margemZonaCritica: number,
): boolean {
  return soc <= socMinDesliga + margemZonaCritica;
}

/**
 * Polla a FusionSolar pra um site, atualiza bess_state/bess_readings,
 * dispara evaluateAndAct e reagenda o próximo poll.
 */
async function pollSite(slug: string): Promise<void> {
  try {
    const runtime = await getSiteRuntimeState(slug);
    if (!runtime) {
      console.warn(`[PollScheduler] ${slug}: runtime indisponível`);
      scheduleNext(slug, 15);
      return;
    }

    const { site, config } = runtime;

    // Sites sem device IDs (ex.: piscinão) — não polla, mas avalia
    if (!site.fusionsolarDeviceIds || !isFusionSolarConfigured()) {
      await evaluateAndAct(slug);
      const intervalMin = runtime.soc !== null && isInCriticalZone(runtime.soc, config.socMinDesliga, config.margemZonaCritica)
        ? config.intervaloCritico
        : config.intervaloPadrao;
      scheduleNext(slug, intervalMin);
      return;
    }

    let batteryDevIdStr = "";
    try {
      const ids = JSON.parse(site.fusionsolarDeviceIds);
      batteryDevIdStr = Array.isArray(ids) ? ids.join(",") : String(ids);
    } catch {
      batteryDevIdStr = "";
    }

    if (!batteryDevIdStr) {
      console.warn(`[PollScheduler] ${slug}: device IDs vazios após parse`);
      await evaluateAndAct(slug);
      scheduleNext(slug, config.intervaloPadrao);
      return;
    }

    const client = getFusionSolarClient();
    const battery = await client.getBatteryRealKpi(batteryDevIdStr);

    const db = await getDb();
    if (battery && battery.battery_soc != null && db) {
      const soc = battery.battery_soc;
      await db.insert(bessReadings).values({
        siteId: site.id,
        soc,
        soh: battery.battery_soh ?? null,
        batteryPower: battery.battery_power ?? null,
        batteryTemperature: battery.battery_temperature ?? null,
        busVoltage: battery.bus_voltage ?? null,
        valid: true,
      });

      await db.update(bessState).set({
        currentSoc: soc,
        currentSoh: battery.battery_soh ?? null,
        currentBatteryPower: battery.battery_power ?? null,
        currentTemperature: battery.battery_temperature ?? null,
        lastTelemetryAt: new Date(),
        socSource: "fusionsolar",
      }).where(eq(bessState.siteId, site.id));

      console.log(`[PollScheduler] ${slug}: SOC=${soc.toFixed(1)}%`);
    } else {
      console.warn(`[PollScheduler] ${slug}: getBatteryRealKpi retornou vazio`);
    }

    await evaluateAndAct(slug);

    const updated = await getSiteRuntimeState(slug);
    const intervalMin = updated?.soc !== null && updated?.soc !== undefined
      && isInCriticalZone(updated.soc, updated.config.socMinDesliga, updated.config.margemZonaCritica)
      ? config.intervaloCritico
      : config.intervaloPadrao;

    scheduleNext(slug, intervalMin);
  } catch (e) {
    console.error(`[PollScheduler] ${slug}: erro no poll —`, e);
    scheduleNext(slug, 15);
  }
}

function scheduleNext(slug: string, intervalMinutes: number): void {
  const ms = intervalMinutes * 60_000;
  const timer = setTimeout(() => pollSite(slug), ms);
  _siteTimers.set(slug, timer);
}

export async function startAdaptivePolling(): Promise<void> {
  if (_started) return;
  _started = true;

  const db = await getDb();
  if (!db) {
    console.warn("[PollScheduler] DB indisponível — desativado");
    _started = false;
    return;
  }

  const sites = await db.select().from(bessSites).where(eq(bessSites.isActive, true));
  console.log(`[PollScheduler] Iniciando polling adaptativo pra ${sites.length} sites`);

  // Stagger initial polls pra evitar bursting na FusionSolar
  sites.forEach((site, i) => {
    setTimeout(() => pollSite(site.slug), 30_000 + i * DELAY_BETWEEN_SITES_MS);
  });
}

export function stopAdaptivePolling(): void {
  for (const timer of _siteTimers.values()) {
    clearTimeout(timer);
  }
  _siteTimers.clear();
  _started = false;
}
