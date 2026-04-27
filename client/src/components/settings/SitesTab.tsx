import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Battery, Power, AlertTriangle, ImagePlus, Trash2, MapPin } from "lucide-react";
import { GoogleMapPicker } from "./GoogleMapPicker";
import { toast } from "sonner";

type Site = {
  id: number; slug: string; name: string; description: string | null;
  bessCount: number; bessCapacityKwh: number; bessModel: string;
  pumpCount: number; pumpPowerCv: number; pumpDescription: string | null;
  controlMode: string; mqttTopic: string;
  fusionsolarPlantCode: string;
  fusionsolarDeviceIds: string;
  fusionsolarInverterIds: string;
  backgroundUrl: string | null;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
};

export function SitesTab() {
  const utils = trpc.useUtils();
  const { data: sites, isLoading } = trpc.sites.list.useQuery(undefined, { refetchInterval: 30_000 });
  const [editing, setEditing] = useState<Site | null>(null);

  const setActive = trpc.sites.setActive.useMutation({
    onSuccess: (res) => {
      toast.success(res.isActive ? "Site reativado — voltará ao dashboard" : "Site desativado — sumiu do dashboard e API");
      utils.sites.list.invalidate();
      utils.bess.sites.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando sites…</p>;
  }
  if (!sites?.length) {
    return <p className="text-sm text-muted-foreground">Nenhum site cadastrado.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Gerenciamento de sites BESS. Desativar um site oculta o card do dashboard e
        pausa todas as chamadas FusionSolar/MQTT/control. Reativar é instantâneo.
      </p>

      <div className="space-y-2">
        {sites.map((s) => (
          <Card key={s.id} className={s.isActive ? "border-white/10" : "border-zinc-800/60 bg-zinc-900/30"}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Battery className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-semibold truncate">{s.name}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">{s.slug}</Badge>
                    {s.isActive ? (
                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">ATIVO</Badge>
                    ) : (
                      <Badge variant="outline" className="text-zinc-500 text-[10px]">DESATIVADO</Badge>
                    )}
                  </div>
                  {s.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                    <span>BESS: {s.bessCount}× {s.bessModel} ({s.bessCapacityKwh} kWh ea.)</span>
                    <span>Bomba: {s.pumpCount}× {s.pumpPowerCv} CV</span>
                    <span>FusionSolar: {s.fusionsolarPlantCode ? `✓ ${s.fusionsolarPlantCode}` : "—"}</span>
                    <span>MQTT: {s.mqttTopic || "—"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost" size="sm" onClick={() => setEditing(s)}
                    className="gap-1.5 h-8"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </Button>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/5 bg-black/20">
                    <Power className={`w-3.5 h-3.5 ${s.isActive ? "text-emerald-400" : "text-zinc-500"}`} />
                    <Switch
                      checked={s.isActive}
                      onCheckedChange={(checked) => setActive.mutate({ id: s.id, isActive: checked })}
                      disabled={setActive.isPending}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing && <EditSiteDialog site={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditSiteDialog({ site, onClose }: { site: Site; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: site.name,
    description: site.description ?? "",
    bessCount: site.bessCount,
    bessCapacityKwh: site.bessCapacityKwh,
    bessModel: site.bessModel,
    pumpCount: site.pumpCount,
    pumpPowerCv: site.pumpPowerCv,
    pumpDescription: site.pumpDescription ?? "",
    mqttTopic: site.mqttTopic,
    fusionsolarPlantCode: site.fusionsolarPlantCode,
    fusionsolarDeviceIds: site.fusionsolarDeviceIds,
    fusionsolarInverterIds: site.fusionsolarInverterIds,
    lat: site.lat,
    lng: site.lng,
  });

  const update = trpc.sites.update.useMutation({
    onSuccess: () => {
      toast.success("Site atualizado");
      utils.sites.list.invalidate();
      utils.bess.sites.invalidate();
      utils.bess.getSiteStatus.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar {site.name}</DialogTitle>
          <DialogDescription>
            Slug <code className="text-xs bg-zinc-800 px-1 rounded">{site.slug}</code> não pode ser alterado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea id="description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" />
            </div>
          </div>

          <div className="border-t border-white/5 pt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">BESS</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="bessCount">Quant.</Label>
                <Input id="bessCount" type="number" min={1} max={64} value={form.bessCount} onChange={(e) => setForm({ ...form, bessCount: Number(e.target.value) })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="bessCapacityKwh">Capacidade (kWh ea.)</Label>
                <Input id="bessCapacityKwh" type="number" step="0.1" value={form.bessCapacityKwh} onChange={(e) => setForm({ ...form, bessCapacityKwh: Number(e.target.value) })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="bessModel">Modelo</Label>
                <Input id="bessModel" value={form.bessModel} onChange={(e) => setForm({ ...form, bessModel: e.target.value })} className="mt-1" />
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Bomba</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pumpCount">Quant.</Label>
                <Input id="pumpCount" type="number" min={0} max={32} value={form.pumpCount} onChange={(e) => setForm({ ...form, pumpCount: Number(e.target.value) })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="pumpPowerCv">Potência (CV)</Label>
                <Input id="pumpPowerCv" type="number" step="0.1" value={form.pumpPowerCv} onChange={(e) => setForm({ ...form, pumpPowerCv: Number(e.target.value) })} className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="pumpDescription">Descrição</Label>
                <Input id="pumpDescription" value={form.pumpDescription} onChange={(e) => setForm({ ...form, pumpDescription: e.target.value })} className="mt-1" />
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Integrações</p>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label htmlFor="mqttTopic">MQTT Topic (Sonoff)</Label>
                <Input id="mqttTopic" value={form.mqttTopic} placeholder="bess/barragem/pump" onChange={(e) => setForm({ ...form, mqttTopic: e.target.value })} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label htmlFor="fusionsolarPlantCode">FusionSolar Plant Code</Label>
                <Input id="fusionsolarPlantCode" value={form.fusionsolarPlantCode} onChange={(e) => setForm({ ...form, fusionsolarPlantCode: e.target.value })} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label htmlFor="fusionsolarDeviceIds">Device IDs (CSV)</Label>
                <Input id="fusionsolarDeviceIds" value={form.fusionsolarDeviceIds} onChange={(e) => setForm({ ...form, fusionsolarDeviceIds: e.target.value })} className="mt-1 font-mono text-xs" placeholder="2070XXXXX,2070YYYYY" />
              </div>
              <div>
                <Label htmlFor="fusionsolarInverterIds">Inverter IDs (CSV)</Label>
                <Input id="fusionsolarInverterIds" value={form.fusionsolarInverterIds} onChange={(e) => setForm({ ...form, fusionsolarInverterIds: e.target.value })} className="mt-1 font-mono text-xs" />
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" /> Localização da unidade
            </p>
            <GoogleMapPicker
              lat={form.lat}
              lng={form.lng}
              onChange={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))}
            />
          </div>

          <div className="border-t border-white/5 pt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Imagem de fundo (card no dashboard)</p>
            <BackgroundUpload site={site} onChanged={() => utils.sites.list.invalidate()} />
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200/80">
              Mudanças em integrações (MQTT/FusionSolar) afetam o controle em produção.
              Validar conexões antes de salvar em sites ativos.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => update.mutate({ id: site.id, ...form })} disabled={update.isPending}>
            {update.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm)$/i.test(url);
}

type Phase = "idle" | "compressing" | "trimming" | "uploading" | "processing";

function BackgroundUpload({ site, onChanged }: { site: Site; onChanged: () => void }) {
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
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onUploadProgress(e.loaded, e.total);
      };
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
    if (isImage && file.size > 25 * 1024 * 1024) {
      toast.error("Imagem excede 25 MB.");
      return;
    }
    if (isVideo && file.size > 1024 * 1024 * 1024) {
      toast.error("Vídeo excede 1 GB.");
      return;
    }
    setPercent(0);
    setUploadedMb(0);
    setTotalMb(file.size / 1024 / 1024);
    try {
      let processed: File = file;
      if (isImage) {
        setPhase("compressing");
        processed = await compressImage(file).catch(() => file);
      } else if (isVideo) {
        // Cloudflare Tunnel limita request a ~100s no plano free; vídeo bruto não passa.
        // Cortamos os primeiros 30s e reduzimos no browser, gerando ~6-10 MB.
        setPhase("trimming");
        try {
          processed = await trimVideoInBrowser(file, 30, (progress) => setPercent(progress));
        } catch (e: any) {
          toast.error(`Falha ao cortar vídeo no browser: ${e.message}. Tente cortar manualmente antes (HandBrake, ezgif) e subir um clipe menor.`);
          setPhase("idle");
          return;
        }
      }
      const sizeBefore = (file.size / 1024 / 1024).toFixed(1);
      const sizeAfter = (processed.size / 1024 / 1024).toFixed(2);
      setTotalMb(processed.size / 1024 / 1024);
      setPercent(0);

      setPhase("uploading");
      const data = await uploadWithProgress(site.id, processed, processed.name, (loaded, total) => {
        const pct = Math.min(99, Math.round((loaded / total) * 100));
        setPercent(pct);
        setUploadedMb(loaded / 1024 / 1024);
        // ao completar a transferência, ainda esperamos o servidor responder (ffmpeg)
        if (loaded >= total) setPhase("processing");
      });

      setPercent(100);
      setPreview(data.backgroundUrl);
      toast.success(
        isVideo
          ? `Vídeo cortado em 10s e otimizado (${sizeBefore} MB → ${sizeAfter} MB enviado)`
          : processed === file
            ? "Imagem enviada"
            : `Imagem otimizada e enviada (${sizeBefore} MB → ${sizeAfter} MB)`,
      );
      onChanged();
      utils.bess.sites.invalidate();
      utils.bess.getSiteStatus.invalidate();
    } catch (e: any) {
      toast.error(e.message || "Falha no upload");
    } finally {
      setPhase("idle");
      setPercent(0);
      setUploadedMb(0);
      setTotalMb(0);
    }
  }

  const uploading = phase !== "idle";

  async function handleRemove() {
    setUploading(true);
    try {
      const res = await fetch(`/api/admin/sites/${site.id}/background`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setPreview(null);
      toast.success("Imagem removida");
      onChanged();
      utils.bess.sites.invalidate();
      utils.bess.getSiteStatus.invalidate();
    } catch (e: any) {
      toast.error(e.message || "Falha ao remover");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <div
        className={`relative w-32 h-20 rounded-md border-2 border-dashed border-white/10 bg-black/30 overflow-hidden flex items-center justify-center shrink-0 ${preview ? "" : "hover:border-white/20 transition-colors"}`}
      >
        {preview ? (
          isVideoUrl(preview) ? (
            <video src={preview} muted autoPlay loop playsInline className="w-full h-full object-cover" />
          ) : (
            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
          )
        ) : (
          <ImagePlus className="w-6 h-6 text-zinc-600" />
        )}
      </div>
      <div className="flex-1 space-y-2">
        <div className="flex gap-2">
          <Label htmlFor={`bg-${site.id}`} className="cursor-pointer">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 bg-zinc-800/60 hover:bg-zinc-800 text-xs font-medium transition-colors">
              <ImagePlus className="w-3.5 h-3.5" />
              {preview ? "Trocar" : "Enviar imagem ou vídeo"}
            </span>
          </Label>
          <input
            id={`bg-${site.id}`}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.currentTarget.value = "";
            }}
          />
          {preview && (
            <Button
              variant="ghost" size="sm" onClick={handleRemove} disabled={uploading}
              className="gap-1.5 h-8 text-red-400 hover:text-red-300"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remover
            </Button>
          )}
        </div>
        {phase !== "idle" && (
          <div className="space-y-1">
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${phase === "processing" ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`}
                style={{ width: phase === "compressing" ? "5%" : phase === "processing" ? "100%" : `${percent}%` }}
              />
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

/**
 * Reduz a imagem mantendo aspect ratio (max 2560px no maior lado)
 * e re-encoda em JPEG q=0.92. Para fotos de drone passa de ~7-8 MB
 * para ~600 KB-1.2 MB sem perda visual perceptível em background.
 */
async function compressImage(file: File): Promise<File> {
  const MAX_DIM = 2560;
  const QUALITY = 0.92;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Imagem inválida"));
    i.src = dataUrl;
  });

  const longest = Math.max(img.width, img.height);
  const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas não suportado");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", QUALITY);
  });
  if (!blob) throw new Error("Falha ao gerar JPEG");

  // Se a versão otimizada ficou maior (caso raro com imagens já muito otimizadas), mantém original
  if (blob.size >= file.size && scale === 1) return file;

  const newName = file.name.replace(/\.(jpe?g|png|webp)$/i, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg", lastModified: Date.now() });
}

/**
 * Corta os primeiros `durationSec` segundos do vídeo no browser, redimensiona
 * pra max 1280px no maior lado e recodifica em WebM (VP8/VP9). Útil pra evitar
 * upload de arquivos enormes em redes com proxy de timeout curto (Cloudflare).
 *
 * Real-time: levam ~`durationSec` segundos pra completar (gravação ao vivo).
 */
async function trimVideoInBrowser(
  file: File,
  durationSec: number,
  onProgress: (pct: number) => void,
): Promise<File> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Browser não suporta MediaRecorder");
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Não foi possível ler o vídeo"));
  });

  const MAX_DIM = 1280;
  const longest = Math.max(video.videoWidth, video.videoHeight);
  const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
  const w = Math.round(video.videoWidth * scale / 2) * 2;
  const h = Math.round(video.videoHeight * scale / 2) * 2;

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new Error("Canvas indisponível");
  }

  const stream = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(30);
  if (!stream) {
    URL.revokeObjectURL(url);
    throw new Error("captureStream indisponível neste browser");
  }

  // Escolhe o melhor mime suportado
  const mimeCandidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";

  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  await new Promise<void>((resolve, reject) => {
    recorder.onerror = (e: any) => reject(new Error(`MediaRecorder: ${e?.error?.name ?? "erro"}`));
    recorder.onstop = () => resolve();

    let stopped = false;
    const startTime = performance.now();

    function drawLoop() {
      if (stopped) return;
      const elapsed = (performance.now() - startTime) / 1000;
      onProgress(Math.min(99, Math.round((elapsed / durationSec) * 100)));
      ctx!.drawImage(video, 0, 0, w, h);
      if (elapsed >= durationSec || video.ended) {
        stopped = true;
        try { video.pause(); } catch {}
        try { recorder.stop(); } catch {}
        return;
      }
      requestAnimationFrame(drawLoop);
    }

    video.currentTime = 0;
    video.play().then(() => {
      recorder.start();
      drawLoop();
    }).catch(reject);
  });

  URL.revokeObjectURL(url);
  const blob = new Blob(chunks, { type: "video/webm" });
  const newName = file.name.replace(/\.(mp4|webm|mov|avi)$/i, "") + "-trim10.webm";
  return new File([blob], newName, { type: "video/webm", lastModified: Date.now() });
}
