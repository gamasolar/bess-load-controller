/**
 * API de leitura da telemetria completa (tRPC). Só consulta; não comanda nada.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "./_core/trpc";
import { getSiteBySlug } from "./db";
import { describeSample, summarize, type DeviceKind, type TelemetryPoint, type TelemetrySource } from "./telemetry-catalog";
import { getLatestSample, getSampleHistory, getTelemetryDevice, listTelemetryDevices } from "./telemetry-store";

const MAX_HISTORY_POINTS = 600;

/** Reduz uma série a no máximo `max` pontos, mantendo o primeiro e o último. */
export function downsample<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const out: T[] = [];
  const step = (rows.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(rows[Math.round(i * step)]);
  return out;
}

export interface DeviceView {
  id: number;
  kind: DeviceKind;
  source: TelemetrySource;
  externalId: string;
  name: string | null;
  model: string | null;
  serial: string | null;
  firmware: string | null;
  lastSampleAt: Date | null;
  /** Idade da última amostra em segundos; null se nunca houve amostra. */
  ageSeconds: number | null;
  points: TelemetryPoint[];
  summary: ReturnType<typeof summarize>;
}

export async function buildSiteTelemetry(siteId: number, now = new Date()): Promise<DeviceView[]> {
  const devices = await listTelemetryDevices(siteId);
  const views: DeviceView[] = [];
  for (const d of devices) {
    const latest = await getLatestSample(d.id);
    const kind = d.kind as DeviceKind;
    const points = latest ? describeSample(d.source, kind, (latest.data ?? {}) as Record<string, unknown>) : [];
    views.push({
      id: d.id,
      kind,
      source: d.source,
      externalId: d.externalId,
      name: d.name,
      model: d.model,
      serial: d.serial,
      firmware: d.firmware,
      lastSampleAt: latest?.collectedAt ?? null,
      ageSeconds: latest ? Math.max(0, Math.round((now.getTime() - new Date(latest.collectedAt).getTime()) / 1000)) : null,
      points,
      summary: summarize(points),
    });
  }
  return views;
}

export const telemetryRouter = router({
  /** Todos os equipamentos de uma planta, com a última leitura completa de cada um. */
  site: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(32) }))
    .query(async ({ input }) => {
      const site = await getSiteBySlug(input.slug);
      if (!site) throw new TRPCError({ code: "NOT_FOUND", message: "Planta não encontrada" });
      return { siteId: site.id, slug: site.slug, name: site.name, devices: await buildSiteTelemetry(site.id) };
    }),

  /** Série histórica de até 12 campos de um equipamento. */
  history: publicProcedure
    .input(z.object({
      deviceId: z.number().int().positive(),
      hours: z.number().min(1).max(24 * 31).default(24),
      keys: z.array(z.string().min(1).max(64)).min(1).max(12),
    }))
    .query(async ({ input }) => {
      const device = await getTelemetryDevice(input.deviceId);
      if (!device) throw new TRPCError({ code: "NOT_FOUND", message: "Equipamento não encontrado" });
      const to = new Date();
      const from = new Date(to.getTime() - input.hours * 3600_000);
      const rows = downsample(await getSampleHistory(device.id, from, to), MAX_HISTORY_POINTS);
      const kind = device.kind as DeviceKind;
      const meta = new Map<string, { label: string; unit: string }>();
      const series = rows.map((row) => {
        const points = describeSample(device.source, kind, (row.data ?? {}) as Record<string, unknown>);
        const byKey = new Map(points.map((p) => [p.rawKey, p]));
        const values: Record<string, number | null> = {};
        for (const key of input.keys) {
          const p = byKey.get(key);
          if (p && !meta.has(key)) meta.set(key, { label: p.label, unit: p.unit });
          values[key] = p && typeof p.value === "number" ? p.value : null;
        }
        return { t: new Date(row.collectedAt).getTime(), values };
      });
      return {
        deviceId: device.id,
        keys: input.keys.map((k) => ({ rawKey: k, label: meta.get(k)?.label ?? k, unit: meta.get(k)?.unit ?? "" })),
        series,
      };
    }),
});
