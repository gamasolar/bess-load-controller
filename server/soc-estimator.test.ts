import { describe, it, expect } from "vitest";
import { pickReadingsForRate, computeRate } from "./soc-estimator";

const at = (isoOffsetMin: number) => new Date(Date.UTC(2026, 4, 1, 12, 0, 0) + isoOffsetMin * 60_000);

describe("pickReadingsForRate", () => {
  it("filtra leituras anteriores à última manobra", () => {
    const readings = [
      { soc: 30, createdAt: at(10) },  // após manobra
      { soc: 32, createdAt: at(8) },   // após manobra
      { soc: 34, createdAt: at(6) },   // após manobra
      { soc: 50, createdAt: at(-5) },  // ANTES manobra
      { soc: 52, createdAt: at(-10) }, // ANTES manobra
      { soc: 54, createdAt: at(-15) }, // ANTES manobra
    ];
    const lastManeuverAt = at(0); // manobra ocorreu em t=0
    expect(pickReadingsForRate(readings, lastManeuverAt, 3)).toEqual([
      { soc: 30, createdAt: at(10) },
      { soc: 32, createdAt: at(8) },
      { soc: 34, createdAt: at(6) },
    ]);
  });

  it("retorna null se posteriores à manobra < minRequired", () => {
    const readings = [
      { soc: 30, createdAt: at(5) },
      { soc: 32, createdAt: at(3) },
      { soc: 50, createdAt: at(-5) },
      { soc: 52, createdAt: at(-10) },
    ];
    const lastManeuverAt = at(0);
    expect(pickReadingsForRate(readings, lastManeuverAt, 3)).toBeNull();
  });

  it("lastManeuverAt null usa epoch (todas leituras passam)", () => {
    const readings = [
      { soc: 30, createdAt: at(10) },
      { soc: 32, createdAt: at(8) },
      { soc: 34, createdAt: at(6) },
    ];
    expect(pickReadingsForRate(readings, null, 3)).toHaveLength(3);
  });

  it("limita ao minRequired (slice)", () => {
    const readings = Array.from({ length: 10 }, (_, i) => ({
      soc: 30 - i,
      createdAt: at(20 - i * 2),
    }));
    const result = pickReadingsForRate(readings, at(0), 6);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(6);
    expect(result![0].soc).toBe(30); // mais recente preservado
  });

  it("manobra muito recente (todas leituras anteriores) retorna null", () => {
    const readings = [
      { soc: 30, createdAt: at(-1) },
      { soc: 32, createdAt: at(-3) },
      { soc: 34, createdAt: at(-5) },
    ];
    const lastManeuverAt = at(0);
    expect(pickReadingsForRate(readings, lastManeuverAt, 3)).toBeNull();
  });
});

describe("computeRate", () => {
  it("descarga: SOC caindo de 40 → 34 em 30min = -0.2 pp/min", () => {
    const readings = [
      { soc: 34, createdAt: at(30) },
      { soc: 36, createdAt: at(20) },
      { soc: 38, createdAt: at(10) },
      { soc: 40, createdAt: at(0) },
    ];
    expect(computeRate(readings)).toBeCloseTo(-0.2, 2);
  });

  it("carga: SOC subindo de 20 → 50 em 60min = +0.5 pp/min", () => {
    const readings = [
      { soc: 50, createdAt: at(60) },
      { soc: 35, createdAt: at(30) },
      { soc: 20, createdAt: at(0) },
    ];
    expect(computeRate(readings)).toBeCloseTo(0.5, 2);
  });

  it("estável: SOC mesmo em ambos extremos = 0 pp/min", () => {
    const readings = [
      { soc: 50, createdAt: at(15) },
      { soc: 50, createdAt: at(0) },
    ];
    expect(computeRate(readings)).toBe(0);
  });

  it("retorna null se < 2 leituras", () => {
    expect(computeRate([])).toBeNull();
    expect(computeRate([{ soc: 50, createdAt: at(0) }])).toBeNull();
  });

  it("retorna null se gap < 1 min (ruído)", () => {
    const readings = [
      { soc: 50, createdAt: at(0.5) },
      { soc: 51, createdAt: at(0) },
    ];
    expect(computeRate(readings)).toBeNull();
  });

  it("ordem desc: newest = índice 0", () => {
    // Confirma que a função usa rows[0] como mais recente
    const readings = [
      { soc: 25, createdAt: at(20) }, // newest
      { soc: 30, createdAt: at(10) },
      { soc: 35, createdAt: at(0) },  // oldest
    ];
    // delta = newest(25) - oldest(35) = -10 / 20min = -0.5
    expect(computeRate(readings)).toBeCloseTo(-0.5, 2);
  });
});
