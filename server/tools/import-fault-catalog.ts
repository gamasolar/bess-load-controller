/**
 * Importa o catálogo de falhas para a tabela `fault_catalog`:
 *   1. Códigos Huawei dos inversores — do CSV já transcrito dos manuais
 *      (Gama 360: ~/gama360-manuais/huawei/codigos.csv). O `codigo` é o mesmo
 *      Alarm ID que a FusionSolar devolve, então casa direto com os alarmes.
 *   2. Alarmes do SmartLogger3000 — da Tabela 2-2 (ALARM_BITS em
 *      smartlogger-map.ts). Nome + gravidade; a ação (passo a passo) fica
 *      pendente até entrar o manual do usuário do SmartLogger.
 *
 * Idempotente: apaga as linhas do escopo (manufacturer+equipmentKind) antes de
 * reinserir. Uso:
 *   set -a; . ./.env; set +a
 *   pnpm tsx server/tools/import-fault-catalog.ts [caminho/codigos.csv]
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { faultCatalog, type InsertFaultCatalogEntry } from "../../drizzle/schema";
import { ALARM_BITS, type AlarmSeverity } from "../smartlogger-map";

/** Parser CSV (RFC4180) com delimitador configurável. Lida com aspas, aspas duplicadas e quebras dentro do campo. */
export function parseCsv(text: string, delimiter = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // remove BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = ""; rows.push(row); row = [];
    } else if (c === "\r") {
      // ignora; o \n cuida da quebra
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const SEVERITY_MAP: Record<AlarmSeverity, string> = {
  Major: "major", Minor: "minor", Warning: "warning", Adaptable: "warning",
};

/** Normaliza a severidade vinda do CSV para o nosso vocabulário. */
function normSeverity(s: string): string | null {
  const v = s.trim().toLowerCase();
  if (["critical", "major", "minor", "warning"].includes(v)) return v;
  if (v === "adaptable") return "warning";
  return v || null;
}

/** Converte o CSV Huawei (inversores) em linhas de fault_catalog. Puro — testável. */
export function rowsFromHuaweiCsv(csvText: string): InsertFaultCatalogEntry[] {
  const rows = parseCsv(csvText, ";");
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const col = { fab: idx("fabricante"), fam: idx("familia"), mod: idx("modelos_cobertos"), cod: idx("codigo"),
    nome: idx("nome"), desc: idx("descricao"), causa: idx("causa_provavel"), acao: idx("acao"),
    sev: idx("severidade"), pdf: idx("fonte_pdf"), pag: idx("pagina") };
  const out: InsertFaultCatalogEntry[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < header.length || row.every((c) => c.trim() === "")) continue;
    const code = parseInt((row[col.cod] ?? "").trim(), 10);
    if (!Number.isInteger(code)) continue; // linha sem Alarm ID numérico
    out.push({
      manufacturer: (row[col.fab] || "Huawei").trim(),
      equipmentKind: "inverter",
      family: row[col.fam]?.trim() || null,
      modelsCovered: row[col.mod]?.trim() || null,
      code,
      subId: null,
      name: (row[col.nome] || `Alarme ${code}`).trim().slice(0, 255),
      description: row[col.desc]?.trim() || null,
      cause: row[col.causa]?.trim() || null,
      action: row[col.acao]?.trim() || null,
      severity: normSeverity(row[col.sev] ?? ""),
      sourcePdf: row[col.pdf]?.trim().slice(0, 255) || null,
      page: row[col.pag]?.trim().slice(0, 16) || null,
    });
  }
  return out;
}

/** Converte a Tabela 2-2 do SmartLogger (ALARM_BITS) em linhas de fault_catalog. */
export function rowsFromSmartlogger(): InsertFaultCatalogEntry[] {
  const seen = new Set<string>();
  const out: InsertFaultCatalogEntry[] = [];
  for (const a of ALARM_BITS) {
    const key = `${a.alarmId}/${a.subId}`;
    if (seen.has(key)) continue; // o mesmo (alarmId,subId) pode aparecer em bits diferentes
    seen.add(key);
    out.push({
      manufacturer: "Huawei",
      equipmentKind: "smartlogger",
      family: "SmartLogger3000 ModBus Interface Definitions (Issue 47), Tabela 2-2",
      modelsCovered: "SmartLogger3000",
      code: a.alarmId,
      subId: a.subId,
      name: a.label.slice(0, 255),
      description: `Registrador ${a.register}, bit ${a.bit}${a.relevant ? " — relevante para planta off-grid com ESS" : ""}`,
      cause: null,
      action: null, // pendente: manual do usuário do SmartLogger3000
      severity: SEVERITY_MAP[a.severity] ?? "warning",
      sourcePdf: null,
      page: null,
    });
  }
  return out;
}

async function main() {
  const csvPath = process.argv[2] || path.join(os.homedir(), "gama360-manuais", "huawei", "codigos.csv");
  const db = await getDb();
  if (!db) throw new Error("DB indisponível (DATABASE_URL?)");

  let invRows: InsertFaultCatalogEntry[] = [];
  try {
    invRows = rowsFromHuaweiCsv(readFileSync(csvPath, "utf8"));
  } catch (e) {
    console.warn(`[import] não li o CSV dos inversores em ${csvPath}: ${e instanceof Error ? e.message : e}`);
  }
  const slRows = rowsFromSmartlogger();

  // Idempotência: limpa os escopos antes de reinserir.
  await db.delete(faultCatalog).where(and(eq(faultCatalog.manufacturer, "Huawei"), eq(faultCatalog.equipmentKind, "inverter")));
  await db.delete(faultCatalog).where(and(eq(faultCatalog.manufacturer, "Huawei"), eq(faultCatalog.equipmentKind, "smartlogger")));

  const insertChunked = async (rows: InsertFaultCatalogEntry[]) => {
    for (let i = 0; i < rows.length; i += 100) await db.insert(faultCatalog).values(rows.slice(i, i + 100));
  };
  if (invRows.length) await insertChunked(invRows);
  if (slRows.length) await insertChunked(slRows);

  console.log(`[import] inversores: ${invRows.length} linhas | SmartLogger: ${slRows.length} linhas | total ${invRows.length + slRows.length}`);
}

// roda só quando chamado direto (não quando importado por um teste)
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
