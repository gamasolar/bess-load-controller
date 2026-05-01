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
import { getDb, addAlarm, closeAlarmsByType } from "./db";
import { bessSites, bessReadings, bessState } from "../drizzle/schema";
import { getFusionSolarClient, isFusionSolarConfigured } from "./fusionsolar";
import { evaluateAndAct } from "./control-engine";
import { getSiteRuntimeState } from "./control-engine";
import { evaluateLoadHealth } from "./load-monitor";

const DELAY_BETWEEN_SITES_MS = 15_000; // respeitar rate limit Northbound (10s+)
const WATCHDOG_PERIOD_MS = 30_000;     // re-avalia intervalo correto a cada 30s

const _siteTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
const _siteNextScheduledAt: Map<string, number> = new Map(); // ms epoch
let _started = false;
let _watchdogTimer: ReturnType<typeof setInterval> | null = null;

export function isInCriticalZone(
  soc: number,
  socMinDesliga: number,
  margemZonaCritica: number,
): boolean {
  return soc <= socMinDesliga + margemZonaCritica;
}

/**
 * Projeta SOC após `intervalMinutes` dado batteryPower atual.
 * Convenção: batteryPower < 0 = descarregando (kW), capacityKwh > 0.
 * Retorna null se não houver dados suficientes pra projetar.
 */
export function projectSocAfter(opts: {
  currentSoc: number | null | undefined;
  batteryPowerKw: number | null | undefined;
  capacityKwh: number | null | undefined;
  intervalMinutes: number;
}): number | null {
  const { currentSoc, batteryPowerKw, capacityKwh, intervalMinutes } = opts;
  if (currentSoc == null || batteryPowerKw == null || !capacityKwh || capacityKwh <= 0) {
    return null;
  }
  // batteryPower negativo = descarga; positivo = carga.
  // ΔSOC% = (kW × h) / kWh × 100
  const deltaSoc = (batteryPowerKw * (intervalMinutes / 60)) / capacityKwh * 100;
  return currentSoc + deltaSoc;
}

/** Janela de antecipação: projeta com horizonte = intervaloPadrao × N pra disparar
 * crítico antes do SOC entrar na zona crítica. Maior = mais conservador. */
const PROJECTION_HORIZON_FACTOR = 2;

/** SOC limite acima do qual o intervalo é sempre o padrão (sem aceleração).
 * Abaixo dele, escala gradual entre intervaloCritico e intervaloPadrao
 * conforme SOC se aproxima da zona crítica. */
const TRANSITION_UPPER_SOC = 50;

/**
 * Interpolação linear entre dois intervalos baseado em "quão perto" o SOC está
 * da zona crítica. Quando SOC está logo acima da margem crítica, intervalo
 * próximo do crítico; longe da margem, próximo do padrão.
 *
 * @param distancePp distância em pp acima da fronteira da zona crítica (≥ 0)
 * @param rangePp largura da faixa de transição (pp)
 */
function interpolateInterval(
  distancePp: number,
  rangePp: number,
  intervaloCritico: number,
  intervaloPadrao: number,
): number {
  if (rangePp <= 0) return intervaloPadrao;
  const ratio = Math.max(0, Math.min(1, distancePp / rangePp));
  const value = intervaloCritico + (intervaloPadrao - intervaloCritico) * ratio;
  return Math.max(1, Math.round(value));
}

/** Margem de segurança em pp aplicada ao threshold pra cálculo de ETA — garante
 * que o TURN_OFF tenha sido disparado pela projeção em decideAction antes do
 * SOC bater literalmente o threshold. */
const ETA_SAFETY_PP = 1;

/** Quantos polls a gente quer entre o agora e o ETA. Valor 2 = "1 poll antes
 * do threshold + 1 poll após o cálculo agora". 0.5 do ETA por poll. */
const ETA_DIVIDER = 2;

/**
 * Decide o intervalo de polling em minutos.
 *
 * Estratégia: quando temos batteryPower fresh, calculamos ETA até o threshold
 * crítico e dividimos por 2 (sempre cabem ≥2 polls antes do TURN_OFF). Isso
 * substitui a antiga regra fixa "zona crítica → 1 min", que estourava o rate
 * limit Huawei (1 call/min). Sem batteryPower, fallback pra escala gradual
 * por SOC.
 *
 * Regras (ordem de precedência):
 *   1. Fora da janela [horarioLiberacao, horarioCorte) E bomba OFF →
 *      intervaloNoturno (nada pode mudar — religar exige horário).
 *   2. ETA-based (quando há batteryPowerKw + currentSoc + capacityKwh +
 *      criticalThreshold):
 *        - descarregando (battPower < 0): intervalo = clamp(ETA/2,
 *          intervaloCritico, baseInterval). Se já passou o target, retorna
 *          intervaloCritico (emergência).
 *        - carregando ou estável: baseInterval (sem urgência — watchdog
 *          re-avalia em 30s se taxa mudar).
 *   3. Fallback sem batteryPower:
 *      3a. Zona crítica → intervaloCritico.
 *      3b. Faixa de transição (SOC entre criticalThreshold e
 *          TRANSITION_UPPER_SOC) → interpolação linear.
 *   4. Caso contrário → baseInterval (intervaloPadrao dentro do horário,
 *      intervaloBombaSemSolar fora com bomba ON).
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
  // Projeção opcional — quando os 4 abaixo estão todos presentes, ativa regra 4.
  currentSoc?: number | null;
  batteryPowerKw?: number | null;
  capacityKwh?: number | null;
  criticalThreshold?: number;
  // Cooldown ativo: epoch ms até quando o control-engine não pode agir.
  // Se o cooldown termina antes do intervalo natural, agenda poll pra logo
  // depois — assim o auto-religa dispara segundos após cooldown abrir.
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
  const minLiberacao = parseHHMM(opts.horarioLiberacao);
  const minCorte = parseHHMM(opts.horarioCorte);
  const insideWindow = minutesNow >= minLiberacao && minutesNow < minCorte;
  const outsideWindow = !insideWindow;

  // Helper: aplica o cap de cooldown no fim — quando o cooldown termina antes
  // do intervalo natural, antecipa pro fim do cooldown + 30s de buffer.
  const COOLDOWN_BUFFER_MIN = 0.5; // 30s — garante que cooldown realmente passou
  const COOLDOWN_FLOOR_MIN = 0.5;  // não polla mais frequente que 30s
  const applyCooldownCap = (intervalMin: number): number => {
    if (opts.cooldownUntilMs == null) return intervalMin;
    const now = opts.nowMs ?? Date.now();
    const remainingMin = (opts.cooldownUntilMs - now) / 60_000;
    if (remainingMin <= 0) return intervalMin;
    const cooldownPoll = Math.max(COOLDOWN_FLOOR_MIN, remainingMin + COOLDOWN_BUFFER_MIN);
    return Math.min(intervalMin, cooldownPoll);
  };

  // 1. Fora do horário com bomba OFF → noturno (nada pode mudar — religar
  //    exige horário + SOC ≥ socMinReliga)
  if (outsideWindow && opts.pumpOff) return applyCooldownCap(opts.intervaloNoturno);

  // Intervalo "base" pro contexto: bomba ON fora do horário usa o intervalo de
  // bomba sem solar; senão usa o padrão.
  const baseInterval = (outsideWindow && !opts.pumpOff)
    ? opts.intervaloBombaSemSolar
    : opts.intervaloPadrao;

  // 2. ETA-based — quando temos battPower fresh, intervalo é proporcional ao
  //    tempo até bater o threshold crítico (com safety margin).
  if (
    opts.batteryPowerKw != null &&
    opts.currentSoc != null &&
    opts.capacityKwh != null && opts.capacityKwh > 0 &&
    opts.criticalThreshold !== undefined
  ) {
    if (opts.batteryPowerKw < 0) {
      // Descarregando — calcula ETA até o threshold + safety
      const dischargeKw = Math.abs(opts.batteryPowerKw);
      const dPerMin = (dischargeKw / opts.capacityKwh) * 100 / 60;
      const target = opts.criticalThreshold + ETA_SAFETY_PP;
      const remainingPp = opts.currentSoc - target;

      if (remainingPp <= 0) {
        // Já passou o target — emergência, polla no mínimo
        return applyCooldownCap(opts.intervaloCritico);
      }
      if (dPerMin > 0) {
        const etaMin = remainingPp / dPerMin;
        const ideal = etaMin / ETA_DIVIDER;
        const clamped = Math.max(
          opts.intervaloCritico,
          Math.min(baseInterval, Math.round(ideal)),
        );
        return applyCooldownCap(clamped);
      }
    }
    // Carregando (battPower > 0) ou estável (= 0) → sem urgência. Watchdog
    // re-avalia em 30s se taxa mudar.
    return applyCooldownCap(baseInterval);
  }

  // 3. Fallback sem batteryPower — usa lógica antiga (mais conservadora)
  // 3a. Zona crítica → crítico
  if (opts.socInCriticalZone) return applyCooldownCap(opts.intervaloCritico);

  // 3b. SOC abaixo do threshold de transição → escala gradual entre
  //     intervaloCritico e baseInterval, conforme SOC se aproxima da zona crítica.
  if (
    opts.currentSoc != null &&
    opts.currentSoc < TRANSITION_UPPER_SOC &&
    opts.criticalThreshold !== undefined
  ) {
    const distancePp = opts.currentSoc - opts.criticalThreshold;
    const rangePp = TRANSITION_UPPER_SOC - opts.criticalThreshold;
    if (distancePp > 0 && rangePp > 0) {
      return applyCooldownCap(
        interpolateInterval(distancePp, rangePp, opts.intervaloCritico, baseInterval),
      );
    }
  }

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
      const totalCapacityKwh = (site.bessCapacityKwh ?? 0) * (site.bessCount ?? 1);
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
        currentSoc: runtime.soc,
        batteryPowerKw: runtime.state.currentBatteryPower ?? null,
        capacityKwh: totalCapacityKwh,
        criticalThreshold: config.socMinDesliga + config.margemZonaCritica,
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
    // Pause de 5s entre calls pra atenuar rate limit Huawei. 407 ocasional
    // gera warn no log, não vira regra permanente de skip.
    if (inverterDevIdStr) {
      await new Promise((r) => setTimeout(r, 5000));
    }
    const inverter = inverterDevIdStr
      ? await client.getInverterRealKpi(inverterDevIdStr, 1)
      : null;

    const db = await getDb();
    if (battery && battery.battery_soc != null && db) {
      const soc = battery.battery_soc;
      const battPower = battery.battery_power ?? null;
      const pvPower = inverter?.active_power ?? null;
      const battDischarge = battPower != null && battPower < 0 ? Math.abs(battPower) : 0;
      const battCharge = battPower != null && battPower > 0 ? battPower : 0;
      const loadPower = pvPower != null
        ? Math.max(0, pvPower + battDischarge - battCharge)
        : null;

      // 1. Atualiza state PRIMEIRO (battery/pv/load + lastTelemetryAt) pra que
      //    o load-monitor leia valores fresh via getSiteRuntimeState.
      await db.update(bessState).set({
        currentSoc: soc,
        currentSoh: battery.battery_soh ?? null,
        currentBatteryPower: battPower,
        currentTemperature: battery.battery_temperature ?? null,
        currentPvPower: pvPower,
        currentLoadPower: loadPower,
        lastTelemetryAt: new Date(),
        socSource: "fusionsolar",
      }).where(eq(bessState.siteId, site.id));

      console.log(
        `[PollScheduler] ${slug}: SOC=${soc.toFixed(1)}%` +
        (battPower != null ? ` Bat=${battPower.toFixed(2)}kW` : "") +
        (pvPower != null ? ` PV=${pvPower.toFixed(2)}kW` : "") +
        (loadPower != null ? ` Load=${loadPower.toFixed(2)}kW` : "")
      );

      // 2. Load monitor — calcula etiqueta antes da leitura ser persistida pra
      //    que o INSERT carregue o loadHealth (alinha histórico de leituras com saúde).
      let computedLoadHealth: string | null = null;
      try {
        const fresh = await getSiteRuntimeState(slug);
        if (fresh && process.env.LOAD_MONITOR_ENABLED === "true") {
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
        soc,
        soh: battery.battery_soh ?? null,
        batteryPower: battPower,
        batteryTemperature: battery.battery_temperature ?? null,
        busVoltage: battery.bus_voltage ?? null,
        pvPower,
        loadPower,
        loadHealth: computedLoadHealth,
        valid: true,
      });
    } else {
      console.warn(`[PollScheduler] ${slug}: getBatteryRealKpi retornou vazio`);
    }

    await evaluateAndAct(slug);

    const updated = await getSiteRuntimeState(slug);
    const now = new Date();
    const cfg = updated?.config ?? config;
    const stateRef = updated?.state ?? runtime.state;
    const totalCapacityKwh = (site.bessCapacityKwh ?? 0) * (site.bessCount ?? 1);
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
      currentSoc: updated?.soc ?? runtime.soc,
      batteryPowerKw: stateRef.currentBatteryPower ?? null,
      capacityKwh: totalCapacityKwh,
      criticalThreshold: cfg.socMinDesliga + cfg.margemZonaCritica,
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
  _siteNextScheduledAt.set(slug, Date.now() + ms);
}

/**
 * A cada 30s, pra cada site:
 *   - Lê o estado atual (SOC, batteryPower, pumpState).
 *   - Recalcula o intervalo correto.
 *   - Se a próxima fetch agendada está mais distante que o intervalo correto
 *     a partir da última telemetria, dispara fetch já (e re-agenda).
 * Custo: 0 chamadas FusionSolar — só substitui um timer por outro.
 */
async function watchdog(): Promise<void> {
  for (const [slug] of _siteTimers) {
    try {
      const runtime = await getSiteRuntimeState(slug);
      if (!runtime) continue;
      const now = new Date();
      const cfg = runtime.config;
      const totalCapacityKwh = (runtime.site.bessCapacityKwh ?? 0) * (runtime.site.bessCount ?? 1);
      const correct = pickPollInterval({
        socInCriticalZone: runtime.soc !== null && isInCriticalZone(runtime.soc, cfg.socMinDesliga, cfg.margemZonaCritica),
        pumpOff: runtime.pumpState !== "ON",
        hourMinute: { h: now.getHours(), m: now.getMinutes() },
        horarioLiberacao: cfg.horarioLiberacao,
        horarioCorte: cfg.horarioCorte,
        intervaloPadrao: cfg.intervaloPadrao,
        intervaloCritico: cfg.intervaloCritico,
        intervaloNoturno: cfg.intervaloNoturno,
        intervaloBombaSemSolar: cfg.intervaloBombaSemSolar,
        currentSoc: runtime.soc,
        batteryPowerKw: runtime.state.currentBatteryPower ?? null,
        capacityKwh: totalCapacityKwh,
        criticalThreshold: cfg.socMinDesliga + cfg.margemZonaCritica,
        cooldownUntilMs: runtime.state.cooldownUntil
          ? new Date(runtime.state.cooldownUntil).getTime()
          : null,
      });

      const lastTelemetry = runtime.state.lastTelemetryAt
        ? new Date(runtime.state.lastTelemetryAt).getTime()
        : 0;
      const elapsedMin = (Date.now() - lastTelemetry) / 60_000;
      const nextScheduledAt = _siteNextScheduledAt.get(slug) ?? 0;
      const minutesUntilNext = (nextScheduledAt - Date.now()) / 60_000;

      // Se o intervalo correto já foi alcançado mas o timer atual ainda
      // tem mais que correct/2 esperando, antecipa a fetch.
      if (elapsedMin >= correct && minutesUntilNext > correct / 2) {
        console.log(`[PollScheduler:Watchdog] ${slug}: SOC=${runtime.soc?.toFixed(1)}% intervalo correto=${correct}min · última fetch há ${elapsedMin.toFixed(1)}min · timer agendado ${minutesUntilNext.toFixed(1)}min — antecipando.`);
        const existing = _siteTimers.get(slug);
        if (existing) clearTimeout(existing);
        _siteTimers.delete(slug);
        pollSite(slug); // dispara já
      }
    } catch (e) {
      console.warn(`[PollScheduler:Watchdog] ${slug} erro:`, e);
    }
  }
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

  // Watchdog re-avalia intervalo correto a cada 30s
  if (_watchdogTimer) clearInterval(_watchdogTimer);
  _watchdogTimer = setInterval(() => {
    watchdog().catch((e) => console.warn("[PollScheduler:Watchdog] erro geral:", e));
  }, WATCHDOG_PERIOD_MS);
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
  _siteNextScheduledAt.clear();
  if (_watchdogTimer) clearInterval(_watchdogTimer);
  _watchdogTimer = null;
  _started = false;
}
