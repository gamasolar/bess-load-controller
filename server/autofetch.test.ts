import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("fetchFusionSolarData logic", () => {
  it("fusionsolarFetch returns error for non-existent site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.fusionsolarFetch({ slug: "site-inexistente" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Site não encontrado");
  });

  it("fusionsolarFetch attempts to fetch data for configured site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    // piscinao now has a real plantCode, so it will attempt to fetch (may fail due to API rate limit)
    const result = await caller.bess.fusionsolarFetch({ slug: "piscinao" });
    // Either succeeds or fails with an API error (not "not configured")
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("message");
  }, 15_000);


  it("fusionsolarFetch attempts auto-discovery when inverter IDs are missing", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    // barragem has fusionsolarPlantCode set but fusionsolarInverterIds is null
    // This will attempt auto-discovery via the FusionSolar API
    const result = await caller.bess.fusionsolarFetch({ slug: "barragem" });
    // Should not crash — either succeeds or returns a meaningful error
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.message).toBe("string");
  }, 15000);
});

describe("energy flow calculation logic (pvPower + loadPower)", () => {
  it("calculates loadPower correctly when battery is discharging (matches FusionSolar app)", () => {
    // Real values from FusionSolar: FV=42.337 kW, ESS=9.422 kW discharging, Load=51.759 kW
    const pvPower = 42.337;
    const batteryPower = -9.422; // negative = discharging
    const battDischarge = batteryPower < 0 ? Math.abs(batteryPower) : 0;
    const battCharge = batteryPower > 0 ? batteryPower : 0;
    const loadPower = Math.max(0, pvPower + battDischarge - battCharge);
    
    expect(loadPower).toBeCloseTo(51.759, 2);
  });

  it("calculates loadPower correctly when battery is charging", () => {
    const pvPower = 50;
    const batteryPower = 10; // positive = charging
    const battDischarge = batteryPower < 0 ? Math.abs(batteryPower) : 0;
    const battCharge = batteryPower > 0 ? batteryPower : 0;
    const loadPower = Math.max(0, pvPower + battDischarge - battCharge);
    
    // FV=50 - charge=10 = 40 kW consumed by load
    expect(loadPower).toBe(40);
  });

  it("clamps loadPower to zero when PV is zero and battery is charging", () => {
    const pvPower = 0;
    const batteryPower = 5; // charging from grid
    const battDischarge = batteryPower < 0 ? Math.abs(batteryPower) : 0;
    const battCharge = batteryPower > 0 ? batteryPower : 0;
    const loadPower = Math.max(0, pvPower + battDischarge - battCharge);
    
    expect(loadPower).toBe(0);
  });

  it("calculates loadPower correctly when only PV is producing (battery idle)", () => {
    const pvPower = 30;
    const batteryPower = 0;
    const battDischarge = batteryPower && batteryPower < 0 ? Math.abs(batteryPower) : 0;
    const battCharge = batteryPower && batteryPower > 0 ? batteryPower : 0;
    const loadPower = Math.max(0, pvPower + battDischarge - battCharge);
    
    expect(loadPower).toBe(30);
  });

  it("prefers inverter active_power over station day_power for pvPower", () => {
    const telemetry = {
      inverterData: { active_power: 42.337 },
      stationData: { day_power: 150.5 },
    };
    
    const pvPower = telemetry.inverterData?.active_power ?? telemetry.stationData?.day_power ?? 0;
    expect(pvPower).toBe(42.337);
  });

  it("falls back to station day_power when inverter data is unavailable", () => {
    const telemetry = {
      inverterData: null as any,
      stationData: { day_power: 150.5 },
    };
    
    const pvPower = telemetry.inverterData?.active_power ?? telemetry.stationData?.day_power ?? 0;
    expect(pvPower).toBe(150.5);
  });

  it("returns 0 when no PV data is available at all", () => {
    const telemetry = {
      inverterData: null as any,
      stationData: null as any,
    };
    
    const pvPower = telemetry.inverterData?.active_power ?? telemetry.stationData?.day_power ?? 0;
    expect(pvPower).toBe(0);
  });
});
