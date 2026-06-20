/**
 * Poll Scheduler — polling com cadência fixa por site.
 *
 * Cadência (fixa, sem cálculo dinâmico):
 *   - intervaloPadrao   — SOC normal dentro da janela horária
 *   - intervaloCritico  — SOC <= socMinDesliga + margemZonaCritica
 *   - intervaloNoturno  — fora da janela com bomba OFF
 *   - intervaloBombaSemSolar — fora da janela com bomba ON
 *
 * Operador define os intervalos na UI; código respeita literalmente.
 * triggerSitePoll() força reagendamento imediato após mudança de
 * config/modo/comando manual.
 *
 * Cada site roda em seu próprio loop (setTimeout reagendado).
 */

import { eq } from "drizzle-orm";
import { getDb, addAlarm, closeAlarmsByType } from "./db";
import { bessSites, bessReadings, bessState } from "../drizzle/schema";
import { getFusionSolarClient, isFusionSolarConfigured } from "./fusionsolar";
import { evaluateAndAct } from "./control-engine";
import { getSiteRuntimeState } from "./control-engine";
import { evaluateLoadHealth } from "./load-monitor";

const DELAY_BETWEEN_SITES_MS = 15_000; // respeitar rate limit Northbound (10s+)

const _siteTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
let _started = false;

/**
 * Coage valores não-finitos (NaN, Infinity) e undefined/null para null.
 * Sem isso, um NaN vindo da FusionSolar (ex.: battery_power parcial) chega
 * cru no MySQL como literal "NaN" e derruba a gravação INTEIRA do bess_state
 * (ER_BAD_FIELD_ERROR), congelando SOC/telemetria do site até o próximo poll bom.
 */
function fin(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function isInCriticalZone(
  soc: number,
  socMinDesliga: number,
  margemZonaCritica: number,
): boolean {
  return soc <= socMinDesliga + margemZonaCritica;
}

/**
 * Decide o intervalo de polling em minutos. Regras fixas:
 *   1. Fora da janela horária + bomba OFF → intervaloNoturno
 *      (nada pode mudar — religar exige janela)
 *   2. Zona crítica → intervaloCritico
 *   3. Bomba ON fora da janela → intervaloBombaSemSolar
 *   4. Demais → intervaloPadrao
 *
 * Cooldown cap: se cooldownUntilMs termina antes do intervalo natural,
 * antecipa pro fim do cooldown + 30s de buffer (auto-religa dispara
 * logo após cooldown abrir, não no próximo tick natural).
 */
export function pickPollInterval(opts: {
  socInCriticalZone: boolean;
  pumpOff: boolean;
  hourMinute: { h: number; m: number };
  horarioLiberacao: string;
  horarioCorte: string;
  intervaloPadrao: number;
  intervaloCritico: number;
  intervaloNoturno: number;
  intervaloBombaSemSolar: number;
  cooldownUntilMs?: number | null;
  nowMs?: number;
}): number {
  const parseHHMM = (s: string): number => {
    const parts = s.split(":");
    const h = Number(parts[0]) || 0;
    const m = Number(parts[1]) || 0;
    return h * 60 + m;
  };
  const minutesNow = opts.hourMinute.h * 60 + opts.hourMinute.m;
  const insideWindow = minutesNow >= parseHHMM(opts.horarioLiberacao)
    && minutesNow < parseHHMM(opts.horarioCorte);

  const COOLDOWN_BUFFER_MIN = 0.5;
  const COOLDOWN_FLOOR_MIN = 0.5;
  const applyCooldownCap = (intervalMin: number): number => {
    if (opts.cooldownUntilMs == null) return intervalMin;
    const now = opts.nowMs ?? Date.now();
    const remainingMin = (opts.cooldownUntilMs - now) / 60_000;
    if (remainingMin <= 0) return intervalMin;
    const cooldownPoll = Math.max(COOLDOWN_FLOOR_MIN, remainingMin + COOLDOWN_BUFFER_MIN);
    return Math.min(intervalMin, cooldownPoll);
  };

  if (!insideWindow && opts.pumpOff) return applyCooldownCap(opts.intervaloNoturno);
  if (opts.socInCriticalZone) return applyCooldownCap(opts.intervaloCritico);

  const baseInterval = (!insideWindow && !opts.pumpOff)
    ? opts.intervaloBombaSemSolar
    : opts.intervaloPadrao;
  return applyCooldownCap(baseInterval);
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
      const now = new Date();
      const intervalMin = pickPollInterval({
        socInCriticalZone: runtime.soc !== null && isInCriticalZone(runtime.soc, config.socMinDesliga, config.margemZonaCritica),
        pumpOff: runtime.pumpState !== "ON",
        hourMinute: { h: now.getHours(), m: now.getMinutes() },
        horarioLiberacao: config.horarioLiberacao,
        horarioCorte: config.horarioCorte,
        intervaloPadrao: config.intervaloPadrao,
        intervaloCritico: config.intervaloCritico,
        intervaloNoturno: config.intervaloNoturno,
        intervaloBombaSemSolar: config.intervaloBombaSemSolar,
        cooldownUntilMs: runtime.state.cooldownUntil
          ? new Date(runtime.state.cooldownUntil).getTime()
          : null,
      });
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

    let inverterDevIdStr = "";
    if (site.fusionsolarInverterIds) {
      try {
        const invIds = JSON.parse(site.fusionsolarInverterIds);
        inverterDevIdStr = Array.isArray(invIds) ? invIds.join(",") : String(invIds);
      } catch {
        inverterDevIdStr = "";
      }
    }

    const client = getFusionSolarClient();
    const battery = await client.getBatteryRealKpi(batteryDevIdStr, 41, site.id);

    const db = await getDb();

    // ── Stage 1: persistir SOC/Bat ANTES da call de inversor ──
    // getInverterRealKpi bloqueia ~70s pra respeitar a janela rolante da Huawei
    // (`/getDevRealKpi` é 1/min POR ENDPOINT, e bat+inv usam o mesmo). Atualizar
    // o state com SOC já agora libera o controle (decideAction só usa SOC) pra
    // atuar sem esperar PV/Load. PV/Load chegam ~70s depois e cobrem o card e o
    // load-monitor.
    if (battery && battery.battery_soc != null && db) {
      const soc = battery.battery_soc;
      const battPower = fin(battery.battery_power);
      await db.update(bessState).set({
        currentSoc: fin(soc),
        currentSoh: fin(battery.battery_soh),
        currentBatteryPower: battPower,
        currentTemperature: fin(battery.battery_temperature),
        lastTelemetryAt: new Date(),
        socSource: "fusionsolar",
      }).where(eq(bessState.siteId, site.id));
      console.log(
        `[PollScheduler] ${slug}: stage1 SOC=${soc.toFixed(1)}%` +
        (battPower != null ? ` Bat=${battPower.toFixed(2)}kW` : "")
      );
    }
    // Controle atua com SOC fresco (não depende de PV/Load).
    await evaluateAndAct(slug);

    // ── Stage 2: call do inversor (espera ~70s no waitForRateLimit) ──
    const inverter = inverterDevIdStr
      ? await client.getInverterRealKpi(inverterDevIdStr, 1)
      : null;

    if (battery && battery.battery_soc != null && db) {
      const soc = battery.battery_soc;
      const battPower = fin(battery.battery_power);
      const pvPower = fin(inverter?.active_power);
      const battDischarge = battPower != null && battPower < 0 ? Math.abs(battPower) : 0;
      const battCharge = battPower != null && battPower > 0 ? battPower : 0;
      const loadPower = pvPower != null
        ? Math.max(0, pvPower + battDischarge - battCharge)
        : null;

      await db.update(bessState).set({
        currentPvPower: pvPower,
        currentLoadPower: fin(loadPower),
        lastTelemetryAt: new Date(),
      }).where(eq(bessState.siteId, site.id));

      console.log(
        `[PollScheduler] ${slug}: stage2 SOC=${soc.toFixed(1)}%` +
        (battPower != null ? ` Bat=${battPower.toFixed(2)}kW` : "") +
        (pvPower != null ? ` PV=${pvPower.toFixed(2)}kW` : "") +
        (loadPower != null ? ` Load=${loadPower.toFixed(2)}kW` : "")
      );

      // Log da compensação de overshoot — só quando feature ativa (factor > 0).
      // Ver DECISION-OVERSHOOT-COMPENSATION.md (2026-05-07).
      if (config.overshootFactor > 0) {
        const descarga = battPower !== null && battPower < 0 ? Math.abs(battPower) : 0;
        const overshootEstimado = descarga * config.overshootFactor;
        const thresholdEfetivo = config.socMinDesliga + overshootEstimado;
        console.log(
          `[ControlEngine] ${slug}: SOC=${soc.toFixed(1)}% Bat=${battPower !== null ? battPower.toFixed(2) : "null"}kW ` +
          `overshoot_estimado=${overshootEstimado.toFixed(1)}pp threshold_efetivo=${thresholdEfetivo.toFixed(1)}%`
        );
      }

      // 2. Load monitor — calcula etiqueta antes da leitura ser persistida pra
      //    que o INSERT carregue o loadHealth (alinha histórico de leituras com saúde).
      let computedLoadHealth: string | null = null;
      try {
        const fresh = await getSiteRuntimeState(slug);
        // Pula load-monitor em sites read-only (sem MQTT/Sonoff) — não temos
        // como verificar Sonoff pra cross-check, então qualquer "FAILED" é
        // falso positivo (a "carga" do FusionSolar é o consumo da planta inteira,
        // não da bomba específica que monitoraríamos via Sonoff).
        if (fresh && process.env.LOAD_MONITOR_ENABLED === "true" && site.mqttTopic) {
          const decision = evaluateLoadHealth({
            state: fresh.state,
            pumpPowerCv: site.pumpPowerCv ?? 30,
            pumpCount: site.pumpCount ?? 1,
            thresholdOverrideKw: process.env.LOAD_MIN_KW_OK
              ? Number(process.env.LOAD_MIN_KW_OK)
              : undefined,
          });

          await db.update(bessState).set({
            loadHealth: decision.health,
            loadFailureSince: decision.nextFailureSince,
          }).where(eq(bessState.siteId, site.id));

          computedLoadHealth = decision.health;

          const shadow = process.env.LOAD_MONITOR_SHADOW === "true";
          if (shadow) {
            console.log(
              `[load-monitor:shadow] ${slug} health=${decision.health}` +
              ` cmd=${fresh.state.loadStatus} sonoff=${fresh.state.sonoffPower}` +
              ` load=${loadPower?.toFixed(2) ?? "null"}kW` +
              ` bat=${battPower?.toFixed(2) ?? "null"}kW pv=${pvPower?.toFixed(2) ?? "null"}kW`
            );
          } else {
            if (decision.health === "FAILED") {
              await addAlarm(
                site.id,
                "WARNING",
                "LOAD_FAILURE",
                `Comando ON sem consumo detectado (carga ${loadPower?.toFixed(1) ?? "?"}kW). Verificar softstarter/motor.`,
              );
            } else if (decision.health === "RUNNING_OK" || decision.health === "OFF_OK") {
              await closeAlarmsByType("LOAD_FAILURE", site.id);
            }
          }
        }
      } catch (err) {
        console.error(`[load-monitor] ${slug}: erro não-fatal —`, err);
      }

      // 3. INSERT da leitura JÁ com loadHealth (histórico unificado).
      await db.insert(bessReadings).values({
        siteId: site.id,
        soc: fin(soc),
        soh: fin(battery.battery_soh),
        batteryPower: battPower,
        batteryTemperature: fin(battery.battery_temperature),
        busVoltage: fin(battery.bus_voltage),
        pvPower,
        loadPower,
        loadHealth: computedLoadHealth,
        valid: true,
      });
    } else {
      console.warn(`[PollScheduler] ${slug}: getBatteryRealKpi retornou vazio`);
    }

    const updated = await getSiteRuntimeState(slug);
    const now = new Date();
    const cfg = updated?.config ?? config;
    const stateRef = updated?.state ?? runtime.state;
    const socCritical = updated?.soc !== null && updated?.soc !== undefined
      && isInCriticalZone(updated.soc, cfg.socMinDesliga, cfg.margemZonaCritica);
    const intervalMin = pickPollInterval({
      socInCriticalZone: !!socCritical,
      pumpOff: (updated?.pumpState ?? runtime.pumpState) !== "ON",
      hourMinute: { h: now.getHours(), m: now.getMinutes() },
      horarioLiberacao: cfg.horarioLiberacao,
      horarioCorte: cfg.horarioCorte,
      intervaloPadrao: cfg.intervaloPadrao,
      intervaloCritico: cfg.intervaloCritico,
      intervaloNoturno: cfg.intervaloNoturno,
      intervaloBombaSemSolar: cfg.intervaloBombaSemSolar,
      cooldownUntilMs: stateRef.cooldownUntil
        ? new Date(stateRef.cooldownUntil).getTime()
        : null,
    });

    scheduleNext(slug, intervalMin);
  } catch (e) {
    console.error(`[PollScheduler] ${slug}: erro no poll —`, e);
    scheduleNext(slug, 15);
  }
}

function scheduleNext(slug: string, intervalMinutes: number): void {
  const ms = intervalMinutes * 60_000;
  const existing = _siteTimers.get(slug);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => pollSite(slug), ms);
  _siteTimers.set(slug, timer);
}

export async function startAdaptivePolling(): Promise<void> {
  if (_started) return;
  // Defesa: nunca rodar em paralelo com o legacy startAutoFetch (v1).
  if (process.env.USE_MVP_V2_CONTROL !== "true") {
    console.warn("[PollScheduler] startAdaptivePolling ignorado — USE_MVP_V2_CONTROL≠true (v1 está ativo).");
    return;
  }
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

/**
 * Força polling imediato de um site, cancelando o timer agendado.
 * Útil quando config muda (intervalo, limites de SOC, etc.) e queremos que o
 * novo valor entre em vigor sem esperar o próximo tick natural.
 * Se o adaptive polling não está ativo, é no-op.
 */
export function triggerSitePoll(slug: string): void {
  if (!_started) return;
  const t = _siteTimers.get(slug);
  if (t) clearTimeout(t);
  _siteTimers.delete(slug);
  // Dispara em microtask pra garantir que o caller já retornou
  Promise.resolve().then(() => pollSite(slug)).catch((e) =>
    console.warn(`[PollScheduler] triggerSitePoll erro em ${slug}:`, e),
  );
}

export function stopAdaptivePolling(): void {
  for (const timer of _siteTimers.values()) {
    clearTimeout(timer);
  }
  _siteTimers.clear();
  _started = false;
}
