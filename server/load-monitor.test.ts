import { describe, it, expect } from "vitest";
import { evaluateLoadHealth, type LoadMonitorInput } from "./load-monitor";

const NOW = new Date("2026-04-29T15:00:00Z").getTime();

function buildInput(overrides: Partial<LoadMonitorInput["state"]> = {}): LoadMonitorInput {
  return {
    state: {
      loadStatus: "on" as const,
      sonoffPower: "ON" as const,
      currentLoadPower: 35,
      currentBatteryPower: -10,
      currentPvPower: 25,
      lastTelemetryAt: new Date(NOW - 60_000),
      lastManeuverAt: new Date(NOW - 10 * 60_000),
      loadFailureSince: null,
      ...overrides,
    } as LoadMonitorInput["state"],
    pumpPowerCv: 30,
    pumpCount: 2,
    nowMs: NOW,
  };
}

describe("evaluateLoadHealth — pre-conditions", () => {
  it("UNKNOWN quando lastTelemetryAt > 5min", () => {
    const r = evaluateLoadHealth(buildInput({ lastTelemetryAt: new Date(NOW - 6 * 60_000) }));
    expect(r.health).toBe("UNKNOWN");
  });

  it("UNKNOWN quando Sonoff diverge do comando", () => {
    const r = evaluateLoadHealth(buildInput({ loadStatus: "on", sonoffPower: "OFF" }));
    expect(r.health).toBe("UNKNOWN");
  });

  it("aceita Sonoff UNKNOWN (não bloqueia)", () => {
    const r = evaluateLoadHealth(buildInput({ sonoffPower: "UNKNOWN" }));
    expect(r.health).toBe("RUNNING_OK");
  });

  it("UNKNOWN dentro da janela de transição (90s pós-comando)", () => {
    const r = evaluateLoadHealth(buildInput({ lastManeuverAt: new Date(NOW - 30_000) }));
    expect(r.health).toBe("UNKNOWN");
  });

  it("UNKNOWN quando currentLoadPower é null", () => {
    const r = evaluateLoadHealth(buildInput({ currentLoadPower: null }));
    expect(r.health).toBe("UNKNOWN");
  });
});

describe("evaluateLoadHealth — comando OFF", () => {
  it("OFF_OK quando carga ~0", () => {
    const r = evaluateLoadHealth(buildInput({
      loadStatus: "off", sonoffPower: "OFF", currentLoadPower: 1.5,
    }));
    expect(r.health).toBe("OFF_OK");
    expect(r.nextFailureSince).toBeNull();
  });

  it("RESIDUAL quando comando OFF mas consumo detectado", () => {
    const r = evaluateLoadHealth(buildInput({
      loadStatus: "off", sonoffPower: "OFF", currentLoadPower: 25,
    }));
    expect(r.health).toBe("RESIDUAL");
  });
});

describe("evaluateLoadHealth — comando ON: máquina de estado FAILED", () => {
  it("RUNNING_OK quando carga acima do threshold (30% × 30CV × 2 × 0.7355 ≈ 13.2kW)", () => {
    const r = evaluateLoadHealth(buildInput({ currentLoadPower: 30 }));
    expect(r.health).toBe("RUNNING_OK");
    expect(r.nextFailureSince).toBeNull();
  });

  it("VERIFYING quando carga baixa pela primeira vez (arma timer)", () => {
    const r = evaluateLoadHealth(buildInput({
      currentLoadPower: 2, loadFailureSince: null,
    }));
    expect(r.health).toBe("VERIFYING");
    expect(r.nextFailureSince).toEqual(new Date(NOW));
  });

  it("VERIFYING ainda quando timer < 10min", () => {
    const since = new Date(NOW - 5 * 60_000);
    const r = evaluateLoadHealth(buildInput({
      currentLoadPower: 2, loadFailureSince: since,
    }));
    expect(r.health).toBe("VERIFYING");
    expect(r.nextFailureSince).toEqual(since);
  });

  it("FAILED quando timer ≥ 10min", () => {
    const since = new Date(NOW - 11 * 60_000);
    const r = evaluateLoadHealth(buildInput({
      currentLoadPower: 2, loadFailureSince: since,
    }));
    expect(r.health).toBe("FAILED");
    expect(r.nextFailureSince).toEqual(since);
  });

  it("RUNNING_OK limpa timer quando carga volta", () => {
    const since = new Date(NOW - 5 * 60_000);
    const r = evaluateLoadHealth(buildInput({
      currentLoadPower: 30, loadFailureSince: since,
    }));
    expect(r.health).toBe("RUNNING_OK");
    expect(r.nextFailureSince).toBeNull();
  });
});

describe("evaluateLoadHealth — sanity check noturno (PV < 1kW)", () => {
  it("UNKNOWN quando loadPower diverge muito de battery_power à noite", () => {
    // PV=0, bat=-30 (descarga forte) mas load=2 → discrepância 28kW, > tolerância
    const r = evaluateLoadHealth(buildInput({
      currentPvPower: 0, currentBatteryPower: -30, currentLoadPower: 2,
    }));
    expect(r.health).toBe("UNKNOWN");
  });

  it("RUNNING_OK quando loadPower e battery_power batem à noite", () => {
    // PV=0, bat=-30, load=30 → discrepância 0
    const r = evaluateLoadHealth(buildInput({
      currentPvPower: 0, currentBatteryPower: -30, currentLoadPower: 30,
    }));
    expect(r.health).toBe("RUNNING_OK");
  });

  it("não aplica sanity check de dia (PV ativo)", () => {
    // PV=20, bat=+5 (carregando), load=15 → balance: 20+0-5=15 ✓
    // Mas mesmo se loadPower fosse incoerente, sanity check só roda à noite
    const r = evaluateLoadHealth(buildInput({
      currentPvPower: 20, currentBatteryPower: 5, currentLoadPower: 15,
    }));
    expect(r.health).toBe("RUNNING_OK");
  });
});

describe("evaluateLoadHealth — threshold override", () => {
  it("respeita LOAD_MIN_KW_OK override", () => {
    const r = evaluateLoadHealth({
      ...buildInput({ currentLoadPower: 8 }),
      thresholdOverrideKw: 5,
    });
    expect(r.health).toBe("RUNNING_OK"); // 8 ≥ 5
  });

  it("override muito alto causa VERIFYING", () => {
    const r = evaluateLoadHealth({
      ...buildInput({ currentLoadPower: 35, loadFailureSince: null }),
      thresholdOverrideKw: 50,
    });
    expect(r.health).toBe("VERIFYING"); // 35 < 50
  });
});
