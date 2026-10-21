import { describe, expect, it } from "vitest";
import {
  ALARM_BOMBA_SEM_SOL, ALARM_CARGA_NOTURNA, ALARM_SOC_BAIXO_NOITE, ALARM_SOC_CRITICO,
  decideEnergyAlarms, energyAlarmConfigFromEnv, isNight, DEFAULT_ENERGY_ALARM_CONFIG, sweepEnergyAlarms,
} from "./energy-alarm";

const base = { soc: 80, loadKw: 5.5, batteryKw: -5.5, readingAgeMin: 3 };
const types = (d: { open: { type: string }[] }) => d.open.map((a) => a.type);

describe("isNight", () => {
  it("17h às 6h é noite", () => {
    const c = DEFAULT_ENERGY_ALARM_CONFIG;
    expect(isNight(17, c)).toBe(true);
    expect(isNight(23.5, c)).toBe(true);
    expect(isNight(2, c)).toBe(true);
    expect(isNight(5.9, c)).toBe(true);
    expect(isNight(6, c)).toBe(false);
    expect(isNight(12, c)).toBe(false);
    expect(isNight(16.9, c)).toBe(false);
  });
});

describe("decideEnergyAlarms", () => {
  it("noite normal com o poço (5,5 kW, SOC 80) não abre nada e fecha os que existirem", () => {
    const d = decideEnergyAlarms({ ...base, localHour: 22 });
    expect(d.open).toEqual([]);
    expect(d.close).toEqual(expect.arrayContaining([ALARM_SOC_CRITICO, ALARM_SOC_BAIXO_NOITE, ALARM_BOMBA_SEM_SOL, ALARM_CARGA_NOTURNA]));
  });

  it("bombas ligadas às 18h (58 kW) é crítico; de dia (15h) não é", () => {
    const night = decideEnergyAlarms({ ...base, loadKw: 58, batteryKw: -40, localHour: 18 });
    expect(types(night)).toEqual([ALARM_BOMBA_SEM_SOL]);
    expect(night.open[0].severity).toBe("CRITICAL");
    expect(night.open[0].description).toContain("18:00");
    expect(night.open[0].description).toContain("20 pontos/h");
    const day = decideEnergyAlarms({ ...base, loadKw: 58, batteryKw: 5, localHour: 15 });
    expect(types(day)).toEqual([]);
    expect(day.close).toContain(ALARM_BOMBA_SEM_SOL);
  });

  it("carga noturna de 10 kW (noite de 15/10) avisa sem ser crítico", () => {
    const d = decideEnergyAlarms({ ...base, loadKw: 9.9, batteryKw: -9.9, localHour: 23 });
    expect(types(d)).toEqual([ALARM_CARGA_NOTURNA]);
    expect(d.open[0].severity).toBe("WARNING");
  });

  it("SOC 38 às 2h avisa; SOC 20 é crítico a qualquer hora", () => {
    const n = decideEnergyAlarms({ ...base, soc: 38, localHour: 2 });
    expect(types(n)).toEqual([ALARM_SOC_BAIXO_NOITE]);
    const d = decideEnergyAlarms({ ...base, soc: 38, localHour: 10 });
    expect(types(d)).toEqual([]);
    const c = decideEnergyAlarms({ ...base, soc: 20, localHour: 10 });
    expect(types(c)).toEqual([ALARM_SOC_CRITICO]);
    const c2 = decideEnergyAlarms({ ...base, soc: 20, localHour: 3 });
    expect(types(c2)).toEqual([ALARM_SOC_CRITICO, ALARM_SOC_BAIXO_NOITE]);
  });

  it("histerese: SOC 27 não fecha o crítico; 30 fecha", () => {
    expect(decideEnergyAlarms({ ...base, soc: 27, localHour: 10 }).close).not.toContain(ALARM_SOC_CRITICO);
    expect(decideEnergyAlarms({ ...base, soc: 30, localHour: 10 }).close).toContain(ALARM_SOC_CRITICO);
  });

  it("leitura velha (> 45 min) não decide nada", () => {
    const d = decideEnergyAlarms({ ...base, soc: 5, loadKw: 60, readingAgeMin: 60, localHour: 20 });
    expect(d).toEqual({ open: [], close: [] });
  });

  it("sem SOC nem carga não abre nada", () => {
    const d = decideEnergyAlarms({ soc: null, loadKw: null, batteryKw: null, readingAgeMin: 1, localHour: 20 });
    expect(d.open).toEqual([]);
  });

  it("config do ambiente sobrescreve os padrões e ignora lixo", () => {
    const c = energyAlarmConfigFromEnv({ ALERTA_SOC_NOITE: "50", ALERTA_BOMBA_KW: "abc" } as NodeJS.ProcessEnv);
    expect(c.socNoite).toBe(50);
    expect(c.bombaKw).toBe(DEFAULT_ENERGY_ALARM_CONFIG.bombaKw);
  });
});

describe("sweepEnergyAlarms", () => {
  function harness(reading: { soc: number; loadKw: number; batteryKw: number }, openAlready: string[] = [], hour = 19) {
    const calls: string[] = [];
    const now = new Date(Date.UTC(2026, 9, 17, hour + 3, 0, 0)); // hora local = hour (UTC-3)
    const deps = {
      listSites: async () => [{ id: 1, slug: "barragem", name: "Barragem" }, { id: 2, slug: "piscinao", name: "Piscinão" }],
      latestReading: async () => ({ ...reading, at: new Date(now.getTime() - 60_000) }),
      listOpen: async () => openAlready,
      open: async (_s: number, a: { type: string }) => { calls.push(`open:${a.type}`); },
      close: async (_s: number, t: string) => { calls.push(`close:${t}`); },
      event: async (_s: number, t: string) => { calls.push(`event:${t}`); },
      notify: async (name: string, a: { type: string }) => { calls.push(`notify:${name}:${a.type}`); },
      now: () => now,
      sites: ["barragem"],
    };
    return { deps, calls };
  }

  it("abre, registra evento e notifica uma vez; só a planta vigiada", async () => {
    const { deps, calls } = harness({ soc: 70, loadKw: 58, batteryKw: -40 });
    const r = await sweepEnergyAlarms(deps);
    expect(r).toEqual({ opened: 1, closed: 0, skipped: 0 });
    expect(calls).toEqual([`open:${ALARM_BOMBA_SEM_SOL}`, `event:${ALARM_BOMBA_SEM_SOL}`, `notify:Barragem:${ALARM_BOMBA_SEM_SOL}`]);
  });

  it("não reabre alarme já aberto e fecha quando a condição passa", async () => {
    const a = harness({ soc: 70, loadKw: 58, batteryKw: -40 }, [ALARM_BOMBA_SEM_SOL]);
    expect(await sweepEnergyAlarms(a.deps)).toEqual({ opened: 0, closed: 0, skipped: 0 });
    expect(a.calls).toEqual([]);
    const b = harness({ soc: 70, loadKw: 5, batteryKw: -5 }, [ALARM_BOMBA_SEM_SOL]);
    expect(await sweepEnergyAlarms(b.deps)).toEqual({ opened: 0, closed: 1, skipped: 0 });
    expect(b.calls).toEqual([`close:${ALARM_BOMBA_SEM_SOL}`]);
  });
});
