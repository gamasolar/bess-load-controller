import { describe, it, expect } from "vitest";
import { decideAction, isWithinWindow, type SiteRuntimeState } from "./control-engine";
import type { BessSite, BessState, BessConfig } from "../drizzle/schema";

function makeState(overrides: Partial<{
  soc: number | null;
  socSource: "REAL" | "ESTIMATED" | null;
  pumpState: "ON" | "OFF" | "UNKNOWN";
  controlMode: "AUTO" | "MANUAL";
  cooldownUntil: Date | null;
  socMinDesliga: number;
  socMinReliga: number;
  socBlackout: number;
  horarioLiberacao: string;
  horarioCorte: string;
}> = {}): SiteRuntimeState {
  const config: BessConfig = {
    id: 1, siteId: 1,
    socLowLimit: 15, socHighLimit: 20, cooldownMinutes: 5,
    lowReadingsRequired: 2, highReadingsRequired: 3, presetName: "padrao",
    socMinDesliga: overrides.socMinDesliga ?? 25,
    socMinReliga: overrides.socMinReliga ?? 30,
    socBlackout: overrides.socBlackout ?? 15,
    horarioLiberacao: overrides.horarioLiberacao ?? "06:00",
    horarioCorte: overrides.horarioCorte ?? "17:30",
    margemZonaCritica: 5, intervaloPadrao: 15, intervaloCritico: 2,
    cooldownAcao: 5, maxSemTelemetria: 30,
    controlMode: overrides.controlMode ?? "AUTO",
    updatedAt: new Date(),
  };
  const state: BessState = {
    id: 1, siteId: 1, loadStatus: "on", mode: "auto",
    currentSoc: 50, currentSoh: null, currentBatteryPower: null,
    currentTemperature: null, currentPvPower: null, currentLoadPower: null,
    lowCounter: 0, highCounter: 0, lastManeuverAt: null,
    healthStatus: "healthy", lastDecision: null,
    mqttConnected: true, sonoffOnline: true,
    sonoffPower: overrides.pumpState ?? "ON",
    lastTelemetryAt: new Date(),
    socSource: "fusionsolar",
    socEstimated: null, lastEstimateAt: null, dischargeRatePpPerMin: null,
    cooldownUntil: overrides.cooldownUntil ?? null,
    pumpOnSinceTimestamp: null, pumpOnSecondsToday: 0,
    updatedAt: new Date(),
  };
  const site: BessSite = {
    id: 1, slug: "test", name: "Test Site", description: null,
    bessCount: 1, bessCapacityKwh: 215, bessModel: "LUNA2000-215KWH",
    pumpCount: 1, pumpPowerCv: 30, pumpDescription: null,
    controlMode: "auto_mqtt",
    mqttTopic: "test/sonoff",
    fusionsolarDeviceIds: null, fusionsolarInverterIds: null,
    fusionsolarPlantCode: null,
    isActive: true,
    createdAt: new Date(), updatedAt: new Date(),
  };

  return {
    site, state, config,
    soc: overrides.soc !== undefined ? overrides.soc : 50,
    socSource: overrides.socSource !== undefined ? overrides.socSource : "REAL",
    socAgeSeconds: 0,
    pumpState: overrides.pumpState ?? "ON",
    inCriticalZone: false,
  };
}

const NOON = new Date("2026-01-01T12:00:00");
const MIDNIGHT = new Date("2026-01-01T03:00:00");

describe("decideAction", () => {
  describe("BLACKOUT (SOC <= socBlackout)", () => {
    it("desliga bomba ON em blackout", () => {
      const s = makeState({ soc: 14, pumpState: "ON" });
      const d = decideAction(s, NOON);
      expect(d.kind).toBe("TURN_OFF");
      expect(d.reason).toMatch(/BLACKOUT/);
    });

    it("não age se já OFF em blackout", () => {
      const s = makeState({ soc: 14, pumpState: "OFF" });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("blackout ignora MANUAL", () => {
      const s = makeState({ soc: 10, pumpState: "ON", controlMode: "MANUAL" });
      expect(decideAction(s, NOON).kind).toBe("TURN_OFF");
    });

    it("blackout ignora cooldown", () => {
      const s = makeState({
        soc: 10, pumpState: "ON",
        cooldownUntil: new Date(NOON.getTime() + 60_000),
      });
      expect(decideAction(s, NOON).kind).toBe("TURN_OFF");
    });
  });

  describe("Sem SOC", () => {
    it("não age se soc é null", () => {
      const s = makeState({ soc: null, socSource: null });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });
  });

  describe("Cooldown", () => {
    it("bloqueia ação durante cooldown", () => {
      const s = makeState({
        soc: 24, pumpState: "ON",
        cooldownUntil: new Date(NOON.getTime() + 60_000),
      });
      const d = decideAction(s, NOON);
      expect(d.kind).toBe("NONE");
      expect(d.reason).toMatch(/[Cc]ooldown/);
    });

    it("permite ação após cooldown expirar", () => {
      const s = makeState({
        soc: 24, pumpState: "ON",
        cooldownUntil: new Date(NOON.getTime() - 1000),
      });
      expect(decideAction(s, NOON).kind).toBe("TURN_OFF");
    });
  });

  describe("MANUAL", () => {
    it("não age automaticamente em MANUAL", () => {
      const s = makeState({ soc: 24, pumpState: "ON", controlMode: "MANUAL" });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("não religa em MANUAL mesmo com SOC alto", () => {
      const s = makeState({ soc: 80, pumpState: "OFF", controlMode: "MANUAL" });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });
  });

  describe("AUTO desliga", () => {
    it("desliga quando ON e SOC <= socMinDesliga", () => {
      const s = makeState({ soc: 25, pumpState: "ON" });
      expect(decideAction(s, NOON).kind).toBe("TURN_OFF");
    });

    it("não desliga quando ON e SOC > socMinDesliga", () => {
      const s = makeState({ soc: 26, pumpState: "ON" });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("desliga com SOC ESTIMADO (conservador)", () => {
      const s = makeState({ soc: 20, pumpState: "ON", socSource: "ESTIMATED" });
      expect(decideAction(s, NOON).kind).toBe("TURN_OFF");
    });
  });

  describe("AUTO religa", () => {
    it("religa quando OFF e SOC >= socMinReliga e dentro do horário", () => {
      const s = makeState({ soc: 30, pumpState: "OFF" });
      expect(decideAction(s, NOON).kind).toBe("TURN_ON");
    });

    it("não religa quando OFF mas SOC < socMinReliga", () => {
      const s = makeState({ soc: 29, pumpState: "OFF" });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("não religa fora do horário (madrugada)", () => {
      const s = makeState({ soc: 50, pumpState: "OFF" });
      const d = decideAction(s, MIDNIGHT);
      expect(d.kind).toBe("NONE");
      expect(d.reason).toMatch(/janela/);
    });

    it("não religa após o corte (18:00)", () => {
      const s = makeState({ soc: 50, pumpState: "OFF" });
      const d = decideAction(s, new Date("2026-01-01T18:00:00"));
      expect(d.kind).toBe("NONE");
    });

    it("não religa com SOC ESTIMADO (precisa REAL)", () => {
      const s = makeState({ soc: 35, pumpState: "OFF", socSource: "ESTIMATED" });
      const d = decideAction(s, NOON);
      expect(d.kind).toBe("NONE");
      expect(d.reason).toMatch(/REAL/);
    });
  });

  describe("Histerese (zona morta)", () => {
    it("zona morta entre socMinDesliga e socMinReliga não age (pump ON)", () => {
      // socMinDesliga=25, socMinReliga=30. SOC=27 com pump ON: nada a fazer.
      const s = makeState({ soc: 27, pumpState: "ON" });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("zona morta com pump OFF aguarda subir até socMinReliga", () => {
      const s = makeState({ soc: 27, pumpState: "OFF" });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });
  });
});

describe("isWithinWindow", () => {
  it("dentro do horário comercial", () => {
    expect(isWithinWindow(new Date("2026-01-01T10:00:00"), "06:00", "17:30")).toBe(true);
  });
  it("antes do início", () => {
    expect(isWithinWindow(new Date("2026-01-01T05:30:00"), "06:00", "17:30")).toBe(false);
  });
  it("exatamente no fim (excludente)", () => {
    expect(isWithinWindow(new Date("2026-01-01T17:30:00"), "06:00", "17:30")).toBe(false);
  });
  it("exatamente no início (incluído)", () => {
    expect(isWithinWindow(new Date("2026-01-01T06:00:00"), "06:00", "17:30")).toBe(true);
  });
});
