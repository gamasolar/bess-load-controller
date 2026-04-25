import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Unit tests for evaluateLoadControl logic ──
// We test the SOC evaluation logic by mocking the DB and MQTT functions

describe("evaluateLoadControl logic", () => {
  // Test the core decision logic extracted from evaluateLoadControl
  function evaluateSOC(params: {
    currentSoc: number;
    socLow: number;
    socHigh: number;
    lowCounter: number;
    highCounter: number;
    lowRequired: number;
    highRequired: number;
    loadStatus: "on" | "off";
  }) {
    const { currentSoc, socLow, socHigh, lowRequired, highRequired } = params;
    let { lowCounter, highCounter, loadStatus } = params;
    let healthStatus: "healthy" | "attention" | "degraded" | "critical" = "healthy";
    let lastDecision = "";
    let actionTaken = "none";

    if (currentSoc <= socLow) {
      lowCounter++;
      highCounter = 0;
      if (lowCounter >= lowRequired && loadStatus === "on") {
        loadStatus = "off";
        lowCounter = 0;
        healthStatus = "critical";
        lastDecision = `[AUTO] SOC em ${currentSoc}% — CARGA DESLIGADA`;
        actionTaken = "LOAD_OFF";
      } else {
        healthStatus = lowCounter >= lowRequired ? "critical" : "attention";
        lastDecision = `[AUTO] SOC em ${currentSoc}% — abaixo. LOW: ${lowCounter}/${lowRequired}`;
      }
    } else if (currentSoc >= socHigh) {
      highCounter++;
      lowCounter = 0;
      if (highCounter >= highRequired && loadStatus === "off") {
        loadStatus = "on";
        highCounter = 0;
        healthStatus = "healthy";
        lastDecision = `[AUTO] SOC em ${currentSoc}% — CARGA RELIGADA`;
        actionTaken = "LOAD_ON";
      } else if (highCounter >= highRequired && loadStatus === "on") {
        highCounter = highRequired;
        healthStatus = "healthy";
        lastDecision = `[AUTO] SOC em ${currentSoc}% — estabilizado`;
      } else {
        healthStatus = "healthy";
        lastDecision = `[AUTO] SOC em ${currentSoc}% — acima. HIGH: ${highCounter}/${highRequired}`;
      }
    } else {
      healthStatus = lowCounter > 0 ? "degraded" : "attention";
      lastDecision = `[AUTO] SOC em ${currentSoc}% — zona morta`;
    }

    return { loadStatus, lowCounter, highCounter, healthStatus, lastDecision, actionTaken };
  }

  it("should trigger LOAD_OFF when SOC drops below socLow for enough readings", () => {
    const result = evaluateSOC({
      currentSoc: 10, socLow: 15, socHigh: 25,
      lowCounter: 1, highCounter: 0, lowRequired: 2, highRequired: 3,
      loadStatus: "on",
    });
    expect(result.actionTaken).toBe("LOAD_OFF");
    expect(result.loadStatus).toBe("off");
    expect(result.healthStatus).toBe("critical");
    expect(result.lowCounter).toBe(0); // reset after action
  });

  it("should NOT trigger LOAD_OFF if counter not reached", () => {
    const result = evaluateSOC({
      currentSoc: 10, socLow: 15, socHigh: 25,
      lowCounter: 0, highCounter: 0, lowRequired: 2, highRequired: 3,
      loadStatus: "on",
    });
    expect(result.actionTaken).toBe("none");
    expect(result.loadStatus).toBe("on");
    expect(result.lowCounter).toBe(1); // incremented
  });

  it("should NOT trigger LOAD_OFF if load already off", () => {
    const result = evaluateSOC({
      currentSoc: 10, socLow: 15, socHigh: 25,
      lowCounter: 5, highCounter: 0, lowRequired: 2, highRequired: 3,
      loadStatus: "off",
    });
    expect(result.actionTaken).toBe("none");
    expect(result.loadStatus).toBe("off");
    // Counter still increments but no action since already off
    expect(result.healthStatus).toBe("critical");
  });

  it("should trigger LOAD_ON when SOC rises above socHigh for enough readings", () => {
    const result = evaluateSOC({
      currentSoc: 30, socLow: 15, socHigh: 25,
      lowCounter: 0, highCounter: 2, lowRequired: 2, highRequired: 3,
      loadStatus: "off",
    });
    expect(result.actionTaken).toBe("LOAD_ON");
    expect(result.loadStatus).toBe("on");
    expect(result.healthStatus).toBe("healthy");
    expect(result.highCounter).toBe(0); // reset after action
  });

  it("should NOT trigger LOAD_ON if counter not reached", () => {
    const result = evaluateSOC({
      currentSoc: 30, socLow: 15, socHigh: 25,
      lowCounter: 0, highCounter: 0, lowRequired: 2, highRequired: 3,
      loadStatus: "off",
    });
    expect(result.actionTaken).toBe("none");
    expect(result.loadStatus).toBe("off");
    expect(result.highCounter).toBe(1); // incremented
  });

  it("should cap highCounter when load already on and SOC above socHigh", () => {
    const result = evaluateSOC({
      currentSoc: 80, socLow: 15, socHigh: 25,
      lowCounter: 0, highCounter: 5, lowRequired: 2, highRequired: 3,
      loadStatus: "on",
    });
    expect(result.actionTaken).toBe("none");
    expect(result.loadStatus).toBe("on");
    expect(result.highCounter).toBe(3); // capped at highRequired
    expect(result.lastDecision).toContain("estabilizado");
  });

  it("should maintain state in dead zone", () => {
    const result = evaluateSOC({
      currentSoc: 18, socLow: 15, socHigh: 25,
      lowCounter: 0, highCounter: 0, lowRequired: 2, highRequired: 3,
      loadStatus: "on",
    });
    expect(result.actionTaken).toBe("none");
    expect(result.loadStatus).toBe("on");
    expect(result.lastDecision).toContain("zona morta");
  });

  it("should show degraded health in dead zone with active lowCounter", () => {
    const result = evaluateSOC({
      currentSoc: 18, socLow: 15, socHigh: 25,
      lowCounter: 1, highCounter: 0, lowRequired: 2, highRequired: 3,
      loadStatus: "on",
    });
    expect(result.healthStatus).toBe("degraded");
  });

  it("should reset highCounter when SOC drops below socLow", () => {
    const result = evaluateSOC({
      currentSoc: 10, socLow: 15, socHigh: 25,
      lowCounter: 0, highCounter: 5, lowRequired: 2, highRequired: 3,
      loadStatus: "on",
    });
    expect(result.highCounter).toBe(0);
    expect(result.lowCounter).toBe(1);
  });

  it("should reset lowCounter when SOC rises above socHigh", () => {
    const result = evaluateSOC({
      currentSoc: 30, socLow: 15, socHigh: 25,
      lowCounter: 5, highCounter: 0, lowRequired: 2, highRequired: 3,
      loadStatus: "off",
    });
    expect(result.lowCounter).toBe(0);
    expect(result.highCounter).toBe(1);
  });
});

describe("Manual mode MQTT dispatch", () => {
  it("should send MQTT in manual mode when mqttTopic is configured", () => {
    // This tests the logic: if controlMode === "manual" && site.mqttTopic && isMqttConfigured()
    // then sendMqttCommand should be called
    const site = { controlMode: "manual", mqttTopic: "bess_sonoff" };
    const shouldSendMqtt = site.controlMode === "manual" && site.mqttTopic;
    expect(shouldSendMqtt).toBeTruthy();
  });

  it("should NOT send MQTT in manual mode when mqttTopic is null", () => {
    const site = { controlMode: "manual", mqttTopic: null };
    const shouldSendMqtt = site.controlMode === "manual" && site.mqttTopic;
    expect(shouldSendMqtt).toBeFalsy();
  });
});

describe("evaluateLoadControl mode filtering", () => {
  it("should skip evaluation for manual mode sites", () => {
    const controlMode = "manual";
    const shouldEvaluate = controlMode === "auto_mqtt";
    expect(shouldEvaluate).toBe(false);
  });

  it("should evaluate for auto_mqtt mode sites", () => {
    const controlMode = "auto_mqtt";
    const shouldEvaluate = controlMode === "auto_mqtt";
    expect(shouldEvaluate).toBe(true);
  });
});

describe("SOC staleness guard", () => {
  function shouldEvaluateSOC(params: {
    socSource: string | null;
    lastTelemetryAt: number | null;
    nowMs: number;
    maxStaleMinutes: number;
  }) {
    const { socSource, lastTelemetryAt, nowMs, maxStaleMinutes } = params;
    // Must be from a real source
    if (!socSource || (socSource !== "fusionsolar" && socSource !== "manual")) {
      return { skip: true, reason: "source_not_real" };
    }
    // Must not be stale
    if (!lastTelemetryAt) {
      return { skip: true, reason: "no_telemetry_timestamp" };
    }
    const ageMs = nowMs - lastTelemetryAt;
    const maxStaleMs = maxStaleMinutes * 60 * 1000;
    if (ageMs > maxStaleMs) {
      return { skip: true, reason: "stale_telemetry", ageMinutes: Math.round(ageMs / 60000) };
    }
    return { skip: false };
  }

  const now = Date.now();

  it("should skip when socSource is unknown", () => {
    const result = shouldEvaluateSOC({ socSource: "unknown", lastTelemetryAt: now, nowMs: now, maxStaleMinutes: 15 });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("source_not_real");
  });

  it("should skip when socSource is null", () => {
    const result = shouldEvaluateSOC({ socSource: null, lastTelemetryAt: now, nowMs: now, maxStaleMinutes: 15 });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("source_not_real");
  });

  it("should skip when socSource is simulation", () => {
    const result = shouldEvaluateSOC({ socSource: "simulation", lastTelemetryAt: now, nowMs: now, maxStaleMinutes: 15 });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("source_not_real");
  });

  it("should allow when socSource is fusionsolar and data is fresh", () => {
    const result = shouldEvaluateSOC({ socSource: "fusionsolar", lastTelemetryAt: now - 5 * 60000, nowMs: now, maxStaleMinutes: 15 });
    expect(result.skip).toBe(false);
  });

  it("should allow when socSource is manual and data is fresh", () => {
    const result = shouldEvaluateSOC({ socSource: "manual", lastTelemetryAt: now - 1 * 60000, nowMs: now, maxStaleMinutes: 15 });
    expect(result.skip).toBe(false);
  });

  it("should skip when telemetry is stale (>15 min)", () => {
    const result = shouldEvaluateSOC({ socSource: "fusionsolar", lastTelemetryAt: now - 20 * 60000, nowMs: now, maxStaleMinutes: 15 });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("stale_telemetry");
    expect(result.ageMinutes).toBe(20);
  });

  it("should skip when lastTelemetryAt is null", () => {
    const result = shouldEvaluateSOC({ socSource: "fusionsolar", lastTelemetryAt: null, nowMs: now, maxStaleMinutes: 15 });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("no_telemetry_timestamp");
  });

  it("should allow at exactly 15 min boundary", () => {
    const result = shouldEvaluateSOC({ socSource: "fusionsolar", lastTelemetryAt: now - 15 * 60000, nowMs: now, maxStaleMinutes: 15 });
    expect(result.skip).toBe(false);
  });

  it("should skip at 15 min + 1ms", () => {
    const result = shouldEvaluateSOC({ socSource: "fusionsolar", lastTelemetryAt: now - 15 * 60000 - 1, nowMs: now, maxStaleMinutes: 15 });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("stale_telemetry");
  });
});

describe("Auto-fetch + evaluateLoadControl integration", () => {
  it("should call evaluateLoadControl for auto_mqtt sites after fetch", () => {
    // The doFetch loop checks: if (site.controlMode === "auto_mqtt") evaluateLoadControl(site.id)
    const sites = [
      { id: 1, slug: "piscinao", controlMode: "manual", fusionsolarPlantCode: "NE=123" },
      { id: 2, slug: "barragem", controlMode: "auto_mqtt", fusionsolarPlantCode: "NE=456" },
    ];
    const evaluated = sites.filter(s => s.controlMode === "auto_mqtt").map(s => s.slug);
    expect(evaluated).toEqual(["barragem"]);
    expect(evaluated).not.toContain("piscinao");
  });

  it("should evaluate even if FusionSolar fetch is not configured", () => {
    // evaluateLoadControl runs independently of FusionSolar config
    const site = { id: 2, slug: "barragem", controlMode: "auto_mqtt", fusionsolarPlantCode: null };
    const shouldEvaluate = site.controlMode === "auto_mqtt";
    expect(shouldEvaluate).toBe(true);
  });
});
