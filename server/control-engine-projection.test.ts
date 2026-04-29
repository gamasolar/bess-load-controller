/**
 * Testes de projeção SOC em decideAction.
 *
 * Garantem que a lógica adicionada após o incidente 2026-04-29 (overshoot 4pp:
 * SOC=20 setado, real desligamento em SOC=16) realmente antecipa o TURN_OFF
 * baseado na taxa de descarga atual.
 */
import { describe, it, expect } from "vitest";
import { decideAction, type SiteRuntimeState } from "./control-engine";
import type { BessSite, BessState, BessConfig } from "../drizzle/schema";

const NOON = new Date("2026-01-01T12:00:00");

interface ProjectionScenario {
  soc: number;
  battPowerKw: number | null;
  pumpState?: "ON" | "OFF";
  inCriticalZone?: boolean;
  socMinDesliga?: number;
  intervaloCritico?: number;
  intervaloPadrao?: number;
  capacityKwh?: number;
  bessCount?: number;
}

function makeState(s: ProjectionScenario): SiteRuntimeState {
  const config: BessConfig = {
    id: 1, siteId: 2,
    socLowLimit: 15, socHighLimit: 20, cooldownMinutes: 5,
    lowReadingsRequired: 2, highReadingsRequired: 3, presetName: "padrao",
    socMinDesliga: s.socMinDesliga ?? 20,
    socMinReliga: 25,
    socBlackout: 15,
    horarioLiberacao: "06:00", horarioCorte: "17:30",
    margemZonaCritica: 10,
    intervaloPadrao: s.intervaloPadrao ?? 15,
    intervaloCritico: s.intervaloCritico ?? 1,
    cooldownAcao: 5, maxSemTelemetria: 30, controlMode: "AUTO",
    intervaloNoturno: 60, intervaloBombaSemSolar: 5,
    updatedAt: new Date(),
  };
  const state: BessState = {
    id: 1, siteId: 2, loadStatus: "on", mode: "auto",
    currentSoc: s.soc, currentSoh: null,
    currentBatteryPower: s.battPowerKw,
    currentTemperature: null, currentPvPower: null, currentLoadPower: null,
    lowCounter: 0, highCounter: 0, lastManeuverAt: null,
    healthStatus: "healthy", lastDecision: null,
    mqttConnected: true, sonoffOnline: true,
    sonoffPower: s.pumpState ?? "ON",
    lastTelemetryAt: new Date(), socSource: "fusionsolar",
    socEstimated: null, lastEstimateAt: null, dischargeRatePpPerMin: null,
    cooldownUntil: null, pumpOnSinceTimestamp: null, pumpOnSecondsToday: 0,
    loadHealth: null, loadFailureSince: null,
    updatedAt: new Date(),
  };
  const site: BessSite = {
    id: 2, slug: "barragem", name: "BESS Barragem", description: null,
    bessCount: s.bessCount ?? 1,
    bessCapacityKwh: s.capacityKwh ?? 215,
    bessModel: "LUNA2000-215KWH",
    pumpCount: 1, pumpPowerCv: 30, pumpDescription: null,
    controlMode: "auto_mqtt", mqttTopic: "barragem/sonoff",
    fusionsolarDeviceIds: null, fusionsolarInverterIds: null,
    fusionsolarPlantCode: null,
    backgroundUrl: null, cardCustomization: null,
    lat: null, lng: null, isActive: true,
    createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    site, state, config,
    soc: s.soc, socSource: "REAL", socAgeSeconds: 0,
    pumpState: s.pumpState ?? "ON",
    inCriticalZone: s.inCriticalZone ?? false,
  };
}

describe("decideAction — projeção SOC (anti-overshoot)", () => {
  describe("incidente 2026-04-29 (Barragem)", () => {
    it("SOC=23 com descarga 52kW deve antecipar TURN_OFF (cenário real do dia)", () => {
      const s = makeState({
        soc: 23, battPowerKw: -52,
        socMinDesliga: 20, intervaloCritico: 1,
        inCriticalZone: true,
      });
      const d = decideAction(s, NOON);
      // Projeção: 23 + (-52 × 2/60) / 215 × 100 = 23 - 0.81 = 22.19
      // 22.19 > 21 (effectiveThreshold) → ainda não trigger por projeção
      expect(d.kind).toBe("NONE");
    });

    it("SOC=22 com descarga 52kW antecipa quando projeção bate effectiveThreshold", () => {
      const s = makeState({
        soc: 22, battPowerKw: -52,
        socMinDesliga: 20, intervaloCritico: 1,
        inCriticalZone: true,
      });
      // Projeção: 22 - 0.81 = 21.19 > 21 → ainda não
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("SOC=21.5 com descarga 52kW antecipa", () => {
      const s = makeState({
        soc: 21.5, battPowerKw: -52,
        socMinDesliga: 20, intervaloCritico: 1,
        inCriticalZone: true,
      });
      // Projeção: 21.5 - 0.81 = 20.69 <= 21 → trigger
      const d = decideAction(s, NOON);
      expect(d.kind).toBe("TURN_OFF");
      expect(d.reason).toMatch(/Projeção/);
    });

    it("descarga acelerada (100kW) pega antes — cenário catastrófico", () => {
      const s = makeState({
        soc: 22.5, battPowerKw: -100,
        socMinDesliga: 20, intervaloCritico: 1,
        inCriticalZone: true,
      });
      // Projeção: 22.5 + (-100 × 2/60) / 215 × 100 = 22.5 - 1.55 = 20.95 <= 21 → trigger
      expect(decideAction(s, NOON).kind).toBe("TURN_OFF");
    });
  });

  describe("não dispara em cenários normais", () => {
    it("SOC=50 com descarga 30kW não trigger", () => {
      const s = makeState({ soc: 50, battPowerKw: -30, socMinDesliga: 20 });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("SOC=30 com descarga leve (10kW) não trigger", () => {
      const s = makeState({ soc: 30, battPowerKw: -10, socMinDesliga: 20 });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("SOC=22 carregando (battPower > 0) não trigger por projeção", () => {
      // bateria carregando (PV forte), projeção subiria
      const s = makeState({ soc: 22, battPowerKw: +30, socMinDesliga: 20 });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("battPower=null não dispara projeção (fallback ao threshold tradicional)", () => {
      const s = makeState({ soc: 22, battPowerKw: null, socMinDesliga: 20 });
      // Sem dado de potência, projeção é skipped. SOC 22 > 20 → NONE.
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("battPower=0 (idle) não dispara projeção", () => {
      const s = makeState({ soc: 22, battPowerKw: 0, socMinDesliga: 20 });
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("bomba OFF não dispara projeção mesmo com descarga", () => {
      const s = makeState({
        soc: 21.5, battPowerKw: -52,
        socMinDesliga: 20, pumpState: "OFF",
      });
      // pumpState OFF → fallthrough pra TURN_ON branch (precisa SOC>=socMinReliga=25)
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });
  });

  describe("Piscinão (socMinDesliga=25, capacidade 2× 215)", () => {
    it("SOC=27 com descarga 52kW e capacidade 430kWh — descarga lenta, não trigger", () => {
      const s = makeState({
        soc: 27, battPowerKw: -52,
        socMinDesliga: 25, intervaloCritico: 1,
        capacityKwh: 215, bessCount: 2, inCriticalZone: true,
      });
      // Projeção: 27 + (-52 × 2/60) / 430 × 100 = 27 - 0.40 = 26.60 > 26 (eff) → NONE
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });

    it("SOC=26.3 com descarga 52kW — projeção bate effectiveThreshold=26", () => {
      const s = makeState({
        soc: 26.3, battPowerKw: -52,
        socMinDesliga: 25, intervaloCritico: 1,
        capacityKwh: 215, bessCount: 2, inCriticalZone: true,
      });
      // Projeção: 26.3 - 0.40 = 25.90 <= 26 → trigger
      expect(decideAction(s, NOON).kind).toBe("TURN_OFF");
    });
  });

  describe("zona não-crítica usa intervaloPadrao (15min) — antecipação maior", () => {
    it("SOC=35 com descarga forte 80kW antecipa antes mesmo de entrar na crítica", () => {
      const s = makeState({
        soc: 35, battPowerKw: -80,
        socMinDesliga: 20, intervaloPadrao: 15,
        inCriticalZone: false,
      });
      // Horizonte = 30min. Projeção: 35 + (-80 × 30/60) / 215 × 100 = 35 - 18.6 = 16.4 <= 21 → trigger
      expect(decideAction(s, NOON).kind).toBe("TURN_OFF");
    });

    it("SOC=50 com descarga moderada 30kW não dispara cedo demais", () => {
      const s = makeState({
        soc: 50, battPowerKw: -30,
        socMinDesliga: 20, intervaloPadrao: 15,
        inCriticalZone: false,
      });
      // Horizonte = 30min. Projeção: 50 + (-30 × 30/60) / 215 × 100 = 50 - 6.98 = 43.02 > 21 → NONE
      expect(decideAction(s, NOON).kind).toBe("NONE");
    });
  });

  describe("threshold tradicional ainda funciona (defesa em profundidade)", () => {
    it("SOC=20 sem dado de battPower dispara TURN_OFF tradicional", () => {
      const s = makeState({ soc: 20, battPowerKw: null, socMinDesliga: 20 });
      const d = decideAction(s, NOON);
      expect(d.kind).toBe("TURN_OFF");
      expect(d.reason).toMatch(/AUTO desliga/);
    });

    it("SOC=19 (já abaixo) dispara mesmo se projeção daria NONE em teoria", () => {
      const s = makeState({ soc: 19, battPowerKw: 0, socMinDesliga: 20 });
      // battPower=0 → projeção skipped. SOC 19 <= 20 → AUTO desliga tradicional.
      expect(decideAction(s, NOON).kind).toBe("TURN_OFF");
    });
  });
});
