/**
 * Admin-only upload endpoints.
 *
 * Currently exposes:
 *   POST /api/admin/sites/:id/background  — upload de imagem ou vídeo
 *     - Imagens (jpg/png/webp, ≤25MB): salvas direto.
 *     - Vídeos (mp4/webm, ≤1GB): processados pelo ffmpeg —
 *       primeiros ~10s, max 1280px no maior lado, H.264, ~2-4 MB,
 *       áudio descartado (background é silencioso).
 *   DELETE /api/admin/sites/:id/background  — remove (apaga arquivo + zera coluna)
 *
 * Auth: cookie de sessão (mesmo do tRPC) + checagem `role === "admin"`.
 */
import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { verifySession } from "./auth";
import { getUserByOpenId, getSiteById, updateSiteById } from "./db";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;          // 25 MB pra imagens
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;        // 1 GB pra vídeos brutos
const VIDEO_TRIM_SECONDS = 30;                     // primeiros N segundos do vídeo
const VIDEO_MAX_DIM = 1280;                        // px no maior lado após processar
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;           // 5 min hard timeout pro processamento

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/webm"]);
const ALLOWED_MIMES = new Set([...IMAGE_MIMES, ...VIDEO_MIMES]);
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function getStorageRoot(): string {
  const override = process.env.STORAGE_DIR;
  if (override && override.trim().length > 0) return path.resolve(override.trim());
  return path.resolve(process.cwd(), "storage-data");
}

function sitesDir(): string {
  const dir = path.join(getStorageRoot(), "sites");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tmpDir(): string {
  const dir = path.join(getStorageRoot(), "tmp");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function requireAdmin(req: Request, res: Response): Promise<{ id: number } | null> {
  try {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
      res.status(401).json({ error: "Sessão ausente" });
      return null;
    }
    const cookies = parseCookieHeader(cookieHeader);
    const token = cookies[COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: "Sessão ausente" });
      return null;
    }
    const payload = await verifySession(token);
    if (!payload) {
      res.status(401).json({ error: "Sessão inválida" });
      return null;
    }
    const user = await getUserByOpenId(payload.openId);
    if (!user) {
      res.status(401).json({ error: "Usuário não encontrado" });
      return null;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "Acesso restrito a administradores" });
      return null;
    }
    if (user.disabled) {
      res.status(403).json({ error: "Usuário desativado" });
      return null;
    }
    return { id: user.id };
  } catch (e) {
    console.warn("[Upload] requireAdmin err:", e);
    res.status(500).json({ error: "Falha de autenticação" });
    return null;
  }
}

// disk storage para suportar arquivos grandes sem estourar RAM
const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir()),
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] ?? "bin";
    cb(null, `${crypto.randomUUID()}-tmp.${ext}`);
  },
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error(`Mime não suportado: ${file.mimetype}. Use JPG, PNG, WebP, MP4 ou WebM.`));
      return;
    }
    cb(null, true);
  },
});

function safeUnlink(absPath: string): void {
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch (e) {
    console.warn(`[Upload] safeUnlink falhou em ${absPath}:`, e);
  }
}

function backgroundUrlToAbsPath(url: string | null): string | null {
  if (!url) return null;
  const prefix = "/storage/sites/";
  if (!url.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  if (filename.includes("/") || filename.includes("..") || filename.includes("\\")) return null;
  return path.join(sitesDir(), filename);
}

/**
 * Processa um vídeo bruto: corta primeiros N segundos, redimensiona pra ≤1280px no maior lado,
 * recodifica em H.264 baixo bitrate, descarta áudio. Sai em ~2-4 MB pra clipe de 10s.
 *
 * Resolve com o caminho absoluto do arquivo otimizado (mp4) ou rejeita com Error.
 */
function processVideo(srcAbs: string, dstAbs: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Filtro de scale: se largura > altura, w=MAX e h=auto (pares); senão o oposto.
    // `force_original_aspect_ratio=decrease` garante que NUNCA aumenta resolução.
    const vf = `scale='min(${VIDEO_MAX_DIM},iw)':-2:force_original_aspect_ratio=decrease`;
    const args = [
      "-y",                       // sobrescreve sem perguntar
      "-i", srcAbs,
      "-t", String(VIDEO_TRIM_SECONDS),
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", "veryfast",      // tradeoff razoável de velocidade/tamanho
      "-crf", "22",               // qualidade visual alta, arquivo ainda enxuto
      "-pix_fmt", "yuv420p",      // máxima compatibilidade web
      "-movflags", "+faststart",  // permite começar a tocar antes do download completar
      "-an",                      // sem áudio (background silencioso)
      dstAbs,
    ];

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString().slice(0, 4096); });

    const killTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error(`ffmpeg timeout (${FFMPEG_TIMEOUT_MS / 1000}s)`));
    }, FFMPEG_TIMEOUT_MS);

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      reject(new Error(`Falha ao executar ffmpeg: ${err.message}. Está instalado? (sudo apt install ffmpeg)`));
    });
    proc.on("close", (code) => {
      clearTimeout(killTimer);
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exit ${code}. ${stderr.slice(-500)}`));
    });
  });
}

export function registerUploadRoutes(app: Express): void {
  function handleMulter(req: Request, res: Response, next: NextFunction) {
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: `Arquivo excede o limite (${MAX_VIDEO_BYTES / 1024 / 1024} MB)` });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof Error) return res.status(400).json({ error: err.message });
      next();
    });
  }

  app.post(
    "/api/admin/sites/:id/background",
    handleMulter,
    async (req, res) => {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const siteId = Number(req.params.id);
      if (!Number.isInteger(siteId) || siteId <= 0) {
        return res.status(400).json({ error: "siteId inválido" });
      }

      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) return res.status(400).json({ error: "Arquivo ausente (campo 'file')" });

      const site = await getSiteById(siteId);
      if (!site) {
        safeUnlink(file.path);
        return res.status(404).json({ error: "Site não encontrado" });
      }

      const isImage = IMAGE_MIMES.has(file.mimetype);
      const isVideo = VIDEO_MIMES.has(file.mimetype);

      // Limite secundário: imagens não podem usar a quota maior reservada pra vídeos.
      if (isImage && file.size > MAX_IMAGE_BYTES) {
        safeUnlink(file.path);
        return res.status(413).json({ error: `Imagem excede ${MAX_IMAGE_BYTES / 1024 / 1024} MB` });
      }

      try {
        let finalFilename: string;
        if (isVideo) {
          // Sempre sai como .mp4 (independente do input ser webm)
          finalFilename = `${crypto.randomUUID()}.mp4`;
          const finalAbs = path.join(sitesDir(), finalFilename);
          const sizeBeforeMb = (file.size / 1024 / 1024).toFixed(1);
          console.log(`[Upload] Processando vídeo de ${sizeBeforeMb} MB com ffmpeg…`);
          try {
            await processVideo(file.path, finalAbs);
          } catch (e: any) {
            safeUnlink(file.path);
            safeUnlink(finalAbs);
            return res.status(500).json({ error: `Falha ao processar vídeo: ${e.message}` });
          }
          const finalSizeMb = (fs.statSync(finalAbs).size / 1024 / 1024).toFixed(2);
          console.log(`[Upload] Vídeo otimizado: ${sizeBeforeMb} MB → ${finalSizeMb} MB`);
          safeUnlink(file.path); // remove o original gigante
        } else {
          // Imagem: só move do tmp pra sites/ com nome final
          const ext = EXT_BY_MIME[file.mimetype];
          if (!ext) {
            safeUnlink(file.path);
            return res.status(400).json({ error: "Mime não suportado" });
          }
          finalFilename = `${crypto.randomUUID()}.${ext}`;
          const finalAbs = path.join(sitesDir(), finalFilename);
          fs.renameSync(file.path, finalAbs);
        }

        // Cleanup do anterior, se existir
        const oldAbs = backgroundUrlToAbsPath(site.backgroundUrl ?? null);
        const newAbs = path.join(sitesDir(), finalFilename);
        if (oldAbs && oldAbs !== newAbs) safeUnlink(oldAbs);

        const publicUrl = `/storage/sites/${finalFilename}`;
        await updateSiteById(siteId, { backgroundUrl: publicUrl });

        res.json({ backgroundUrl: publicUrl });
      } catch (e: any) {
        safeUnlink(file.path);
        console.error("[Upload] erro inesperado:", e);
        res.status(500).json({ error: e.message ?? "Falha no upload" });
      }
    },
  );

  app.delete("/api/admin/sites/:id/background", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const siteId = Number(req.params.id);
    if (!Number.isInteger(siteId) || siteId <= 0) {
      return res.status(400).json({ error: "siteId inválido" });
    }

    const site = await getSiteById(siteId);
    if (!site) return res.status(404).json({ error: "Site não encontrado" });

    const oldAbs = backgroundUrlToAbsPath(site.backgroundUrl ?? null);
    if (oldAbs) safeUnlink(oldAbs);

    await updateSiteById(siteId, { backgroundUrl: null });
    res.json({ backgroundUrl: null });
  });
}
