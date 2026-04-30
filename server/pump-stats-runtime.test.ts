/**
 * Testes da distribuição do tempo EFETIVO da bomba.
 *
 * Cenários cobrem:
 *  - Sequência RUNNING_OK contínua → tempo total bate com (último - primeiro)
 *  - Mistura RUNNING/OFF/VERIFYING → só RUNNING conta
 *  - Gap > cap (poll perdido) → cap aplicado, tempo não infla
 *  - Última leitura RUNNING sem próxima → usa rangeEndMs
 *  - Atravessa fronteira de bucket → distribui proporcionalmente entre buckets
 *  - Cenário do incidente 2026-04-29 (Barragem)
 */
import { describe, it, expect } from "vitest";
import {
  distributeRunningTime,
  buildBucketHelpers,
  type ReadingPoint,
  type BucketSlot,
  POLL_GAP_CAP_MS_DEFAULT,
} from "./pump-stats-runtime";

function ts(s: string): number {
  return new Date(s).getTime();
}

function makeHourlyBuckets(dayStartIso: string, hours: number): { buckets: BucketSlot[]; rangeEndMs: number } {
  const start = new Date(dayStartIso);
  const buckets: BucketSlot[] = [];
  for (let i = 0; i < hours; i++) {
    const d = new Date(start); d.setHours(d.getHours() + i);
    buckets.push({ ts: d.getTime(), secondsRunning: 0 });
  }
  const end = new Date(start); end.setHours(end.getHours() + hours);
  return { buckets, rangeEndMs: end.getTime() };
}

describe("distributeRunningTime — tempo efetivo de operação da bomba", () => {
  it("sequência contínua RUNNING_OK soma o tempo total entre primeiro e último", () => {
    // 3 leituras RUNNING_OK espaçadas 15min, total esperado = 30min entre 1ª e 3ª
    // mas como a 3ª não tem próxima, ela usa rangeEndMs (que ponho 1h depois → cap 30min)
    const { buckets, rangeEndMs } = makeHourlyBuckets("2026-04-29T15:00:00", 3);
    const helpers = buildBucketHelpers(buckets, rangeEndMs);
    const readings: ReadingPoint[] = [
      { createdAt: ts("2026-04-29T15:00:00"), loadHealth: "RUNNING_OK" },
      { createdAt: ts("2026-04-29T15:15:00"), loadHealth: "RUNNING_OK" },
      { createdAt: ts("2026-04-29T15:30:00"), loadHealth: "RUNNING_OK" },
    ];
    distributeRunningTime(readings, buckets, { rangeEndMs, ...helpers });
    // 1ª (15:00) → 2ª (15:15) = 15min, 2ª → 3ª = 15min, 3ª → fim (16:00=60min depois mas cap 30min) = 30min
    // Total 60min, tudo no bucket [15:00, 16:00)
    expect(buckets[0].secondsRunning).toBeCloseTo(60 * 60, 0);
    expect(buckets[1].secondsRunning).toBe(0);
    expect(buckets[2].secondsRunning).toBe(0);
  });

  it("mistura RUNNING/OFF_OK/VERIFYING — só conta intervalos onde a anterior era RUNNING", () => {
    const { buckets, rangeEndMs } = makeHourlyBuckets("2026-04-29T15:00:00", 1);
    const helpers = buildBucketHelpers(buckets, rangeEndMs);
    const readings: ReadingPoint[] = [
      { createdAt: ts("2026-04-29T15:00:00"), loadHealth: "RUNNING_OK" },  // → 15min
      { createdAt: ts("2026-04-29T15:15:00"), loadHealth: "OFF_OK" },      // ignorada
      { createdAt: ts("2026-04-29T15:30:00"), loadHealth: "VERIFYING" },   // ignorada
      { createdAt: ts("2026-04-29T15:45:00"), loadHealth: "RUNNING_OK" },  // → fim (15min até 16:00)
    ];
    distributeRunningTime(readings, buckets, { rangeEndMs, ...helpers });
    // 1ª RUNNING → 15min + 4ª RUNNING (cap nem chega — 15min até rangeEnd) = 30min
    expect(buckets[0].secondsRunning).toBeCloseTo(30 * 60, 0);
  });

  it("gap maior que cap (30min) é truncado — não infla tempo", () => {
    const { buckets, rangeEndMs } = makeHourlyBuckets("2026-04-29T10:00:00", 24);
    const helpers = buildBucketHelpers(buckets, rangeEndMs);
    // 1ª leitura RUNNING, próxima 6h depois (poll perdido / serviço down)
    const readings: ReadingPoint[] = [
      { createdAt: ts("2026-04-29T10:00:00"), loadHealth: "RUNNING_OK" },
      { createdAt: ts("2026-04-29T16:00:00"), loadHealth: "RUNNING_OK" },
    ];
    distributeRunningTime(readings, buckets, { rangeEndMs, ...helpers });
    // 1ª contribui só 30min (cap), não 6h
    // 2ª contribui da 16:00 até rangeEnd (10:00 next day = 18h) → cap 30min
    const total = buckets.reduce((s, b) => s + b.secondsRunning, 0);
    expect(total).toBeCloseTo(60 * 60, 0); // 30min + 30min = 60min total
  });

  it("última leitura RUNNING sem próxima usa rangeEndMs (com cap)", () => {
    const { buckets, rangeEndMs } = makeHourlyBuckets("2026-04-29T15:00:00", 1);
    const helpers = buildBucketHelpers(buckets, rangeEndMs);
    const readings: ReadingPoint[] = [
      { createdAt: ts("2026-04-29T15:50:00"), loadHealth: "RUNNING_OK" },
    ];
    distributeRunningTime(readings, buckets, { rangeEndMs, ...helpers });
    // 15:50 → 16:00 = 10min (rangeEnd menos do que cap)
    expect(buckets[0].secondsRunning).toBeCloseTo(10 * 60, 0);
  });

  it("intervalo atravessa fronteira de buckets — distribui proporcionalmente", () => {
    const { buckets, rangeEndMs } = makeHourlyBuckets("2026-04-29T15:00:00", 2);
    const helpers = buildBucketHelpers(buckets, rangeEndMs);
    // RUNNING às 15:50, próxima às 16:10 → 20min total. 10min cai no bucket [15:00,16:00) e 10min em [16:00,17:00)
    const readings: ReadingPoint[] = [
      { createdAt: ts("2026-04-29T15:50:00"), loadHealth: "RUNNING_OK" },
      { createdAt: ts("2026-04-29T16:10:00"), loadHealth: "OFF_OK" },
    ];
    distributeRunningTime(readings, buckets, { rangeEndMs, ...helpers });
    expect(buckets[0].secondsRunning).toBeCloseTo(10 * 60, 0);
    expect(buckets[1].secondsRunning).toBeCloseTo(10 * 60, 0);
  });

  it("leituras vazias retornam 0 em todos os buckets", () => {
    const { buckets, rangeEndMs } = makeHourlyBuckets("2026-04-29T00:00:00", 24);
    const helpers = buildBucketHelpers(buckets, rangeEndMs);
    distributeRunningTime([], buckets, { rangeEndMs, ...helpers });
    expect(buckets.every(b => b.secondsRunning === 0)).toBe(true);
  });

  it("loadHealth=null não conta como running", () => {
    const { buckets, rangeEndMs } = makeHourlyBuckets("2026-04-29T15:00:00", 1);
    const helpers = buildBucketHelpers(buckets, rangeEndMs);
    const readings: ReadingPoint[] = [
      { createdAt: ts("2026-04-29T15:00:00"), loadHealth: null },
      { createdAt: ts("2026-04-29T15:30:00"), loadHealth: null },
    ];
    distributeRunningTime(readings, buckets, { rangeEndMs, ...helpers });
    expect(buckets[0].secondsRunning).toBe(0);
  });

  it("aceita createdAt como string (vem do drizzle/mysql2 às vezes)", () => {
    // Usa o mesmo formato de string sem timezone que o `makeHourlyBuckets` usa
    // pra evitar discrepância UTC vs local.
    const { buckets, rangeEndMs } = makeHourlyBuckets("2026-04-29T15:00:00", 1);
    const helpers = buildBucketHelpers(buckets, rangeEndMs);
    const readings: ReadingPoint[] = [
      { createdAt: "2026-04-29T15:00:00", loadHealth: "RUNNING_OK" },
      { createdAt: "2026-04-29T15:20:00", loadHealth: "OFF_OK" },
    ];
    distributeRunningTime(readings, buckets, { rangeEndMs, ...helpers });
    // só conta o intervalo da 1ª (RUNNING) até a 2ª (OFF) = 20min
    expect(buckets[0].secondsRunning).toBeCloseTo(20 * 60, 0);
  });

  it("cenário 2026-04-29 — bomba ON 10:40 → OFF 19:37 (após backfill)", () => {
    // 24 buckets de 1h. Dia 29/04. Janela [00:00, 24:00).
    const { buckets, rangeEndMs } = makeHourlyBuckets("2026-04-29T00:00:00", 24);
    const helpers = buildBucketHelpers(buckets, rangeEndMs);

    // Simula leituras a cada 5min entre 10:40 e 19:37 todas RUNNING_OK,
    // depois 1 OFF_OK em 19:37:14 (transição).
    const readings: ReadingPoint[] = [];
    let t = ts("2026-04-29T10:40:00");
    const end = ts("2026-04-29T19:37:14");
    while (t < end) {
      readings.push({ createdAt: new Date(t), loadHealth: "RUNNING_OK" });
      t += 5 * 60_000;
    }
    readings.push({ createdAt: new Date(end), loadHealth: "OFF_OK" });

    distributeRunningTime(readings, buckets, { rangeEndMs, ...helpers });

    // Total esperado = 19:37:14 - 10:40 = 8h57min14s ≈ 8.954h
    const totalSec = buckets.reduce((s, b) => s + b.secondsRunning, 0);
    const totalHr = totalSec / 3600;
    expect(totalHr).toBeCloseTo(8.954, 1);

    // Bucket 10h (10:00-11:00): das 10:40 às 11:00 = 20min
    expect(buckets[10].secondsRunning).toBeCloseTo(20 * 60, 0);
    // Bucket 11h: completo (60min)
    expect(buckets[11].secondsRunning).toBeCloseTo(60 * 60, 0);
    // Bucket 19h (19:00-20:00): 19:00 → 19:37:14 ≈ 37.23min
    expect(buckets[19].secondsRunning).toBeCloseTo(37.23 * 60, 0);
    // Bucket antes de 10h e depois de 19h: zero
    expect(buckets[9].secondsRunning).toBe(0);
    expect(buckets[20].secondsRunning).toBe(0);
  });

  it("cap default é 30min", () => {
    expect(POLL_GAP_CAP_MS_DEFAULT).toBe(30 * 60 * 1000);
  });

  it("cap customizado funciona", () => {
    const { buckets, rangeEndMs } = makeHourlyBuckets("2026-04-29T15:00:00", 24);
    const helpers = buildBucketHelpers(buckets, rangeEndMs);
    const readings: ReadingPoint[] = [
      { createdAt: ts("2026-04-29T15:00:00"), loadHealth: "RUNNING_OK" },
      { createdAt: ts("2026-04-29T18:00:00"), loadHealth: "OFF_OK" },
    ];
    distributeRunningTime(readings, buckets, { rangeEndMs, ...helpers, pollGapCapMs: 10 * 60_000 });
    // Cap 10min — só conta 10min, não 3h
    expect(buckets[0].secondsRunning).toBeCloseTo(10 * 60, 0);
  });
});
