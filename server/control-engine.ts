/**
 * Control Engine — lógica de decisão pra ligar/desligar bombas baseada em SOC.
 *
 * Substitui o evaluateLoadControl v1 (low/highCounter) por uma lógica baseada
 * em thresholds explícitos (socMinDesliga / socMinReliga / socBlackout) +
 * cooldown temporal + janela horária + modo MANUAL/AUTO.
 *
 * decideAction é PURA — fácil de testar. applyDecision lida com side effects
 * (MQTT + bess_actions + bess_state). evaluateAndAct compõe os dois.
 *
 * Princípio não-negociável: comportamento conservador. Quando em dúvida,
 * DESLIGA. Religar requer SOC REAL (não ESTIMADO) pra evitar oscilação
 * durante janelas sem telemetria.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { bessSites, bessState, bessConfig, bessActions } from "../drizzle/schema";
import type { BessSite, BessState, BessConfig } from "../drizzle/schema";
import { estimateCurrentSoc } from "./soc-estimator";
import { sendMqttCommand } from "./mqtt-dispatch";

export type ActionSource = "AUTO" | "MANUAL" | "BLACKOUT" | "SYSTEM";
export type PumpState = "ON" | "OFF" | "UNKNOWN";
export type SocSource = "REAL" | "ESTIMATED";

export type SiteRuntimeState = {
  site: BessSite;
  config: BessConfig;
  state: BessState;
  /** SOC efetivo (real ou estimado). null = sem dados confiáveis. */
  soc: number | null;
  socSource: SocSource | null;
  /** Segundos desde última leitura real da FusionSolar. */
  socAgeSeconds: number | null;
  pumpState: PumpState;
  /** True quando SOC está dentro de socMinDesliga + margemZonaCritica. */
  inCriticalZone: boolean;
};

export type Decision =
  | { kind: "NONE"; reason: string }
  | { kind: "TURN_ON"; reason: string }
  | { kind: "TURN_OFF"; reason: string };

/**
 * Builda o SiteRuntimeState consultando DB + soc-estimator.
 * Não tem side effects — só leitura.
 */
export async function getSiteRuntimeState(slug: string): Promise<SiteRuntimeState | null> {
  const db = await getDb();
  if (!db) return null;

  const sites = await db.select().from(bessSites).where(eq(bessSites.slug, slug)).limit(1);
  const site = sites[0];
  if (!site) return null;

  const states = await db.select().from(bessState).where(eq(bessState.siteId, site.id)).limit(1);
  const state = states[0];
  if (!state) return null;

  const configs = await db.select().from(bessConfig).where(eq(bessConfig.siteId, site.id)).limit(1);
  const config = configs[0];
  if (!config) return null;

  const estimate = await estimateCurrentSoc(site.id);
  const soc = estimate?.soc ?? null;
  const socSource = estimate?.source ?? null;
  const socAgeSeconds = estimate?.ageSeconds ?? null;

  const inCriticalZone =
    soc !== null && soc <= config.socMinDesliga + config.margemZonaCritica;

  return {
    site,
    config,
    state,
    soc,
    socSource,
    socAgeSeconds,
    pumpState: state.sonoffPower as PumpState,
    inCriticalZone,
  };
}

/**
 * Pura. Recebe estado e timestamp, retorna decisão.
 *
 * Ordem de avaliação (cada regra "early-returns"):
 *   1. BLACKOUT (SOC <= socBlackout) — sempre desliga, ignora MANUAL e cooldown.
 *   2. Sem SOC — não age (caller emite ALERT separadamente).
 *   3. Cooldown ativo — não age.
 *   4. MANUAL — não age (exceto blackout).
 *   5. AUTO desliga — pump ON e SOC <= socMinDesliga.
 *   6. AUTO religa — pump OFF e SOC >= socMinReliga e dentro do horário e
 *      socSource === "REAL". Religar com SOC ESTIMADO é proibido.
 *   7. Else — NONE.
 */
export function decideAction(state: SiteRuntimeState, now: Date): Decision {
  const { soc, socSource, pumpState, config } = state;

  if (soc !== null && soc <= config.socBlackout) {
    if (pumpState === "ON") {
      return { kind: "TURN_OFF", reason: `BLACKOUT: SOC ${soc.toFixed(1)}% <= socBlackout ${config.socBlackout}%` };
    }
    return { kind: "NONE", reason: "Blackout, bomba já OFF" };
  }

  if (soc === null) {
    return { kind: "NONE", reason: "Sem SOC disponível (nem real nem estimável)" };
  }

  if (state.state.cooldownUntil && now < state.state.cooldownUntil) {
    const secs = Math.ceil((state.state.cooldownUntil.getTime() - now.getTime()) / 1000);
    return { kind: "NONE", reason: `Cooldown ativo (${secs}s restantes)` };
  }

  if (config.controlMode === "MANUAL") {
    return { kind: "NONE", reason: "Modo MANUAL — sem ação automática" };
  }

  if (pumpState === "ON" && soc <= config.socMinDesliga) {
    return { kind: "TURN_OFF", reason: `AUTO desliga: SOC ${soc.toFixed(1)}% <= socMinDesliga ${config.socMinDesliga}%` };
  }

  if (pumpState === "OFF" && soc >= config.socMinReliga) {
    if (socSource !== "REAL") {
      return { kind: "NONE", reason: `Religar requer SOC REAL (atual: ${socSource})` };
    }
    if (!isWithinWindow(now, config.horarioLiberacao, config.horarioCorte)) {
      return { kind: "NONE", reason: `Fora da janela (${config.horarioLiberacao}–${config.horarioCorte})` };
    }
    return { kind: "TURN_ON", reason: `AUTO religa: SOC ${soc.toFixed(1)}% >= socMinReliga ${config.socMinReliga}%, janela OK` };
  }

  return { kind: "NONE", reason: "Nenhuma condição satisfeita" };
}

/** "HH:MM" comparison. window.start <= now < window.end. Cruza meia-noite não suportado. */
export function isWithinWindow(now: Date, startHHMM: string, endHHMM: string): boolean {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const cur = `${hh}:${mm}`;
  return cur >= startHHMM && cur < endHHMM;
}

/**
 * Aplica a decisão: envia comando MQTT (se for TURN_ON/OFF), registra em
 * bess_actions, atualiza bess_state (loadStatus, cooldownUntil, lastManeuverAt,
 * pumpOnSinceTimestamp).
 *
 * Pra Decision.kind === "NONE", apenas atualiza lastDecision (não cria action).
 */
export async function applyDecision(
  runtime: SiteRuntimeState,
  decision: Decision,
  source: ActionSource,
  userId?: number,
): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  if (!db) return { success: false, message: "DB indisponível" };

  const { site, state, soc, socSource } = runtime;
  const now = new Date();

  if (decision.kind === "NONE") {
    await db.update(bessState).set({ lastDecision: decision.reason }).where(eq(bessState.siteId, site.id));
    return { success: true, message: decision.reason };
  }

  const desiredAction = decision.kind === "TURN_ON" ? "ON" : "OFF";

  let mqttResult: { success: boolean; message: string } = {
    success: true,
    message: "Sem MQTT (site sem hardware)",
  };

  if (site.mqttTopic) {
    mqttResult = await sendMqttCommand(site.id, site.mqttTopic, desiredAction, `controlEngine:${source}`);
  }

  // Registra ação mesmo se MQTT falhar — auditoria > sucesso operacional.
  await db.insert(bessActions).values({
    siteId: site.id,
    source,
    action: decision.kind,
    socAtTime: soc !== null ? Math.round(soc) : null,
    socSource: socSource ?? "REAL",
    pumpStateBefore: state.sonoffPower,
    pumpStateAfter: mqttResult.success ? desiredAction : state.sonoffPower,
    reason: decision.reason.slice(0, 255),
    userId: userId ?? null,
    metadata: site.mqttTopic ? { mqttTopic: site.mqttTopic, mqttMessage: mqttResult.message } : null,
  });

  if (mqttResult.success) {
    const cooldownMs = runtime.config.cooldownAcao * 60_000;
    const updates: Partial<typeof bessState.$inferInsert> = {
      loadStatus: desiredAction === "ON" ? "on" : "off",
      lastManeuverAt: now,
      cooldownUntil: new Date(now.getTime() + cooldownMs),
      lastDecision: `${decision.kind}: ${decision.reason}`,
    };
    if (decision.kind === "TURN_ON") {
      updates.pumpOnSinceTimestamp = now;
    } else {
      updates.pumpOnSinceTimestamp = null;
    }
    await db.update(bessState).set(updates).where(eq(bessState.siteId, site.id));
  } else {
    await db
      .update(bessState)
      .set({ lastDecision: `${decision.kind} FALHOU: ${mqttResult.message}` })
      .where(eq(bessState.siteId, site.id));
  }

  return mqttResult;
}

/**
 * Loop principal — chamado pelo poll-scheduler após cada nova leitura SOC.
 * Compõe getSiteRuntimeState + decideAction + applyDecision.
 */
export async function evaluateAndAct(slug: string): Promise<{ decision: Decision; applied: boolean }> {
  const runtime = await getSiteRuntimeState(slug);
  if (!runtime) {
    return { decision: { kind: "NONE", reason: "Site não encontrado" }, applied: false };
  }

  const decision = decideAction(runtime, new Date());
  const result = await applyDecision(runtime, decision, "AUTO");
  return { decision, applied: decision.kind !== "NONE" && result.success };
}
