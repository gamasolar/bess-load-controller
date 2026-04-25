import { describe, it, expect } from "vitest";
import { computeFlowState } from "../shared/energy-flow-logic";

/**
 * Tests for the shared energy flow logic used by EnergyFlowDiagram.
 * batteryPower: positive = charging, negative = discharging
 */

describe("EnergyFlowDiagram flow logic (shared/energy-flow-logic)", () => {
  it("FV + BESS → Carga: both sources feeding load", () => {
    const flows = computeFlowState(45, -12, 57);
    expect(flows.sourceLabel).toBe("FV + BESS → Carga");
    expect(flows.sourceColor).toBe("#22c55e");
    expect(flows.pvToLoad).toBe(true);
    expect(flows.bessToLoad).toBe(true);
    expect(flows.bessDischarging).toBe(true);
  });

  it("FV → Carga: only solar feeding load", () => {
    const flows = computeFlowState(30, 0, 25);
    expect(flows.sourceLabel).toBe("FV → Carga");
    expect(flows.sourceColor).toBe("#f59e0b");
    expect(flows.pvToLoad).toBe(true);
    expect(flows.bessToLoad).toBe(false);
    expect(flows.bessDischarging).toBe(false);
  });

  it("BESS → Carga: only battery feeding load (night mode)", () => {
    const flows = computeFlowState(0, -20, 20);
    expect(flows.sourceLabel).toBe("BESS → Carga");
    expect(flows.sourceColor).toBe("#3b82f6");
    expect(flows.pvToLoad).toBe(false);
    expect(flows.bessToLoad).toBe(true);
    expect(flows.bessDischarging).toBe(true);
  });

  it("FV → BESS (carregando): solar charging battery, no load", () => {
    const flows = computeFlowState(50, 50, 0);
    expect(flows.sourceLabel).toBe("FV → BESS (carregando)");
    expect(flows.sourceColor).toBe("#8b5cf6");
    expect(flows.pvToLoad).toBe(false);
    expect(flows.bessToLoad).toBe(false);
    expect(flows.pvToBess).toBe(true);
    expect(flows.bessCharging).toBe(true);
  });

  it("Sem carga: everything idle", () => {
    const flows = computeFlowState(0, 0, 0);
    expect(flows.sourceLabel).toBe("Sem carga");
    expect(flows.sourceColor).toBe("#64748b");
    expect(flows.pvToLoad).toBe(false);
    expect(flows.bessToLoad).toBe(false);
    expect(flows.pvToBess).toBe(false);
    expect(flows.bessCharging).toBe(false);
    expect(flows.bessDischarging).toBe(false);
  });

  it("Sem carga: battery charging slightly but no PV (grid charge)", () => {
    const flows = computeFlowState(0, 0.5, 0);
    expect(flows.sourceLabel).toBe("Sem carga");
    expect(flows.pvToBess).toBe(false);
    expect(flows.bessCharging).toBe(true);
  });

  it("FV → Carga + FV → BESS: solar feeding both load and charging battery", () => {
    const flows = computeFlowState(70, 20, 50);
    expect(flows.sourceLabel).toBe("FV → Carga");
    expect(flows.pvToLoad).toBe(true);
    expect(flows.pvToBess).toBe(true);
    expect(flows.bessToLoad).toBe(false);
  });

  it("handles edge case: very small battery discharge below threshold", () => {
    const flows = computeFlowState(0, -0.05, 10);
    expect(flows.bessDischarging).toBe(false);
    expect(flows.bessToLoad).toBe(false);
    expect(flows.sourceLabel).toBe("Sem carga");
  });
});
