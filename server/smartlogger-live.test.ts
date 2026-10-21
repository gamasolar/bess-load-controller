import { afterEach, describe, expect, it } from "vitest";
import { isSmartloggerLiveEnabled, parseHosts, snapshotToRow } from "./smartlogger-live";
import type { RegisterValue } from "./smartlogger";

describe("parseHosts", () => {
  it("lê slug=host com porta padrão 502", () => {
    expect(parseHosts("barragem=192.168.88.250")).toEqual([
      { slug: "barragem", host: "192.168.88.250", port: 502 },
    ]);
  });

  it("aceita porta explícita e vários sites", () => {
    expect(parseHosts("barragem=192.168.88.250:1502, piscinao=10.0.0.9")).toEqual([
      { slug: "barragem", host: "192.168.88.250", port: 1502 },
      { slug: "piscinao", host: "10.0.0.9", port: 502 },
    ]);
  });

  it("ignora entradas malformadas e porta inválida", () => {
    expect(parseHosts("semigual, =semhost, bom=1.2.3.4, ruim=1.2.3.4:0, ruim2=1.2.3.4:99999")).toEqual([
      { slug: "bom", host: "1.2.3.4", port: 502 },
    ]);
  });

  it("vazio/undefined → lista vazia", () => {
    expect(parseHosts(undefined)).toEqual([]);
    expect(parseHosts("   ")).toEqual([]);
  });
});

describe("isSmartloggerLiveEnabled", () => {
  const save = { ...process.env };
  afterEach(() => { process.env = { ...save }; });

  it("ligado quando há hosts e sem SMARTLOGGER_LIVE=off", () => {
    process.env.SMARTLOGGER_HOSTS = "barragem=192.168.88.250";
    delete process.env.SMARTLOGGER_LIVE;
    expect(isSmartloggerLiveEnabled()).toBe(true);
  });

  it("desligado com SMARTLOGGER_LIVE=off mesmo com hosts", () => {
    process.env.SMARTLOGGER_HOSTS = "barragem=192.168.88.250";
    process.env.SMARTLOGGER_LIVE = "off";
    expect(isSmartloggerLiveEnabled()).toBe(false);
  });

  it("desligado sem hosts", () => {
    delete process.env.SMARTLOGGER_HOSTS;
    delete process.env.SMARTLOGGER_LIVE;
    expect(isSmartloggerLiveEnabled()).toBe(false);
  });
});

describe("snapshotToRow", () => {
  const readAt = new Date("2026-10-21T12:00:00Z");
  const values: Record<string, RegisterValue> = {
    soc: 54, soh: 99, essActivePowerKw: 9.846, pvActivePowerKw: 0,
    totalActivePowerKw: 9.849, dischargeableCapacityKwh: 114.96, maxDischargePowerKw: 134.545,
    runningEssPcs: 1, voltageAB: 377.8, activeAlarmSeq: 757,
  };

  it("mapeia as grandezas para as colunas (convenção Huawei: ess +=descarga)", () => {
    const row = snapshotToRow(2, readAt, values);
    expect(row).toMatchObject({
      siteId: 2, source: "direct", ok: true, readAt,
      soc: 54, soh: 99, essPowerKw: 9.846, pvPowerKw: 0, loadKw: 9.849,
      dischargeableKwh: 114.96, maxDischargeKw: 134.545, pcsRunning: 1, voltageAbV: 377.8, alarmSeq: 757,
      err: null,
    });
  });

  it("valores ausentes, NaN ou string viram null (nunca derruba o INSERT)", () => {
    const row = snapshotToRow(2, readAt, { soc: NaN, soh: "x" as unknown as RegisterValue });
    expect(row.soc).toBeNull();
    expect(row.soh).toBeNull();
    expect(row.essPowerKw).toBeNull();
    expect(row.loadKw).toBeNull();
  });
});
