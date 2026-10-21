/**
 * Serve os PDFs da biblioteca de manuais, com login. O arquivo é resolvido
 * pelo id no banco (nunca por caminho do cliente) e confirmado dentro de
 * storage-data/manuals — sem travessia de diretório.
 */

import type { Express, Request, Response } from "express";
import { createReadStream, existsSync, statSync } from "node:fs";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { verifySession } from "./auth";
import { getManual, manualFilePath } from "./manuals-faults";

async function hasSession(req: Request): Promise<boolean> {
  try {
    const raw = req.headers.cookie;
    if (!raw) return false;
    const token = parseCookieHeader(raw)[COOKIE_NAME];
    return !!(await verifySession(token));
  } catch {
    return false;
  }
}

export function registerManualRoutes(app: Express, storageRoot: string): void {
  app.get("/api/manuals/:id/file", async (req: Request, res: Response) => {
    if (!(await hasSession(req))) { res.status(401).json({ error: "Sessão ausente ou expirada" }); return; }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "id inválido" }); return; }
    const manual = await getManual(id);
    if (!manual || !manual.isActive) { res.status(404).json({ error: "manual não encontrado" }); return; }
    const full = manualFilePath(storageRoot, manual.filename);
    if (!full || !existsSync(full)) { res.status(404).json({ error: "arquivo ausente" }); return; }
    res.setHeader("Content-Type", manual.mimeType || "application/pdf");
    res.setHeader("Content-Length", String(statSync(full).size));
    // inline: abre no visualizador do navegador; ?download=1 força baixar
    const safeName = `${manual.title.replace(/[^\w.-]+/g, "_").slice(0, 80)}.pdf`;
    res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${safeName}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    createReadStream(full).on("error", () => { if (!res.headersSent) res.status(500).end(); }).pipe(res);
  });
}
