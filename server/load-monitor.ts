/**
 * Load Monitor — Saúde da Bomba (Fase 2 do plano).
 *
 * Avalia a etiqueta `loadHealth` a cada poll, comparando o que o sistema
 * comandou (loadStatus) com o consumo real (currentLoadPower derivado do
 * balanço de energia PV + bateria).
 *
 * Detecta o cenário smoking-gun de 27/04: comando ON, Sonoff ON, mas
 * softstarter em erro/motor parado → carga real próxima de zero por ≥10min.
 *
 * Observação passiva. Nunca muda estado de bomba. Em modo shadow só registra
 * a etiqueta; em modo live emite alarme LOAD_FAILURE.
 */
import type { BessState } from "../drizzle/schema";

export type LoadHealth =
  | "OFF_OK"
  | "RUNNING_OK"
  | "VERIFYING"
  | "FAILED"
  | "RESIDUAL"
  | "UNKNOWN";

export interface LoadHealthDecision {
  health: LoadHealth;
  /** Próximo valor pra bess_state.loadFailureSince. null limpa o timer. */
  nextFailureSince: Date | null;
}

const STALE_TELEMETRY_MS = 5 * 60_000;
const TRANSITION_GRACE_MS = 90_000;
const FAIL_PERSIST_MS = 10 * 60_000;
const PV_DARK_THRESHOLD_KW = 1;
const SANITY_DELTA_KW = 2;
const SANITY_DELTA_PCT = 0.2;
const KW_PER_CV = 0.7355;
const PUMP_FRACTION_OK = 0.3;

export interface LoadMonitorInput {
  state: Pick<
    BessState,
    | "loadStatus"
    | "sonoffPower"
    | "currentLoadPower"
    | "currentBatteryPower"
    | "currentPvPower"
    | "lastTelemetryAt"
    | "lastManeuverAt"
    | "loadFailureSince"
  >;
  pumpPowerCv: number;
  pumpCount: number;
  thresholdOverrideKw?: number;
  nowMs?: number;
}

export function evaluateLoadHealth(input: LoadMonitorInput): LoadHealthDecision {
  const { state } = input;
  const now = input.nowMs ?? Date.now();
  const failureSince = state.loadFailureSince;

  const expectedPumpKw = input.pumpPowerCv * input.pumpCount * KW_PER_CV;
  const threshold = input.thresholdOverrideKw ?? expectedPumpKw * PUMP_FRACTION_OK;

  // ── Pre-conditions: dado fresh, Sonoff convergente, fora de transição ──
  if (!state.lastTelemetryAt || now - state.lastTelemetryAt.getTime() > STALE_TELEMETRY_MS) {
    return { health: "UNKNOWN", nextFailureSince: failureSince };
  }

  const cmd = state.loadStatus;
  const sonoff = state.sonoffPower;
  if (sonoff !== "UNKNOWN" && sonoff.toLowerCase() !== cmd) {
    return { health: "UNKNOWN", nextFailureSince: failureSince };
  }

  if (state.lastManeuverAt && now - state.lastManeuverAt.getTime() < TRANSITION_GRACE_MS) {
    return { health: "UNKNOWN", nextFailureSince: failureSince };
  }

  const load = state.currentLoadPower;
  const battPower = state.currentBatteryPower;
  const pv = state.currentPvPower;

  if (load == null) {
    return { health: "UNKNOWN", nextFailureSince: failureSince };
  }

  // ── Cross-check loadPower vs battery_power à noite (PV ≈ 0) ──
  if (
    pv != null &&
    pv < PV_DARK_THRESHOLD_KW &&
    battPower != null &&
    battPower < 0
  ) {
    const dischargeKw = Math.abs(battPower);
    const tolerance = Math.max(SANITY_DELTA_KW, load * SANITY_DELTA_PCT);
    if (Math.abs(dischargeKw - load) > tolerance) {
      return { health: "UNKNOWN", nextFailureSince: failureSince };
    }
  }

  // ── Comando OFF ──
  if (cmd === "off") {
    if (load < threshold) {
      return { health: "OFF_OK", nextFailureSince: null };
    }
    return { health: "RESIDUAL", nextFailureSince: null };
  }

  // ── Comando ON ──
  if (load >= threshold) {
    return { health: "RUNNING_OK", nextFailureSince: null };
  }

  // load < threshold com cmd=ON → arma/checa timer
  if (!failureSince) {
    return { health: "VERIFYING", nextFailureSince: new Date(now) };
  }

  if (now - failureSince.getTime() < FAIL_PERSIST_MS) {
    return { health: "VERIFYING", nextFailureSince: failureSince };
  }

  return { health: "FAILED", nextFailureSince: failureSince };
}
