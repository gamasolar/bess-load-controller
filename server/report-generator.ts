/**
 * BESS Performance Report Generator
 *
 * Generates daily and weekly performance reports for each BESS site.
 * Aggregates readings, events, and alarms into a summary stored in bess_reports.
 * Sends push notifications to the project owner with report highlights.
 *
 * Features:
 * - Deduplication: checks hasRecentReport before generating to avoid duplicates on restart
 * - Notification persistence: updates notificationSent=true in DB after successful push
 * - Configurable scheduler: reads daily report hour from bess_settings table
 * - Settings keys: "scheduler_daily_hour" (0-23), "scheduler_enabled" ("true"/"false")
 */

import {
  getAllSites,
  aggregateReadings,
  countEvents,
  estimateLoadOnMinutes,
  addReport,
  getLatestReport,
  hasRecentReport,
  updateReportNotification,
  getSetting,
  upsertSetting,
} from "./db";
import { notifyOwner } from "./_core/notification";
import type { InsertBessReport } from "../drizzle/schema";

// ── Constants ─────────────────────────────────────────────────

export const SETTING_SCHEDULER_ENABLED = "scheduler_enabled";
export const SETTING_DAILY_HOUR = "scheduler_daily_hour";
export const SETTING_WEEKLY_DAY = "scheduler_weekly_day"; // 0=Sunday, 1=Monday, ...

const DEFAULT_DAILY_HOUR = 6;    // 06:00 AM
const DEFAULT_WEEKLY_DAY = 1;    // Monday
const CHECK_INTERVAL = 60_000;   // Check every 60 seconds

// ── Report Generation ──────────────────────────────────────

export interface ReportResult {
  siteId: number;
  siteName: string;
  reportType: "daily" | "weekly";
  success: boolean;
  message: string;
  report?: InsertBessReport;
}

/**
 * Generate a performance report for a single site and period.
 * Includes dedup check: if a report already exists for the same site/type/period, skip.
 */
export async function generateSiteReport(
  siteId: number,
  siteName: string,
  reportType: "daily" | "weekly",
  periodStart: Date,
  periodEnd: Date,
  options: { skipDedup?: boolean } = {}
): Promise<ReportResult> {
  try {
    // Dedup check: avoid generating duplicate reports for the same period
    if (!options.skipDedup) {
      const exists = await hasRecentReport(siteId, reportType, periodStart);
      if (exists) {
        return {
          siteId, siteName, reportType,
          success: false,
          message: `Relatório ${reportType} já existe para ${siteName} neste período.`,
        };
      }
    }

    // Aggregate reading metrics
    const metrics = await aggregateReadings(siteId, periodStart, periodEnd);
    if (!metrics) {
      return {
        siteId, siteName, reportType,
        success: false,
        message: `Sem leituras no período para ${siteName}.`,
      };
    }

    // Count events and maneuvers
    const eventCounts = await countEvents(siteId, periodStart, periodEnd);

    // Estimate load-on time
    const loadOnMinutes = await estimateLoadOnMinutes(siteId, periodStart, periodEnd);

    // Estimate energy consumed (kWh) = avg load power * hours of operation
    const hoursOn = loadOnMinutes / 60;
    const estimatedEnergyKwh = metrics.avgLoadPower
      ? Math.round(metrics.avgLoadPower * hoursOn * 100) / 100
      : 0;

    const report: InsertBessReport = {
      siteId,
      reportType,
      periodStart,
      periodEnd,
      avgSoc: Math.round(metrics.avgSoc * 100) / 100,
      minSoc: Math.round(metrics.minSoc * 100) / 100,
      maxSoc: Math.round(metrics.maxSoc * 100) / 100,
      avgPvPower: metrics.avgPvPower ? Math.round(metrics.avgPvPower * 100) / 100 : null,
      maxPvPower: metrics.maxPvPower ? Math.round(metrics.maxPvPower * 100) / 100 : null,
      avgLoadPower: metrics.avgLoadPower ? Math.round(metrics.avgLoadPower * 100) / 100 : null,
      maxLoadPower: metrics.maxLoadPower ? Math.round(metrics.maxLoadPower * 100) / 100 : null,
      avgBatteryPower: metrics.avgBatteryPower ? Math.round(metrics.avgBatteryPower * 100) / 100 : null,
      avgTemperature: metrics.avgTemperature ? Math.round(metrics.avgTemperature * 100) / 100 : null,
      maxTemperature: metrics.maxTemperature ? Math.round(metrics.maxTemperature * 100) / 100 : null,
      totalReadings: metrics.totalReadings,
      loadOnMinutes,
      estimatedEnergyKwh,
      totalEvents: eventCounts.total,
      totalAlarms: eventCounts.alarms,
      maneuverCount: eventCounts.maneuvers,
      notificationSent: false,
    };

    // Save report to database
    await addReport(report);

    return {
      siteId, siteName, reportType,
      success: true,
      message: `Relatório ${reportType} gerado: SOC médio ${report.avgSoc}%, ${loadOnMinutes}min operação, ${estimatedEnergyKwh} kWh estimados.`,
      report,
    };
  } catch (error) {
    return {
      siteId, siteName, reportType,
      success: false,
      message: `Erro ao gerar relatório: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Generate reports for all active sites.
 * The scheduler passes skipDedup=false (default) to prevent duplicates.
 * On-demand generation from the UI passes skipDedup=true to always generate.
 */
export async function generateAllReports(
  reportType: "daily" | "weekly",
  options: { skipDedup?: boolean } = {}
): Promise<ReportResult[]> {
  const sites = await getAllSites();
  const results: ReportResult[] = [];

  const now = new Date();
  let periodStart: Date;
  let periodEnd: Date;

  if (reportType === "daily") {
    periodEnd = new Date(now);
    periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else {
    periodEnd = new Date(now);
    periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  for (const site of sites) {
    const result = await generateSiteReport(
      site.id, site.name, reportType, periodStart, periodEnd, options
    );
    results.push(result);
  }

  return results;
}

// ── Notification ───────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatReportNotification(results: ReportResult[], reportType: "daily" | "weekly"): { title: string; content: string } {
  const typeLabel = reportType === "daily" ? "Diário" : "Semanal";
  const now = new Date();
  const dateStr = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  let content = `Relatório ${typeLabel} — ${dateStr}\n\n`;

  for (const r of results) {
    if (r.success && r.report) {
      const rp = r.report;
      content += `--- ${r.siteName} ---\n`;
      content += `SOC: ${rp.avgSoc}% (min: ${rp.minSoc}%, max: ${rp.maxSoc}%)\n`;
      if (rp.avgPvPower != null) content += `Geração FV média: ${rp.avgPvPower} kW (pico: ${rp.maxPvPower} kW)\n`;
      if (rp.avgLoadPower != null) content += `Consumo médio: ${rp.avgLoadPower} kW (pico: ${rp.maxLoadPower} kW)\n`;
      if (rp.avgTemperature != null) content += `Temperatura média: ${rp.avgTemperature}°C (max: ${rp.maxTemperature}°C)\n`;
      content += `Operação: ${formatDuration(rp.loadOnMinutes ?? 0)} com carga ligada\n`;
      content += `Energia estimada: ${rp.estimatedEnergyKwh} kWh\n`;
      content += `Eventos: ${rp.totalEvents} total, ${rp.maneuverCount} manobras, ${rp.totalAlarms} alarmes\n`;
      content += `Leituras: ${rp.totalReadings}\n\n`;
    } else {
      content += `--- ${r.siteName} ---\n`;
      content += `${r.message}\n\n`;
    }
  }

  return {
    title: `Relatório ${typeLabel} BESS — ${dateStr}`,
    content: content.trim(),
  };
}

/**
 * Generate reports and send notification to owner.
 * After successful notification, updates notificationSent=true in the DB for each report.
 */
export async function generateAndNotify(
  reportType: "daily" | "weekly",
  options: { skipDedup?: boolean } = {}
): Promise<{
  results: ReportResult[];
  notified: boolean;
}> {
  const results = await generateAllReports(reportType, options);

  // Only send notification if at least one report was generated successfully
  const successfulResults = results.filter(r => r.success);
  let notified = false;

  if (successfulResults.length > 0) {
    try {
      const { title, content } = formatReportNotification(results, reportType);
      notified = await notifyOwner({ title, content });

      // Persist notification status in DB for each successful report
      if (notified) {
        console.log(`[Reports] Notificação ${reportType} enviada com sucesso.`);
        for (const r of successfulResults) {
          try {
            await updateReportNotification(r.siteId, reportType, true);
          } catch (e) {
            console.warn(`[Reports] Erro ao atualizar notificationSent para site ${r.siteId}:`, e);
          }
        }
      } else {
        console.warn(`[Reports] Falha ao enviar notificação ${reportType}.`);
      }
    } catch (error) {
      console.warn(`[Reports] Erro ao enviar notificação:`, error);
    }
  }

  return { results, notified };
}

// ── Configurable Scheduler ───────────────────────────────────

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let lastDailyRun: string | null = null;   // "YYYY-MM-DD" of last daily run
let lastWeeklyRun: string | null = null;  // "YYYY-MM-DD" of last weekly run

/**
 * Read scheduler settings from DB with defaults.
 */
export async function getSchedulerSettings(): Promise<{
  enabled: boolean;
  dailyHour: number;
  weeklyDay: number;
}> {
  try {
    const [enabledStr, hourStr, dayStr] = await Promise.all([
      getSetting(SETTING_SCHEDULER_ENABLED),
      getSetting(SETTING_DAILY_HOUR),
      getSetting(SETTING_WEEKLY_DAY),
    ]);

    return {
      enabled: enabledStr !== "false", // default true
      dailyHour: hourStr ? Math.max(0, Math.min(23, parseInt(hourStr, 10))) : DEFAULT_DAILY_HOUR,
      weeklyDay: dayStr ? Math.max(0, Math.min(6, parseInt(dayStr, 10))) : DEFAULT_WEEKLY_DAY,
    };
  } catch {
    return { enabled: true, dailyHour: DEFAULT_DAILY_HOUR, weeklyDay: DEFAULT_WEEKLY_DAY };
  }
}

/**
 * Seed default scheduler settings if they don't exist yet.
 */
async function seedDefaultSettings() {
  try {
    const existing = await getSetting(SETTING_SCHEDULER_ENABLED);
    if (existing === null) {
      await upsertSetting(SETTING_SCHEDULER_ENABLED, "true", "Habilitar/desabilitar scheduler automático de relatórios");
    }
    const existingHour = await getSetting(SETTING_DAILY_HOUR);
    if (existingHour === null) {
      await upsertSetting(SETTING_DAILY_HOUR, String(DEFAULT_DAILY_HOUR), "Hora do dia (0-23) para gerar relatórios diários");
    }
    const existingDay = await getSetting(SETTING_WEEKLY_DAY);
    if (existingDay === null) {
      await upsertSetting(SETTING_WEEKLY_DAY, String(DEFAULT_WEEKLY_DAY), "Dia da semana (0=Dom, 1=Seg, ..., 6=Sáb) para relatórios semanais");
    }
  } catch (e) {
    console.warn("[Reports] Erro ao inicializar configurações padrão:", e);
  }
}

/**
 * Check function called every minute by the scheduler.
 * Reads settings from DB, checks current time, and generates reports when due.
 */
async function schedulerCheck() {
  try {
    const settings = await getSchedulerSettings();
    if (!settings.enabled) return;

    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay(); // 0=Sunday
    const todayStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

    // Daily report: run once per day at the configured hour
    if (currentHour === settings.dailyHour && lastDailyRun !== todayStr) {
      lastDailyRun = todayStr;
      console.log(`[Reports] Scheduler: gerando relatório diário (hora configurada: ${settings.dailyHour}h)...`);
      try {
        await generateAndNotify("daily", { skipDedup: false });
      } catch (error) {
        console.warn("[Reports] Erro no relatório diário automático:", error);
      }
    }

    // Weekly report: run once per week on the configured day at the same hour
    if (currentDay === settings.weeklyDay && currentHour === settings.dailyHour && lastWeeklyRun !== todayStr) {
      lastWeeklyRun = todayStr;
      console.log(`[Reports] Scheduler: gerando relatório semanal (dia ${settings.weeklyDay}, hora ${settings.dailyHour}h)...`);
      try {
        await generateAndNotify("weekly", { skipDedup: false });
      } catch (error) {
        console.warn("[Reports] Erro no relatório semanal automático:", error);
      }
    }
  } catch (error) {
    console.warn("[Reports] Erro no scheduler check:", error);
  }
}

/**
 * Start the configurable report scheduler.
 * Checks every minute if it's time to generate reports based on DB settings.
 * Also runs initial reports 30s after startup for fresh data.
 */
export function startReportScheduler() {
  console.log("[Reports] Iniciando scheduler de relatórios automáticos...");

  // Seed default settings
  seedDefaultSettings().catch(e => console.warn("[Reports] Seed settings error:", e));

  // Generate initial reports after 30s delay (let DB seed complete)
  setTimeout(async () => {
    try {
      console.log("[Reports] Gerando relatório diário inicial...");
      await generateAndNotify("daily", { skipDedup: false });
    } catch (error) {
      console.warn("[Reports] Erro no relatório diário inicial:", error);
    }
  }, 30_000);

  setTimeout(async () => {
    try {
      console.log("[Reports] Gerando relatório semanal inicial...");
      await generateAndNotify("weekly", { skipDedup: false });
    } catch (error) {
      console.warn("[Reports] Erro no relatório semanal inicial:", error);
    }
  }, 60_000);

  // Start the minute-by-minute check loop
  schedulerTimer = setInterval(schedulerCheck, CHECK_INTERVAL);

  console.log("[Reports] Scheduler ativo: verifica a cada 60s, configurável via Configurações.");
}

/**
 * Stop the report scheduler.
 */
export function stopReportScheduler() {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
  lastDailyRun = null;
  lastWeeklyRun = null;
  console.log("[Reports] Scheduler parado.");
}
