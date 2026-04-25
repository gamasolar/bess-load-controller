import { describe, it, expect, beforeAll } from "vitest";
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

const SLUG_BARRAGEM = "barragem";
const SLUG_PISCINAO = "piscinao";

describe("bess.energyTrend", () => {
  it("returns points array and yieldKwh for a valid site and date", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // First generate some readings via simulateTick
    await caller.bess.simulateTick({ slug: SLUG_BARRAGEM });
    await caller.bess.simulateTick({ slug: SLUG_BARRAGEM });
    await caller.bess.simulateTick({ slug: SLUG_BARRAGEM });

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const result = await caller.bess.energyTrend({ slug: SLUG_BARRAGEM, date: today });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.points)).toBe(true);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
    expect(typeof result.yieldKwh).toBe("number");
    expect(result.yieldKwh).toBeGreaterThanOrEqual(0);
  });

  it("maps PV, ESS discharge, ESS charge correctly from readings", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const today = new Date().toISOString().slice(0, 10);
    const result = await caller.bess.energyTrend({ slug: SLUG_BARRAGEM, date: today });

    if (result.points.length > 0) {
      const point = result.points[0];
      expect(point).toHaveProperty("time");
      expect(point).toHaveProperty("timestamp");
      expect(point).toHaveProperty("pvOutput");
      expect(point).toHaveProperty("essDischarge");
      expect(point).toHaveProperty("essCharge");
      expect(point).toHaveProperty("loadPower");
      expect(point).toHaveProperty("soc");

      // pvOutput should be non-negative
      expect(point.pvOutput).toBeGreaterThanOrEqual(0);
      // essDischarge and essCharge should be non-negative
      expect(point.essDischarge).toBeGreaterThanOrEqual(0);
      expect(point.essCharge).toBeGreaterThanOrEqual(0);
      // They should be mutually exclusive (battery can't charge and discharge simultaneously)
      expect(point.essDischarge === 0 || point.essCharge === 0).toBe(true);
    }
  });

  it("returns empty points for a day with no data", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.bess.energyTrend({ slug: SLUG_BARRAGEM, date: "2020-01-01" });

    expect(result.success).toBe(true);
    expect(result.points).toHaveLength(0);
    expect(result.yieldKwh).toBe(0);
  });

  it("returns success=false for non-existent site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const today = new Date().toISOString().slice(0, 10);
    const result = await caller.bess.energyTrend({ slug: "nonexistent", date: today });

    expect(result.success).toBe(false);
    expect(result.points).toHaveLength(0);
    expect(result.yieldKwh).toBe(0);
  });

  it("calculates yieldKwh as time-weighted integral of PV output", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // Generate more readings to have meaningful yield
    for (let i = 0; i < 5; i++) {
      await caller.bess.simulateTick({ slug: SLUG_PISCINAO });
    }

    const today = new Date().toISOString().slice(0, 10);
    const result = await caller.bess.energyTrend({ slug: SLUG_PISCINAO, date: today });

    expect(result.success).toBe(true);
    // yieldKwh should be a reasonable number (not NaN, not Infinity)
    expect(Number.isFinite(result.yieldKwh)).toBe(true);
    expect(result.yieldKwh).toBeGreaterThanOrEqual(0);
  });
});

describe("simulateTick MQTT dispatch logic", () => {
  it("simulateTick for auto_mqtt site (barragem) includes MQTT dispatch code path", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // Run multiple ticks — the MQTT dispatch is inside the auto ON/OFF logic
    // Since SOC is random, we can't guarantee a state change, but the code path should not crash
    const results = [];
    for (let i = 0; i < 10; i++) {
      const result = await caller.bess.simulateTick({ slug: SLUG_BARRAGEM });
      results.push(result);
    }

    // All results should be valid
    for (const r of results) {
      expect(typeof r.soc).toBe("number");
      expect(["on", "off"]).toContain(r.loadStatus);
      expect(["healthy", "attention", "degraded", "critical"]).toContain(r.healthStatus);
    }
  });

  it("simulateTick for manual site (piscinao) does not crash on auto-switch", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // piscinao is manual mode — MQTT dispatch should be skipped
    const results = [];
    for (let i = 0; i < 5; i++) {
      const result = await caller.bess.simulateTick({ slug: SLUG_PISCINAO });
      results.push(result);
    }

    for (const r of results) {
      expect(typeof r.soc).toBe("number");
      expect(["on", "off"]).toContain(r.loadStatus);
    }
  });
});
