import { describe, expect, it } from "vitest";
import { manualFilePath, parseAlarmType } from "./manuals-faults";
import { parseCsv, rowsFromHuaweiCsv, rowsFromSmartlogger } from "./tools/import-fault-catalog";

describe("parseAlarmType", () => {
  it("HUAWEI_2032 → code 2032, sem subId", () => {
    expect(parseAlarmType("HUAWEI_2032")).toEqual({ code: 2032, subId: null });
  });
  it("HUAWEI_1140_3 → code 1140, subId 3", () => {
    expect(parseAlarmType("HUAWEI_1140_3")).toEqual({ code: 1140, subId: 3 });
  });
  it("tipos que não são Huawei → null", () => {
    expect(parseAlarmType("AUTOMACAO_OFFLINE")).toBeNull();
    expect(parseAlarmType("SOC_BAIXO")).toBeNull();
    expect(parseAlarmType("HUAWEI_")).toBeNull();
  });
});

describe("manualFilePath (sem travessia de diretório)", () => {
  const root = "/opt/bess-dashboard/storage-data";
  it("resolve dentro de manuals/", () => {
    expect(manualFilePath(root, "Huawei_x.pdf")).toBe("/opt/bess-dashboard/storage-data/manuals/Huawei_x.pdf");
  });
  it("recusa travessia", () => {
    expect(manualFilePath(root, "../../etc/passwd")).toBeNull();
    expect(manualFilePath(root, "../secrets.env")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("campos com ; e quebras dentro de aspas ficam inteiros", () => {
    const text = 'a;b;c\n1;"tem ; e\nquebra";3\n';
    expect(parseCsv(text, ";")).toEqual([["a", "b", "c"], ["1", "tem ; e\nquebra", "3"]]);
  });
  it("aspas duplicadas viram uma aspa", () => {
    expect(parseCsv('x\n"diz ""oi"""\n', ";")).toEqual([["x"], ['diz "oi"']]);
  });
});

describe("rowsFromHuaweiCsv", () => {
  const csv = [
    "fabricante;familia;modelos_cobertos;codigo;nome;descricao;causa_provavel;acao;severidade;fonte_pdf;pagina",
    'Huawei;Ref;"SUN2000-75KTL-M1";2032;Grid Failure;desc;"a rede caiu";"1. cheque a rede";major;ref.pdf;31',
    "Huawei;Ref;mod;;SemCodigo;d;c;a;warning;ref.pdf;9", // sem Alarm ID → ignorada
  ].join("\n");
  it("mapeia colunas e ignora linha sem código numérico", () => {
    const rows = rowsFromHuaweiCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      manufacturer: "Huawei", equipmentKind: "inverter", code: 2032,
      name: "Grid Failure", cause: "a rede caiu", action: "1. cheque a rede",
      severity: "major", page: "31",
    });
  });
});

describe("rowsFromSmartlogger", () => {
  it("gera linhas únicas por (alarmId, subId), sem ação (pendente de manual)", () => {
    const rows = rowsFromSmartlogger();
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.every((r) => r.equipmentKind === "smartlogger")).toBe(true);
    expect(rows.every((r) => r.action === null)).toBe(true);
    // 1148/1 = array desligado por falha de comunicação (relevante off-grid)
    const r1148 = rows.find((r) => r.code === 1148 && r.subId === 1);
    expect(r1148?.severity).toBe("major");
    // sem duplicatas de (code, subId)
    const keys = rows.map((r) => `${r.code}/${r.subId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
