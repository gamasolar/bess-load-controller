import { describe, it, expect } from "vitest";
import { pickPollInterval, isInCriticalZone } from "./poll-scheduler";

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

describe("pickPollInterval — cooldown cap", () => {
  it("cooldown ativo termina antes do intervalo natural → antecipa", () => {
    // intervaloPadrao=15min, cooldown termina em 2min → poll em ~2.5min (cooldown + 30s buffer)
    const now = Date.now();
    const v = pickPollInterval({
      ...base,
      socInCriticalZone: false,
      pumpOff: true,
      hourMinute: { h: 12, m: 0 },
      cooldownUntilMs: now + 2 * 60_000,
      nowMs: now,
    });
    expect(v).toBeGreaterThanOrEqual(2);
    expect(v).toBeLessThanOrEqual(3);
  });

  it("cooldown já expirou → não afeta", () => {
    const now = Date.now();
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 12, m: 0 },
        cooldownUntilMs: now - 1000,
        nowMs: now,
      }),
    ).toBe(15);
  });

  it("cooldown muito longo (>15min) não estende intervalo", () => {
    const now = Date.now();
    expect(
      pickPollInterval({
        ...base,
        socInCriticalZone: false,
        pumpOff: true,
        hourMinute: { h: 12, m: 0 },
        cooldownUntilMs: now + 60 * 60_000,
        nowMs: now,
      }),
    ).toBe(15);
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
