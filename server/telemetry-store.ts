/**
 * Armazenamento da telemetria completa (tabelas telemetry_devices e
 * telemetry_samples). Separado do `db.ts` de propósito: nada aqui é lido
 * pelo control-engine.
 */

import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import { getDb } from "./db";
import { telemetryDevices, telemetrySamples, type TelemetryDevice } from "../drizzle/schema";
import type { DeviceKind, TelemetrySource } from "./telemetry-catalog";

export interface DeviceIdentity {
  siteId: number;
  source: TelemetrySource;
  externalId: string;
  kind: DeviceKind;
  devTypeId?: number | null;
  name?: string | null;
  model?: string | null;
  serial?: string | null;
  firmware?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Contrato mínimo usado pela captura — permite testar sem banco. */
export interface TelemetryStore {
  /** Garante que o equipamento existe e devolve o id; null se o banco estiver indisponível. */
  upsertDevice(identity: DeviceIdentity): Promise<number | null>;
  /** Grava a amostra. Devolve false se já existia uma com o mesmo instante (duplicata). */
  insertSample(deviceId: number, collectedAt: Date, data: Record<string, unknown>): Promise<boolean>;
}

const floorToSecond = (d: Date) => new Date(Math.floor(d.getTime() / 1000) * 1000);

export const dbTelemetryStore: TelemetryStore = {
  async upsertDevice(identity) {
    const db = await getDb();
    if (!db) return null;
    const where = and(eq(telemetryDevices.source, identity.source), eq(telemetryDevices.externalId, identity.externalId));
    const existing = await db.select().from(telemetryDevices).where(where).limit(1);
    if (existing.length > 0) {
      const cur = existing[0];
      // Preenche só o que chegou e ainda não tínhamos; nunca apaga um dado conhecido.
      const patch: Partial<typeof telemetryDevices.$inferInsert> = { lastSeenAt: new Date() };
      if (identity.name && identity.name !== cur.name) patch.name = identity.name;
      if (identity.model && identity.model !== cur.model) patch.model = identity.model;
      if (identity.serial && identity.serial !== cur.serial) patch.serial = identity.serial;
      if (identity.firmware && identity.firmware !== cur.firmware) patch.firmware = identity.firmware;
      if (identity.siteId !== cur.siteId) patch.siteId = identity.siteId;
      if (identity.kind !== cur.kind) patch.kind = identity.kind;
      await db.update(telemetryDevices).set(patch).where(eq(telemetryDevices.id, cur.id));
      return cur.id;
    }
    await db.insert(telemetryDevices).ignore().values({
      siteId: identity.siteId,
      source: identity.source,
      externalId: identity.externalId,
      kind: identity.kind,
      devTypeId: identity.devTypeId ?? null,
      name: identity.name ?? null,
      model: identity.model ?? null,
      serial: identity.serial ?? null,
      firmware: identity.firmware ?? null,
      meta: identity.meta ?? null,
      lastSeenAt: new Date(),
    });
    const created = await db.select({ id: telemetryDevices.id }).from(telemetryDevices).where(where).limit(1);
    return created[0]?.id ?? null;
  },

  async insertSample(deviceId, collectedAt, data) {
    const db = await getDb();
    if (!db) return false;
    const at = floorToSecond(collectedAt);
    const res = await db.insert(telemetrySamples).ignore().values({ deviceId, collectedAt: at, data });
    const inserted = ((res as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) > 0;
    if (inserted) {
      await db.update(telemetryDevices).set({ lastSampleAt: at, lastSeenAt: new Date() }).where(eq(telemetryDevices.id, deviceId));
    }
    return inserted;
  },
};

export async function listTelemetryDevices(siteId: number): Promise<TelemetryDevice[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(telemetryDevices).where(eq(telemetryDevices.siteId, siteId)).orderBy(asc(telemetryDevices.kind), asc(telemetryDevices.id));
}

export async function getTelemetryDevice(deviceId: number): Promise<TelemetryDevice | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(telemetryDevices).where(eq(telemetryDevices.id, deviceId)).limit(1);
  return rows[0] ?? null;
}

export async function getLatestSample(deviceId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(telemetrySamples).where(eq(telemetrySamples.deviceId, deviceId))
    .orderBy(desc(telemetrySamples.collectedAt)).limit(1);
  return rows[0] ?? null;
}

export async function getSampleHistory(deviceId: number, from: Date, to: Date, limit = 5000) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ collectedAt: telemetrySamples.collectedAt, data: telemetrySamples.data }).from(telemetrySamples)
    .where(and(eq(telemetrySamples.deviceId, deviceId), gte(telemetrySamples.collectedAt, from), lte(telemetrySamples.collectedAt, to)))
    .orderBy(asc(telemetrySamples.collectedAt)).limit(limit);
}

/** Apaga amostras mais antigas que `olderThan`. Devolve quantas saíram. */
export async function pruneTelemetrySamples(olderThan: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const res = await db.delete(telemetrySamples).where(lt(telemetrySamples.collectedAt, olderThan));
  return (res as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
}
