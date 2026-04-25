import { describe, expect, it, beforeAll } from "vitest";
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

describe("bess.sites", () => {
  it("returns all sites with summary status", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const sites = await caller.bess.sites();

    expect(Array.isArray(sites)).toBe(true);
    expect(sites.length).toBeGreaterThanOrEqual(2);

    const barragem = sites.find(s => s.slug === SLUG_BARRAGEM);
    const piscinao = sites.find(s => s.slug === SLUG_PISCINAO);
    expect(barragem).toBeDefined();
    expect(piscinao).toBeDefined();

    // Verify required fields on each site
    for (const site of sites) {
      expect(site).toHaveProperty("id");
      expect(site).toHaveProperty("slug");
      expect(site).toHaveProperty("name");
      expect(site).toHaveProperty("bessCount");
      expect(site).toHaveProperty("bessCapacityKwh");
      expect(site).toHaveProperty("pumpCount");
      expect(site).toHaveProperty("pumpPowerCv");
      expect(site).toHaveProperty("controlMode");
      expect(site).toHaveProperty("currentSoc");
      expect(site).toHaveProperty("loadStatus");
      expect(site).toHaveProperty("mode");
      expect(site).toHaveProperty("healthStatus");
      expect(typeof site.currentSoc).toBe("number");
      expect(["on", "off"]).toContain(site.loadStatus);
      expect(["auto", "manual"]).toContain(site.mode);
      expect(["healthy", "attention", "degraded", "critical"]).toContain(site.healthStatus);
    }

    // Piscinão: 2x BESS, manual control
    expect(piscinao!.bessCount).toBe(2);
    expect(piscinao!.controlMode).toBe("manual");

    // Barragem: 1x BESS, auto_mqtt control
    expect(barragem!.bessCount).toBe(1);
    expect(barragem!.controlMode).toBe("auto_mqtt");
  });
});

describe("bess.siteDetail", () => {
  it("returns full detail for a valid slug", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const detail = await caller.bess.siteDetail({ slug: SLUG_BARRAGEM });

    expect(detail).not.toBeNull();
    expect(detail!.site).toHaveProperty("slug", SLUG_BARRAGEM);
    expect(detail!.site).toHaveProperty("name");
    expect(detail!.site).toHaveProperty("bessCount");
    expect(detail!.site).toHaveProperty("pumpCount");
    expect(detail!.site).toHaveProperty("controlMode");

    // State
    expect(detail!.state).toHaveProperty("loadStatus");
    expect(detail!.state).toHaveProperty("mode");
    expect(detail!.state).toHaveProperty("currentSoc");
    expect(detail!.state).toHaveProperty("healthStatus");
    expect(detail!.state).toHaveProperty("cooldownRemaining");
    expect(typeof detail!.state!.currentSoc).toBe("number");

    // Config
    expect(detail!.config).toHaveProperty("socLowLimit");
    expect(detail!.config).toHaveProperty("socHighLimit");
    expect(detail!.config).toHaveProperty("cooldownMinutes");
    expect(detail!.config.socHighLimit).toBeGreaterThan(detail!.config.socLowLimit);

    // Alarms
    expect(Array.isArray(detail!.activeAlarms)).toBe(true);
  });

  it("returns null for non-existent slug", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const detail = await caller.bess.siteDetail({ slug: "nao_existe" });
    expect(detail).toBeNull();
  });
});

describe("bess.command", () => {
  it("handles anti-duplication correctly", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const detail = await caller.bess.siteDetail({ slug: SLUG_BARRAGEM });
    const currentAction = detail!.state!.loadStatus;

    // Send same command = should be duplicate
    const result = await caller.bess.command({ slug: SLUG_BARRAGEM, action: currentAction as "on" | "off" });
    expect(result.wasDuplicate).toBe(true);
    expect(result.success).toBe(true);
  });

  it("rejects invalid action values", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.bess.command({ slug: SLUG_BARRAGEM, action: "invalid" as any })
    ).rejects.toThrow();
  });

  it("warns about manual control for piscinao site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const detail = await caller.bess.siteDetail({ slug: SLUG_PISCINAO });
    const oppositeAction = detail!.state!.loadStatus === "on" ? "off" : "on";

    const result = await caller.bess.command({ slug: SLUG_PISCINAO, action: oppositeAction as "on" | "off" });
    // May succeed with manual warning, or fail due to cooldown from prior test runs
    if (result.success) {
      // Manual mode: either MQTT was sent or physical actuation message
      expect(result.message).toBeTruthy();
    } else {
      // Cooldown is active from a previous command in this test run
      expect(result.message).toContain("Cooldown");
    }
  });

  it("returns error for non-existent site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.command({ slug: "nao_existe", action: "on" });
    expect(result.success).toBe(false);
  });
});

describe("bess.toggleMode", () => {
  it("toggles between auto and manual for a site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const detail1 = await caller.bess.siteDetail({ slug: SLUG_BARRAGEM });
    const mode1 = detail1!.state!.mode;

    const result = await caller.bess.toggleMode({ slug: SLUG_BARRAGEM });
    expect(result.mode).toBe(mode1 === "auto" ? "manual" : "auto");

    // Toggle back
    const result2 = await caller.bess.toggleMode({ slug: SLUG_BARRAGEM });
    expect(result2.mode).toBe(mode1);
  });
});

describe("bess.readings", () => {
  it("returns array of readings with soc and timestamp", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const readings = await caller.bess.readings({ slug: SLUG_BARRAGEM, hours: 4 });

    expect(Array.isArray(readings)).toBe(true);
    if (readings.length > 0) {
      expect(readings[0]).toHaveProperty("soc");
      expect(readings[0]).toHaveProperty("timestamp");
      expect(typeof readings[0].soc).toBe("number");
      expect(typeof readings[0].timestamp).toBe("number");
    }
  });

  it("returns empty array for non-existent site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const readings = await caller.bess.readings({ slug: "nao_existe", hours: 4 });
    expect(Array.isArray(readings)).toBe(true);
    expect(readings.length).toBe(0);
  });
});

describe("bess.events", () => {
  it("returns events for a specific site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const events = await caller.bess.events({ slug: SLUG_BARRAGEM });

    expect(Array.isArray(events)).toBe(true);
    if (events.length > 0) {
      expect(events[0]).toHaveProperty("type");
      expect(events[0]).toHaveProperty("description");
      expect(events[0]).toHaveProperty("createdAt");
    }
  });

  it("returns all events when no slug provided", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const events = await caller.bess.events({});

    expect(Array.isArray(events)).toBe(true);
  });
});

describe("bess.alarms", () => {
  it("returns alarms for a specific site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const alarms = await caller.bess.alarms({ slug: SLUG_BARRAGEM });
    expect(Array.isArray(alarms)).toBe(true);
  });

  it("returns global alarms when no slug provided", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const alarms = await caller.bess.alarms({});
    expect(Array.isArray(alarms)).toBe(true);
  });
});

describe("bess.stats", () => {
  it("returns statistics with min, max, avg, count for a site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const stats = await caller.bess.stats({ slug: SLUG_BARRAGEM });

    expect(stats).toHaveProperty("min");
    expect(stats).toHaveProperty("max");
    expect(stats).toHaveProperty("avg");
    expect(stats).toHaveProperty("count");
    expect(typeof stats.min).toBe("number");
    expect(typeof stats.max).toBe("number");
    expect(typeof stats.avg).toBe("number");
    expect(typeof stats.count).toBe("number");
  });

  it("returns zeros for non-existent site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const stats = await caller.bess.stats({ slug: "nao_existe" });
    expect(stats.count).toBe(0);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.avg).toBe(0);
  });
});

describe("bess.getConfig", () => {
  it("returns configuration with all required fields for a site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const config = await caller.bess.getConfig({ slug: SLUG_BARRAGEM });

    expect(config).toHaveProperty("socLowLimit");
    expect(config).toHaveProperty("socHighLimit");
    expect(config).toHaveProperty("cooldownMinutes");
    expect(config).toHaveProperty("lowReadingsRequired");
    expect(config).toHaveProperty("highReadingsRequired");
    expect(config).toHaveProperty("presetName");
    expect(typeof config.socLowLimit).toBe("number");
    expect(typeof config.socHighLimit).toBe("number");
    expect(config.socHighLimit).toBeGreaterThan(config.socLowLimit);
  });
});

describe("bess.updateConfig", () => {
  it("saves valid configuration for a site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.updateConfig({
      slug: SLUG_BARRAGEM,
      socLowLimit: 10,
      socHighLimit: 25,
      cooldownMinutes: 3,
      lowReadingsRequired: 2,
      highReadingsRequired: 3,
      presetName: "personalizado",
    });

    expect(result.success).toBe(true);

    // Verify saved
    const config = await caller.bess.getConfig({ slug: SLUG_BARRAGEM });
    expect(config.socLowLimit).toBe(10);
    expect(config.socHighLimit).toBe(25);
    expect(config.cooldownMinutes).toBe(3);
  });

  it("rejects config with insufficient hysteresis gap", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.updateConfig({
      slug: SLUG_BARRAGEM,
      socLowLimit: 18,
      socHighLimit: 20,
      cooldownMinutes: 5,
      lowReadingsRequired: 2,
      highReadingsRequired: 3,
      presetName: "personalizado",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("5 p.p.");
  });

  it("returns error for non-existent site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.updateConfig({
      slug: "nao_existe",
      socLowLimit: 10,
      socHighLimit: 25,
      cooldownMinutes: 5,
      lowReadingsRequired: 2,
      highReadingsRequired: 3,
      presetName: "padrao",
    });
    expect(result.success).toBe(false);
  });
});

describe("bess.simulateTick", () => {
  it("returns new soc and healthStatus for a site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.simulateTick({ slug: SLUG_BARRAGEM });

    expect(result).toHaveProperty("soc");
    expect(result).toHaveProperty("healthStatus");
    expect(result).toHaveProperty("loadStatus");
    expect(typeof result.soc).toBe("number");
    expect(result.soc).toBeGreaterThanOrEqual(5);
    expect(result.soc).toBeLessThanOrEqual(100);
    expect(["healthy", "attention", "degraded", "critical"]).toContain(result.healthStatus);
    expect(["on", "off"]).toContain(result.loadStatus);
  });

  it("generates readings that appear in history", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // Simulate a few ticks
    await caller.bess.simulateTick({ slug: SLUG_BARRAGEM });
    await caller.bess.simulateTick({ slug: SLUG_BARRAGEM });
    await caller.bess.simulateTick({ slug: SLUG_BARRAGEM });

    const readings = await caller.bess.readings({ slug: SLUG_BARRAGEM, hours: 1 });
    expect(readings.length).toBeGreaterThanOrEqual(3);
  });
});

describe("bess.fusionsolarStatus", () => {
  it("returns status object with configured and connected fields", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const status = await caller.bess.fusionsolarStatus();

    expect(status).toHaveProperty("configured");
    expect(status).toHaveProperty("connected");
    expect(status).toHaveProperty("message");
    expect(typeof status.configured).toBe("boolean");
    expect(typeof status.connected).toBe("boolean");
    expect(typeof status.message).toBe("string");
  }, 60000);

  it("reports configured status correctly", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const status = await caller.bess.fusionsolarStatus();

    // Credentials are now configured
    expect(status.configured).toBe(true);
    expect(typeof status.connected).toBe("boolean");
    expect(typeof status.message).toBe("string");
  }, 60000);
});

describe("bess.fusionsolarDiscover", () => {
  it("discovers stations when configured", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.fusionsolarDiscover();

    // Credentials are configured, should attempt discovery
    expect(Array.isArray(result.stations)).toBe(true);
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.message).toBe("string");
  }, 60000);
});

describe("bess.fusionsolarFetch", () => {
  it("returns error for non-existent site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.fusionsolarFetch({ slug: "nao_existe" });

    expect(result.success).toBe(false);
    expect(result.message).toContain("não encontrado");
  }, 30000);

  it("returns a result with message when fetching FusionSolar data", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.fusionsolarFetch({ slug: SLUG_BARRAGEM });

    // With real plantCode, may succeed (station-level) or fail (rate limit/auth)
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.message).toBe("string");
  }, 60000);
});

describe("bess.fusionsolarAlarms", () => {
  it("returns alarm structure for a site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.fusionsolarAlarms({ slug: SLUG_BARRAGEM });

    expect(result).toHaveProperty("configured");
    expect(result).toHaveProperty("alarms");
    expect(Array.isArray(result.alarms)).toBe(true);
  });
});

describe("bess.integrationStatus", () => {
  it("returns full integration status with fusionsolar, mqtt and sites", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const status = await caller.bess.integrationStatus();

    // FusionSolar status
    expect(status).toHaveProperty("fusionsolar");
    expect(status.fusionsolar).toHaveProperty("configured");
    expect(status.fusionsolar).toHaveProperty("connected");
    expect(typeof status.fusionsolar.configured).toBe("boolean");

    // MQTT status
    expect(status).toHaveProperty("mqtt");
    expect(status.mqtt).toHaveProperty("brokerHost");
    expect(status.mqtt).toHaveProperty("brokerPort");
    expect(typeof status.mqtt.brokerPort).toBe("number");

    // Sites status
    expect(status).toHaveProperty("sites");
    expect(Array.isArray(status.sites)).toBe(true);
    expect(status.sites.length).toBeGreaterThanOrEqual(2);

    for (const site of status.sites) {
      expect(site).toHaveProperty("slug");
      expect(site).toHaveProperty("name");
      expect(site).toHaveProperty("fusionsolarConfigured");
      expect(site).toHaveProperty("mqttConfigured");
      expect(site).toHaveProperty("controlMode");
      expect(typeof site.fusionsolarConfigured).toBe("boolean");
      expect(typeof site.mqttConfigured).toBe("boolean");
    }
  });
});

describe("bess.configureSite", () => {
  it("updates FusionSolar device IDs for a site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.configureSite({
      slug: SLUG_BARRAGEM,
      fusionsolarDeviceIds: '["12345"]',
      fusionsolarPlantCode: "NE=abc123",
    });

    expect(result.success).toBe(true);

    // Verify the site now shows as configured
    const sites = await caller.bess.sites();
    const barragem = sites.find(s => s.slug === SLUG_BARRAGEM);
    expect(barragem!.fusionsolarConfigured).toBe(true);
  });

  it("returns error for non-existent site", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.configureSite({
      slug: "nao_existe",
      fusionsolarDeviceIds: '["12345"]',
    });
    expect(result.success).toBe(false);
  });

  it("returns error when no fields to update", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bess.configureSite({
      slug: SLUG_BARRAGEM,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Nenhum campo");
  });
});
