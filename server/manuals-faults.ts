/**
 * Biblioteca de manuais + catálogo de falhas: consulta (tabelas
 * `equipment_manuals` e `fault_catalog`) e a "interpretação" que casa uma
 * falha coletada com a entrada do manual (causa + solução).
 *
 * Fonte dos dados: `server/tools/import-fault-catalog.ts` (inversores Huawei +
 * SmartLogger) e o registro dos PDFs em storage-data/manuals. Camada de
 * leitura/consulta; não toca no controle da bomba.
 */

import path from "node:path";
import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { equipmentManuals, faultCatalog, type EquipmentManual, type FaultCatalogEntry } from "../drizzle/schema";

export async function listManuals(): Promise<EquipmentManual[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(equipmentManuals)
    .where(eq(equipmentManuals.isActive, true))
    .orderBy(asc(equipmentManuals.equipmentKind), asc(equipmentManuals.manufacturer), asc(equipmentManuals.title));
}

export async function getManual(id: number): Promise<EquipmentManual | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(equipmentManuals).where(eq(equipmentManuals.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Caminho absoluto do PDF de um manual, garantido dentro de storage-data/manuals (sem traversal). */
export function manualFilePath(storageRoot: string, filename: string): string | null {
  const base = path.resolve(storageRoot, "manuals");
  const full = path.resolve(base, filename);
  // o filename vem do banco, mas confirmamos que resolve dentro da pasta
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

export interface FaultFilter {
  manufacturer?: string;
  equipmentKind?: string;
  code?: number;
  q?: string;
  limit?: number;
}

export async function listFaults(f: FaultFilter = {}): Promise<FaultCatalogEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [];
  if (f.manufacturer) conds.push(eq(faultCatalog.manufacturer, f.manufacturer));
  if (f.equipmentKind) conds.push(eq(faultCatalog.equipmentKind, f.equipmentKind));
  if (typeof f.code === "number") conds.push(eq(faultCatalog.code, f.code));
  if (f.q && f.q.trim()) {
    const term = `%${f.q.trim()}%`;
    conds.push(or(like(faultCatalog.name, term), like(faultCatalog.cause, term), like(faultCatalog.action, term)));
  }
  const where = conds.length ? and(...conds) : undefined;
  const base = db.select().from(faultCatalog);
  const q = where ? base.where(where) : base;
  return q.orderBy(asc(faultCatalog.code), asc(faultCatalog.subId)).limit(Math.min(Math.max(f.limit ?? 500, 1), 2000));
}

/**
 * Procura a(s) entrada(s) do catálogo para um código de alarme. Quando há
 * `subId`, prioriza o casamento exato; senão devolve a linha única (subId
 * nulo) ou todas as do código.
 */
export async function lookupByCode(code: number, opts: { manufacturer?: string; subId?: number | null } = {}): Promise<FaultCatalogEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(faultCatalog.code, code)];
  if (opts.manufacturer) conds.push(eq(faultCatalog.manufacturer, opts.manufacturer));
  const rows = await db.select().from(faultCatalog).where(and(...conds)).orderBy(asc(faultCatalog.equipmentKind), asc(faultCatalog.subId));
  if (rows.length <= 1 || opts.subId == null) return rows;
  const exact = rows.filter((r) => r.subId === opts.subId);
  return exact.length ? exact : rows.filter((r) => r.subId == null).concat(rows);
}

/** Extrai {code, subId} de um tipo de alarme do nosso banco (ex.: "HUAWEI_2032", "HUAWEI_2032_1"). Puro — testável. */
export function parseAlarmType(type: string): { code: number; subId: number | null } | null {
  const m = /^HUAWEI_(\d+)(?:_(\d+))?$/.exec(type.trim());
  if (!m) return null;
  return { code: Number(m[1]), subId: m[2] !== undefined ? Number(m[2]) : null };
}

export interface EnrichedAlarm {
  type: string;
  /** A melhor entrada do catálogo para esse alarme, ou null se não há transcrição. */
  fault: FaultCatalogEntry | null;
  /** Demais entradas (outras causas do mesmo código), quando houver. */
  others: FaultCatalogEntry[];
}

/** Dado o `type` de um alarme coletado, devolve a interpretação do manual (causa + solução). */
export async function interpretAlarmType(type: string): Promise<EnrichedAlarm> {
  const parsed = parseAlarmType(type);
  if (!parsed) return { type, fault: null, others: [] };
  const rows = await lookupByCode(parsed.code, { manufacturer: "Huawei", subId: parsed.subId });
  if (rows.length === 0) return { type, fault: null, others: [] };
  const [first, ...rest] = rows;
  return { type, fault: first, others: rest };
}

/** Contagem do catálogo por tipo de equipamento e quantos têm solução transcrita — para o cabeçalho da aba. */
export async function faultCatalogStats(): Promise<Array<{ equipmentKind: string; total: number; withSolution: number }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    equipmentKind: faultCatalog.equipmentKind,
    total: sql<number>`count(*)`,
    withSolution: sql<number>`sum(case when ${faultCatalog.action} is not null then 1 else 0 end)`,
  }).from(faultCatalog).groupBy(faultCatalog.equipmentKind);
  return rows.map((r) => ({ equipmentKind: r.equipmentKind, total: Number(r.total), withSolution: Number(r.withSolution) }));
}
