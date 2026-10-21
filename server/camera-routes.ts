/**
 * Rotas HTTP/WebSocket das câmeras (fora do tRPC porque são binárias):
 *
 *   GET /api/camera/:id/photo.jpg   foto nativa da câmera (resolução cheia)
 *   GET /api/camera/:id/frame.jpg   quadro do fluxo leve, para cartões e miniaturas
 *   *   /api/camera/g/<x>           proxy para a API do go2rtc (ws, hls, stream.mp4…)
 *
 * Todas exigem a sessão do app (mesmo cookie do tRPC). O go2rtc só escuta em
 * 127.0.0.1 e nunca é exposto direto.
 */

import type { Express, Request, Response } from "express";
import type { Server, IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import type { Duplex } from "node:stream";
import { connect } from "node:net";
import { createHash } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { verifySession } from "./auth";
import { endpoints, getCamera, streamNames } from "./camera-store";
import { GO2RTC_PORT } from "./camera-stream";

/** Só estes caminhos do go2rtc passam pelo proxy. */
const ALLOWED = new Set(["ws", "hls/playlist.m3u8", "hls/init.mp4", "hls/segment.m4s", "hls/segment.ts", "stream.mp4", "stream.mjpeg", "frame.jpeg", "streams"]);

async function sessionFromHeaders(headers: IncomingMessage["headers"]): Promise<boolean> {
  try {
    const raw = headers.cookie;
    if (!raw) return false;
    const token = parseCookieHeader(raw)[COOKIE_NAME];
    const payload = await verifySession(token);
    return !!payload;
  } catch {
    return false;
  }
}

async function requireSession(req: Request, res: Response): Promise<boolean> {
  if (await sessionFromHeaders(req.headers)) return true;
  res.status(401).json({ error: "Sessão ausente ou expirada" });
  return false;
}

/** GET com autenticação Digest (RFC 2617), como as câmeras IP costumam exigir. */
export async function fetchDigest(url: string, username: string, password: string, timeoutMs = 15_000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const first = await fetch(url, { signal: controller.signal });
    const challenge = first.headers.get("www-authenticate");
    if (first.status !== 401 || !challenge || !/^Digest/i.test(challenge)) return first;
    await first.arrayBuffer().catch(() => undefined);
    const p: Record<string, string> = {};
    for (const m of Array.from(challenge.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g))) p[m[1].toLowerCase()] = m[2] ?? m[3];
    const u = new URL(url);
    const uri = u.pathname + u.search;
    const md5 = (s: string) => createHash("md5").update(s).digest("hex");
    const ha1 = md5(`${username}:${p.realm ?? ""}:${password}`);
    const ha2 = md5(`GET:${uri}`);
    const nc = "00000001";
    const cnonce = md5(String(Math.random())).slice(0, 16);
    const qop = p.qop ? p.qop.split(",")[0].trim() : "";
    const response = qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
    const auth = `Digest username="${username}", realm="${p.realm ?? ""}", nonce="${p.nonce ?? ""}", uri="${uri}", response="${response}"` +
      (qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : "") + (p.opaque ? `, opaque="${p.opaque}"` : "") + (p.algorithm ? `, algorithm=${p.algorithm}` : "");
    return await fetch(url, { headers: { Authorization: auth }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Pede um quadro JPEG ao go2rtc (do fluxo leve). */
export async function grabFrame(streamName: string, timeoutMs = 12_000): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${GO2RTC_PORT}/api/frame.jpeg?src=${encodeURIComponent(streamName)}`, { signal: controller.signal });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function registerCameraRoutes(app: Express, server: Server): void {
  // Foto nativa (4K na Barragem): download/visualização em tela cheia.
  app.get("/api/camera/:id/photo.jpg", async (req, res) => {
    if (!(await requireSession(req, res))) return;
    const cam = await getCamera(Number(req.params.id));
    if (!cam || !cam.isActive) { res.status(404).json({ error: "Câmera não encontrada" }); return; }
    try {
      const r = await fetchDigest(endpoints(cam).snapshotUrl, cam.username, cam.password);
      if (!r.ok) { res.status(502).json({ error: `câmera respondeu ${r.status}` }); return; }
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", r.headers.get("content-type") ?? "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      if (req.query.download === "1") res.setHeader("Content-Disposition", `attachment; filename="${cam.name.replace(/[^\w-]+/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg"`);
      res.end(buf);
    } catch (e) {
      res.status(504).json({ error: `câmera não respondeu (${e instanceof Error ? e.message : e})` });
    }
  });

  // Quadro leve do fluxo secundário, para cartões/miniaturas.
  app.get("/api/camera/:id/frame.jpg", async (req, res) => {
    if (!(await requireSession(req, res))) return;
    const cam = await getCamera(Number(req.params.id));
    if (!cam || !cam.isActive) { res.status(404).json({ error: "Câmera não encontrada" }); return; }
    const buf = await grabFrame(streamNames(cam.id).sub);
    if (!buf) { res.status(504).json({ error: "sem quadro do fluxo" }); return; }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.end(buf);
  });

  // Proxy HTTP para o go2rtc (HLS, MP4, MJPEG, frame).
  app.use("/api/camera/g", async (req, res) => {
    if (!(await requireSession(req, res))) return;
    const target = req.url.replace(/^\//, "");
    const pathOnly = target.split("?")[0];
    if (!ALLOWED.has(pathOnly) || pathOnly === "ws") { res.status(404).json({ error: "rota não permitida" }); return; }
    const upstream = httpRequest({ host: "127.0.0.1", port: GO2RTC_PORT, path: `/api/${target}`, method: "GET", headers: { accept: req.headers.accept ?? "*/*", range: req.headers.range ?? "" } }, (up) => {
      res.status(up.statusCode ?? 502);
      for (const [k, v] of Object.entries(up.headers)) if (v && !/^(connection|transfer-encoding)$/i.test(k)) res.setHeader(k, v as string);
      res.setHeader("Cache-Control", "no-store");
      up.pipe(res);
      req.on("close", () => up.destroy());
    });
    upstream.on("error", () => { if (!res.headersSent) res.status(502).json({ error: "vídeo indisponível" }); else res.end(); });
    upstream.end();
  });

  // WebSocket (MSE/MJPEG) → go2rtc /api/ws. Encaminhamento cru do socket.
  server.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/camera/g/ws")) return; // outros upgrades (Vite HMR) seguem o caminho normal
    if (!(await sessionFromHeaders(req.headers))) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const upstream = connect(GO2RTC_PORT, "127.0.0.1");
    upstream.on("connect", () => {
      const path = url.replace("/api/camera/g/ws", "/api/ws");
      const skip = /^(host|origin|cookie)$/i;
      const headers = Object.entries(req.headers).filter(([k]) => !skip.test(k)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
      upstream.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${GO2RTC_PORT}\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const bye = () => { socket.destroy(); upstream.destroy(); };
    upstream.on("error", bye);
    socket.on("error", bye);
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
  });
}
