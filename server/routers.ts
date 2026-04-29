import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { eq, desc, and, gte, lt, inArray, asc } from "drizzle-orm";
import { bessActions, bessConfig as bessConfigTable, bessState, bessReadings } from "../drizzle/schema";
import { usersRouter, invitationsRouter, sitesRouter, whatsappRouter, systemAdminEndpoints } from "./admin-routes";
import { triggerSitePoll } from "./poll-scheduler";
import {
  getDb,
  getAllSites,
  getSiteBySlug,
  getBessState,
  upsertBessState,
  addReading,
  getReadings,
  getReadingsByDate,
  addEvent,
  getRecentEvents,
  getAllRecentEvents,
  getActiveAlarms,
  addAlarm,
  openAlarmIfMissing,
  closeAlarmsByType,
  recordAction,
  getBessConfig,
  upsertBessConfig,
  upsertSite,
  seedMultiSiteData,
  seedDefaultConfigs,
  getReports,
  getReportsByPeriod,
  getLatestReport,
  getReportTrends,
  getReportsCount,
  getSetting,
  upsertSetting,
  getAllSettings,
} from "./db";
import { getFusionSolarClient, isFusionSolarConfigured } from "./fusionsolar";
import { getMqttClient, isMqttConfigured } from "./mqtt-tasmota";
import { getSiteRuntimeState, decideAction } from "./control-engine";
import { notifyOwner } from "./_core/notification";
import { generateSiteReport, generateAllReports, generateAndNotify, getSchedulerSettings, SETTING_SCHEDULER_ENABLED, SETTING_DAILY_HOUR, SETTING_WEEKLY_DAY } from "./report-generator";

// Re-exported for backwards compat (mqtt-dispatch.test.ts imports from "./routers")
export { sendMqttCommand } from "./mqtt-dispatch";
import { sendMqttCommand } from "./mqtt-dispatch";

// ── Notification helper for critical alarms ──
async function notifyCriticalAlarm(siteName: string, message: string) {
  try {
    await notifyOwner({
      title: `⚠️ ALARME CRÍTICO — ${siteName}`,
      content: message,
    });
  } catch (e) {
    console.warn("[Notification] Falha ao enviar notificação:", e);
  }
}

// Seed data on first load
let seeded = false;
async function ensureSeeded() {
  if (!seeded) {
    await seedMultiSiteData();
    await seedDefaultConfigs();
    seeded = true;
  }
}

// ── Discovery throttle: only try getDevList once every 30 min ──
const _lastDiscoveryAttempt: Record<string, number> = {};
const DISCOVERY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// ── Shared FusionSolar fetch logic (used by endpoint + auto-fetch) ──
export async function fetchFusionSolarData(slug: string) {
  await ensureSeeded();
  const site = await getSiteBySlug(slug);
  if (!site) return { success: false, message: "Site não encontrado." };

  if (!site.fusionsolarPlantCode) {
    return { success: false, message: "FusionSolar não configurada para este site." };
  }
  if (!isFusionSolarConfigured()) {
    return { success: false, message: "Credenciais FusionSolar não configuradas no servidor." };
  }

  try {
    const client = getFusionSolarClient();

    // Auto-discover device IDs if not yet configured (throttled to 1x per 30 min)
    let batteryDevIdStr = "";
    let inverterDevIdStr = "";

    if (site.fusionsolarDeviceIds) {
      const devIds = JSON.parse(site.fusionsolarDeviceIds);
      batteryDevIdStr = Array.isArray(devIds) ? devIds.join(",") : String(devIds);
    }
    if (site.fusionsolarInverterIds) {
      const invIds = JSON.parse(site.fusionsolarInverterIds);
      inverterDevIdStr = Array.isArray(invIds) ? invIds.join(",") : String(invIds);
    }

    // Auto-discover if missing (throttled)
    if (!batteryDevIdStr || !inverterDevIdStr) {
      const lastAttempt = _lastDiscoveryAttempt[slug] ?? 0;
      const now = Date.now();
      if (now - lastAttempt > DISCOVERY_COOLDOWN_MS) {
        _lastDiscoveryAttempt[slug] = now;
        try {
          const discovered = await client.discoverDeviceIds(site.fusionsolarPlantCode);
          if (!batteryDevIdStr && discovered.batteryIds.length > 0) {
            batteryDevIdStr = discovered.batteryIds.join(",");
            await upsertSite({ slug, fusionsolarDeviceIds: JSON.stringify(discovered.batteryIds) } as any);
            console.log(`[FusionSolar] Auto-discovered battery IDs for ${slug}: ${batteryDevIdStr}`);
          }
          if (!inverterDevIdStr && discovered.inverterIds.length > 0) {
            inverterDevIdStr = discovered.inverterIds.join(",");
            await upsertSite({ slug, fusionsolarInverterIds: JSON.stringify(discovered.inverterIds) } as any);
            console.log(`[FusionSolar] Auto-discovered inverter IDs for ${slug}: ${inverterDevIdStr}`);
          }
        } catch (discErr) {
          console.warn(`[FusionSolar] Auto-discovery failed for ${slug} (next attempt in 30min):`, discErr);
        }
      } else {
        const minutesLeft = Math.round((DISCOVERY_COOLDOWN_MS - (now - lastAttempt)) / 60000);
        console.log(`[FusionSolar] Discovery throttled for ${slug} — next attempt in ${minutesLeft}min`);
      }
    }

    // ── STRATEGY A: Device-level data (ideal — gives SOC, power, temperature) ──
    if (batteryDevIdStr) {
      const telemetry = await client.getFullTelemetry(
        batteryDevIdStr,
        site.fusionsolarPlantCode,
        inverterDevIdStr || undefined
      );

      if (telemetry.success && telemetry.data) {
        const d = telemetry.data;
        const soc = d.battery_soc ?? 0;
        const soh = d.battery_soh;
        const batteryPower = d.battery_power;
        const batteryTemperature = d.battery_temperature;
        const pvPower = telemetry.inverterData?.active_power ?? telemetry.stationData?.day_power ?? 0;
        const battDischarge = batteryPower && batteryPower < 0 ? Math.abs(batteryPower) : 0;
        const battCharge = batteryPower && batteryPower > 0 ? batteryPower : 0;
        const loadPower = Math.max(0, pvPower + battDischarge - battCharge);

        await addReading(site.id, {
          soc, soh: soh ?? undefined,
          batteryPower: batteryPower ?? undefined,
          batteryTemperature: batteryTemperature ?? undefined,
          busVoltage: d.bus_voltage ?? undefined,
          pvPower, loadPower, valid: true,
        });

        await upsertBessState(site.id, {
          currentSoc: soc, currentSoh: soh ?? undefined,
          currentBatteryPower: batteryPower ?? undefined,
          currentTemperature: batteryTemperature ?? undefined,
          currentPvPower: pvPower, currentLoadPower: loadPower,
          lastTelemetryAt: new Date(), socSource: "fusionsolar" as const,
        });

        if (batteryTemperature && batteryTemperature > 45) {
          await addAlarm(site.id, "CRITICAL", "HIGH_TEMPERATURE",
            `Temperatura da bateria em ${batteryTemperature}°C — acima do limite seguro (45°C).`);
          notifyCriticalAlarm(site.name, `TEMPERATURA CRÍTICA DA BATERIA\n\nTemperatura: ${batteryTemperature}°C\nLimite seguro: 45°C\n\nVerifique a ventilação e o ambiente do BESS imediatamente.`);
        }

        if (telemetry.dataAge && telemetry.dataAge > 600) {
          await addAlarm(site.id, "WARNING", "STALE_DATA",
            `Dados da FusionSolar com atraso de ${Math.round(telemetry.dataAge / 60)} minutos.`);
        }

        return {
          success: true, source: "device" as const,
          message: `Dados atualizados (device-level): SOC=${soc}%${soh ? `, SOH=${soh}%` : ""}${batteryPower ? `, Bat=${batteryPower}kW` : ""}, FV=${pvPower.toFixed(1)}kW, Carga=${loadPower.toFixed(1)}kW`,
          data: { soc, soh, batteryPower, batteryTemperature, busVoltage: d.bus_voltage, pvPower, loadPower, dataAge: telemetry.dataAge },
        };
      }
      // Device-level failed — fall through to station-level
      console.warn(`[FusionSolar] Device-level fetch failed for ${slug}, trying station-level fallback...`);
    }

    // ── STRATEGY B: Station-level fallback (no SOC, but gives energy data) ──
    console.log(`[FusionSolar] Using station-level fallback for ${slug}...`);
    const stationData = await client.getStationRealKpi(site.fusionsolarPlantCode);

    // Also get the latest hourly KPI for discharge/charge data
    const now = Date.now();
    const hourlyData = await client.getStationHourKpi(site.fusionsolarPlantCode, now);

    // Extract the latest hour bucket
    let latestHour: Record<string, any> | null = null;
    if (Array.isArray(hourlyData) && hourlyData.length > 0) {
      // Find the most recent hour bucket
      for (const entry of hourlyData) {
        const items = entry?.dataItemMap;
        if (items && (!latestHour || (entry.collectTime > (latestHour as any)._collectTime))) {
          latestHour = { ...items, _collectTime: entry.collectTime };
        }
      }
    }

    const pvPower = stationData?.day_power ?? 0; // kWh today (not instantaneous, but best available)
    const dischargeCap = latestHour?.dischargeCap != null ? Number(latestHour.dischargeCap) : 0;
    const chargeCap = latestHour?.chargeCap != null ? Number(latestHour.chargeCap) : 0;
    const inverterPower = latestHour?.inverter_power != null ? Number(latestHour.inverter_power) : undefined;

    // Save partial reading (no SOC from station-level)
    await addReading(site.id, {
      soc: 0, // Unknown — station-level doesn't provide SOC
      pvPower: inverterPower ?? pvPower,
      loadPower: 0,
      valid: false, // Mark as partial/incomplete data
    });

    // Update state with available data (do NOT update SOC — keep existing value)
    await upsertBessState(site.id, {
      currentPvPower: inverterPower ?? pvPower,
      // Do NOT update currentSoc, lastTelemetryAt, or socSource — we don't have real SOC
    });

    const hasDeviceIds = !!site.fusionsolarDeviceIds;
    const reason = hasDeviceIds
      ? "API retornou erro (rate limit ou auth) — device IDs configurados mas chamada falhou"
      : "device IDs não configurados — configure na página Sistema";
    const msg = `Dados parciais (station-level): FV hoje=${pvPower.toFixed(1)}kWh` +
      (inverterPower != null ? `, Inversor última hora=${inverterPower.toFixed(2)}kWh` : "") +
      `, Descarga=${dischargeCap.toFixed(2)}kWh, Carga=${chargeCap.toFixed(2)}kWh` +
      ` | SOC NÃO DISPONÍVEL (${reason})`;

    console.warn(`[FusionSolar] ${slug}: ${msg}`);
    return {
      success: true, source: "station" as const,
      message: msg,
      data: { soc: null, pvPower: inverterPower ?? pvPower, dischargeCap, chargeCap },
    };
  } catch (error) {
    return { success: false, message: `Erro ao buscar dados: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ══════════════════════════════════════════════════════════════
// ── evaluateLoadControl: automatic SOC evaluation + MQTT dispatch ──
// Called after each successful FusionSolar data fetch for auto_mqtt sites.
// Also runs on a standalone periodic interval (every 5 min) as a safety net.
// ══════════════════════════════════════════════════════════════
export async function evaluateLoadControl(siteId: number): Promise<{ action: string; message: string }> {
  const site = await getAllSites().then(sites => sites.find(s => s.id === siteId));
  if (!site) return { action: "none", message: "Site não encontrado." };

  // Only evaluate for auto_mqtt sites
  if (site.controlMode !== "auto_mqtt") {
    return { action: "skip", message: `Site ${site.slug} em modo ${site.controlMode} — avaliação automática ignorada.` };
  }

  const state = await getBessState(siteId);
  const config = await getBessConfig(siteId);

  // ── SOC Staleness Guard ──
  // Only act on real FusionSolar data, not simulated/unknown SOC.
  // Also skip if SOC data is older than 15 minutes.
  const SOC_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
  const socSource = (state as any)?.socSource ?? "unknown";
  const lastTelemetryAt = (state as any)?.lastTelemetryAt;

  if (socSource !== "fusionsolar" && socSource !== "manual") {
    const msg = `[AUTO] ${site.slug}: SOC ignorado — fonte="${socSource}" (não é dado real). Aguardando dados da FusionSolar.`;
    console.log(`[LoadControl] ${msg}`);
    return { action: "skip_stale", message: msg };
  }

  if (lastTelemetryAt) {
    const age = Date.now() - new Date(lastTelemetryAt).getTime();
    if (age > SOC_MAX_AGE_MS) {
      const minutesStale = Math.round(age / 60000);
      const msg = `[AUTO] ${site.slug}: SOC ignorado — dados com ${minutesStale}min de atraso (limite: 15min). Aguardando atualização.`;
      console.log(`[LoadControl] ${msg}`);
      await upsertBessState(siteId, {
        healthStatus: "attention" as const,
        lastDecision: msg,
      });
      return { action: "skip_stale", message: msg };
    }
  } else {
    // No telemetry timestamp at all — SOC was never updated from real data
    const msg = `[AUTO] ${site.slug}: SOC ignorado — nenhuma telemetria real recebida ainda. Aguardando dados da FusionSolar.`;
    console.log(`[LoadControl] ${msg}`);
    return { action: "skip_stale", message: msg };
  }

  const socLow = config?.socLowLimit ?? 15;
  const socHigh = config?.socHighLimit ?? 20;
  const lowRequired = config?.lowReadingsRequired ?? 2;
  const highRequired = config?.highReadingsRequired ?? 3;
  const currentSoc = state?.currentSoc ?? 50;

  let lowCounter = state?.lowCounter ?? 0;
  let highCounter = state?.highCounter ?? 0;
  let healthStatus: "healthy" | "attention" | "degraded" | "critical" = "healthy";
  let lastDecision = "";
  let loadStatus = state?.loadStatus ?? "on";
  let actionTaken = "none";

  if (currentSoc <= socLow) {
    lowCounter++;
    highCounter = 0;
    if (lowCounter >= lowRequired && loadStatus === "on") {
      loadStatus = "off";
      lowCounter = 0;
      healthStatus = "critical";
      lastDecision = `[AUTO] SOC em ${currentSoc}% — CARGA DESLIGADA automaticamente (${lowRequired} leituras <= ${socLow}%).`;
      actionTaken = "LOAD_OFF";
      await addEvent(siteId, "LOAD_OFF", lastDecision);
      const pumpBefore = (state?.sonoffPower ?? "ON") as "ON" | "OFF" | "UNKNOWN";
      // Send MQTT command to Sonoff
      let mqttOk = true;
      if (site.mqttTopic) {
        const mqttResult = await sendMqttCommand(siteId, site.mqttTopic, "OFF", `autoEval:${site.slug}`);
        lastDecision += ` MQTT: ${mqttResult.message}`;
        mqttOk = mqttResult.success;
      }
      await recordAction({
        siteId, source: "AUTO", action: "TURN_OFF",
        socAtTime: currentSoc, socSource: "REAL",
        pumpStateBefore: pumpBefore,
        pumpStateAfter: mqttOk ? "OFF" : pumpBefore,
        reason: lastDecision,
        metadata: { socLow, lowRequired, loop: "v1" },
      });
      // Notify owner
      notifyCriticalAlarm(site.name, `CARGA DESLIGADA automaticamente.\n\nSOC: ${currentSoc}%\nLimite: ${socLow}%\nLeituras consecutivas: ${lowRequired}\n\nA carga será religada quando o SOC atingir ${socHigh}%.`);
    } else {
      healthStatus = lowCounter >= lowRequired ? "critical" : "attention";
      lastDecision = `[AUTO] SOC em ${currentSoc}% — abaixo do limite (${socLow}%). Contador LOW: ${lowCounter}/${lowRequired}.`;
    }
  } else if (currentSoc >= socHigh) {
    highCounter++;
    lowCounter = 0;
    if (highCounter >= highRequired && loadStatus === "off") {
      loadStatus = "on";
      highCounter = 0;
      healthStatus = "healthy";
      lastDecision = `[AUTO] SOC em ${currentSoc}% — CARGA RELIGADA automaticamente (${highRequired} leituras >= ${socHigh}%).`;
      actionTaken = "LOAD_ON";
      await addEvent(siteId, "LOAD_ON", lastDecision);
      const pumpBefore = (state?.sonoffPower ?? "OFF") as "ON" | "OFF" | "UNKNOWN";
      // Send MQTT command to Sonoff
      let mqttOk = true;
      if (site.mqttTopic) {
        const mqttResult = await sendMqttCommand(siteId, site.mqttTopic, "ON", `autoEval:${site.slug}`);
        lastDecision += ` MQTT: ${mqttResult.message}`;
        mqttOk = mqttResult.success;
      }
      await recordAction({
        siteId, source: "AUTO", action: "TURN_ON",
        socAtTime: currentSoc, socSource: "REAL",
        pumpStateBefore: pumpBefore,
        pumpStateAfter: mqttOk ? "ON" : pumpBefore,
        reason: lastDecision,
        metadata: { socHigh, highRequired, loop: "v1" },
      });
    } else if (highCounter >= highRequired && loadStatus === "on") {
      highCounter = highRequired;
      healthStatus = "healthy";
      lastDecision = `[AUTO] SOC em ${currentSoc}% — acima do limite (${socHigh}%). Carga já ligada. Estabilizado.`;
    } else {
      healthStatus = "healthy";
      lastDecision = `[AUTO] SOC em ${currentSoc}% — acima do limite (${socHigh}%). Contador HIGH: ${highCounter}/${highRequired}.`;
    }
  } else {
    // Dead zone — maintain current state
    healthStatus = lowCounter > 0 ? "degraded" : "attention";
    lastDecision = `[AUTO] SOC em ${currentSoc}% — zona morta (${socLow + 1}-${socHigh - 1}%). Estado mantido.`;
  }

  await upsertBessState(siteId, {
    loadStatus, lowCounter, highCounter, healthStatus, lastDecision,
    lastManeuverAt: actionTaken !== "none" ? new Date() : undefined,
  });

  console.log(`[LoadControl] ${site.slug}: SOC=${currentSoc}% → ${actionTaken !== "none" ? actionTaken : "no change"} | ${lastDecision}`);
  return { action: actionTaken, message: lastDecision };
}

// ── Auto-fetch FusionSolar data every 5 minutes ──
let autoFetchInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoFetch() {
  if (autoFetchInterval) return;
  // Defesa: nunca rodar em paralelo com o adaptive polling do v2.
  if (process.env.USE_MVP_V2_CONTROL === "true") {
    console.warn("[AutoFetch] Ignorado — USE_MVP_V2_CONTROL=true (v2 adaptive polling ativo).");
    return;
  }
  console.log("[AutoFetch] Iniciando polling FusionSolar a cada 6 minutos + avaliação automática de carga...");

  const doFetch = async () => {
    try {
      await ensureSeeded();
      const sites = await getAllSites();
      for (const site of sites) {
        // 1. Fetch FusionSolar data (if configured)
        if (site.fusionsolarPlantCode && isFusionSolarConfigured()) {
          try {
            const result = await fetchFusionSolarData(site.slug);
            if (result.success) {
              console.log(`[AutoFetch] ${site.slug}: ${result.message}`);
            } else {
              console.warn(`[AutoFetch] ${site.slug}: ${result.message}`);
            }
          } catch (e) {
            console.warn(`[AutoFetch] Erro em ${site.slug}:`, e);
          }
          // Delay between sites to respect rate limiting (10s min between API calls)
          await new Promise(r => setTimeout(r, 15000));
        }

        // 2. Evaluate load control for auto_mqtt sites (runs even if FusionSolar fetch failed)
        if (site.controlMode === "auto_mqtt") {
          try {
            await evaluateLoadControl(site.id);
          } catch (e) {
            console.warn(`[AutoFetch] Erro ao avaliar carga ${site.slug}:`, e);
          }
        }
      }
    } catch (e) {
      console.warn("[AutoFetch] Erro geral:", e);
    }
  };

  // First evaluation after 15 seconds (let server stabilize)
  setTimeout(doFetch, 15_000);
  // Every 15 minutes to avoid rate limit saturation (2 sites × ~3 calls = 6 calls per cycle)
  autoFetchInterval = setInterval(doFetch, 15 * 60 * 1000);
}

/**
 * Start MQTT state sync: connects to broker, registers tracked devices,
 * sets up a callback to sync real Sonoff state to the database,
 * and starts polling every 30 seconds.
 */
// Sweep periódico que fecha alarmes DIVERGENCE quando estado já convergiu.
// O callback onStateChange do MqttClient só dispara em transição (power ou online
// mudou); em estado estável ele nunca seria chamado e o alarme ficaria stuck.
const DIVERGENCE_AUTO_CLOSE_MS = 30_000;
let divergenceAutoCloseInterval: NodeJS.Timeout | null = null;

async function sweepDivergenceAutoClose() {
  try {
    const sites = await getAllSites();
    for (const site of sites) {
      if (!site.mqttTopic) continue;
      const fresh = await getBessState(site.id);
      if (!fresh || !fresh.sonoffOnline) continue;
      const realPower = fresh.sonoffPower;
      if (realPower === "UNKNOWN") continue;
      const expectedLoad = fresh.loadStatus ?? "off";
      const converged = (expectedLoad === "on" && realPower === "ON") ||
                        (expectedLoad === "off" && realPower === "OFF");
      if (converged) {
        await closeAlarmsByType("DIVERGENCE", site.id);
        continue;
      }
      // Divergente estável: reconcilia loadStatus ← sonoffPower (Sonoff é a verdade física).
      // Só toca se não há cooldown ativo e a última manobra foi há >60s — evita race
      // com applyDecision recém-escrito ou com a janela de propagação do MQTT.
      const now = Date.now();
      const inCooldown = fresh.cooldownUntil
        ? new Date(fresh.cooldownUntil).getTime() > now
        : false;
      const recentManeuver = fresh.lastManeuverAt
        ? now - new Date(fresh.lastManeuverAt).getTime() < 60_000
        : false;
      if (inCooldown || recentManeuver) continue;
      const reconciled = realPower === "ON" ? "on" : "off";
      console.warn(`[MqttSync] RECONCILIANDO ${site.slug}: loadStatus ${expectedLoad}→${reconciled} (Sonoff=${realPower} estável)`);
      await upsertBessState(site.id, {
        loadStatus: reconciled,
        lastDecision: `Reconciliado: loadStatus ${expectedLoad}→${reconciled} (Sonoff=${realPower} estável)`,
      });
      await addEvent(site.id, "RECONCILE",
        `loadStatus ${expectedLoad}→${reconciled} (Sonoff reportava ${realPower} de forma estável).`);
      // Não fecha o alarme aqui — próximo sweep verá converged e fechará.
    }
  } catch (e) {
    console.warn("[MqttSync] sweepDivergenceAutoClose erro:", e);
  }
}

export async function startMqttStateSync() {
  if (!isMqttConfigured()) {
    console.log("[MqttSync] MQTT não configurado — sync desativado.");
    return;
  }

  try {
    await ensureSeeded();
    const sites = await getAllSites();
    const mqtt = getMqttClient();

    // Register tracked devices (sites with mqttTopic)
    let trackedCount = 0;
    for (const site of sites) {
      if (site.mqttTopic) {
        mqtt.trackDevice(site.mqttTopic);
        trackedCount++;
      }
    }

    if (trackedCount === 0) {
      console.log("[MqttSync] Nenhum site com mqttTopic configurado.");
      return;
    }

    // Set callback: when real Sonoff state changes, update DB
    mqtt.setOnStateChange(async (deviceTopic, realState) => {
      try {
        // Find which site uses this mqttTopic
        const allSites = await getAllSites();
        const site = allSites.find(s => s.mqttTopic === deviceTopic);
        if (!site) return;

        const state = await getBessState(site.id);
        const prevPower = state?.sonoffPower ?? "UNKNOWN";
        const prevOnline = state?.sonoffOnline ?? false;

        // Update DB with real Sonoff state
        await upsertBessState(site.id, {
          sonoffOnline: realState.online,
          sonoffPower: realState.power,
          mqttConnected: mqtt.isConnected,
        });

        // Log state changes
        if (realState.power !== prevPower && realState.power !== "UNKNOWN") {
          console.log(`[MqttSync] ${site.slug}: Sonoff real state = ${realState.power} (was ${prevPower})`);
        }
        if (realState.online !== prevOnline) {
          console.log(`[MqttSync] ${site.slug}: Sonoff online = ${realState.online}`);
        }

        // Detect divergence: system says ON but Sonoff is OFF (or vice versa).
        // Estratégias pra evitar flutter:
        //   1. Re-leitura FRESCA (cache stale do bess_state vence em microssegundos).
        //   2. Suprime detecção durante cooldown (janela natural de dessincronia).
        //   3. Suprime se manobra acabou de acontecer (< 30s): applyDecision envia
        //      MQTT antes de gravar loadStatus/cooldownUntil; o broadcast do Sonoff
        //      pode chegar aqui antes do UPDATE, gerando falso positivo.
        //   4. Auto-close vive no sweep periódico (DIVERGENCE_AUTO_CLOSE_MS), porque
        //      o callback só dispara em transição de estado e em estado estável
        //      jamais convergeria sozinho.
        const realPower = realState.power;
        if (realPower !== "UNKNOWN" && realState.online) {
          const fresh = await getBessState(site.id);
          const expectedLoad = fresh?.loadStatus ?? "off";
          const now = Date.now();
          const inCooldown = fresh?.cooldownUntil
            ? new Date(fresh.cooldownUntil).getTime() > now
            : false;
          const recentManeuver = fresh?.lastManeuverAt
            ? now - new Date(fresh.lastManeuverAt).getTime() < 30_000
            : false;
          const isDivergent = (expectedLoad === "on" && realPower === "OFF") ||
                              (expectedLoad === "off" && realPower === "ON");

          if (isDivergent && !inCooldown && !recentManeuver) {
            console.warn(`[MqttSync] DIVERGÊNCIA ${site.slug}: sistema=${expectedLoad} sonoff=${realPower}`);
            await addEvent(site.id, "DIVERGENCE",
              `Estado divergente: sistema diz carga ${expectedLoad === "on" ? "LIGADA" : "DESLIGADA"} mas Sonoff reporta ${realPower}.`);
            await openAlarmIfMissing(site.id, "WARNING", "DIVERGENCE",
              `Divergência: carga deveria estar ${expectedLoad === "on" ? "LIGADA" : "DESLIGADA"} mas Sonoff reporta ${realPower}.`);
          }
        }
      } catch (e) {
        console.error(`[MqttSync] Erro ao sincronizar estado de ${deviceTopic}:`, e);
      }
    });

    // Connect and start polling
    const connected = await mqtt.connect();
    if (connected) {
      mqtt.startPolling(30_000); // Poll every 30 seconds
      if (!divergenceAutoCloseInterval) {
        divergenceAutoCloseInterval = setInterval(sweepDivergenceAutoClose, DIVERGENCE_AUTO_CLOSE_MS);
      }
      console.log(`[MqttSync] Ativo: ${trackedCount} dispositivo(s) rastreado(s), polling a cada 30s.`);
    } else {
      console.warn("[MqttSync] Falha ao conectar ao broker MQTT.");
    }
  } catch (e) {
    console.error("[MqttSync] Erro ao iniciar:", e);
  }
}

export const appRouter = router({
  // Inline replacement for the deleted server/_core/systemRouter.ts.
  // Keeps the public `system.health` endpoint and re-exposes notifyOwner as an
  // admin-only mutation in case the frontend ever needs to trigger a manual
  // notification (currently it doesn't — alarms call notifyOwner directly).
  system: router({
    health: publicProcedure
      .input(z.object({ timestamp: z.number().min(0).optional() }).optional())
      .query(() => ({ ok: true })),
    serverTime: publicProcedure.query(() => ({ now: Date.now(), tz: "America/Sao_Paulo" })),
    info: systemAdminEndpoints.info,
    clearResolvedAlarms: systemAdminEndpoints.clearResolvedAlarms,
  }),
  users: usersRouter,
  invitations: invitationsRouter,
  sites: sitesRouter,
  whatsapp: whatsappRouter,
  auth: router({
    me: publicProcedure.query(opts => { if (!opts.ctx.user) return null; const { passwordHash, ...safe } = opts.ctx.user; return safe; }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  bess: router({
    // ── List all sites with summary status ──
    sites: publicProcedure.query(async () => {
      await ensureSeeded();
      const sites = await getAllSites();
      const result = [];
      for (const site of sites) {
        const state = await getBessState(site.id);
        const alarms = await getActiveAlarms(site.id);
        result.push({
          id: site.id,
          slug: site.slug,
          name: site.name,
          description: site.description,
          bessCount: site.bessCount,
          bessCapacityKwh: site.bessCapacityKwh,
          bessModel: site.bessModel,
          pumpCount: site.pumpCount,
          pumpPowerCv: site.pumpPowerCv,
          pumpDescription: site.pumpDescription,
          controlMode: site.controlMode,
          fusionsolarConfigured: !!(site.fusionsolarDeviceIds && site.fusionsolarPlantCode),
          fusionsolarPlantCode: site.fusionsolarPlantCode ?? "",
          fusionsolarDeviceIds: site.fusionsolarDeviceIds ?? "",
          fusionsolarInverterIds: site.fusionsolarInverterIds ?? "",
          backgroundUrl: site.backgroundUrl ?? null,
          mqttTopic: site.mqttTopic ?? "",
          // State summary
          currentSoc: state?.currentSoc ?? 0,
          currentPvPower: state?.currentPvPower ?? 0,
          currentBatteryPower: state?.currentBatteryPower ?? 0,
          currentLoadPower: state?.currentLoadPower ?? 0,
          loadStatus: state?.loadStatus ?? "off",
          mode: state?.mode ?? "manual",
          healthStatus: state?.healthStatus ?? "healthy",
          mqttConnected: state?.mqttConnected ?? false,
          sonoffOnline: state?.sonoffOnline ?? false,
          activeAlarms: alarms.length,
        });
      }
      return result;
    }),

    // ── Get site details by slug ──
    siteDetail: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return null;
        const state = await getBessState(site.id);
        const config = await getBessConfig(site.id);
        const alarms = await getActiveAlarms(site.id);
        const cooldownMs = (config?.cooldownMinutes ?? 5) * 60 * 1000;
        const cooldownRemaining = state?.lastManeuverAt
          ? Math.max(0, cooldownMs - (Date.now() - new Date(state.lastManeuverAt).getTime()))
          : 0;
        return {
          site: {
            id: site.id,
            slug: site.slug,
            name: site.name,
            description: site.description,
            bessCount: site.bessCount,
            bessCapacityKwh: site.bessCapacityKwh,
            bessModel: site.bessModel,
            pumpCount: site.pumpCount,
            pumpPowerCv: site.pumpPowerCv,
            pumpDescription: site.pumpDescription,
            controlMode: site.controlMode,
            fusionsolarConfigured: !!(site.fusionsolarDeviceIds && site.fusionsolarPlantCode),
          },
          state: state ? {
            loadStatus: state.loadStatus,
            mode: state.mode,
            currentSoc: state.currentSoc,
            currentSoh: state.currentSoh,
            currentBatteryPower: state.currentBatteryPower,
            currentTemperature: state.currentTemperature,
            currentPvPower: state.currentPvPower,
            currentLoadPower: state.currentLoadPower,
            lowCounter: state.lowCounter,
            highCounter: state.highCounter,
            lastManeuverAt: state.lastManeuverAt,
            healthStatus: state.healthStatus,
            lastDecision: state.lastDecision,
            mqttConnected: state.mqttConnected,
            sonoffOnline: state.sonoffOnline,
            sonoffPower: state.sonoffPower ?? "UNKNOWN",
            lastTelemetryAt: (state as any).lastTelemetryAt ?? null,
            socSource: (state as any).socSource ?? "unknown",
            cooldownRemaining,
          } : null,
          config: config ? {
            socLowLimit: config.socLowLimit,
            socHighLimit: config.socHighLimit,
            cooldownMinutes: config.cooldownMinutes,
            lowReadingsRequired: config.lowReadingsRequired,
            highReadingsRequired: config.highReadingsRequired,
            presetName: config.presetName,
          } : {
            socLowLimit: 15, socHighLimit: 20, cooldownMinutes: 5,
            lowReadingsRequired: 2, highReadingsRequired: 3, presetName: "padrao",
          },
          activeAlarms: alarms,
        };
      }),

    // ── MVP v2: Unified site status (UI Home v2 polls this every 30s) ──
    getSiteStatus: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        await ensureSeeded();
        const runtime = await getSiteRuntimeState(input.slug);
        if (!runtime) return null;
        const decision = decideAction(runtime, new Date());
        const cooldownRemainingMs = runtime.state.cooldownUntil
          ? Math.max(0, runtime.state.cooldownUntil.getTime() - Date.now())
          : 0;

        // Últimas 12 leituras de loadPower (pra sparkline). Cheap query, usa só pelo slug atual.
        let recentLoadPower: number[] = [];
        try {
          const db = await getDb();
          if (db) {
            const recent = await db.select({ loadPower: bessReadings.loadPower })
              .from(bessReadings)
              .where(eq(bessReadings.siteId, runtime.site.id))
              .orderBy(desc(bessReadings.createdAt))
              .limit(12);
            recentLoadPower = recent
              .map(r => r.loadPower)
              .filter((v): v is number => v != null)
              .reverse();
          }
        } catch { /* swallow — sparkline opcional */ }

        return {
          site: {
            id: runtime.site.id,
            slug: runtime.site.slug,
            name: runtime.site.name,
            mqttTopic: runtime.site.mqttTopic,
            fusionsolarConfigured: !!(runtime.site.fusionsolarDeviceIds && runtime.site.fusionsolarPlantCode),
            backgroundUrl: runtime.site.backgroundUrl ?? null,
            cardCustomization: runtime.site.cardCustomization ?? null,
            pumpPowerCv: runtime.site.pumpPowerCv ?? 30,
            pumpCount: runtime.site.pumpCount ?? 1,
          },
          config: {
            socMinDesliga: runtime.config.socMinDesliga,
            socMinReliga: runtime.config.socMinReliga,
            socBlackout: runtime.config.socBlackout,
            horarioLiberacao: runtime.config.horarioLiberacao,
            horarioCorte: runtime.config.horarioCorte,
            margemZonaCritica: runtime.config.margemZonaCritica,
            intervaloPadrao: runtime.config.intervaloPadrao,
            intervaloCritico: runtime.config.intervaloCritico,
            intervaloNoturno: runtime.config.intervaloNoturno,
            intervaloBombaSemSolar: runtime.config.intervaloBombaSemSolar,
            cooldownAcao: runtime.config.cooldownAcao,
            maxSemTelemetria: runtime.config.maxSemTelemetria,
            controlMode: runtime.config.controlMode,
          },
          state: {
            loadStatus: runtime.state.loadStatus,
            sonoffPower: runtime.state.sonoffPower,
            sonoffOnline: runtime.state.sonoffOnline,
            mqttConnected: runtime.state.mqttConnected,
            currentSoc: runtime.state.currentSoc,
            currentBatteryPower: runtime.state.currentBatteryPower,
            currentLoadPower: runtime.state.currentLoadPower,
            currentPvPower: runtime.state.currentPvPower,
            currentTemperature: runtime.state.currentTemperature,
            healthStatus: runtime.state.healthStatus,
            lastDecision: runtime.state.lastDecision,
            lastTelemetryAt: runtime.state.lastTelemetryAt,
            cooldownUntil: runtime.state.cooldownUntil,
            pumpOnSinceTimestamp: runtime.state.pumpOnSinceTimestamp,
            pumpOnSecondsToday: runtime.state.pumpOnSecondsToday,
            loadFailureSince: runtime.state.loadFailureSince,
          },
          derived: {
            soc: runtime.soc,
            socSource: runtime.socSource,
            socAgeSeconds: runtime.socAgeSeconds,
            pumpState: runtime.pumpState,
            inCriticalZone: runtime.inCriticalZone,
            cooldownRemainingMs,
            loadHealth: runtime.state.loadHealth ?? "UNKNOWN",
            recentLoadPower,
          },
          nextAction: decision,
        };
      }),

    // ── Manual command: on/off for a site ──
    command: adminProcedure
      .input(z.object({ slug: z.string(), action: z.enum(["on", "off"]) }))
      .mutation(async ({ input, ctx }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { success: false, message: "Site não encontrado.", loadStatus: "off" as const };

        const state = await getBessState(site.id);
        const currentStatus = state?.loadStatus ?? "off";

        // Anti-duplication
        if (currentStatus === input.action) {
          return {
            success: true, wasDuplicate: true,
            message: `Carga já está ${input.action === "on" ? "LIGADA" : "DESLIGADA"}.`,
            loadStatus: currentStatus,
          };
        }

        // Cooldown check — usa cooldownAcao (v2, exposto no modal) e considera
        // tanto cooldownUntil (gravado pelo control-engine) quanto lastManeuverAt.
        const config = await getBessConfig(site.id);
        const cooldownAcaoMin = config?.cooldownAcao ?? 5;
        const cooldownMs = cooldownAcaoMin * 60 * 1000;
        const nowMs = Date.now();
        const lastManeuverEnd = state?.lastManeuverAt
          ? new Date(state.lastManeuverAt).getTime() + cooldownMs
          : 0;
        const cooldownEnd = state?.cooldownUntil
          ? new Date(state.cooldownUntil).getTime()
          : 0;
        const blockedUntil = Math.max(lastManeuverEnd, cooldownEnd);
        if (blockedUntil > nowMs) {
          const remaining = Math.ceil((blockedUntil - nowMs) / 1000);
          return {
            success: false, wasDuplicate: false,
            message: `Cooldown ativo. Aguarde ${remaining}s para proteger o contator.`,
            loadStatus: currentStatus, cooldownRemaining: remaining,
          };
        }
        const cooldownUntilNew = new Date(nowMs + cooldownMs);

        // Manual mode: send MQTT if topic is configured, otherwise just register
        if (site.controlMode === "manual") {
          let mqttManualResult: { success: boolean; message: string } | null = null;
          // In manual mode, still send MQTT if the site has a topic configured
          if (site.mqttTopic && isMqttConfigured()) {
            mqttManualResult = await sendMqttCommand(
              site.id, site.mqttTopic,
              input.action === "on" ? "ON" : "OFF",
              "manual_cmd",
            );
          }
          await upsertBessState(site.id, {
            loadStatus: input.action,
            lastManeuverAt: new Date(),
            cooldownUntil: cooldownUntilNew,
            lastDecision: mqttManualResult
              ? `Comando manual MQTT: Carga ${input.action === "on" ? "LIGADA" : "DESLIGADA"} — ${mqttManualResult.message}`
              : `Comando manual registrado: Carga ${input.action === "on" ? "LIGADA" : "DESLIGADA"}. (Sem MQTT — atuação local necessária)`,
          });
          await addEvent(site.id, input.action === "on" ? "MANUAL_CMD_ON" : "MANUAL_CMD_OFF",
            mqttManualResult
              ? `Carga ${input.action === "on" ? "LIGADA" : "DESLIGADA"} via MQTT (modo manual) — ${mqttManualResult.message}`
              : `Carga ${input.action === "on" ? "LIGADA" : "DESLIGADA"} — registro manual (sem atuação remota)`);
          await recordAction({
            siteId: site.id, source: "MANUAL",
            action: input.action === "on" ? "TURN_ON" : "TURN_OFF",
            socAtTime: state?.currentSoc ?? null, socSource: "REAL",
            pumpStateBefore: (state?.sonoffPower ?? null) as "ON" | "OFF" | "UNKNOWN" | null,
            pumpStateAfter: (mqttManualResult?.success ?? true)
              ? (input.action === "on" ? "ON" : "OFF")
              : (state?.sonoffPower ?? null) as "ON" | "OFF" | "UNKNOWN" | null,
            reason: `Comando manual (modo MANUAL)${mqttManualResult ? ` — ${mqttManualResult.message}` : " — sem MQTT"}`,
            userId: ctx.user?.id ?? null,
            metadata: {
              mode: "manual", mqttSent: !!mqttManualResult,
              userName: ctx.user?.name ?? null,
              userEmail: ctx.user?.email ?? null,
            },
          });
          // Força fetch FusionSolar imediato + reavaliação. Como cooldownUntil
          // foi gravado, o próximo poll respeita e agenda re-eval pra logo após.
          triggerSitePoll(input.slug);
          return {
            success: mqttManualResult ? mqttManualResult.success : true,
            wasDuplicate: false,
            message: mqttManualResult
              ? mqttManualResult.message
              : `Comando registrado. Sem MQTT configurado — a atuação física é necessária.`,
            loadStatus: input.action,
          };
        }

        // Execute command via MQTT for auto_mqtt sites
        let mqttResult: { success: boolean; message: string } | null = null;
        if (site.mqttTopic && isMqttConfigured()) {
          mqttResult = await sendMqttCommand(
            site.id, site.mqttTopic,
            input.action === "on" ? "ON" : "OFF",
            "manual_cmd",
          );
        }

        await upsertBessState(site.id, {
          loadStatus: input.action,
          lastManeuverAt: new Date(),
          cooldownUntil: cooldownUntilNew,
          lastDecision: mqttResult
            ? `Comando MQTT: Carga ${input.action === "on" ? "LIGADA" : "DESLIGADA"} — ${mqttResult.message}`
            : `Comando manual: Carga ${input.action === "on" ? "LIGADA" : "DESLIGADA"} pelo operador (MQTT não configurado).`,
        });
        await addEvent(site.id, input.action === "on" ? "MANUAL_CMD_ON" : "MANUAL_CMD_OFF",
          mqttResult
            ? `Carga ${input.action === "on" ? "LIGADA" : "DESLIGADA"} via MQTT — ${mqttResult.message}`
            : `Carga ${input.action === "on" ? "LIGADA" : "DESLIGADA"} manualmente pelo operador`);
        await recordAction({
          siteId: site.id, source: "MANUAL",
          action: input.action === "on" ? "TURN_ON" : "TURN_OFF",
          socAtTime: state?.currentSoc ?? null, socSource: "REAL",
          pumpStateBefore: (state?.sonoffPower ?? null) as "ON" | "OFF" | "UNKNOWN" | null,
          pumpStateAfter: (mqttResult?.success ?? true)
            ? (input.action === "on" ? "ON" : "OFF")
            : (state?.sonoffPower ?? null) as "ON" | "OFF" | "UNKNOWN" | null,
          reason: `Comando manual${mqttResult ? ` — ${mqttResult.message}` : " (sem MQTT)"}`,
          userId: ctx.user?.id ?? null,
          metadata: {
            mode: "auto_mqtt", mqttSent: !!mqttResult,
            userName: ctx.user?.name ?? null,
            userEmail: ctx.user?.email ?? null,
          },
        });

        const cmdSuccess = mqttResult ? mqttResult.success : true;
        // Força fetch FusionSolar imediato + reavaliação. Como cooldownUntil
        // foi gravado, o próximo poll respeita e agenda re-eval pra logo após.
        triggerSitePoll(input.slug);
        return {
          success: cmdSuccess, wasDuplicate: false,
          message: mqttResult
            ? mqttResult.message
            : `Carga ${input.action === "on" ? "LIGADA" : "DESLIGADA"} com sucesso (sem MQTT — apenas registro).`,
          loadStatus: input.action,
        };
      }),

    // ── Toggle mode for a site ──
    toggleMode: adminProcedure
      .input(z.object({ slug: z.string() }))
      .mutation(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { mode: "manual" as const };
        const state = await getBessState(site.id);
        const currentMode = state?.mode ?? "auto";
        const newMode = currentMode === "auto" ? "manual" : "auto";
        await upsertBessState(site.id, { mode: newMode });
        await addEvent(site.id, "MODE_CHANGE", `Modo alterado para ${newMode === "auto" ? "AUTOMÁTICO" : "MANUAL"}`);
        return { mode: newMode };
      }),

    // ── SOC readings history for a site ──
    readings: publicProcedure
      .input(z.object({ slug: z.string(), hours: z.number().min(1).max(168).default(4) }))
      .query(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return [];
        const rows = await getReadings(site.id, input.hours);
        return rows.map(r => ({
          soc: r.soc,
          soh: r.soh,
          batteryPower: r.batteryPower,
          batteryTemperature: r.batteryTemperature,
          pvPower: r.pvPower,
          loadPower: r.loadPower,
          timestamp: r.createdAt.getTime(),
        }));
      }),

    // ── Events for a site ──
    events: publicProcedure
      .input(z.object({ slug: z.string().optional() }))
      .query(async ({ input }) => {
        await ensureSeeded();
        if (input.slug) {
          const site = await getSiteBySlug(input.slug);
          if (!site) return [];
          return getRecentEvents(site.id, 30);
        }
        return getAllRecentEvents(50);
      }),

    // ── Alarms (global or per site) ──
    alarms: publicProcedure
      .input(z.object({ slug: z.string().optional() }))
      .query(async ({ input }) => {
        await ensureSeeded();
        if (input.slug) {
          const site = await getSiteBySlug(input.slug);
          if (!site) return [];
          return getActiveAlarms(site.id);
        }
        return getActiveAlarms();
      }),

    // ── Statistics for a site ──
    stats: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { min: 0, max: 0, avg: 0, count: 0 };
        const readings = await getReadings(site.id, 4);
        if (readings.length === 0) return { min: 0, max: 0, avg: 0, count: 0 };
        const socs = readings.map(r => r.soc);
        return {
          min: Math.round(Math.min(...socs) * 10) / 10,
          max: Math.round(Math.max(...socs) * 10) / 10,
          avg: Math.round((socs.reduce((a, b) => a + b, 0) / socs.length) * 10) / 10,
          count: socs.length,
        };
      }),

    // ── Get config for a site ──
    getConfig: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { socLowLimit: 15, socHighLimit: 20, cooldownMinutes: 5, lowReadingsRequired: 2, highReadingsRequired: 3, presetName: "padrao" };
        const config = await getBessConfig(site.id);
        return config ?? { socLowLimit: 15, socHighLimit: 20, cooldownMinutes: 5, lowReadingsRequired: 2, highReadingsRequired: 3, presetName: "padrao" };
      }),

    // ── Update config for a site ──
    updateConfig: adminProcedure
      .input(z.object({
        slug: z.string(),
        socLowLimit: z.number().min(5).max(50),
        socHighLimit: z.number().min(10).max(60),
        cooldownMinutes: z.number().min(1).max(30),
        lowReadingsRequired: z.number().min(1).max(10),
        highReadingsRequired: z.number().min(1).max(10),
        presetName: z.string(),
      }))
      .mutation(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { success: false, message: "Site não encontrado." };
        if (input.socHighLimit - input.socLowLimit < 5) {
          return { success: false, message: "O SOC de religação deve ser pelo menos 5 p.p. acima do SOC de desligamento." };
        }
        const { slug, ...configData } = input;
        await upsertBessConfig(site.id, configData);
        await addEvent(site.id, "MODE_CHANGE",
          `Configuração atualizada: Preset=${input.presetName}, Desliga<=${input.socLowLimit}%, Religa>=${input.socHighLimit}%, Cooldown=${input.cooldownMinutes}min`);
        return { success: true, message: `Configuração salva com sucesso. Preset: ${input.presetName}.` };
      }),

    // ── Weather (Open-Meteo, cache 10min) ──
    weather: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const site = await getSiteBySlug(input.slug);
        if (!site) return null;
        if (site.lat == null || site.lng == null) return { configured: false as const };
        const { getWeatherFor } = await import("./weather");
        const data = await getWeatherFor(site.lat, site.lng);
        if (!data) return { configured: true as const, available: false as const };
        return { configured: true as const, available: true as const, ...data };
      }),

    // ─── MVP v2 endpoints ───

    // ── Pump operation stats (hours ON, kWh estimated, cycles) ──
    // Aggregates bess_actions TURN_ON/TURN_OFF pairs into time buckets.
    // For "today" buckets, augments with bess_state.pumpOnSecondsToday so the
    // current open interval (bomba ainda ligada) é contabilizado em tempo real.
    pumpStats: publicProcedure
      .input(z.object({
        slug: z.string(),
        range: z.enum(["day", "week", "month", "year"]).default("week"),
        anchor: z.number().optional(), // ms epoch — drilldown anchor (specific day/month)
      }))
      .query(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { buckets: [], totalHoursOn: 0, totalKwh: 0, totalCycles: 0 };
        const db = await getDb();
        if (!db) return { buckets: [], totalHoursOn: 0, totalKwh: 0, totalCycles: 0 };

        // CV → kW (1 CV ≈ 0.7355 kW). pumpPowerCv é potência por bomba; * pumpCount.
        const totalKwPump = (site.pumpPowerCv ?? 0) * (site.pumpCount ?? 0) * 0.7355;

        // Janela de busca + bucket size. Quando `anchor` vem definido, a janela
        // é fixada nesse ponto (mês ou dia específico) em vez de rolling até now.
        const now = new Date();
        const anchorDate = input.anchor ? new Date(input.anchor) : now;
        let from: Date;
        let to: Date;
        let bucketKind: "hour" | "day" | "month";
        let bucketCount: number;
        if (input.range === "day") {
          from = new Date(anchorDate); from.setHours(0, 0, 0, 0);
          to = new Date(from); to.setDate(to.getDate() + 1);
          bucketKind = "hour"; bucketCount = 24;
        } else if (input.range === "week") {
          from = new Date(anchorDate); from.setDate(from.getDate() - 6); from.setHours(0, 0, 0, 0);
          to = new Date(anchorDate); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 1);
          bucketKind = "day"; bucketCount = 7;
        } else if (input.range === "month") {
          if (input.anchor) {
            // Mês específico (1º ao último dia do mês do anchor)
            from = new Date(anchorDate); from.setDate(1); from.setHours(0, 0, 0, 0);
            to = new Date(from); to.setMonth(to.getMonth() + 1);
            bucketCount = Math.round((to.getTime() - from.getTime()) / 86_400_000);
          } else {
            // Rolling 30 dias
            from = new Date(now); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0);
            to = new Date(now); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 1);
            bucketCount = 30;
          }
          bucketKind = "day";
        } else {
          // 12 meses terminando no anchor (ou now)
          from = new Date(anchorDate); from.setMonth(from.getMonth() - 11); from.setDate(1); from.setHours(0, 0, 0, 0);
          to = new Date(anchorDate); to.setDate(1); to.setHours(0, 0, 0, 0); to.setMonth(to.getMonth() + 1);
          bucketKind = "month"; bucketCount = 12;
        }

        // Última ação ANTES do range pra saber se entrou ligado
        const priorRows = await db
          .select({ action: bessActions.action })
          .from(bessActions)
          .where(and(
            eq(bessActions.siteId, site.id),
            inArray(bessActions.action, ["TURN_ON", "TURN_OFF"]),
            lt(bessActions.timestamp, from),
          ))
          .orderBy(desc(bessActions.timestamp))
          .limit(1);

        // Sem fallback otimista: se não há TURN_ON/OFF registrados, gráfico fica vazio.
        // Inferir "estava ON antes" gera dados imprecisos (não sabemos quando ligou).
        // O v1 antigo (até 15:11 BRT 2026-04-26) não escreveu TURN_ON/OFF — esse hiato
        // é mostrado como zero. A partir do v2 a contagem fica precisa ao segundo.

        // Ações dentro do range [from, to), ascendente
        const rows = await db
          .select({ timestamp: bessActions.timestamp, action: bessActions.action })
          .from(bessActions)
          .where(and(
            eq(bessActions.siteId, site.id),
            inArray(bessActions.action, ["TURN_ON", "TURN_OFF"]),
            gte(bessActions.timestamp, from),
            lt(bessActions.timestamp, to),
          ))
          .orderBy(asc(bessActions.timestamp));

        // Reconstrói intervalos ON [start, end). Ainda ligada → end = now.
        const intervals: { start: Date; end: Date }[] = [];

        // Estado em `from` deduzido SOMENTE de eventos registrados:
        // só consideramos ON se houver um TURN_ON anterior (ou TURN_ON dentro do range).
        // Se a única evidência é um TURN_OFF dentro do range, NÃO inferimos — não
        // sabemos quando ligou (pode ter sido às 06h, 12h, etc.).
        let pendingStart: Date | null = priorRows[0]?.action === "TURN_ON" ? from : null;
        for (const a of rows) {
          const ts = a.timestamp instanceof Date ? a.timestamp : new Date(a.timestamp as unknown as string);
          if (a.action === "TURN_ON") {
            if (!pendingStart) pendingStart = ts;
          } else if (a.action === "TURN_OFF") {
            if (pendingStart) {
              intervals.push({ start: pendingStart, end: ts });
              pendingStart = null;
            }
          }
        }
        // Fecha interval pendente respeitando o limite do range (now p/ janela atual,
        // `to` p/ janela passada — assume bomba foi desligada no fim do range).
        const rangeEndMs = Math.min(now.getTime(), to.getTime());
        if (pendingStart) intervals.push({ start: pendingStart, end: new Date(rangeEndMs) });

        // Aloca buckets
        type Bucket = { label: string; ts: number; secondsOn: number; cycles: number };
        const buckets: Bucket[] = [];
        for (let i = 0; i < bucketCount; i++) {
          const d = new Date(from);
          if (bucketKind === "hour") d.setHours(d.getHours() + i);
          else if (bucketKind === "day") d.setDate(d.getDate() + i);
          else d.setMonth(d.getMonth() + i);
          const label =
            bucketKind === "hour" ? `${String(d.getHours()).padStart(2, "0")}h`
            : bucketKind === "day" ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
            : d.toLocaleDateString("pt-BR", { month: "short" });
          buckets.push({ label, ts: d.getTime(), secondsOn: 0, cycles: 0 });
        }

        // Distribui intervalos pelos buckets
        function bucketIndexFor(t: number): number {
          for (let i = buckets.length - 1; i >= 0; i--) {
            if (t >= buckets[i].ts) return i;
          }
          return -1;
        }
        function bucketEnd(i: number): number {
          return i + 1 < buckets.length ? buckets[i + 1].ts : to.getTime();
        }
        for (const iv of intervals) {
          const startMs = iv.start.getTime();
          const endMs = iv.end.getTime();
          const startIdx = Math.max(0, bucketIndexFor(startMs));
          const endIdx = Math.max(0, bucketIndexFor(endMs - 1));
          for (let i = startIdx; i <= endIdx; i++) {
            const segStart = Math.max(startMs, buckets[i].ts);
            const segEnd = Math.min(endMs, bucketEnd(i));
            if (segEnd > segStart) {
              buckets[i].secondsOn += (segEnd - segStart) / 1000;
            }
          }
          // Conta o ciclo no bucket onde começou
          if (startIdx >= 0 && startIdx < buckets.length) {
            buckets[startIdx].cycles += 1;
          }
        }

        const result = buckets.map((b) => ({
          label: b.label,
          ts: b.ts,
          hoursOn: +(b.secondsOn / 3600).toFixed(2),
          kwhEstimado: +((b.secondsOn / 3600) * totalKwPump).toFixed(2),
          cycles: b.cycles,
        }));

        const totalHoursOn = +result.reduce((s, b) => s + b.hoursOn, 0).toFixed(2);
        const totalKwh = +result.reduce((s, b) => s + b.kwhEstimado, 0).toFixed(2);
        const totalCycles = result.reduce((s, b) => s + b.cycles, 0);

        return { buckets: result, totalHoursOn, totalKwh, totalCycles, pumpKw: +totalKwPump.toFixed(2) };
      }),

    // List actions log (audit) for a site
    getActions: publicProcedure
      .input(z.object({ slug: z.string(), limit: z.number().min(1).max(200).default(50) }))
      .query(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return [];
        const db = await getDb();
        if (!db) return [];
        // LEFT JOIN com users pra trazer nome/email de quem fez cada ação manual.
        // Importação dinâmica evita ciclo com schema (já está na escopo do file).
        const { users } = await import("../drizzle/schema");
        const rows = await db
          .select({
            id: bessActions.id,
            siteId: bessActions.siteId,
            timestamp: bessActions.timestamp,
            source: bessActions.source,
            action: bessActions.action,
            socAtTime: bessActions.socAtTime,
            socSource: bessActions.socSource,
            pumpStateBefore: bessActions.pumpStateBefore,
            pumpStateAfter: bessActions.pumpStateAfter,
            reason: bessActions.reason,
            userId: bessActions.userId,
            metadata: bessActions.metadata,
            userName: users.name,
            userEmail: users.email,
          })
          .from(bessActions)
          .leftJoin(users, eq(bessActions.userId, users.id))
          .where(eq(bessActions.siteId, site.id))
          .orderBy(desc(bessActions.timestamp))
          .limit(input.limit);
        return rows;
      }),

    // Update v2 config fields (additive — v1 fields untouched)
    updateConfigV2: adminProcedure
      .input(z.object({
        slug: z.string(),
        socMinDesliga: z.number().int().min(5).max(60).optional(),
        socMinReliga: z.number().int().min(10).max(80).optional(),
        socBlackout: z.number().int().min(5).max(40).optional(),
        horarioLiberacao: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        horarioCorte: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        margemZonaCritica: z.number().int().min(0).max(20).optional(),
        intervaloPadrao: z.number().int().min(2).max(60).optional(),
        intervaloCritico: z.number().int().min(1).max(15).optional(),
        intervaloNoturno: z.number().int().min(15).max(240).optional(),
        intervaloBombaSemSolar: z.number().int().min(1).max(30).optional(),
        cooldownAcao: z.number().int().min(1).max(30).optional(),
        maxSemTelemetria: z.number().int().min(5).max(120).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { success: false, message: "Site não encontrado." };

        const db = await getDb();
        if (!db) return { success: false, message: "DB indisponível." };

        // Carrega config atual pra validação cruzada
        const current = (await db.select().from(bessConfigTable).where(eq(bessConfigTable.siteId, site.id)).limit(1))[0];
        if (!current) return { success: false, message: "Config não encontrada." };

        const next = {
          socMinDesliga: input.socMinDesliga ?? current.socMinDesliga,
          socMinReliga: input.socMinReliga ?? current.socMinReliga,
          socBlackout: input.socBlackout ?? current.socBlackout,
          horarioLiberacao: input.horarioLiberacao ?? current.horarioLiberacao,
          horarioCorte: input.horarioCorte ?? current.horarioCorte,
          margemZonaCritica: input.margemZonaCritica ?? current.margemZonaCritica,
          intervaloPadrao: input.intervaloPadrao ?? current.intervaloPadrao,
          intervaloCritico: input.intervaloCritico ?? current.intervaloCritico,
          intervaloNoturno: input.intervaloNoturno ?? current.intervaloNoturno,
          intervaloBombaSemSolar: input.intervaloBombaSemSolar ?? current.intervaloBombaSemSolar,
          cooldownAcao: input.cooldownAcao ?? current.cooldownAcao,
          maxSemTelemetria: input.maxSemTelemetria ?? current.maxSemTelemetria,
        };

        if (next.socMinReliga - next.socMinDesliga < 3) {
          return { success: false, message: "socMinReliga deve ser pelo menos 3 p.p. acima de socMinDesliga (histerese)." };
        }
        if (next.socBlackout >= next.socMinDesliga) {
          return { success: false, message: "socBlackout deve ser menor que socMinDesliga." };
        }
        if (next.horarioLiberacao >= next.horarioCorte) {
          return { success: false, message: "horarioLiberacao deve ser anterior a horarioCorte." };
        }

        await db.update(bessConfigTable).set(next).where(eq(bessConfigTable.siteId, site.id));

        await db.insert(bessActions).values({
          siteId: site.id,
          source: "MANUAL",
          action: "CONFIG_CHANGE",
          reason: `Configuração alterada${ctx.user ? ` por ${ctx.user.name ?? ctx.user.email ?? "admin"}` : ""}`,
          userId: ctx.user?.id ?? null,
          metadata: { ...next, userName: ctx.user?.name ?? null, userEmail: ctx.user?.email ?? null },
        });

        // Força reagendamento com a config nova — não espera o timer atual
        triggerSitePoll(input.slug);

        return { success: true, message: "Configuração v2 atualizada." };
      }),

    // Toggle controlMode AUTO ↔ MANUAL no bess_config
    setControlMode: adminProcedure
      .input(z.object({ slug: z.string(), mode: z.enum(["AUTO", "MANUAL"]) }))
      .mutation(async ({ input, ctx }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { success: false, message: "Site não encontrado." };

        const db = await getDb();
        if (!db) return { success: false, message: "DB indisponível." };

        await db.update(bessConfigTable).set({ controlMode: input.mode }).where(eq(bessConfigTable.siteId, site.id));

        await db.insert(bessActions).values({
          siteId: site.id,
          source: "MANUAL",
          action: "MODE_CHANGE",
          reason: `controlMode → ${input.mode}${ctx.user ? ` (por ${ctx.user.name ?? ctx.user.email ?? "admin"})` : ""}`,
          userId: ctx.user?.id ?? null,
          metadata: { mode: input.mode, userName: ctx.user?.name ?? null, userEmail: ctx.user?.email ?? null },
        });

        // Mudou pra AUTO ou MANUAL — força reavaliação imediata
        triggerSitePoll(input.slug);

        return { success: true, message: `Modo de controle: ${input.mode}` };
      }),

    // ── Simulate SOC tick for a site (demo/fallback) ──
    simulateTick: publicProcedure
      .input(z.object({ slug: z.string() }))
      .mutation(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { soc: 0, healthStatus: "healthy", loadStatus: "off" };
        const state = await getBessState(site.id);
        const config = await getBessConfig(site.id);
        const socLow = config?.socLowLimit ?? 15;
        const socHigh = config?.socHighLimit ?? 20;
        const lowRequired = config?.lowReadingsRequired ?? 2;
        const highRequired = config?.highReadingsRequired ?? 3;
        const currentSoc = state?.currentSoc ?? 50;

        const delta = (Math.random() - 0.45) * 2;
        const newSoc = Math.round(Math.max(5, Math.min(100, currentSoc + delta)) * 10) / 10;
        const pvPower = Math.round(Math.max(0, 30 * Math.sin(Date.now() / 3600000 * Math.PI) + (Math.random() - 0.5) * 5) * 10) / 10;
        const battPower = Math.round((-5 + Math.random() * 15) * 10) / 10;
        const temp = Math.round((28 + Math.random() * 6) * 10) / 10;

        await addReading(site.id, {
          soc: newSoc, soh: state?.currentSoh ?? 99, batteryPower: battPower,
          batteryTemperature: temp, pvPower, loadPower: Math.abs(battPower) + pvPower * 0.3,
        });

        let lowCounter = state?.lowCounter ?? 0;
        let highCounter = state?.highCounter ?? 0;
        let healthStatus: "healthy" | "attention" | "degraded" | "critical" = "healthy";
        let lastDecision = "";
        let loadStatus = state?.loadStatus ?? "on";

        if (newSoc <= socLow) {
          lowCounter++;
          highCounter = 0;
          if (lowCounter >= lowRequired && loadStatus === "on") {
            loadStatus = "off"; lowCounter = 0; healthStatus = "critical";
            lastDecision = `SOC em ${newSoc}% — CARGA DESLIGADA automaticamente (${lowRequired} leituras <= ${socLow}%).`;
            await addEvent(site.id, "LOAD_OFF", lastDecision);
            // ── Send MQTT command to Sonoff (auto OFF) ──
            if (site.controlMode === "auto_mqtt" && site.mqttTopic) {
              await sendMqttCommand(site.id, site.mqttTopic, "OFF", `autoTick:${site.slug}`);
            }
            // Notify owner of critical auto-shutdown
            notifyCriticalAlarm(site.name, `CARGA DESLIGADA automaticamente.\n\nSOC: ${newSoc}%\nLimite: ${socLow}%\nLeituras consecutivas: ${lowRequired}\n\nA carga será religada quando o SOC atingir ${socHigh}%.`);
          } else {
            healthStatus = lowCounter >= lowRequired ? "critical" : "attention";
            lastDecision = `SOC em ${newSoc}% — abaixo do limite (${socLow}%). Contador LOW: ${lowCounter}/${lowRequired}.`;
          }
        } else if (newSoc >= socHigh) {
          highCounter++;
          lowCounter = 0;
          if (highCounter >= highRequired && loadStatus === "off") {
            loadStatus = "on"; highCounter = 0; healthStatus = "healthy";
            lastDecision = `SOC em ${newSoc}% — CARGA RELIGADA automaticamente (${highRequired} leituras >= ${socHigh}%).`;
            await addEvent(site.id, "LOAD_ON", lastDecision);
            // ── Send MQTT command to Sonoff (auto ON) ──
            if (site.controlMode === "auto_mqtt" && site.mqttTopic) {
              await sendMqttCommand(site.id, site.mqttTopic, "ON", `autoTick:${site.slug}`);
            }
          } else if (highCounter >= highRequired && loadStatus === "on") {
            highCounter = highRequired; healthStatus = "healthy";
            lastDecision = `SOC em ${newSoc}% — acima do limite (${socHigh}%). Carga já ligada. Estabilizado.`;
          } else {
            healthStatus = "healthy";
            lastDecision = `SOC em ${newSoc}% — acima do limite (${socHigh}%). Contador HIGH: ${highCounter}/${highRequired}.`;
          }
        } else {
          healthStatus = lowCounter > 0 ? "degraded" : "attention";
          lastDecision = `SOC em ${newSoc}% — zona morta (${socLow + 1}-${socHigh - 1}%). Estado mantido.`;
        }

        await upsertBessState(site.id, {
          currentSoc: newSoc, currentBatteryPower: battPower, currentTemperature: temp,
          currentPvPower: pvPower, currentLoadPower: Math.abs(battPower) + pvPower * 0.3,
          loadStatus, lowCounter, highCounter, healthStatus, lastDecision,
          lastManeuverAt: (loadStatus !== (state?.loadStatus ?? "on")) ? new Date() : undefined,
        });

        return { soc: newSoc, healthStatus, loadStatus };
      }),

    // ═══════════════════════════════════════════════════════
    // Energy Trend (daily chart like FusionSolar)
    // ═══════════════════════════════════════════════════════

    energyTrend: publicProcedure
      .input(z.object({ slug: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
      .query(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { success: false, points: [], yieldKwh: 0 };

        const readings = await getReadingsByDate(site.id, input.date);

        // Map readings to raw chart points
        const rawPoints = readings.map((r: any) => {
          const t = new Date(r.createdAt);
          const battPower = r.batteryPower ?? 0;
          return {
            timestamp: t.getTime(),
            pvOutput: Math.max(0, r.pvPower ?? 0),
            essDischarge: battPower < 0 ? Math.abs(battPower) : 0,
            essCharge: battPower > 0 ? battPower : 0,
            loadPower: r.loadPower ?? 0,
            soc: r.soc ?? 0,
          };
        });

        // Aggregate into 5-minute buckets to reduce noise
        const BUCKET_MS = 5 * 60 * 1000; // 5 minutes
        const bucketMap = new Map<number, typeof rawPoints>();
        for (const p of rawPoints) {
          const bucketKey = Math.floor(p.timestamp / BUCKET_MS) * BUCKET_MS;
          if (!bucketMap.has(bucketKey)) bucketMap.set(bucketKey, []);
          bucketMap.get(bucketKey)!.push(p);
        }

        const points = Array.from(bucketMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([bucketTs, bucket]) => {
            const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
            const t = new Date(bucketTs);
            const hh = String(t.getHours()).padStart(2, "0");
            const mm = String(t.getMinutes()).padStart(2, "0");
            return {
              time: `${hh}:${mm}`,
              timestamp: bucketTs,
              pvOutput: Math.round(avg(bucket.map(b => b.pvOutput)) * 100) / 100,
              essDischarge: Math.round(avg(bucket.map(b => b.essDischarge)) * 100) / 100,
              essCharge: Math.round(avg(bucket.map(b => b.essCharge)) * 100) / 100,
              loadPower: Math.round(avg(bucket.map(b => b.loadPower)) * 100) / 100,
              soc: Math.round(avg(bucket.map(b => b.soc)) * 10) / 10,
            };
          });

        // Calculate daily yield (sum of PV output * interval in hours)
        let yieldKwh = 0;
        for (let i = 1; i < points.length; i++) {
          const dt = (points[i].timestamp - points[i - 1].timestamp) / 3600000; // hours
          yieldKwh += points[i].pvOutput * dt;
        }

        return { success: true, points, yieldKwh: Math.round(yieldKwh * 100) / 100 };
      }),

    // ═══════════════════════════════════════════════════════
    // FusionSolar Real Integration Endpoints
    // ═══════════════════════════════════════════════════════

    // ── Check FusionSolar integration status ──
    fusionsolarStatus: publicProcedure.query(async () => {
      const configured = isFusionSolarConfigured();
      if (!configured) {
        return {
          configured: false,
          connected: false,
          message: "Credenciais FusionSolar não configuradas. Defina FUSIONSOLAR_USERNAME e FUSIONSOLAR_SYSTEM_CODE.",
        };
      }
      try {
        const client = getFusionSolarClient();
        const loggedIn = await client.login();
        return {
          configured: true,
          connected: loggedIn,
          message: loggedIn ? "Conectado à FusionSolar API." : "Falha na autenticação FusionSolar.",
        };
      } catch (error) {
        return {
          configured: true,
          connected: false,
          message: `Erro ao conectar: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),

    // ── Discover stations and devices from FusionSolar ──
    fusionsolarDiscover: publicProcedure.mutation(async () => {
      if (!isFusionSolarConfigured()) {
        return { success: false, message: "FusionSolar não configurada.", stations: [], devices: [] };
      }
      try {
        const client = getFusionSolarClient();
        const stations = await client.getStationList();
        const allDevices: Array<{ stationCode: string; devices: any[] }> = [];
        for (const station of stations) {
          const devices = await client.getDeviceList(station.stationCode);
          allDevices.push({ stationCode: station.stationCode, devices });
        }
        return { success: true, message: `Encontradas ${stations.length} planta(s).`, stations, devices: allDevices };
      } catch (error) {
        return { success: false, message: `Erro: ${error instanceof Error ? error.message : String(error)}`, stations: [], devices: [] };
      }
    }),

    // ── Fetch real-time data from FusionSolar for a site ──
    fusionsolarFetch: publicProcedure
      .input(z.object({ slug: z.string() }))
      .mutation(async ({ input }) => {
        return fetchFusionSolarData(input.slug);
      }),

    // ── Fetch alarms from FusionSolar for a site ──
    fusionsolarAlarms: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site || !site.fusionsolarPlantCode || !isFusionSolarConfigured()) {
          return { configured: false, alarms: [] };
        }
        try {
          const client = getFusionSolarClient();
          const now = Date.now();
          const alarms = await client.getAlarmList(
            site.fusionsolarPlantCode,
            now - 7 * 24 * 60 * 60 * 1000, // last 7 days
            now
          );
          return {
            configured: true,
            alarms: alarms.map(a => ({
              id: a.alarmId,
              name: a.alarmName,
              device: a.devName,
              severity: a.severity === 1 ? "CRITICAL" : a.severity === 2 ? "MAJOR" : a.severity === 3 ? "MINOR" : "WARNING",
              time: a.raiseTime,
              station: a.stationName,
            })),
          };
        } catch (error) {
          return { configured: true, alarms: [] };
        }
      }),

    // ── Configure FusionSolar device IDs for a site ──
    configureSite: publicProcedure
      .input(z.object({
        slug: z.string(),
        fusionsolarDeviceIds: z.string().optional(),
        fusionsolarInverterIds: z.string().optional(),
        fusionsolarPlantCode: z.string().optional(),
        mqttTopic: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { success: false, message: "Site não encontrado." };

        const updateData: Record<string, unknown> = {};
        if (input.fusionsolarDeviceIds !== undefined) updateData.fusionsolarDeviceIds = input.fusionsolarDeviceIds;
        if (input.fusionsolarInverterIds !== undefined) updateData.fusionsolarInverterIds = input.fusionsolarInverterIds;
        if (input.fusionsolarPlantCode !== undefined) updateData.fusionsolarPlantCode = input.fusionsolarPlantCode;
        if (input.mqttTopic !== undefined) updateData.mqttTopic = input.mqttTopic;

        if (Object.keys(updateData).length === 0) {
          return { success: false, message: "Nenhum campo para atualizar." };
        }

        await upsertSite({ slug: input.slug, ...updateData } as any);
        await addEvent(site.id, "CONFIG_CHANGE", `Configuração do site atualizada: ${JSON.stringify(updateData)}`);
        return { success: true, message: "Configuração do site atualizada com sucesso." };
      }),

    // ── Manual SOC update ──
    updateSoc: publicProcedure
      .input(z.object({
        slug: z.string(),
        soc: z.number().min(0).max(100),
      }))
      .mutation(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { success: false, message: "Site não encontrado." };

        await upsertBessState(site.id, {
          currentSoc: input.soc,
          socSource: "manual",
          lastTelemetryAt: new Date(),
        });

        await addEvent(site.id, "SOC_MANUAL", `SOC atualizado manualmente para ${input.soc.toFixed(1)}%`);
        console.log(`[ManualSOC] ${site.slug}: SOC atualizado para ${input.soc.toFixed(1)}% (fonte=manual)`);

        return { success: true, message: `SOC atualizado para ${input.soc.toFixed(1)}%` };
      }),

    // ── Integration status summary ──
    integrationStatus: publicProcedure.query(async () => {
      await ensureSeeded();
      const fsConfigured = isFusionSolarConfigured();
      let fsConnected = false;
      if (fsConfigured) {
        try {
          const client = getFusionSolarClient();
          fsConnected = await client.login();
        } catch { /* ignore */ }
      }
      const sites = await getAllSites();
      const siteStatuses = [];
      for (const site of sites) {
        const state = await getBessState(site.id);
        siteStatuses.push({
          slug: site.slug,
          name: site.name,
          fusionsolarConfigured: !!(site.fusionsolarDeviceIds && site.fusionsolarPlantCode),
          mqttConfigured: !!site.mqttTopic,
          mqttConnected: state?.mqttConnected ?? false,
          sonoffOnline: state?.sonoffOnline ?? false,
          controlMode: site.controlMode,
        });
      }
      return {
        fusionsolar: { configured: fsConfigured, connected: fsConnected },
        mqtt: {
          configured: isMqttConfigured(),
          connected: isMqttConfigured() ? getMqttClient().isConnected : false,
          brokerHost: process.env.MQTT_BROKER_HOST ?? "não configurado",
          brokerPort: parseInt(process.env.MQTT_BROKER_PORT ?? "1883", 10),
        },
        sites: siteStatuses,
      };
    }),

    // ── Reports: list reports ──
    reports: publicProcedure
      .input(z.object({
        slug: z.string().optional(),
        limit: z.number().min(1).max(200).default(20),
        page: z.number().min(1).default(1),
      }))
      .query(async ({ input }) => {
        await ensureSeeded();
        let siteId: number | undefined;
        if (input.slug) {
          const site = await getSiteBySlug(input.slug);
          if (site) siteId = site.id;
        }
        const offset = (input.page - 1) * input.limit;
        const [reports, totalCount] = await Promise.all([
          getReports(siteId, input.limit, offset),
          getReportsCount(siteId),
        ]);
        return {
          items: reports.map(r => ({
            id: r.id,
            siteId: r.siteId,
            reportType: r.reportType,
            periodStart: r.periodStart,
            periodEnd: r.periodEnd,
            avgSoc: r.avgSoc,
            minSoc: r.minSoc,
            maxSoc: r.maxSoc,
            avgPvPower: r.avgPvPower,
            maxPvPower: r.maxPvPower,
            avgLoadPower: r.avgLoadPower,
            maxLoadPower: r.maxLoadPower,
            avgBatteryPower: r.avgBatteryPower,
            avgTemperature: r.avgTemperature,
            maxTemperature: r.maxTemperature,
            totalReadings: r.totalReadings,
            loadOnMinutes: r.loadOnMinutes,
            estimatedEnergyKwh: r.estimatedEnergyKwh,
            totalEvents: r.totalEvents,
            totalAlarms: r.totalAlarms,
            maneuverCount: r.maneuverCount,
            notificationSent: r.notificationSent,
            createdAt: r.createdAt,
          })),
          totalCount,
          page: input.page,
          pageSize: input.limit,
          totalPages: Math.ceil(totalCount / input.limit),
        };
      }),

    // ── Reports: trend data for charts ──
    reportTrends: publicProcedure
      .input(z.object({
        slug: z.string().optional(),
        reportType: z.enum(["daily", "weekly"]).optional(),
        limit: z.number().min(1).max(500).default(100),
        sinceDays: z.number().min(1).max(365).optional(),
      }))
      .query(async ({ input }) => {
        await ensureSeeded();
        let siteId: number | undefined;
        if (input.slug) {
          const site = await getSiteBySlug(input.slug);
          if (site) siteId = site.id;
        }
        let since: Date | undefined;
        if (input.sinceDays) {
          since = new Date(Date.now() - input.sinceDays * 24 * 60 * 60 * 1000);
        }
        return getReportTrends({
          siteId,
          reportType: input.reportType,
          limit: input.limit,
          since,
        });
      }),

    // ── Reports: generate on-demand report ──
    generateReport: publicProcedure
      .input(z.object({
        slug: z.string(),
        reportType: z.enum(["daily", "weekly"]),
      }))
      .mutation(async ({ input }) => {
        await ensureSeeded();
        const site = await getSiteBySlug(input.slug);
        if (!site) return { success: false, message: "Site não encontrado." };

        const now = new Date();
        const periodStart = input.reportType === "daily"
          ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
          : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const result = await generateSiteReport(
          site.id, site.name, input.reportType, periodStart, now,
          { skipDedup: true } // On-demand: always generate
        );
        return {
          success: result.success,
          message: result.message,
          report: result.report ? {
            avgSoc: result.report.avgSoc,
            minSoc: result.report.minSoc,
            maxSoc: result.report.maxSoc,
            loadOnMinutes: result.report.loadOnMinutes,
            estimatedEnergyKwh: result.report.estimatedEnergyKwh,
            totalEvents: result.report.totalEvents,
            totalAlarms: result.report.totalAlarms,
            maneuverCount: result.report.maneuverCount,
          } : null,
        };
      }),

    // ── Reports: generate all + notify ──
    generateAllReports: publicProcedure
      .input(z.object({ reportType: z.enum(["daily", "weekly"]) }))
      .mutation(async ({ input }) => {
        await ensureSeeded();
        const { results, notified } = await generateAndNotify(input.reportType, { skipDedup: true });
        return {
          success: results.some(r => r.success),
          notified,
          reports: results.map(r => ({
            siteName: r.siteName,
            success: r.success,
            message: r.message,
          })),
        };
      }),

    // ── Scheduler Settings ──
    schedulerSettings: publicProcedure
      .query(async () => {
        return getSchedulerSettings();
      }),

    updateSchedulerSettings: publicProcedure
      .input(z.object({
        enabled: z.boolean().optional(),
        dailyHour: z.number().min(0).max(23).optional(),
        weeklyDay: z.number().min(0).max(6).optional(),
      }))
      .mutation(async ({ input }) => {
        if (input.enabled !== undefined) {
          await upsertSetting(SETTING_SCHEDULER_ENABLED, String(input.enabled), "Habilitar/desabilitar scheduler automático de relatórios");
        }
        if (input.dailyHour !== undefined) {
          await upsertSetting(SETTING_DAILY_HOUR, String(input.dailyHour), "Hora do dia (0-23) para gerar relatórios diários");
        }
        if (input.weeklyDay !== undefined) {
          await upsertSetting(SETTING_WEEKLY_DAY, String(input.weeklyDay), "Dia da semana (0=Dom, 1=Seg, ..., 6=Sáb) para relatórios semanais");
        }
        return getSchedulerSettings();
      }),
  }),
});

export type AppRouter = typeof appRouter;
