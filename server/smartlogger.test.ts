import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import type { AddressInfo } from "node:net";
import {
  ModbusTcpReader, ModbusExceptionError, ModbusTimeoutError,
  buildFrame, buildReadHoldingPdu, parseDeviceIdPdu,
} from "./modbus-tcp";
import {
  PLANT_REGISTERS, ALARM_BITS, DEVICE_PUBLIC_REGISTERS, EMI_REGISTERS, METER_REGISTERS,
  WRITE_REGISTERS, SMARTLOGGER_UNIT_ID, type RegisterDef,
} from "./smartlogger-map";
import {
  decodeRegister, planReadGroups, readRegisters, readPlantSnapshot, decodeAlarmWords, unknownAlarmBits,
  readDevicePublic, scanDevices, readDeviceList, parseDeviceDescription, inferEssSign, derivePlant,
  validateSnapshot, describeValue, CONTROL_KEYS, type SignSample,
} from "./smartlogger";

// ── SmartLogger simulado ───────────────────────────────────────────────
// Servidor Modbus TCP em memória: registradores por unit id; endereço
// ausente → exceção 0x02; unit id ausente → exceção 0x0B.

type RegMap = Map<number, number>;

class FakeSmartLogger {
  units = new Map<number, RegMap>();
  deviceList: string[] = [];
  supportsDeviceList = true;
  silent = false;
  receivedFunctionCodes: number[] = [];
  private server = net.createServer((sock) => this.onSocket(sock));
  port = 0;

  listen(): Promise<void> {
    return new Promise((resolve) => this.server.listen(0, "127.0.0.1", () => {
      this.port = (this.server.address() as AddressInfo).port;
      resolve();
    }));
  }
  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
  unit(id: number): RegMap {
    if (!this.units.has(id)) this.units.set(id, new Map());
    return this.units.get(id)!;
  }
  setU16(unit: number, addr: number, v: number) { this.unit(unit).set(addr, v & 0xffff); }
  setI32(unit: number, addr: number, v: number) {
    const b = Buffer.alloc(4); b.writeInt32BE(v, 0);
    this.setU16(unit, addr, b.readUInt16BE(0)); this.setU16(unit, addr + 1, b.readUInt16BE(2));
  }
  setU32(unit: number, addr: number, v: number) {
    const b = Buffer.alloc(4); b.writeUInt32BE(v, 0);
    this.setU16(unit, addr, b.readUInt16BE(0)); this.setU16(unit, addr + 1, b.readUInt16BE(2));
  }
  setI64(unit: number, addr: number, v: bigint) {
    const b = Buffer.alloc(8); b.writeBigInt64BE(v, 0);
    for (let i = 0; i < 4; i++) this.setU16(unit, addr + i, b.readUInt16BE(i * 2));
  }
  setStr(unit: number, addr: number, regs: number, s: string) {
    const b = Buffer.alloc(regs * 2); b.write(s, 0, "latin1");
    for (let i = 0; i < regs; i++) this.setU16(unit, addr + i, b.readUInt16BE(i * 2));
  }

  private onSocket(sock: net.Socket) {
    let rx = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      rx = Buffer.concat([rx, chunk]);
      while (rx.length >= 7) {
        const len = rx.readUInt16BE(4);
        if (rx.length < 6 + len) break;
        const frame = rx.subarray(0, 6 + len);
        rx = rx.subarray(6 + len);
        const tid = frame.readUInt16BE(0);
        const unit = frame[6];
        const pdu = frame.subarray(7);
        this.receivedFunctionCodes.push(pdu[0]);
        if (this.silent) continue;
        sock.write(buildFrame(tid, unit, this.respond(unit, pdu)));
      }
    });
    sock.on("error", () => undefined);
  }

  private respond(unit: number, pdu: Buffer): Buffer {
    const fc = pdu[0];
    if (fc === 0x03) {
      const regs = this.units.get(unit);
      if (!regs) return Buffer.from([0x83, 0x0b]);
      const addr = pdu.readUInt16BE(1);
      const qty = pdu.readUInt16BE(3);
      const out = Buffer.alloc(2 + qty * 2);
      out[0] = 0x03; out[1] = qty * 2;
      for (let i = 0; i < qty; i++) {
        const v = regs.get(addr + i);
        if (v === undefined) return Buffer.from([0x83, 0x02]);
        out.writeUInt16BE(v, 2 + i * 2);
      }
      return out;
    }
    if (fc === 0x2b) {
      if (!this.supportsDeviceList) return Buffer.from([0xc1, 0x01]); // código de exceção citado pela Huawei
      const objectId = pdu[3];
      const objs: Buffer[] = [];
      if (objectId <= 0x87) objs.push(Buffer.from([0x87, 1, this.deviceList.length]));
      this.deviceList.forEach((d, i) => {
        const id = 0x88 + i;
        if (id >= objectId) objs.push(Buffer.concat([Buffer.from([id, d.length]), Buffer.from(d, "latin1")]));
      });
      return Buffer.concat([Buffer.from([0x2b, 0x0e, 0x03, 0x03, 0x00, 0x00, objs.length]), ...objs]);
    }
    return Buffer.from([fc | 0x80, 0x01]);
  }
}

/** Preenche o simulador com todos os registradores de planta zerados e depois os valores do cenário. */
function seedPlant(fake: FakeSmartLogger) {
  for (const def of PLANT_REGISTERS) for (let i = 0; i < def.quantity; i++) fake.setU16(0, def.address + i, 0);
  for (let r = 50000; r <= 50007; r++) fake.setU16(0, r, 0);
  // Cenário: noite de 17/09/2026 — bomba ligada, FV zerada, bateria descarregando 47 kW.
  fake.setU16(0, 40515, 583);            // SOC 58,3 %
  fake.setU16(0, 40516, 998);            // SOH 99,8 %
  fake.setI32(0, 40392, 47010);          // ESS +47,01 kW (saída = descarga)
  fake.setI32(0, 40507, 47010);
  fake.setU32(0, 40388, 0);              // FV 0
  fake.setI32(0, 40525, 47010);
  fake.setU16(0, 40207, 1);
  fake.setU16(0, 40539, 1);
  fake.setU32(0, 40468, 15234);          // 152,34 kWh carregados hoje
  fake.setU32(0, 40470, 9876);           // 98,76 kWh descarregados hoje
  fake.setI64(0, 40472, 12345678901n);   // 123.456.789,01 kWh
  fake.setU32(0, 40482, 116600);         // 116,6 kWh descarregáveis
  fake.setU16(0, 40217, 50);             // fim de descarga 5,0 %
  fake.setU16(0, 44365, 1);              // VSG
  fake.setU16(0, 41947, 0);
  fake.setStr(0, 40713, 10, "HV2310012345");
  fake.setU32(0, 40000, Math.floor(Date.now() / 1000));
}

let fake: FakeSmartLogger;
let reader: ModbusTcpReader;

beforeAll(async () => {
  fake = new FakeSmartLogger();
  await fake.listen();
  seedPlant(fake);
  reader = new ModbusTcpReader({ host: "127.0.0.1", port: fake.port, timeoutMs: 1000 });
});

afterAll(async () => {
  reader.close();
  await fake.close();
});

// ── Quadros ────────────────────────────────────────────────────────────

describe("quadros Modbus TCP", () => {
  it("reproduz o exemplo do documento Huawei (§4.3.3.4): ler 32306, 2 registradores", () => {
    // "00 01 00 00 00 06 00 03 7E 32 00 02"
    const frame = buildFrame(1, 0, buildReadHoldingPdu(32306, 2));
    expect(frame.toString("hex")).toBe("0001000000060003" + "7e32" + "0002");
  });

  it("usa o endereço decimal literal: SOC 40515 = 0x9E43", () => {
    expect(buildReadHoldingPdu(40515, 1).toString("hex")).toBe("039e430001");
  });

  it("recusa quantidade acima de 125 e endereço fora da faixa", () => {
    expect(() => buildReadHoldingPdu(40000, 126)).toThrow(RangeError);
    expect(() => buildReadHoldingPdu(40000, 0)).toThrow(RangeError);
    expect(() => buildReadHoldingPdu(70000, 1)).toThrow(RangeError);
  });

  it("interpreta resposta 0x2B com vários objetos", () => {
    const d = "1=SUN2000;4=ABC";
    const pdu = Buffer.concat([
      Buffer.from([0x2b, 0x0e, 0x03, 0x03, 0xff, 0x89, 2, 0x87, 1, 3, 0x88, d.length]), Buffer.from(d),
    ]);
    const r = parseDeviceIdPdu(pdu);
    expect(r.more).toBe(true);
    expect(r.nextObjectId).toBe(0x89);
    expect(r.objects.map((o) => o.id)).toEqual([0x87, 0x88]);
    expect(r.objects[1].value.toString()).toBe(d);
  });
});

// ── Decodificação ──────────────────────────────────────────────────────

describe("decodeRegister", () => {
  const def = (o: Partial<RegisterDef>): RegisterDef =>
    ({ key: "x", address: 0, quantity: 1, type: "U16", gain: 1, unit: "", label: "", ...o });

  it("U16 com ganho 10: SOC 583 → 58,3 %", () => {
    expect(decodeRegister(def({ gain: 10 }), Buffer.from([0x02, 0x47]))).toBe(58.3);
  });
  it("I32 negativo com ganho 1000: −47,01 kW", () => {
    const b = Buffer.alloc(4); b.writeInt32BE(-47010);
    expect(decodeRegister(def({ type: "I32", quantity: 2, gain: 1000 }), b)).toBe(-47.01);
  });
  it("I16 negativo", () => {
    const b = Buffer.alloc(2); b.writeInt16BE(-125);
    expect(decodeRegister(def({ type: "I16", gain: 10 }), b)).toBe(-12.5);
  });
  it("U32 acima de 2^31 não vira negativo", () => {
    const b = Buffer.alloc(4); b.writeUInt32BE(3_000_000_000);
    expect(decodeRegister(def({ type: "U32", quantity: 2 }), b)).toBe(3_000_000_000);
  });
  it("I64 com ganho 100", () => {
    const b = Buffer.alloc(8); b.writeBigInt64BE(12345678901n);
    expect(decodeRegister(def({ type: "I64", quantity: 4, gain: 100 }), b)).toBe(123456789.01);
  });
  it("STR remove NUL e lixo", () => {
    const b = Buffer.alloc(20); b.write("HV2310012345");
    expect(decodeRegister(def({ type: "STR", quantity: 10 }), b)).toBe("HV2310012345");
  });
  it("erra se vierem menos bytes que o registrador pede", () => {
    expect(() => decodeRegister(def({ type: "I32", quantity: 2 }), Buffer.alloc(2))).toThrow(RangeError);
  });
  it("describeValue traduz enumeração e sinaliza código desconhecido", () => {
    const d = PLANT_REGISTERS.find((r) => r.key === "blackStartStatus")!;
    expect(describeValue(d, 5)).toBe("black start falhou");
    expect(describeValue(d, 9)).toContain("não documentado");
  });
});

// ── Integridade do mapa ────────────────────────────────────────────────

describe("mapa de registradores", () => {
  const all = [...PLANT_REGISTERS, ...DEVICE_PUBLIC_REGISTERS, ...EMI_REGISTERS, ...METER_REGISTERS];

  it("chaves únicas dentro de cada tabela", () => {
    for (const table of [PLANT_REGISTERS, DEVICE_PUBLIC_REGISTERS, EMI_REGISTERS, METER_REGISTERS]) {
      const keys = table.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("quantidade de registradores coerente com o tipo", () => {
    const expected: Record<string, number> = { U16: 1, I16: 1, U32: 2, I32: 2, U64: 4, I64: 4 };
    for (const d of all) if (d.type !== "STR") expect([d.key, d.quantity]).toEqual([d.key, expected[d.type]]);
  });

  it("registradores de planta não se sobrepõem", () => {
    const sorted = [...PLANT_REGISTERS].sort((a, b) => a.address - b.address);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].address, `${sorted[i - 1].key} × ${sorted[i].key}`)
        .toBeGreaterThanOrEqual(sorted[i - 1].address + sorted[i - 1].quantity);
    }
  });

  it("endereços-chave conferidos contra a Issue 47", () => {
    const at = (k: string) => PLANT_REGISTERS.find((d) => d.key === k)!;
    expect([at("soc").address, at("soc").type, at("soc").gain]).toEqual([40515, "U16", 10]);
    expect([at("essActivePowerKw").address, at("essActivePowerKw").type, at("essActivePowerKw").gain]).toEqual([40392, "I32", 1000]);
    expect([at("batteryChargeDischargeKw").address, at("batteryChargeDischargeKw").sinceIssue]).toEqual([40507, 47]);
    expect([at("pvActivePowerKw").address, at("pvActivePowerKw").type]).toEqual([40388, "U32"]);
    expect([at("totalEnergyChargedKwh").address, at("totalEnergyChargedKwh").type]).toEqual([40472, "I64"]);
    expect(at("blackStartStatus").address).toBe(44361);
    expect(at("commTimeoutShutdownEnabled").address).toBe(41947);
  });

  it("nenhum registrador lido aparece como escrita perigosa de disparo (WO)", () => {
    // 44360/44362 (black start), 4019x–4020x (liga/desliga), 40723 (reset) nunca podem estar na lista de leitura
    const forbidden = [40196, 40197, 40198, 40199, 40200, 40201, 40202, 40203, 40205, 40723, 40724, 40725, 44360, 44362, 44373, 44374];
    for (const d of all) expect(forbidden, d.key).not.toContain(d.address);
  });

  it("alarmes: bit 0–15, registrador 50000–50007, e ambiguidades conhecidas declaradas", () => {
    for (const a of ALARM_BITS) {
      expect(a.bit).toBeGreaterThanOrEqual(0); expect(a.bit).toBeLessThanOrEqual(15);
      expect(a.register).toBeGreaterThanOrEqual(50000); expect(a.register).toBeLessThanOrEqual(50007);
    }
    const dup = (reg: number, bit: number) => ALARM_BITS.filter((a) => a.register === reg && a.bit === bit).length;
    expect(dup(50002, 6)).toBe(2);
    expect(dup(50005, 13)).toBe(2);
    expect(dup(50005, 14)).toBe(2);
  });

  it("lista de escritas documenta os comandos que apagam a planta", () => {
    const risky = WRITE_REGISTERS.filter((w) => w.risk === "desliga a planta").map((w) => w.address);
    for (const a of [40198, 40201, 40723, 41947, 44374]) expect(risky).toContain(a);
    expect(WRITE_REGISTERS.find((w) => w.address === 40725)!.risk).toBe("destrutivo");
  });
});

// ── Agrupamento ────────────────────────────────────────────────────────

describe("planReadGroups", () => {
  it("junta só endereços contíguos por padrão", () => {
    const defs = PLANT_REGISTERS.filter((d) => ["soc", "soh", "soe", "ratedEssCapacityAh"].includes(d.key));
    const g = planReadGroups(defs);
    expect(g).toHaveLength(1);
    expect([g[0].start, g[0].quantity]).toEqual([40515, 5]);
  });
  it("não atravessa buraco sem maxGap", () => {
    const defs = PLANT_REGISTERS.filter((d) => ["soc", "totalActivePowerKw"].includes(d.key));
    expect(planReadGroups(defs)).toHaveLength(2);
    expect(planReadGroups(defs, 20)).toHaveLength(1);
  });
  it("nenhum grupo passa de 125 registradores", () => {
    for (const g of planReadGroups(PLANT_REGISTERS, 200)) expect(g.quantity).toBeLessThanOrEqual(125);
  });
});

// ── Leitura de ponta a ponta contra o simulador ────────────────────────

describe("leitura contra o SmartLogger simulado", () => {
  it("lê o retrato de controle com os valores certos", async () => {
    const snap = await readPlantSnapshot(reader, { keys: CONTROL_KEYS });
    expect(snap.values.soc).toBe(58.3);
    expect(snap.values.essActivePowerKw).toBe(47.01);
    expect(snap.values.pvActivePowerKw).toBe(0);
    expect(snap.values.runningEssPcs).toBe(1);
    expect(snap.values.energyDischargedTodayKwh).toBe(98.76);
    expect(snap.derived.loadKw).toBe(47.01);
    expect(snap.errors).toEqual({});
    expect(snap.alarms).toEqual([]);
  });

  it("lê o retrato completo, inclusive I64 e string", async () => {
    const snap = await readPlantSnapshot(reader);
    expect(snap.values.totalEnergyChargedKwh).toBe(123456789.01);
    expect(snap.values.dischargeableCapacityKwh).toBe(116.6);
    expect(snap.values.essEndOfDischargeSoc).toBe(5);
    expect(snap.values.esn).toBe("HV2310012345");
    expect(snap.values.pcsWorkingMode).toBe(1);
    expect(Math.abs(snap.derived.clockSkewS!)).toBeLessThan(5);
    expect(Object.keys(snap.values)).toHaveLength(PLANT_REGISTERS.length);
  });

  it("registrador ausente no firmware vira null com motivo, sem esconder os vizinhos", async () => {
    fake.unit(0).delete(40507); fake.unit(0).delete(40508); // firmware anterior à Issue 47
    fake.unit(0).delete(50007);
    try {
      const snap = await readPlantSnapshot(reader);
      expect(snap.values.batteryChargeDischargeKw).toBeNull();
      expect(snap.errors.batteryChargeDischargeKw).toContain("0x02");
      expect(snap.values.soc).toBe(58.3);
      expect(snap.values.essActivePowerKw).toBe(47.01);
      expect(snap.alarmWords[50007]).toBeNull();
      expect(snap.alarmWords[50006]).toBe(0);
    } finally {
      fake.setI32(0, 40507, 47010); fake.setU16(0, 50007, 0);
    }
  });

  it("bloco com buraco cai para leitura individual", async () => {
    const defs = PLANT_REGISTERS.filter((d) => ["soc", "totalActivePowerKw"].includes(d.key));
    fake.unit(0).delete(40520); // endereço não documentado no meio do bloco
    const res = await readRegisters(reader, 0, defs, { maxGap: 20 });
    expect(res.values).toEqual({ soc: 58.3, totalActivePowerKw: 47.01 });
    expect(res.requests).toBe(3); // 1 bloco que falhou + 2 individuais
  });

  it("decodifica alarmes ativos e avisa do desligamento por perda de comunicação", async () => {
    fake.setU16(0, 50006, (1 << 4) | (1 << 5)); // 1147 black start falhou por SOC; 1148 array desligado por comunicação
    fake.setU16(0, 50005, 1 << 13);            // bit ambíguo
    fake.setU16(0, 41947, 1); fake.setU16(0, 41948, 300);
    try {
      const snap = await readPlantSnapshot(reader);
      expect(snap.alarms.map((a) => a.alarmId).sort()).toEqual([1141, 1142, 1147, 1148]);
      expect(snap.alarms.find((a) => a.alarmId === 1147)!.ambiguous).toBe(false);
      expect(snap.alarms.filter((a) => a.ambiguous).map((a) => a.alarmId).sort()).toEqual([1141, 1142]);
      expect(snap.warnings.join(" ")).toContain("41947");
      expect(snap.warnings.join(" ")).toContain("300 s");
    } finally {
      fake.setU16(0, 50006, 0); fake.setU16(0, 50005, 0); fake.setU16(0, 41947, 0); fake.setU16(0, 41948, 0);
    }
  });

  it("em toda a sessão só saíram funções de leitura (0x03 e 0x2B)", async () => {
    expect([...reader.sentFunctionCodes.keys()].every((fc) => fc === 0x03 || fc === 0x2b)).toBe(true);
    expect(fake.receivedFunctionCodes.every((fc) => fc === 0x03 || fc === 0x2b)).toBe(true);
    expect(fake.receivedFunctionCodes).not.toContain(0x06);
    expect(fake.receivedFunctionCodes).not.toContain(0x10);
  });

  it("o cliente não expõe nenhuma função de escrita", () => {
    const methods = Object.getOwnPropertyNames(ModbusTcpReader.prototype);
    expect(methods.filter((m) => /write|set|force/i.test(m))).toEqual([]);
  });
});

// ── Alarmes (puro) ─────────────────────────────────────────────────────

describe("decodeAlarmWords", () => {
  it("sem bits, sem alarmes", () => {
    expect(decodeAlarmWords({ 50000: 0, 50005: 0 })).toEqual([]);
  });
  it("black start falhou: ESS não suporta (1140/4) e nenhum ESS disponível (1140/3)", () => {
    const a = decodeAlarmWords({ 50005: (1 << 2) | (1 << 3) });
    expect(a.map((x) => `${x.alarmId}/${x.subId}`)).toEqual(["1140/3", "1140/4"]);
    expect(a.every((x) => x.relevant)).toBe(true);
  });
  it("comunicação com BMS e bateria (1154/9 e 1154/3) vêm do 50007", () => {
    const a = decodeAlarmWords({ 50007: (1 << 7) | (1 << 13) });
    expect(a.map((x) => x.subId).sort()).toEqual([3, 9]);
  });
  it("registrador não lido (null) é ignorado", () => {
    expect(decodeAlarmWords({ 50007: null })).toEqual([]);
  });
  it("aponta bits ligados que o documento não descreve", () => {
    expect(unknownAlarmBits({ 50000: 1 << 0, 50004: 1 << 9 })).toEqual([{ register: 50000, bit: 0 }, { register: 50004, bit: 9 }]);
  });
});

// ── Descoberta de dispositivos ─────────────────────────────────────────

describe("descoberta de dispositivos", () => {
  beforeAll(() => {
    const seedDevice = (unit: number, status: number, sn: string, alias: string, type: number, phys: number) => {
      for (const d of DEVICE_PUBLIC_REGISTERS) for (let i = 0; i < d.quantity; i++) fake.setU16(unit, d.address + i, 0);
      fake.setU16(unit, 65534, status);
      fake.setStr(unit, 65510, 10, sn);
      fake.setStr(unit, 65524, 10, alias);
      fake.setU16(unit, 65520, type);
      fake.setU16(unit, 65523, phys);
    };
    seedDevice(1, 0xb001, "BT25A1551919", "ESS-1", 0x8030, 1);
    seedDevice(2, 0xb001, "6T2529034582", "INV-1", 0x8001, 11);
    seedDevice(3, 0xb000, "6T2000000000", "INV-2", 0x8001, 12);
    fake.deviceList = [
      "1=LUNA2000-215-2S10;2=V200R024C00SPC410;3=P1.0-D1.0;4=BT25A1551919;5=1",
      "1=SUN2000-75KTL-M1;2=V500R023C00SPC165;3=P1.0-D1.0;4=6T2529034582;5=2",
    ];
  });

  it("lê os registradores públicos de um dispositivo online", async () => {
    const d = await readDevicePublic(reader, 1);
    expect(d).not.toBeNull();
    expect(d!.online).toBe(true);
    expect(d!.values.serialNumber).toBe("BT25A1551919");
    expect(d!.values.alias).toBe("ESS-1");
    expect(d!.values.physicalAddress).toBe(1);
  });

  it("dispositivo cadastrado mas desconectado aparece offline", async () => {
    expect((await readDevicePublic(reader, 3))!.online).toBe(false);
  });

  it("unit id sem dispositivo devolve null", async () => {
    expect(await readDevicePublic(reader, 9)).toBeNull();
  });

  it("varredura encontra exatamente os três", async () => {
    const found = await scanDevices(reader, 1, 12);
    expect(found.map((d) => d.unitId)).toEqual([1, 2, 3]);
    expect(found.map((d) => d.online)).toEqual([true, true, false]);
  });

  it("lista de dispositivos pelo FC 0x2B", async () => {
    const list = await readDeviceList(reader);
    expect(list.count).toBe(2);
    expect(list.devices.map((d) => d.model)).toEqual(["LUNA2000-215-2S10", "SUN2000-75KTL-M1"]);
    expect(list.devices[0].softwareVersion).toBe("V200R024C00SPC410");
    expect(list.devices[0].esn).toBe("BT25A1551919");
    expect(list.devices[1].deviceNumber).toBe(2);
  });

  it("firmware sem suporte ao 0x2B responde com exceção, não trava", async () => {
    fake.supportsDeviceList = false;
    try {
      await expect(readDeviceList(reader)).rejects.toBeInstanceOf(ModbusExceptionError);
    } finally {
      fake.supportsDeviceList = true;
    }
  });

  it("parseDeviceDescription tolera atributos faltando", () => {
    const d = parseDeviceDescription(0x88, "1=SUN2000;2=V1");
    expect(d.model).toBe("SUN2000");
    expect(d.esn).toBeUndefined();
    expect(d.deviceNumber).toBeUndefined();
  });
});

// ── Timeout ────────────────────────────────────────────────────────────

describe("timeout", () => {
  it("servidor mudo gera ModbusTimeoutError e a conexão se recupera depois", async () => {
    const r = new ModbusTcpReader({ host: "127.0.0.1", port: fake.port, timeoutMs: 150 });
    fake.silent = true;
    try {
      await expect(r.readHoldingRegisters(0, 40515, 1)).rejects.toBeInstanceOf(ModbusTimeoutError);
    } finally {
      fake.silent = false;
    }
    const data = await r.readHoldingRegisters(0, 40515, 1);
    expect(data.readUInt16BE(0)).toBe(583);
    r.close();
  });

  it("porta fechada falha na conexão", async () => {
    const r = new ModbusTcpReader({ host: "127.0.0.1", port: 1, timeoutMs: 300 });
    await expect(r.readHoldingRegisters(0, 40515, 1)).rejects.toBeTruthy();
    r.close();
  });
});

// ── Derivados e plausibilidade ─────────────────────────────────────────

describe("derivePlant / validateSnapshot", () => {
  const at = new Date("2026-09-17T21:00:00Z");
  it("carga = FV + saída do ESS", () => {
    expect(derivePlant({ pvActivePowerKw: 30, essActivePowerKw: 17.5 }, at).loadKw).toBe(47.5);
    expect(derivePlant({ pvActivePowerKw: 70, essActivePowerKw: -22.4 }, at).loadKw).toBe(47.6);
  });
  it("carga é null se faltar uma das parcelas", () => {
    expect(derivePlant({ pvActivePowerKw: 30, essActivePowerKw: null }, at).loadKw).toBeNull();
  });
  it("SOC fora de 0–100 gera aviso", () => {
    const v = { soc: 6553.5 };
    expect(validateSnapshot(v, derivePlant(v, at)).join(" ")).toContain("soc fora de 0–100");
  });
  it("sinais opostos entre 40392 e 40507 geram aviso", () => {
    const v = { essActivePowerKw: 47, batteryChargeDischargeKw: -47 };
    expect(validateSnapshot(v, derivePlant(v, at)).join(" ")).toContain("sinais opostos");
  });
  it("PCS parado e modo PQ são avisados", () => {
    const v = { runningEssPcs: 0, essPcsShutDown: 1, pcsWorkingMode: 0 };
    const w = validateSnapshot(v, derivePlant(v, at)).join(" ");
    expect(w).toContain("PCS do ESS estão parados");
    expect(w).toContain("modo PQ");
  });
  it("planta saudável não gera aviso", () => {
    const v = { soc: 60, essActivePowerKw: 10, batteryChargeDischargeKw: 10, runningEssPcs: 1, pcsWorkingMode: 1, commTimeoutShutdownEnabled: 0 };
    expect(validateSnapshot(v, derivePlant(v, at))).toEqual([]);
  });
});

// ── Calibração do sinal ────────────────────────────────────────────────

describe("inferEssSign", () => {
  const mk = (rows: [number, number, number][]): SignSample[] =>
    rows.map(([p, c, d], i) => ({ t: i * 10_000, essPowerKw: p, chargedTodayKwh: c, dischargedTodayKwh: d }));

  it("descarga com potência positiva → positivo = descarga", () => {
    const r = inferEssSign(mk([[47, 10, 20.0], [47, 10, 20.13], [46.8, 10, 20.26], [47.1, 10, 20.39]]));
    expect(r.convention).toBe("positivo = descarga");
  });
  it("descarga com potência negativa → positivo = carga", () => {
    const r = inferEssSign(mk([[-47, 10, 20.0], [-47, 10, 20.13], [-46.8, 10, 20.26], [-47.1, 10, 20.39]]));
    expect(r.convention).toBe("positivo = carga");
  });
  it("carga com potência negativa também confirma positivo = descarga", () => {
    const r = inferEssSign(mk([[-76, 5.0, 3], [-76, 5.21, 3], [-76, 5.42, 3], [-75, 5.63, 3]]));
    expect(r.convention).toBe("positivo = descarga");
  });
  it("poucos intervalos → indeterminado", () => {
    expect(inferEssSign(mk([[47, 10, 20.0], [47, 10, 20.13]])).convention).toBe("indeterminado");
  });
  it("potência perto de zero não conta", () => {
    expect(inferEssSign(mk([[0.1, 10, 20], [0.2, 10, 20.01], [0.1, 10, 20.02], [0.1, 10, 20.03]])).convention).toBe("indeterminado");
  });
  it("evidência contraditória → indeterminado", () => {
    const r = inferEssSign(mk([
      [47, 10, 20.0], [47, 10, 20.1], [47, 10, 20.2], // descarga com positivo
      [47, 10, 20.2], [47, 10.3, 20.2], [47, 10.6, 20.2], // carga com positivo
    ]));
    expect(r.convention).toBe("indeterminado");
    expect(r.reason).toContain("contraditória");
  });
  it("virada do dia (contador zera) é ignorada", () => {
    const r = inferEssSign(mk([[47, 10, 99.9], [47, 0, 0.1], [47, 0, 0.2], [47, 0, 0.3], [47, 0, 0.4]]));
    expect(r.convention).toBe("positivo = descarga");
    expect(r.evidence.discharging.positive).toBe(3);
  });
  it("amostras com leitura faltando são puladas", () => {
    const s = mk([[47, 10, 20.0], [47, 10, 20.1], [47, 10, 20.2], [47, 10, 20.3], [47, 10, 20.4]]);
    s[2].essPowerKw = null;
    expect(inferEssSign(s).convention).toBe("indeterminado"); // sobram 2 intervalos
  });
});
