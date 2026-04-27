import { describe, it, expect } from "vitest";
import { pickPollInterval, isInCriticalZone, projectSocAfter } from "./poll-scheduler";

const base = {
  intervaloPadrao: 15,
  intervaloCritico: 2,
  intervaloNoturno: 60,
  intervaloBombaSemSolar: 5,
  horarioLiberacao: "06:00",
  horarioCorte: "19:00",
};

describe("pickPollInterval", () => {
  it("fora do horário com bomba OFF vence zona crítica — nada pode ser feito", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: true,
        pumpOff: true,
        hourMinute: { h: 3, m: 0 },
      }),
    ).toBe(60);
  });

  it("bomba ON fora do horário com SOC alto → intervaloBombaSemSolar (5 min)", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: false,
        hourMinute: { h: 22, m: 0 },
      }),
    ).toBe(5);
  });

  it("bomba ON dentro do horário com SOC alto → intervaloPadrao (15 min)", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: false,
        hourMinute: { h: 12, m: 0 },
      }),
    ).toBe(15);
  });

  it("zona crítica + bomba ON fora do horário → crítico (precisa proteger blackout)", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: true,
        pumpOff: false,
        hourMinute: { h: 22, m: 0 },
      }),
    ).toBe(2);
  });

  it("zona crítica + bomba OFF dentro do horário → crítico (pode religar a qualquer momento)", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: true,
        pumpOff: true,
        hourMinute: { h: 12, m: 0 },
      }),
    ).toBe(2);
  });

  it("dia normal, fora zona crítica → intervaloPadrao", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 12, m: 30 },
      }),
    ).toBe(15);
  });

  it("madrugada [00:00, 06:00) com bomba OFF → intervaloNoturno", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 2, m: 17 },
      }),
    ).toBe(60);
  });

  it("noite após corte (19:01-23:59) com bomba OFF → intervaloNoturno", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 21, m: 30 },
      }),
    ).toBe(60);
  });

  it("19:00 exato (corte) é fora da janela → noturno", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 19, m: 0 },
      }),
    ).toBe(60);
  });

  it("18:59 (1 min antes do corte) ainda é diurno", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 18, m: 59 },
      }),
    ).toBe(15);
  });

  it("madrugada com bomba ON, SOC alto → intervaloBombaSemSolar (5 min)", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: false,
        hourMinute: { h: 2, m: 17 },
      }),
    ).toBe(5);
  });

  it("00:00 exato é noturno", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 0, m: 0 },
      }),
    ).toBe(60);
  });

  it("horário de liberação exato (06:00) já é diurno (não inclusive)", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 6, m: 0 },
      }),
    ).toBe(15);
  });

  it("05:59 ainda é noturno", () => {
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 5, m: 59 },
      }),
    ).toBe(60);
  });

  it("horarioLiberacao customizado 04:30 — 04:29 noturno, 04:30 diurno", () => {
    const cfg = { ...base, horarioLiberacao: "04:30" };
    expect(
      pickPollInterval({ ...cfg, socInCriticalZone: false, pumpOff: true, hourMinute: { h: 4, m: 29 } }),
    ).toBe(60);
    expect(
      pickPollInterval({ ...cfg, socInCriticalZone: false, pumpOff: true, hourMinute: { h: 4, m: 30 } }),
    ).toBe(15);
  });

  it("horarioLiberacao malformado cai como 00:00 → tudo é diurno", () => {
    expect(
      pickPollInterval({
        ...base,
        horarioLiberacao: "abc",
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 2, m: 0 },
      }),
    ).toBe(15);
  });
});

describe("projectSocAfter", () => {
  it("descarga simples: 22kW por 15min em 215kWh → -2.56pp", () => {
    const proj = projectSocAfter({
      currentSoc: 40, batteryPowerKw: -22, capacityKwh: 215, intervalMinutes: 15,
    });
    expect(proj).not.toBeNull();
    expect(proj!).toBeCloseTo(40 - 2.56, 1);
  });

  it("carga: SOC sobe", () => {
    const proj = projectSocAfter({
      currentSoc: 40, batteryPowerKw: 10, capacityKwh: 215, intervalMinutes: 60,
    });
    expect(proj!).toBeCloseTo(40 + 4.65, 1);
  });

  it("retorna null se faltar dado", () => {
    expect(projectSocAfter({ currentSoc: null, batteryPowerKw: -10, capacityKwh: 215, intervalMinutes: 15 })).toBeNull();
    expect(projectSocAfter({ currentSoc: 40, batteryPowerKw: null, capacityKwh: 215, intervalMinutes: 15 })).toBeNull();
    expect(projectSocAfter({ currentSoc: 40, batteryPowerKw: -10, capacityKwh: 0, intervalMinutes: 15 })).toBeNull();
  });
});

describe("pickPollInterval — regra 2 (descarga rápida projetada)", () => {
  const dischargeBase = {
    ...base,
    socInCriticalZone: false,
    pumpOff: false,
    hourMinute: { h: 14, m: 0 }, // diurno
    capacityKwh: 215,
    criticalThreshold: 30, // socMinDesliga(25) + margem(5)
  };

  it("descarga + SOC encostando: 34% com -22kW × 30min (horizon 2× × 15) → SOC projetado ~28.9 ≤ 30 → crítico", () => {
    expect(
      pickPollInterval({
        ...dischargeBase,
        currentSoc: 34,
        batteryPowerKw: -22,
      }),
    ).toBe(2);
  });

  it("descarga forte: 32% com -30kW projeta SOC ~24% em 30min → crítico", () => {
    expect(
      pickPollInterval({
        ...dischargeBase,
        currentSoc: 32,
        batteryPowerKw: -30,
      }),
    ).toBe(2);
  });

  it("descarga lenta longe da zona não antecipa — fica em padrao", () => {
    // SOC=50, descarga -5kW × 30min / 215 × 100 = -1.16pp → SOC projetado 48.84 (longe de 30)
    expect(
      pickPollInterval({
        ...dischargeBase,
        currentSoc: 50,
        batteryPowerKw: -5,
      }),
    ).toBe(15);
  });

  it("carregando + SOC alto (acima de 50) → fica em padrao", () => {
    expect(
      pickPollInterval({
        ...dischargeBase,
        currentSoc: 60,
        batteryPowerKw: 10,
      }),
    ).toBe(15);
  });

  it("sem batteryPower + SOC alto (acima de 50) → fica em padrao", () => {
    expect(
      pickPollInterval({
        ...dischargeBase,
        currentSoc: 60,
        batteryPowerKw: null,
      }),
    ).toBe(15);
  });

  it("zona crítica clássica vence projeção (mesma resposta)", () => {
    expect(
      pickPollInterval({
        ...dischargeBase,
        socInCriticalZone: true,
        currentSoc: 28,
        batteryPowerKw: -22,
      }),
    ).toBe(2);
  });

  it("descarga rápida na madrugada com bomba OFF → noturno (nada pode ser feito sem horário+SOC)", () => {
    expect(
      pickPollInterval({
        ...dischargeBase,
        pumpOff: true,
        hourMinute: { h: 3, m: 0 },
        currentSoc: 32,
        batteryPowerKw: -30,
      }),
    ).toBe(60);
  });

  it("descarga rápida com bomba ON na madrugada → crítico (proteção contra blackout)", () => {
    expect(
      pickPollInterval({
        ...dischargeBase,
        pumpOff: false,
        hourMinute: { h: 3, m: 0 },
        currentSoc: 32,
        batteryPowerKw: -30,
      }),
    ).toBe(2);
  });
});

describe("pickPollInterval — escala gradual SOC < 50%", () => {
  // Barragem-like: socMinDesliga=20, margem=5, criticalThreshold=25
  // Faixa de transição: SOC entre 25 (exclusivo) e 50 (exclusivo)
  // Padrão: 15 min, Crítico: 2 min
  const grad = {
    ...base,
    socInCriticalZone: false,
    pumpOff: false,
    hourMinute: { h: 12, m: 0 }, // diurno
    criticalThreshold: 25,
  };

  it("SOC = 50 → padrão 15 min (limite superior)", () => {
    expect(pickPollInterval({ ...grad, currentSoc: 50 })).toBe(15);
  });
  it("SOC > 50 → padrão 15 min", () => {
    expect(pickPollInterval({ ...grad, currentSoc: 65 })).toBe(15);
  });
  it("SOC = 35 → ~7 min (meio da escala)", () => {
    const v = pickPollInterval({ ...grad, currentSoc: 35 });
    expect(v).toBeGreaterThanOrEqual(6);
    expect(v).toBeLessThanOrEqual(8);
  });
  it("SOC = 30 → ~4-5 min (mais perto da zona crítica)", () => {
    const v = pickPollInterval({ ...grad, currentSoc: 30 });
    expect(v).toBeGreaterThanOrEqual(4);
    expect(v).toBeLessThanOrEqual(5);
  });
  it("SOC = 26 (logo acima do crítico) → ~2-3 min", () => {
    const v = pickPollInterval({ ...grad, currentSoc: 26 });
    expect(v).toBeGreaterThanOrEqual(2);
    expect(v).toBeLessThanOrEqual(3);
  });
  it("SOC = 25 (na fronteira da zona crítica) → crítico 2 min", () => {
    expect(pickPollInterval({ ...grad, socInCriticalZone: true, currentSoc: 25 })).toBe(2);
  });
});

describe("isInCriticalZone", () => {
  it("dentro da margem (≤ socMinDesliga + margem)", () => {
    expect(isInCriticalZone(28, 25, 5)).toBe(true);
    expect(isInCriticalZone(30, 25, 5)).toBe(true);
  });
  it("fora da margem", () => {
    expect(isInCriticalZone(31, 25, 5)).toBe(false);
  });
});
