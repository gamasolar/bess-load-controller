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

  it("descarga moderada: 34% com -22kW (capacidade 215kWh, threshold 30) → ETA ~17min → poll ~9min", () => {
    // dPerMin = 22/215*100/60 = 0.171
    // remainingPp = 34 - (30+1) = 3
    // ETA = 3/0.171 = 17.6min → ideal 8.8 → clamp(2, 15, 9) = 9
    const v = pickPollInterval({
      ...dischargeBase,
      currentSoc: 34,
      batteryPowerKw: -22,
    });
    expect(v).toBeGreaterThanOrEqual(8);
    expect(v).toBeLessThanOrEqual(10);
  });

  it("descarga forte: 32% com -30kW → ETA ~4min → poll mínimo (crítico)", () => {
    // dPerMin = 30/215*100/60 = 0.233
    // remainingPp = 32 - 31 = 1
    // ETA = 1/0.233 = 4.3min → ideal 2.1 → clamp(2, 15, 2) = 2
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

describe("pickPollInterval — ETA-based polling", () => {
  // Barragem: socMinDesliga=20, margem=10, criticalThreshold=30, capacidade=215kWh
  const eta = {
    ...base,
    socInCriticalZone: false,
    pumpOff: false,
    hourMinute: { h: 12, m: 0 }, // diurno
    capacityKwh: 215,
    criticalThreshold: 30,
  };

  it("bomba OFF carregando em zona crítica (cenário manhã pós-blackout) → padrão (sem urgência)", () => {
    // SOC=14, bat=+58kW, threshold=30 → battPower>0 → sem urgência → padrão=15
    expect(
      pickPollInterval({
        ...eta,
        socInCriticalZone: true,
        pumpOff: true,
        currentSoc: 14,
        batteryPowerKw: 58,
      }),
    ).toBe(15);
  });

  it("bomba ON SOC alto descarga moderada → padrão (cap)", () => {
    // SOC=50, bat=-30kW: dPerMin=0.233, remaining=19, ETA=81min → ideal 40 → cap 15
    expect(
      pickPollInterval({
        ...eta,
        currentSoc: 50,
        batteryPowerKw: -30,
      }),
    ).toBe(15);
  });

  it("incidente cf18fab: SOC=22, descarga -52kW → poll mínimo (já no limite)", () => {
    // dPerMin = 52/215*100/60 = 0.403
    // remainingPp = 22 - 31 = -9 (já passou) → critico=2
    expect(
      pickPollInterval({
        ...eta,
        currentSoc: 22,
        batteryPowerKw: -52,
      }),
    ).toBe(2);
  });

  it("descarga forte mas SOC longe (45% / -52kW) → escala", () => {
    // dPerMin = 0.403
    // remainingPp = 45 - 31 = 14
    // ETA = 34.7min → ideal 17.4 → clamp(2, 15, 17) = 15 (cap)
    expect(
      pickPollInterval({
        ...eta,
        currentSoc: 45,
        batteryPowerKw: -52,
      }),
    ).toBe(15);
  });

  it("zona próxima (SOC=35, descarga -30kW) → escala intermediária", () => {
    // dPerMin = 0.233
    // remainingPp = 35 - 31 = 4
    // ETA = 17.2min → ideal 8.6 → round(9) → clamp(2, 15, 9) = 9
    const v = pickPollInterval({
      ...eta,
      currentSoc: 35,
      batteryPowerKw: -30,
    });
    expect(v).toBeGreaterThanOrEqual(8);
    expect(v).toBeLessThanOrEqual(10);
  });

  it("battPower zero (estável) → sem urgência → padrão", () => {
    expect(
      pickPollInterval({
        ...eta,
        currentSoc: 25,
        batteryPowerKw: 0,
      }),
    ).toBe(15);
  });

  it("descarga muito leve (SOC=32, -2kW) → ETA grande → cap padrão", () => {
    // dPerMin = 2/215*100/60 = 0.0155
    // remainingPp = 1
    // ETA = 64.5min → ideal 32 → cap 15
    expect(
      pickPollInterval({
        ...eta,
        currentSoc: 32,
        batteryPowerKw: -2,
      }),
    ).toBe(15);
  });

  it("ETA-based com bomba ON fora janela usa intervaloBombaSemSolar como cap", () => {
    // h=22 (fora janela), bomba ON → baseInterval=intervaloBombaSemSolar=5
    // SOC=45, descarga -10kW → ETA grande → cap 5
    expect(
      pickPollInterval({
        ...eta,
        hourMinute: { h: 22, m: 0 },
        currentSoc: 45,
        batteryPowerKw: -10,
      }),
    ).toBe(5);
  });

  it("ETA com bomba OFF mas dentro janela e descarga (cargas auxiliares) → escala", () => {
    // SOC=25, descarga -2kW (cargas auxiliares, ~1pp/h)
    // dPerMin = 0.0155, remaining = 25-31 = -6 (já passou) → critico
    expect(
      pickPollInterval({
        ...eta,
        pumpOff: true,
        currentSoc: 25,
        batteryPowerKw: -2,
      }),
    ).toBe(2);
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
