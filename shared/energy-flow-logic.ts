/**
 * Shared energy flow logic used by both the EnergyFlowDiagram component and tests.
 * Determines the current energy flow state based on real-time power readings.
 */

export interface FlowState {
  pvToLoad: boolean;
  bessToLoad: boolean;
  pvToBess: boolean;
  bessCharging: boolean;
  bessDischarging: boolean;
  sourceLabel: string;
  sourceColor: string;
}

/**
 * Compute the energy flow state from power readings.
 * @param pvPower - Solar PV power output in kW (>= 0)
 * @param batteryPower - Battery power in kW (positive = charging, negative = discharging)
 * @param loadPower - Load consumption in kW (>= 0)
 */
export function computeFlowState(pvPower: number, batteryPower: number, loadPower: number): FlowState {
  const pvToLoad = pvPower > 0 && loadPower > 0;
  const bessDischarging = batteryPower < -0.1; // negative = discharging
  const bessCharging = batteryPower > 0.1;     // positive = charging
  const bessToLoad = bessDischarging && loadPower > 0;
  const pvToBess = pvPower > 0 && bessCharging;

  // Determine what's feeding the load
  let sourceLabel = "Sem carga";
  let sourceColor = "#64748b";
  if (pvToLoad && bessToLoad) {
    sourceLabel = "FV + BESS → Carga";
    sourceColor = "#22c55e";
  } else if (pvToLoad && !bessToLoad) {
    sourceLabel = "FV → Carga";
    sourceColor = "#f59e0b";
  } else if (bessToLoad && !pvToLoad) {
    sourceLabel = "BESS → Carga";
    sourceColor = "#3b82f6";
  } else if (pvToBess && !pvToLoad) {
    sourceLabel = "FV → BESS (carregando)";
    sourceColor = "#8b5cf6";
  }

  return { pvToLoad, bessToLoad, pvToBess, bessCharging, bessDischarging, sourceLabel, sourceColor };
}
