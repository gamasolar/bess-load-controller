/**
 * Job interno que mantém bess_pump_daily atualizado.
 *
 * Estratégia:
 *   - Boot: agrega últimos 7 dias (recovery se servidor ficou offline).
 *   - Cron interno (a cada 1h): garante que o dia anterior está fechado.
 *   - Idempotente: usa UPSERT (siteId, date).
 *
 * Custo: zero chamadas externas. Roda local, MySQL.
 *
 * Não precisa de cron de SO — usamos setInterval no próprio processo.
 * Se o processo cair, o boot recupera dias faltantes.
 */
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, getAllSites } from "./db";
import { bessActions, bessPumpDaily, bessState } from "../drizzle/schema";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = startOfDay(d);
  r.setDate(r.getDate() + 1);
  return r;
}

/**
 * Reconstrói o tempo ligado da bomba para um (siteId, dia) a partir de bess_actions
 * e faz upsert em bess_pump_daily. Retorna o resumo gravado.
 */
export async function aggregatePumpDay(siteId: number, day: Date, pumpKw: number): Promise<{
  date: string; secondsOn: number; kwhEstimado: number; cycles: number;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);

  const priorRows = await db
    .select({ action: bessActions.action })
    .from(bessActions)
    .where(and(
      eq(bessActions.siteId, siteId),
      inArray(bessActions.action, ["TURN_ON", "TURN_OFF"]),
      lt(bessActions.timestamp, dayStart),
    ))
    .orderBy(desc(bessActions.timestamp))
    .limit(1);

  const rows = await db
    .select({ timestamp: bessActions.timestamp, action: bessActions.action })
    .from(bessActions)
    .where(and(
      eq(bessActions.siteId, siteId),
      inArray(bessActions.action, ["TURN_ON", "TURN_OFF"]),
      gte(bessActions.timestamp, dayStart),
      lt(bessActions.timestamp, dayEnd),
    ))
    .orderBy(asc(bessActions.timestamp));

  // Estado em dayStart vindo SOMENTE de eventos registrados (sem inferências).
  // Se v1 antigo não escreveu TURN_ON, secondsOn fica 0 — preferimos dado faltante a
  // dado inventado. Daqui pra frente os pares ON/OFF do v2 ficam precisos.
  let pendingStart: Date | null = priorRows[0]?.action === "TURN_ON" ? dayStart : null;
  let secondsOn = 0;
  let cycles = 0;

  for (const a of rows) {
    const ts = a.timestamp instanceof Date ? a.timestamp : new Date(a.timestamp as unknown as string);
    if (a.action === "TURN_ON") {
      if (!pendingStart) {
        pendingStart = ts;
        cycles += 1;
      }
    } else if (a.action === "TURN_OFF") {
      if (pendingStart) {
        secondsOn += (ts.getTime() - pendingStart.getTime()) / 1000;
        pendingStart = null;
      }
    }
  }
  // Se ainda ligada no fim do dia (ou ainda ligada agora pro dia corrente)
  if (pendingStart) {
    const closeAt = day < startOfDay(new Date()) ? dayEnd : new Date();
    if (closeAt > pendingStart) {
      secondsOn += (closeAt.getTime() - pendingStart.getTime()) / 1000;
    }
    // ciclo já contado se o ON aconteceu dentro do dia; se herdou do dia anterior, não conta
  }
  // Conta também o ciclo herdado do dia anterior como "1 ciclo em andamento" — não.
  // Mantemos cycles = quantas vezes ligou DENTRO do dia.

  const dKey = dateKey(day);
  const kwhEstimado = (secondsOn / 3600) * pumpKw;

  const existing = await db
    .select({ id: bessPumpDaily.id })
    .from(bessPumpDaily)
    .where(and(eq(bessPumpDaily.siteId, siteId), eq(bessPumpDaily.date, dKey)))
    .limit(1);

  if (existing[0]) {
    await db.update(bessPumpDaily).set({ secondsOn, kwhEstimado, cycles }).where(eq(bessPumpDaily.id, existing[0].id));
  } else {
    await db.insert(bessPumpDaily).values({ siteId, date: dKey, secondsOn, kwhEstimado, cycles });
  }
  return { date: dKey, secondsOn, kwhEstimado, cycles };
}

function pumpKwForSite(s: { pumpCount: number; pumpPowerCv: number }): number {
  // 1 CV ≈ 0.7355 kW
  return (s.pumpCount ?? 0) * (s.pumpPowerCv ?? 0) * 0.7355;
}

/**
 * Re-agrega os últimos N dias completos (ignora hoje — hoje é calculado on-the-fly
 * no endpoint pumpStats pra refletir o intervalo aberto).
 */
export async function recomputeRecentDays(daysBack = 7): Promise<void> {
  const sites = await getAllSites();
  const now = new Date();
  for (const site of sites) {
    const kw = pumpKwForSite(site);
    if (kw <= 0) continue;
    for (let i = 1; i <= daysBack; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      try {
        await aggregatePumpDay(site.id, d, kw);
      } catch (e) {
        console.warn(`[PumpDailyJob] aggregatePumpDay falhou ${site.slug} D-${i}:`, e);
      }
    }
  }
}

let _started = false;
let _hourlyTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Inicia o job: roda recovery imediato (assíncrono) e agenda re-agregação horária.
 */
export function startPumpDailyJob(): void {
  if (_started) return;
  _started = true;
  // Recovery inicial (não bloqueia boot)
  recomputeRecentDays(7).then(() => console.log("[PumpDailyJob] Recovery dos últimos 7 dias OK")).catch((e) => console.warn("[PumpDailyJob] Recovery falhou:", e));
  // A cada 1h, re-agrega últimos 2 dias (cobre transição de meia-noite)
  _hourlyTimer = setInterval(() => {
    recomputeRecentDays(2).catch((e) => console.warn("[PumpDailyJob] Re-agregação horária falhou:", e));
  }, 60 * 60 * 1000);
}

export function stopPumpDailyJob(): void {
  if (_hourlyTimer) clearInterval(_hourlyTimer);
  _hourlyTimer = null;
  _started = false;
}
