/**
 * SOC Estimator — Coulomb counting simples.
 *
 * Quando a FusionSolar fica indisponível (rate limit, manutenção, rede),
 * estimamos o SOC atual usando a taxa de descarga/carga calculada das
 * últimas N leituras reais. Permite o control-engine seguir agindo de
 * forma conservadora durante janelas curtas (até maxSemTelemetria minutos).
 *
 * Política: se não há histórico suficiente (< MIN_VALID_READINGS), retornamos
 * null e o control-engine deve agir conservador (não religa, mas pode desligar
 * se já ficou estagnado abaixo do mínimo).
 */

import { eq, and, gte, desc } from "drizzle-orm";
import { getDb } from "./db";
import { bessReadings, bessState } from "../drizzle/schema";

const MIN_VALID_READINGS = 6;
const HISTORY_WINDOW_HOURS = 2;

export type SocEstimate = {
  soc: number;
  source: "REAL" | "ESTIMATED";
  /** Idade dos dados base em segundos (0 = leitura real fresca). */
  ageSeconds: number;
  /** pp/min usada na estimativa (negativo = descarregando). null se REAL. */
  ratePpPerMin: number | null;
};

/**
 * Calcula taxa média de variação de SOC (pp/min) baseada nas últimas
 * MIN_VALID_READINGS leituras válidas. Retorna null se não há histórico
 * suficiente ou se as leituras estão muito espaçadas/concentradas pra ter
 * sinal confiável.
 *
 * Sinal: positivo = SOC subindo (carregando), negativo = SOC caindo.
 */
export async function calculateDischargeRate(siteId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const since = new Date(Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(bessReadings)
    .where(
      and(
        eq(bessReadings.siteId, siteId),
        eq(bessReadings.valid, true),
        gte(bessReadings.createdAt, since),
      ),
    )
    .orderBy(desc(bessReadings.createdAt))
    .limit(MIN_VALID_READINGS);

  if (rows.length < MIN_VALID_READINGS) return null;

  // rows está em desc — mais recente em rows[0], mais antigo em rows[N-1].
  const newest = rows[0];
  const oldest = rows[rows.length - 1];
  const deltaSoc = newest.soc - oldest.soc;
  const deltaMs = newest.createdAt.getTime() - oldest.createdAt.getTime();
  const deltaMin = deltaMs / 60_000;

  if (deltaMin < 1) return null;

  return deltaSoc / deltaMin;
}

/**
 * Estima o SOC atual de um site. Se os dados em bess_state são frescos
 * (< STALE_THRESHOLD_MS), retorna o valor real direto. Caso contrário,
 * estima usando a última leitura real + tempo decorrido * rate.
 *
 * Retorna null se nunca houve leitura real (lastTelemetryAt is null) ou
 * se não há rate calculável (< MIN_VALID_READINGS no histórico).
 */
const STALE_THRESHOLD_MS = 60_000; // 1 min — abaixo disso, considera REAL

export async function estimateCurrentSoc(siteId: number): Promise<SocEstimate | null> {
  const db = await getDb();
  if (!db) return null;

  const stateRows = await db
    .select()
    .from(bessState)
    .where(eq(bessState.siteId, siteId))
    .limit(1);
  const state = stateRows[0];
  if (!state) return null;
  if (!state.lastTelemetryAt) return null;

  const now = Date.now();
  const ageMs = now - state.lastTelemetryAt.getTime();
  const ageSeconds = Math.floor(ageMs / 1000);

  // Dados frescos — devolve o real
  if (ageMs < STALE_THRESHOLD_MS) {
    return {
      soc: state.currentSoc,
      source: "REAL",
      ageSeconds,
      ratePpPerMin: null,
    };
  }

  const rate = await calculateDischargeRate(siteId);
  if (rate === null) return null;

  const minutesElapsed = ageMs / 60_000;
  const projected = state.currentSoc + rate * minutesElapsed;
  const clamped = Math.max(0, Math.min(100, projected));

  return {
    soc: clamped,
    source: "ESTIMATED",
    ageSeconds,
    ratePpPerMin: rate,
  };
}
