import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export interface BackgroundUploadSite {
  id: number;
  backgroundUrl: string | null;
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm)$/i.test(url);
}

type Phase = "idle" | "compressing" | "trimming" | "uploading" | "processing";

export function BackgroundUpload({ site, onChanged }: { site: BackgroundUploadSite; onChanged?: () => void }) {
  const utils = trpc.useUtils();
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [uploadedMb, setUploadedMb] = useState(0);
  const [totalMb, setTotalMb] = useState(0);
  const [preview, setPreview] = useState<string | null>(site.backgroundUrl);

  function uploadWithProgress(siteId: number, blob: Blob, name: string, onUploadProgress: (loaded: number, total: number) => void) {
    return new Promise<{ backgroundUrl: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/admin/sites/${siteId}/background`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onUploadProgress(e.loaded, e.total); };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new Error(body?.error ?? `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Falha de rede no upload"));
      xhr.ontimeout = () => reject(new Error("Timeout no upload"));
      const fd = new FormData();
      fd.append("file", blob, name);
      xhr.send(fd);
    });
  }

  async function handleFile(file: File) {
    const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    const isVideo = ["video/mp4", "video/webm"].includes(file.type);
    if (!isImage && !isVideo) {
      toast.error("Formato não suportado. Use JPG, PNG, WebP, MP4 ou WebM.");
      return;
    }
    if (isImage && file.size > 25 * 1024 * 1024) { toast.error("Imagem excede 25 MB."); return; }
    if (isVideo && file.size > 1024 * 1024 * 1024) { toast.error("Vídeo excede 1 GB."); return; }
    setPercent(0); setUploadedMb(0); setTotalMb(file.size / 1024 / 1024);
    try {
      let processed: File = file;
      if (isImage) {
        setPhase("compressing");
        processed = await compressImage(file).catch(() => file);
      } else if (isVideo) {
        setPhase("trimming");
        try {
          processed = await trimVideoInBrowser(file, 30, (progress) => setPercent(progress));
        } catch (e: any) {
          toast.error(`Falha ao cortar vídeo no browser: ${e.message}.`);
          setPhase("idle"); return;
        }
      }
      const sizeBefore = (file.size / 1024 / 1024).toFixed(1);
      const sizeAfter = (processed.size / 1024 / 1024).toFixed(2);
      setTotalMb(processed.size / 1024 / 1024); setPercent(0);
      setPhase("uploading");
      const data = await uploadWithProgress(site.id, processed, processed.name, (loaded, total) => {
        const pct = Math.min(99, Math.round((loaded / total) * 100));
        setPercent(pct); setUploadedMb(loaded / 1024 / 1024);
        if (loaded >= total) setPhase("processing");
      });
      setPercent(100); setPreview(data.backgroundUrl);
      toast.success(
        isVideo
          ? `Vídeo cortado em 30s e otimizado (${sizeBefore} MB → ${sizeAfter} MB enviado)`
          : processed === file ? "Imagem enviada"
          : `Imagem otimizada e enviada (${sizeBefore} MB → ${sizeAfter} MB)`,
      );
      onChanged?.();
      utils.bess.sites.invalidate();
      utils.bess.getSiteStatus.invalidate();
    } catch (e: any) {
      toast.error(e.message || "Falha no upload");
    } finally {
      setPhase("idle"); setPercent(0); setUploadedMb(0); setTotalMb(0);
    }
  }

  async function handleRemove() {
    setPhase("processing");
    try {
      const res = await fetch(`/api/admin/sites/${site.id}/background`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setPreview(null);
      toast.success("Imagem removida");
      onChanged?.();
      utils.bess.sites.invalidate();
      utils.bess.getSiteStatus.invalidate();
    } catch (e: any) {
      toast.error(e.message || "Falha ao remover");
    } finally {
      setPhase("idle");
    }
  }

  const uploading = phase !== "idle";

  return (
    <div className="flex items-start gap-3">
      <div className={`relative w-32 h-20 rounded-md border-2 border-dashed border-white/10 bg-black/30 overflow-hidden flex items-center justify-center shrink-0 ${preview ? "" : "hover:border-white/20 transition-colors"}`}>
        {preview ? (
          isVideoUrl(preview)
            ? <video src={preview} muted autoPlay loop playsInline className="w-full h-full object-cover" />
            : <img src={preview} alt="Preview" className="w-full h-full object-cover" />
        ) : <ImagePlus className="w-6 h-6 text-zinc-600" />}
      </div>
      <div className="flex-1 space-y-2">
        <div className="flex gap-2">
          <Label htmlFor={`bg-${site.id}`} className="cursor-pointer">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 bg-zinc-800/60 hover:bg-zinc-800 text-xs font-medium transition-colors">
              <ImagePlus className="w-3.5 h-3.5" />
              {preview ? "Trocar" : "Enviar imagem ou vídeo"}
            </span>
          </Label>
          <input id={`bg-${site.id}`} type="file"
                 accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                 className="hidden" disabled={uploading}
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = ""; }} />
          {preview && (
            <Button variant="ghost" size="sm" onClick={handleRemove} disabled={uploading}
                    className="gap-1.5 h-8 text-red-400 hover:text-red-300">
              <Trash2 className="w-3.5 h-3.5" /> Remover
            </Button>
          )}
        </div>
        {phase !== "idle" && (
          <div className="space-y-1">
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div className={`h-full transition-all ${phase === "processing" ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`}
                   style={{ width: phase === "compressing" ? "5%" : phase === "processing" ? "100%" : `${percent}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              {phase === "compressing" && "Comprimindo imagem…"}
              {phase === "trimming" && `Cortando 30s do vídeo no browser… ${percent}%`}
              {phase === "uploading" && `Enviando ${uploadedMb.toFixed(1)} / ${totalMb.toFixed(1)} MB · ${percent}%`}
              {phase === "processing" && "Servidor otimizando vídeo (ffmpeg)…"}
            </p>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          JPG / PNG / WebP até 25 MB · MP4 / WebM (vídeo é cortado em 30s e otimizado).
          Aplicada como fundo do card no dashboard.
        </p>
      </div>
    </div>
  );
}

async function compressImage(file: File): Promise<File> {
  const MAX_DIM = 2560; const QUALITY = 0.92;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("Imagem inválida")); i.src = dataUrl;
  });
  const longest = Math.max(img.width, img.height);
  const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
  const w = Math.round(img.width * scale); const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas não suportado");
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", QUALITY));
  if (!blob) throw new Error("Falha ao gerar JPEG");
  if (blob.size >= file.size && scale === 1) return file;
  const newName = file.name.replace(/\.(jpe?g|png|webp)$/i, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg", lastModified: Date.now() });
}

async function trimVideoInBrowser(file: File, durationSec: number, onProgress: (pct: number) => void): Promise<File> {
  if (typeof MediaRecorder === "undefined") throw new Error("Browser não suporta MediaRecorder");
  const url = URL.createObjectURL(file);
  const video = document.createElement("video"); video.src = url; video.muted = true; video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Não foi possível ler o vídeo"));
  });
  const MAX_DIM = 1280;
  const longest = Math.max(video.videoWidth, video.videoHeight);
  const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
  const w = Math.round(video.videoWidth * scale / 2) * 2;
  const h = Math.round(video.videoHeight * scale / 2) * 2;
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) { URL.revokeObjectURL(url); throw new Error("Canvas indisponível"); }
  const stream = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(30);
  if (!stream) { URL.revokeObjectURL(url); throw new Error("captureStream indisponível neste browser"); }
  const mimeCandidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = []; recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  await new Promise<void>((resolve, reject) => {
    recorder.onerror = (e: any) => reject(new Error(`MediaRecorder: ${e?.error?.name ?? "erro"}`));
    recorder.onstop = () => resolve();
    let stopped = false; const startTime = performance.now();
    function drawLoop() {
      if (stopped) return;
      const elapsed = (performance.now() - startTime) / 1000;
      onProgress(Math.min(99, Math.round((elapsed / durationSec) * 100)));
      ctx!.drawImage(video, 0, 0, w, h);
      if (elapsed >= durationSec || video.ended) {
        stopped = true; try { video.pause(); } catch {} try { recorder.stop(); } catch {} return;
      }
      requestAnimationFrame(drawLoop);
    }
    video.currentTime = 0;
    video.play().then(() => { recorder.start(); drawLoop(); }).catch(reject);
  });
  URL.revokeObjectURL(url);
  const blob = new Blob(chunks, { type: "video/webm" });
  const newName = file.name.replace(/\.(mp4|webm|mov|avi)$/i, "") + "-trim10.webm";
  return new File([blob], newName, { type: "video/webm", lastModified: Date.now() });
}
