/**
 * SOC Estimator — Coulomb counting simples.
 *
 * Quando a FusionSolar fica indisponível (rate limit, manutenção, rede),
 * estimamos o SOC atual usando a taxa de descarga/carga calculada das
 * últimas N leituras reais com a bomba no MESMO estado atual. Permite o
 * control-engine seguir agindo de forma conservadora durante janelas
 * curtas (até maxSemTelemetria minutos).
 *
 * Política: se não há histórico suficiente posterior à última manobra
 * (< MIN_VALID_READINGS), retornamos null e o control-engine cai em
 * "Sem SOC disponível" → não age. Bomba mantém estado. Blackout (regra
 * 1 do decideAction) é a rede de segurança absoluta.
 */

import { eq, and, gte, desc } from "drizzle-orm";
import { getDb } from "./db";
import { bessReadings, bessState, bessSites } from "../drizzle/schema";

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
 * PURA. Filtra leituras pra ficar só com as POSTERIORES à última manobra
 * (TURN_ON / TURN_OFF). Garante que as N leituras usadas pra calcular taxa
 * representam UM único estado da bomba, sem misturar descarga rápida com
 * idle. Retorna null se não houver leituras suficientes pós-manobra.
 *
 * @param readingsDesc leituras ordenadas decrescentemente (mais recente primeiro)
 * @param lastManeuverAt timestamp da última mudança ON/OFF; null = sem manobra registrada
 * @param minRequired número mínimo de leituras pós-manobra exigidas
 */
export function pickReadingsForRate<T extends { createdAt: Date }>(
  readingsDesc: T[],
  lastManeuverAt: Date | null,
  minRequired: number,
): T[] | null {
  const cutoff = lastManeuverAt ?? new Date(0);
  const filtered = readingsDesc.filter((r) => r.createdAt > cutoff);
  if (filtered.length < minRequired) return null;
  return filtered.slice(0, minRequired);
}

/**
 * PURA. Taxa pp/min entre a leitura mais recente e a mais antiga.
 * readingsDesc[0] = mais recente, readingsDesc[N-1] = mais antiga.
 * Negativa = descarregando. Positiva = carregando.
 * Retorna null se < 2 leituras ou gap < 1 minuto (ruído).
 */
export function computeRate(
  readingsDesc: Array<{ soc: number; createdAt: Date }>,
): number | null {
  if (readingsDesc.length < 2) return null;
  const newest = readingsDesc[0];
  const oldest = readingsDesc[readingsDesc.length - 1];
  const deltaSoc = newest.soc - oldest.soc;
  const deltaMin = (newest.createdAt.getTime() - oldest.createdAt.getTime()) / 60_000;
  if (deltaMin < 1) return null;
  return deltaSoc / deltaMin;
}

/**
 * Calcula taxa pp/min usando MIN_VALID_READINGS leituras posteriores à
 * última manobra da bomba (lastManeuverAt). Garante que todas as leituras
 * usadas refletem o MESMO estado atual da bomba (ON ou OFF), eliminando
 * distorção causada por mistura de descarga (-52kW) + idle (-0.08kW).
 *
 * Retorna null se não há histórico suficiente pós-manobra dentro da
 * janela de HISTORY_WINDOW_HOURS.
 */
export async function calculateDischargeRate(siteId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const stateRows = await db
    .select()
    .from(bessState)
    .where(eq(bessState.siteId, siteId))
    .limit(1);
  const state = stateRows[0];
  if (!state) return null;

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
    .limit(MIN_VALID_READINGS * 3); // margem pro filtro pós-manobra

  const filtered = pickReadingsForRate(rows, state.lastManeuverAt, MIN_VALID_READINGS);
  if (!filtered) return null;

  return computeRate(filtered);
}

/** Descarga mínima (kW) pra considerar a projeção stale relevante. Abaixo
 *  disso o drift é desprezível e respeitamos o SOC reportado literalmente. */
const STALE_MIN_DISCHARGE_KW = 1;

/**
 * PURA. Detecta um snapshot STALE reentregue pela FusionSolar e projeta o
 * SOC real via Coulomb counting.
 *
 * Contexto (incidente Barragem 2026-06-19): a "real-time KPI" da Huawei só
 * atualiza ~5min no servidor deles, mas pollamos a cada 2min na zona crítica.
 * Resultado: recebemos o MESMO retrato (ex.: SOC=26%, Bat=-50.652kW) 3-4×
 * seguidas enquanto a bateria de verdade continua drenando. O SOC reportado
 * "trava" 1pp acima do gatilho de desligar e a bomba só desliga quando a
 * própria proteção da bateria já cortou tudo (SOC despenca 26→9 num poll).
 *
 * Comprovação de stale: `batteryPower` idêntico ao milésimo entre o snapshot
 * atual e a leitura persistida mais recente. Telemetria viva nunca repete o
 * float exato — só cache reentregue. Quando stale + descarregando, integramos
 * a potência (ainda válida; a bomba não mudou de estado) sobre o tempo
 * congelado e devolvemos o SOC projetado (menor que o reportado).
 *
 * Retorna null quando NÃO há staleness comprovado (telemetria variando) ou
 * sem descarga relevante — aí o SOC reportado é respeitado literalmente
 * (DECISION-RESPECT-CONFIG). Conservador por construção: só puxa o SOC pra
 * BAIXO, nunca pra cima.
 */
export function projectStaleSoc(params: {
  currentSoc: number;
  currentBatteryKw: number | null;
  readingsDesc: Array<{ soc: number | null; batteryPower: number | null; createdAt: Date }>;
  capacityKwh: number;
  nowMs: number;
}): { soc: number; staleMin: number; ratePpPerMin: number } | null {
  const { currentSoc, currentBatteryKw, readingsDesc, capacityKwh, nowMs } = params;

  // Só projeta em descarga relevante. Idle/carga → respeita reportado.
  if (currentBatteryKw === null || currentBatteryKw > -STALE_MIN_DISCHARGE_KW) return null;
  if (!(capacityKwh > 0)) return null;
  if (readingsDesc.length === 0) return null;

  const samePower = (a: number | null) =>
    a !== null && Math.abs(a - currentBatteryKw) < 1e-6;

  // O snapshot atual precisa ser idêntico à leitura persistida mais recente.
  const newest = readingsDesc[0];
  if (!samePower(newest.batteryPower) || newest.soc !== currentSoc) return null;

  // Anchor = leitura mais antiga do "run" de duplicados — quando o valor
  // congelou. staleMin = há quanto tempo o snapshot está parado.
  let anchorMs = newest.createdAt.getTime();
  for (const r of readingsDesc) {
    if (samePower(r.batteryPower) && r.soc === currentSoc) {
      anchorMs = r.createdAt.getTime();
    } else {
      break;
    }
  }

  const staleMin = (nowMs - anchorMs) / 60_000;
  if (staleMin < 1) return null;

  // dropPp < 0 (descarga). capacityKwh = bessCapacityKwh * bessCount.
  const dropPp = (currentBatteryKw * staleMin / 60) / capacityKwh * 100;
  const projected = Math.max(0, Math.min(100, currentSoc + dropPp));
  return { soc: projected, staleMin, ratePpPerMin: dropPp / staleMin };
}

/**
 * Carrega capacidade + histórico do DB e aplica projectStaleSoc. Retorna
 * null se o snapshot não está stale (caminho comum — telemetria viva).
 */
async function detectStaleProjection(
  siteId: number,
  state: { currentSoc: number; currentBatteryPower: number | null },
  nowMs: number,
): Promise<{ soc: number; ratePpPerMin: number; staleMin: number } | null> {
  const db = await getDb();
  if (!db) return null;
  if (state.currentBatteryPower === null || state.currentBatteryPower > -STALE_MIN_DISCHARGE_KW) {
    return null;
  }

  const sites = await db.select().from(bessSites).where(eq(bessSites.id, siteId)).limit(1);
  const site = sites[0];
  if (!site) return null;
  const capacityKwh = site.bessCapacityKwh * site.bessCount;

  const rows = await db
    .select()
    .from(bessReadings)
    .where(and(eq(bessReadings.siteId, siteId), eq(bessReadings.valid, true)))
    .orderBy(desc(bessReadings.createdAt))
    .limit(20);

  const proj = projectStaleSoc({
    currentSoc: state.currentSoc,
    currentBatteryKw: state.currentBatteryPower,
    readingsDesc: rows.map((r) => ({
      soc: r.soc,
      batteryPower: r.batteryPower,
      createdAt: r.createdAt,
    })),
    capacityKwh,
    nowMs,
  });
  return proj;
}

// Threshold pra considerar a leitura "fresca o bastante pra usar como REAL".
// 30 min cobre intervaloPadrao=15min e zona crítica=1min com folga.
const STALE_THRESHOLD_MS = 30 * 60_000;
// Acima disso, mesmo o estimador é descartado — leitura velha demais pra
// confiar em qualquer estimativa.
const ABANDON_THRESHOLD_MS = 6 * 60 * 60_000; // 6h

/**
 * Estima o SOC atual de um site.
 *
 * Comportamento:
 *   - Sem state ou sem lastTelemetryAt → null (nunca houve leitura real)
 *   - Idade > 6h → null (dado velho demais pra confiar)
 *   - Idade < 30 min → REAL (leitura fresca, retorna direto)
 *   - 30 min < idade ≤ 6h e há histórico pós-manobra suficiente → ESTIMATED
 *     com taxa calculada
 *   - 30 min < idade ≤ 6h e SEM histórico suficiente → null (não estima
 *     com dado velho; control-engine cai em "Sem SOC disponível" e não age,
 *     bomba mantém estado, blackout protege em última instância)
 */
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

  // Leitura velha demais — não há SOC confiável.
  if (ageMs > ABANDON_THRESHOLD_MS) return null;

  // Leitura recente — MAS pode ser um snapshot STALE reentregue pela
  // FusionSolar (mesmo retrato repetido enquanto a bateria drena). Antes de
  // confiar, cross-check via Coulomb counting; se stale + descarregando,
  // devolve o SOC projetado (menor) marcado ESTIMATED.
  if (ageMs < STALE_THRESHOLD_MS) {
    const stale = await detectStaleProjection(siteId, state, now);
    if (stale) {
      return {
        soc: stale.soc,
        source: "ESTIMATED",
        ageSeconds,
        ratePpPerMin: stale.ratePpPerMin,
      };
    }
    return {
      soc: state.currentSoc,
      source: "REAL",
      ageSeconds,
      ratePpPerMin: null,
    };
  }

  // Tenta estimar via Coulomb counting com base nas leituras pós-manobra.
  const rate = await calculateDischargeRate(siteId);
  if (rate !== null) {
    const minutesElapsed = ageMs / 60_000;
    const projected = state.currentSoc + rate * minutesElapsed;
    return {
      soc: Math.max(0, Math.min(100, projected)),
      source: "ESTIMATED",
      ageSeconds,
      ratePpPerMin: rate,
    };
  }

  // Sem rate calculável (histórico insuficiente, ou manobra muito recente):
  // retorna null. control-engine cai em "Sem SOC disponível" → não age.
  // Bomba mantém estado atual. Blackout protege se SOC bater 15.
  return null;
}
