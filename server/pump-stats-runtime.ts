/**
 * Distribuição do tempo EFETIVO de operação da bomba (loadHealth=RUNNING_OK)
 * pelos buckets temporais do gráfico de pumpStats.
 *
 * Convenção: cada leitura representa o estado VIGENTE entre o seu createdAt
 * e o createdAt da PRÓXIMA leitura. Se houver gap absurdo (poll perdido,
 * serviço down), aplica-se o `pollGapCapMs` pra não inflar o tempo.
 *
 * Função pura — fácil de testar com dados sintéticos.
 */

export interface ReadingPoint {
  createdAt: Date | string;
  loadHealth: string | null;
}

export interface BucketSlot {
  ts: number;            // ms epoch (início do bucket)
  secondsRunning: number;
}

export interface DistributeOptions {
  rangeEndMs: number;                  // limite final (now ou to.ms)
  bucketEndOf: (i: number) => number;  // retorna bucket[i+1].ts ou to.ms
  bucketIndexFor: (t: number) => number;
  pollGapCapMs?: number;               // default 30min
}

export const POLL_GAP_CAP_MS_DEFAULT = 30 * 60_000;

export function distributeRunningTime(
  readings: ReadingPoint[],
  buckets: BucketSlot[],
  opts: DistributeOptions,
): void {
  const cap = opts.pollGapCapMs ?? POLL_GAP_CAP_MS_DEFAULT;

  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    if (r.loadHealth !== "RUNNING_OK") continue;

    const startMs = (r.createdAt instanceof Date
      ? r.createdAt
      : new Date(r.createdAt as unknown as string)
    ).getTime();

    const next = readings[i + 1];
    const rawEndMs = next
      ? (next.createdAt instanceof Date
          ? next.createdAt
          : new Date(next.createdAt as unknown as string)
        ).getTime()
      : opts.rangeEndMs;

    const gap = rawEndMs - startMs;
    if (gap <= 0) continue;

    const endMs = startMs + Math.min(gap, cap);
    const startIdx = Math.max(0, opts.bucketIndexFor(startMs));
    const endIdx = Math.max(0, opts.bucketIndexFor(endMs - 1));

    for (let j = startIdx; j <= endIdx; j++) {
      const bs = buckets[j].ts;
      const be = opts.bucketEndOf(j);
      const segStart = Math.max(startMs, bs);
      const segEnd = Math.min(endMs, be);
      if (segEnd > segStart) {
        buckets[j].secondsRunning += (segEnd - segStart) / 1000;
      }
    }
  }
}

/**
 * Helper para construir buckets, bucketIndexFor e bucketEndOf coerentes —
 * usado por testes e (futuramente) pelo endpoint pra alinhar 100%.
 */
export function buildBucketHelpers(
  buckets: { ts: number }[],
  rangeEndMs: number,
): { bucketIndexFor: (t: number) => number; bucketEndOf: (i: number) => number } {
  const bucketIndexFor = (t: number): number => {
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (t >= buckets[i].ts) return i;
    }
    return -1;
  };
  const bucketEndOf = (i: number): number =>
    i + 1 < buckets.length ? buckets[i + 1].ts : rangeEndMs;
  return { bucketIndexFor, bucketEndOf };
}
