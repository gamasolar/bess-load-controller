import { describe, expect, it, vi } from "vitest";
import type { FusionSolarAlarm } from "./fusionsolar";
import { mapSeverity, reconcileHuaweiAlarms, sweepHuaweiAlarms, type HuaweiAlarmDeps, type SiteRef } from "./huawei-alarms";

const sites: SiteRef[] = [
  { id: 1, name: "Piscinão", plantCode: "NE=1" },
  { id: 2, name: "Barragem", plantCode: "NE=2" },
];

function alarm(over: Partial<FusionSolarAlarm> & Record<string, unknown>): FusionSolarAlarm {
  return { alarmId: "2064", alarmName: "Falha do equipamento", devName: "Inversor 1", devTypeId: 1, stationCode: "NE=2", stationName: "Barragem", severity: 2, raiseTime: 1, ...over } as FusionSolarAlarm;
}

describe("mapSeverity", () => {
  it("traduz o nível do fabricante", () => {
    expect(mapSeverity(1)).toBe("CRITICAL");
    expect(mapSeverity(2)).toBe("WARNING");
    expect(mapSeverity(3)).toBe("INFO");
    expect(mapSeverity(4)).toBe("INFO");
    expect(mapSeverity(undefined)).toBe("INFO");
  });
});

describe("reconcileHuaweiAlarms", () => {
  it("abre alarme novo com equipamento, causa e sugestão", () => {
    const r = reconcileHuaweiAlarms([alarm({ lev: 1, alarmCause: "Sobretemperatura", repairSuggestion: "Verificar ventilação" })], [], sites);
    expect(r.toClose).toEqual([]);
    expect(r.toOpen).toEqual([{
      siteId: 2, siteName: "Barragem", severity: "CRITICAL", type: "HUAWEI_2064",
      description: "Inversor 1: Falha do equipamento. Causa: Sobretemperatura. O que fazer: Verificar ventilação",
    }]);
  });

  it("não reabre o que já está aberto", () => {
    const r = reconcileHuaweiAlarms([alarm({})], [{ siteId: 2, type: "HUAWEI_2064" }], sites);
    expect(r.toOpen).toEqual([]);
    expect(r.toClose).toEqual([]);
  });

  it("fecha o que sumiu da lista e não toca em alarmes de outra origem", () => {
    const r = reconcileHuaweiAlarms([], [{ siteId: 2, type: "HUAWEI_2064" }, { siteId: 2, type: "AUTOMACAO_OFFLINE" }], sites);
    expect(r.toClose).toEqual([{ siteId: 2, type: "HUAWEI_2064" }]);
  });

  it("junta o mesmo alarme em dois equipamentos e fica com a pior gravidade", () => {
    const r = reconcileHuaweiAlarms([alarm({ lev: 3 }), alarm({ devName: "Inversor 2", lev: 1 })], [], sites);
    expect(r.toOpen).toHaveLength(1);
    expect(r.toOpen[0].severity).toBe("CRITICAL");
    expect(r.toOpen[0].description.startsWith("Inversor 1, Inversor 2: ")).toBe(true);
  });

  it("separa por planta e ignora planta desconhecida e alarme encerrado", () => {
    const r = reconcileHuaweiAlarms([
      alarm({}),
      alarm({ stationCode: "NE=1" }),
      alarm({ stationCode: "NE=999" }),
      alarm({ alarmId: "3000", status: 2 }),
    ], [], sites);
    expect(r.toOpen.map((a) => `${a.siteId}:${a.type}`).sort()).toEqual(["1:HUAWEI_2064", "2:HUAWEI_2064"]);
  });
});

function deps(over: Partial<HuaweiAlarmDeps>): HuaweiAlarmDeps {
  return {
    listSites: async () => sites,
    anySiteCritical: async () => false,
    fetchAlarms: async () => [],
    listOpen: async () => [],
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    now: () => 1_000_000_000_000,
    ...over,
  };
}

describe("sweepHuaweiAlarms", () => {
  it("faz uma única chamada com todas as plantas", async () => {
    const fetchAlarms = vi.fn(async () => []);
    const r = await sweepHuaweiAlarms(deps({ fetchAlarms }));
    expect(r).toEqual({ status: "ok", opened: 0, closed: 0, active: 0 });
    expect(fetchAlarms).toHaveBeenCalledTimes(1);
    expect(fetchAlarms.mock.calls[0][0]).toBe("NE=1,NE=2");
  });

  it("cede a vez quando há planta em zona crítica (não chama a API)", async () => {
    const fetchAlarms = vi.fn(async () => []);
    const r = await sweepHuaweiAlarms(deps({ fetchAlarms, anySiteCritical: async () => true }));
    expect(r.status).toBe("skipped");
    expect(fetchAlarms).not.toHaveBeenCalled();
  });

  it("em zona crítica cede duas rodadas e consulta na terceira; depois recomeça", async () => {
    const fetchAlarms = vi.fn(async () => []);
    const yields = { count: 0 };
    const d = deps({ fetchAlarms, anySiteCritical: async () => true, yields });
    expect((await sweepHuaweiAlarms(d)).status).toBe("skipped");
    expect((await sweepHuaweiAlarms(d)).status).toBe("skipped");
    expect((await sweepHuaweiAlarms(d)).status).toBe("ok");
    expect(fetchAlarms).toHaveBeenCalledTimes(1);
    expect((await sweepHuaweiAlarms(d)).status).toBe("skipped");
  });

  it("falha na consulta não fecha alarme aberto", async () => {
    const d = deps({ fetchAlarms: async () => null, listOpen: async () => [{ siteId: 2, type: "HUAWEI_2064" }] });
    expect(await sweepHuaweiAlarms(d)).toEqual({ status: "failed" });
    expect(d.close).not.toHaveBeenCalled();
    expect(d.open).not.toHaveBeenCalled();
  });

  it("abre, avisa só o crítico e fecha o que sumiu", async () => {
    const d = deps({
      fetchAlarms: async () => [alarm({ lev: 1 }), alarm({ alarmId: "2065", lev: 3 })],
      listOpen: async () => [{ siteId: 1, type: "HUAWEI_9" }],
    });
    expect(await sweepHuaweiAlarms(d)).toEqual({ status: "ok", opened: 2, closed: 1, active: 2 });
    expect(d.open).toHaveBeenCalledTimes(2);
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.close).toHaveBeenCalledWith({ siteId: 1, type: "HUAWEI_9" });
  });
});
