import { describe, it, expect, vi } from "vitest";
import { describeSample, summarize, kindFromDevTypeId, GROUP_ORDER } from "./telemetry-catalog";
import { createFusionSolarCapture, compactData, resolveCollectedAt, type CaptureDeps } from "./telemetry-capture";
import type { DeviceIdentity, TelemetryStore } from "./telemetry-store";
import { downsample } from "./telemetry-api";
import { decodeSun2000Alarms, describeSun2000Status, SUN2000_REALTIME_REGISTERS, SUN2000_ID_REGISTERS, SUN2000_ALARMS } from "./sun2000-map";
import { setRawKpiListener } from "./fusionsolar";

// Pacote de inversor no formato do getDevRealKpi (devTypeId 1) da Northbound.
const INVERTER_ITEM = {
  devId: 1000000055696640,
  sn: "6T2529034582",
  collectTime: 1790000000000,
  dataItemMap: {
    inverter_state: 512, run_state: 1,
    active_power: 26.72, reactive_power: 0.31, mppt_power: 27.4, power_factor: 0.999, elec_freq: 60.01,
    efficiency: 98.2, temperature: 47.3,
    ab_u: 380.4, bc_u: 379.8, ca_u: 381.0, a_u: 219.6, b_u: 219.2, c_u: 220.1, a_i: 40.6, b_i: 40.8, c_i: 40.5,
    day_cap: 212.4, total_cap: 104370.5, mppt_total_cap: 105001.2, mppt_1_cap: 10500.1, mppt_2_cap: 10480.7,
    pv1_u: 742.1, pv1_i: 9.31, pv2_u: 741.8, pv2_i: 9.28, pv10_u: 739.9, pv10_i: 9.11, pv11_u: 0, pv11_i: 0,
    open_time: 1789970000000, close_time: 1789950000000,
    some_new_field: 7, estranho_temp_modulo: 51.2, valor_nulo: null,
  },
};

// Pacote de bateria (devTypeId 41): a LUNA2000-215 manda potência em W, positivo = descarga.
const BATTERY_ITEM = {
  devId: 1000000054174514,
  collectTime: 1790000000000,
  dataItemMap: { battery_soc: 58, ch_discharge_power: 47010, battery_status: 2, run_state: 1, charge_cap: 152.34, discharge_cap: 98.76 },
};

describe("catálogo: FusionSolar", () => {
  const points = describeSample("fusionsolar", "inverter", INVERTER_ITEM.dataItemMap);
  const get = (k: string) => points.find((p) => p.rawKey === k)!;

  it("nenhum campo é descartado, conhecido ou não", () => {
    const sent = Object.keys(INVERTER_ITEM.dataItemMap).filter((k) => INVERTER_ITEM.dataItemMap[k as keyof typeof INVERTER_ITEM.dataItemMap] !== undefined);
    expect(points.map((p) => p.rawKey).sort()).toEqual(sent.sort());
  });

  it("dá nome, unidade e grupo aos campos conhecidos", () => {
    expect([get("temperature").label, get("temperature").unit, get("temperature").group]).toEqual(["Temperatura interna", "°C", "temperatura"]);
    expect([get("active_power").unit, get("active_power").group]).toEqual(["kW", "potência"]);
    expect(get("elec_freq").group).toBe("rede");
    expect(get("day_cap").group).toBe("energia");
  });

  it("traduz o estado do inversor (512 = 0x0200)", () => {
    expect(get("inverter_state").text).toBe("conectado à rede");
    expect(describeSample("fusionsolar", "inverter", { inverter_state: 768 })[0].text).toBe("parado: falha");
    expect(describeSample("fusionsolar", "inverter", { inverter_state: 40960 })[0].text).toBe("em espera: sem irradiação");
    expect(describeSample("fusionsolar", "inverter", { inverter_state: 515 })[0].text).toBe("operando fora da rede (off-grid)");
  });

  it("reconhece strings e MPPTs pelo padrão do nome", () => {
    expect([get("pv10_u").label, get("pv10_u").unit, get("pv10_u").group]).toEqual(["Tensão da string PV10", "V", "strings"]);
    expect(get("pv10_i").unit).toBe("A");
    expect(get("mppt_2_cap").group).toBe("energia");
  });

  it("campo desconhecido vai para 'outros' com o nome original; com 'temp' no nome, para temperatura", () => {
    expect([get("some_new_field").group, get("some_new_field").label, get("some_new_field").known]).toEqual(["outros", "some_new_field", false]);
    expect(get("estranho_temp_modulo").group).toBe("temperatura");
  });

  it("ordena por grupo e, dentro do grupo, PV2 antes de PV10", () => {
    const groups = points.map((p) => GROUP_ORDER.indexOf(p.group));
    expect([...groups].sort((a, b) => a - b)).toEqual(groups);
    const strings = points.filter((p) => p.group === "strings" && p.unit === "V").map((p) => p.label);
    expect(strings).toEqual(["Tensão da string PV1", "Tensão da string PV2", "Tensão da string PV10", "Tensão da string PV11"]);
  });

  it("bateria: converte W com sinal invertido para kW na convenção do sistema", () => {
    const b = describeSample("fusionsolar", "ess", BATTERY_ITEM.dataItemMap);
    const p = b.find((x) => x.rawKey === "ch_discharge_power")!;
    expect(p.value).toBe(-47.01); // descarregando 47 kW
    expect(p.unit).toBe("kW");
    expect(b.find((x) => x.rawKey === "battery_status")!.text).toBe("operando");
    expect(b.find((x) => x.rawKey === "battery_soc")!.value).toBe(58);
  });

  it("aceita número vindo como texto", () => {
    expect(describeSample("fusionsolar", "inverter", { temperature: "47.3" })[0].value).toBe(47.3);
  });
});

describe("catálogo: Modbus", () => {
  it("usa o mapa do SmartLogger para nome, unidade e enumeração", () => {
    const pts = describeSample("modbus", "plant", { soc: 58.3, pcsWorkingMode: 1, blackStartStatus: 5, campoNovo: 3 });
    const get = (k: string) => pts.find((p) => p.rawKey === k)!;
    expect([get("soc").label, get("soc").unit, get("soc").group]).toEqual(["SOC agregado da planta", "%", "bateria"]);
    expect(get("pcsWorkingMode").text).toBe("VSG (forma a rede)");
    expect(get("blackStartStatus").text).toBe("black start falhou");
    expect(get("campoNovo").known).toBe(false);
  });

  it("usa o mapa do SUN2000 para o inversor", () => {
    const pts = describeSample("modbus", "inverter", { internalTemperatureC: 47.3, pv3VoltageV: 740.2, deviceStatus: 0x0203, model: "SUN2000-75KTL-M1" });
    const get = (k: string) => pts.find((p) => p.rawKey === k)!;
    expect(get("internalTemperatureC").group).toBe("temperatura");
    expect(get("pv3VoltageV").group).toBe("strings");
    expect(get("deviceStatus").text).toBe("operando fora da rede (off-grid)");
    expect([get("model").value, get("model").group]).toEqual(["SUN2000-75KTL-M1", "identificação"]);
  });
});

describe("summarize", () => {
  it("extrai estado, temperaturas e só as strings conectadas", () => {
    const s = summarize(describeSample("fusionsolar", "inverter", INVERTER_ITEM.dataItemMap));
    expect(s.status).toBe("conectado à rede");
    expect(s.temperatures.map((t) => t.value).sort()).toEqual([47.3, 51.2]);
    expect(s.strings.map((x) => x.n)).toEqual([1, 2, 10]); // PV11 está zerada: fora
    expect(s.strings[0]).toEqual({ n: 1, voltage: 742.1, current: 9.31 });
  });
});

describe("kindFromDevTypeId", () => {
  it("classifica os tipos da Northbound", () => {
    expect([kindFromDevTypeId(1), kindFromDevTypeId(41), kindFromDevTypeId(39), kindFromDevTypeId(10), kindFromDevTypeId(17), kindFromDevTypeId(999)])
      .toEqual(["inverter", "ess", "ess", "emi", "meter", "other"]);
  });
});

// ── Captura ────────────────────────────────────────────────────────────

class FakeStore implements TelemetryStore {
  devices: (DeviceIdentity & { id: number })[] = [];
  samples: { deviceId: number; collectedAt: Date; data: Record<string, unknown> }[] = [];
  failInsert = false;
  async upsertDevice(identity: DeviceIdentity) {
    let d = this.devices.find((x) => x.source === identity.source && x.externalId === identity.externalId);
    if (!d) { d = { ...identity, id: this.devices.length + 1 }; this.devices.push(d); }
    return d.id;
  }
  async insertSample(deviceId: number, collectedAt: Date, data: Record<string, unknown>) {
    if (this.failInsert) throw new Error("banco fora do ar");
    if (this.samples.some((s) => s.deviceId === deviceId && s.collectedAt.getTime() === collectedAt.getTime())) return false;
    this.samples.push({ deviceId, collectedAt, data });
    return true;
  }
}

const NOW = new Date(1790000060000);
function makeDeps(store: FakeStore, known: Record<string, number>): CaptureDeps & { logs: string[] } {
  const logs: string[] = [];
  return { store, resolveSite: async (id) => (known[id] ? { siteId: known[id] } : null), now: () => NOW, log: (m) => logs.push(m), logs };
}

describe("captura do pacote bruto da FusionSolar", () => {
  const known = { "1000000055696640": 2, "1000000054174514": 2 };

  it("grava o pacote inteiro do inversor, por equipamento", async () => {
    const store = new FakeStore();
    const r = await createFusionSolarCapture(makeDeps(store, known))(1, [INVERTER_ITEM]);
    expect(r).toEqual({ received: 1, stored: 1, duplicates: 0, skipped: 0 });
    expect(store.devices[0]).toMatchObject({ siteId: 2, source: "fusionsolar", externalId: "1000000055696640", kind: "inverter", devTypeId: 1, serial: "6T2529034582" });
    expect(store.samples[0].collectedAt.getTime()).toBe(1790000000000);
    expect(store.samples[0].data.temperature).toBe(47.3);
    expect(store.samples[0].data.pv10_u).toBe(739.9);
    expect(store.samples[0].data.some_new_field).toBe(7);
    expect("valor_nulo" in store.samples[0].data).toBe(false);
  });

  it("duas baterias viram dois equipamentos, sem média", async () => {
    const store = new FakeStore();
    const b2 = { ...BATTERY_ITEM, devId: 1000000054175053, dataItemMap: { ...BATTERY_ITEM.dataItemMap, battery_soc: 61 } };
    const r = await createFusionSolarCapture(makeDeps(store, { ...known, "1000000054175053": 1 }))(41, [BATTERY_ITEM, b2]);
    expect(r.stored).toBe(2);
    expect(store.devices.map((d) => [d.externalId, d.siteId, d.kind])).toEqual([["1000000054174514", 2, "ess"], ["1000000054175053", 1, "ess"]]);
    expect(store.samples.map((s) => s.data.battery_soc)).toEqual([58, 61]);
  });

  it("mesmo collectTime repetido não duplica", async () => {
    const store = new FakeStore();
    const capture = createFusionSolarCapture(makeDeps(store, known));
    await capture(1, [INVERTER_ITEM]);
    const r = await capture(1, [INVERTER_ITEM]);
    expect(r).toEqual({ received: 1, stored: 0, duplicates: 1, skipped: 0 });
    expect(store.samples).toHaveLength(1);
  });

  it("equipamento que não pertence a nenhuma planta é ignorado", async () => {
    const store = new FakeStore();
    const r = await createFusionSolarCapture(makeDeps(store, {}))(1, [INVERTER_ITEM]);
    expect(r).toEqual({ received: 1, stored: 0, duplicates: 0, skipped: 1 });
    expect(store.devices).toHaveLength(0);
  });

  it("pacote vazio, sem devId ou com formato inesperado não quebra", async () => {
    const store = new FakeStore();
    const capture = createFusionSolarCapture(makeDeps(store, known));
    expect((await capture(1, [{ devId: 1000000055696640, dataItemMap: {} }, { dataItemMap: { a: 1 } }, null, "lixo"])).skipped).toBe(4);
    expect(await capture(1, null)).toEqual({ received: 0, stored: 0, duplicates: 0, skipped: 0 });
    expect(await capture(1, { nao: "é lista" })).toEqual({ received: 0, stored: 0, duplicates: 0, skipped: 0 });
  });

  it("falha do banco é contida: conta como pulada, registra e segue para o próximo", async () => {
    const store = new FakeStore();
    store.failInsert = true;
    const deps = makeDeps(store, known);
    const r = await createFusionSolarCapture(deps)(1, [INVERTER_ITEM, { ...INVERTER_ITEM, devId: 1000000054174514 }]);
    expect(r).toEqual({ received: 2, stored: 0, duplicates: 0, skipped: 2 });
    expect(deps.logs.join(" ")).toContain("banco fora do ar");
  });
});

describe("compactData / resolveCollectedAt", () => {
  it("remove nulos, vazios, N/A e não finitos; mantém zero e false", () => {
    expect(compactData({ a: 0, b: null, c: undefined, d: "", e: "N/A", f: NaN, g: Infinity, h: false, i: "x", j: 1.5 }))
      .toEqual({ a: 0, h: false, i: "x", j: 1.5 });
  });
  it("usa o collectTime da Huawei quando plausível", () => {
    expect(resolveCollectedAt(1790000000000, NOW).getTime()).toBe(1790000000000);
    expect(resolveCollectedAt("1790000000000", NOW).getTime()).toBe(1790000000000);
  });
  it("cai para agora se o collectTime for ausente, absurdo ou muito no futuro", () => {
    expect(resolveCollectedAt(undefined, NOW)).toBe(NOW);
    expect(resolveCollectedAt(0, NOW)).toBe(NOW);
    expect(resolveCollectedAt(NOW.getTime() + 3600_000, NOW)).toBe(NOW);
    expect(resolveCollectedAt("abc", NOW)).toBe(NOW);
  });
});

describe("aviso do cliente FusionSolar", () => {
  it("setRawKpiListener aceita e remove o ouvinte sem efeitos colaterais", () => {
    const fn = vi.fn();
    setRawKpiListener(fn);
    setRawKpiListener(null);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("downsample", () => {
  it("não mexe em série curta", () => {
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
  it("reduz mantendo o primeiro e o último", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsample(rows, 100);
    expect(out).toHaveLength(100);
    expect([out[0], out[99]]).toEqual([0, 999]);
  });
});

describe("mapa do SUN2000", () => {
  it("endereços-chave conferidos contra o documento V3.0", () => {
    const at = (k: string) => [...SUN2000_ID_REGISTERS, ...SUN2000_REALTIME_REGISTERS].find((d) => d.key === k)!;
    expect([at("activePowerKw").address, at("activePowerKw").type, at("activePowerKw").gain]).toEqual([32080, "I32", 1000]);
    expect([at("internalTemperatureC").address, at("internalTemperatureC").type, at("internalTemperatureC").gain]).toEqual([32087, "I16", 10]);
    expect([at("insulationResistanceMohm").address, at("insulationResistanceMohm").gain]).toEqual([32088, 1000]);
    expect([at("gridFrequencyHz").address, at("gridFrequencyHz").gain]).toEqual([32085, 100]);
    expect([at("pv1VoltageV").address, at("pv1CurrentA").address]).toEqual([32016, 32017]);
    expect([at("pv20VoltageV").address, at("pv20CurrentA").address, at("pv20CurrentA").gain]).toEqual([32054, 32055, 100]);
    expect([at("yieldTodayKwh").address, at("totalYieldKwh").address]).toEqual([32114, 32106]);
    expect([at("model").address, at("serialNumber").address, at("numberOfStrings").address, at("ratedPowerKw").address]).toEqual([30000, 30015, 30071, 30073]);
  });
  it("registradores não se sobrepõem", () => {
    const sorted = [...SUN2000_ID_REGISTERS, ...SUN2000_REALTIME_REGISTERS].sort((a, b) => a.address - b.address);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].address, `${sorted[i - 1].key} × ${sorted[i].key}`).toBeGreaterThanOrEqual(sorted[i - 1].address + sorted[i - 1].quantity);
    }
  });
  it("decodifica alarmes: perda da rede (2032) e sobretemperatura (2063)", () => {
    const a = decodeSun2000Alarms({ 1: 1 << 7, 2: 1 << 3, 3: 0 });
    expect(a.map((x) => x.alarmId)).toEqual([2032, 2063]);
    expect(a[1].severity).toBe("Minor");
  });
  it("ventiladores e perda de string vêm do terceiro registrador", () => {
    expect(decodeSun2000Alarms({ 3: (1 << 3) | (1 << 6) | (1 << 7) }).map((x) => x.alarmId)).toEqual([2086, 2015, 2087]);
  });
  it("registrador não lido é ignorado e a tabela tem 41 alarmes sem bit repetido", () => {
    expect(decodeSun2000Alarms({ 1: null })).toEqual([]);
    expect(SUN2000_ALARMS).toHaveLength(41);
    expect(new Set(SUN2000_ALARMS.map((a) => `${a.word}/${a.bit}`)).size).toBe(41);
  });
  it("estado desconhecido volta em hexadecimal", () => {
    expect(describeSun2000Status(0x0200)).toBe("conectado à rede");
    expect(describeSun2000Status(0x0999)).toContain("0x0999");
    expect(describeSun2000Status(null)).toBeNull();
  });
});
