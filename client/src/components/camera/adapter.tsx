/**
 * Liga o modelo de tela (types.ts) às chamadas reais `trpc.camera.*` e ao
 * player `VideoStream`. Nada de endpoint novo: só conversão de formato.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { trpc } from "@/lib/trpc";
import { VideoStream } from "./VideoStream";
import type { Camera, CameraAdapter, CameraState, Imaging, IrMode, PlayerPrefs, StreamMode, StreamStats, StreamStatus, Transport } from "./types";

// Reduz a qualidade (HD→SD) uma vez por visita quando a conexão fica ruim de verdade.
// Só desce; nunca sobe sozinha (evita piscar). O operador pode voltar a HD à mão.
let autoReducedThisSession = false;
/** Segundos ruins acumulados antes de reduzir. Blip não conta; travando/perdendo frames por ~10 s, sim. */
const BAD_SECONDS_TO_REDUCE = 10;

type Utils = ReturnType<typeof trpc.useUtils>;
type ListOut = Awaited<ReturnType<Utils["camera"]["list"]["fetch"]>>;
type StateOut = Awaited<ReturnType<Utils["camera"]["state"]["fetch"]>>;
type PublicCam = ListOut[number]["cameras"][number];
type Range = { min: number; max: number } | null | undefined;

// ── preferências do player (som, SD/HD), compartilhadas entre o vídeo e os botões ──
const TRANSPORT_KEY = "cam-transport";
/** Padrão é WebRTC ("auto"), que dá ~1 s quando a rede deixa. Cai sozinho para MSE se nem abrir imagem. */
const readTransport = (): Transport => {
  try {
    return localStorage.getItem(TRANSPORT_KEY) === "stable" ? "stable" : "auto";
  } catch {
    return "auto";
  }
};
const QUALITY_KEY = "cam-quality-v2"; // v2: zera o "SD" guardado nos testes de 17-18/10; padrão volta a HD
/** Padrão é HD (main). Se o operador fixar SD de novo, respeita (grava sob a chave v2). */
const readQuality = (): PlayerPrefs["quality"] => {
  try {
    return localStorage.getItem(QUALITY_KEY) === "sub" ? "sub" : "main";
  } catch {
    return "main";
  }
};
const prefsStore = (() => {
  let prefs: PlayerPrefs = { muted: true, quality: readQuality(), transport: readTransport() };
  const listeners = new Set<() => void>();
  return {
    get: () => prefs,
    set(patch: Partial<PlayerPrefs>) {
      prefs = { ...prefs, ...patch };
      listeners.forEach((fn) => fn());
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
})();
export function usePlayerPrefs(): PlayerPrefs {
  return useSyncExternalStore(prefsStore.subscribe, prefsStore.get);
}

// ── conversões ──
const num = (id: string) => Number(id);
const pct = (v: number | null | undefined, r: Range) => {
  const { min, max } = r ?? { min: 0, max: 255 };
  if (v == null) return 50;
  return Math.round(((v - min) / Math.max(1, max - min)) * 100);
};
const raw = (p: number, r: Range) => {
  const { min, max } = r ?? { min: 0, max: 255 };
  return Math.round(min + (Math.min(100, Math.max(0, p)) / 100) * (max - min));
};
const irFrom = (v: string | null | undefined): IrMode => (v === "OFF" ? "night" : v === "ON" ? "day" : "auto");
const irTo: Record<IrMode, "AUTO" | "ON" | "OFF"> = { auto: "AUTO", day: "ON", night: "OFF" };
const lampKey = (id: string) => `cam${id}-lamp`;
const readLamp = (id: string) => {
  try {
    return localStorage.getItem(lampKey(id)) === "1";
  } catch {
    return false;
  }
};

function toCamera(c: PublicCam, plant: { name: string; slug: string | null }): Camera {
  const f = c.features ?? {};
  return {
    id: String(c.id),
    name: c.name,
    plant: plant.name,
    plantSlug: plant.slug,
    description: [c.model, f.resolutionMain].filter(Boolean).join(" · ") || "Câmera",
    poster: `/api/camera/${c.id}/frame.jpg`,
    enabled: c.isActive,
    streams: c.streams,
    info: {
      model: c.model,
      manufacturer: f.manufacturer ?? null,
      firmware: f.firmware ?? null,
      resolutionMain: f.resolutionMain ?? null,
      resolutionSub: f.resolutionSub ?? null,
      hasTunnel: c.hasTunnel,
      mainQuality: f.mainQuality === "uhd" ? "uhd" : "hd",
    },
    capabilities: {
      ptz: f.ptz !== false,
      focus: f.focus !== false,
      wiper: !!f.wiper,
      light: !!f.lamp,
      ir: true,
      imaging: true,
      snapshot: true,
      snapshot4k: true,
      audio: f.audio !== false,
      talk: !!f.talk,
    },
  };
}

function toState(id: string, s: StateOut): CameraState {
  const img = s.imaging;
  const opt = s.options;
  const modes = (opt?.irCutModes ?? []).map((m) => irFrom(m));
  return {
    online: s.online,
    light: readLamp(id),
    ir: irFrom(img?.irCut ?? null),
    irModes: modes.length ? Array.from(new Set(modes)) : ["auto", "day", "night"],
    imaging: {
      brightness: pct(img?.brightness, opt?.brightness),
      contrast: pct(img?.contrast, opt?.contrast),
      saturation: pct(img?.saturation, opt?.saturation),
      sharpness: pct(img?.sharpness, opt?.sharpness),
      wdr: img?.wdr ? img.wdr.mode === "ON" : null,
      blc: img?.blc ? img.blc.mode === "ON" : null,
    },
    position: s.status ? { pan: s.status.pan, tilt: s.status.tilt, zoom: s.status.zoom } : null,
    presets: s.presets.map((p) => ({ id: p.token, name: p.name, thumbnail: p.thumb })),
    clockOffsetSeconds: s.clockOffsetSeconds,
  };
}

/** Vídeo ao vivo com o player existente; informa à página se há imagem. */
function LiveStream({ camera, onStatus }: { camera: Camera; onStatus: (s: StreamStatus, mode: StreamMode, stats: StreamStats) => void }) {
  const prefs = usePlayerPrefs();
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<StreamMode>("—");
  const [stats, setStats] = useState<StreamStats>({ loss: null, fellBack: false, stalling: false, reduced: autoReducedThisSession });
  const lastLive = useRef<number>(Date.now());
  const badSeconds = useRef(0);
  const stream = prefs.quality === "main" ? camera.streams.main : camera.streams.sub;
  useEffect(() => {
    onStatus("connecting", mode, stats);
    lastLive.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, prefs.transport]);
  useEffect(() => {
    if (playing) {
      lastLive.current = Date.now();
      onStatus("live", mode, stats);
      return;
    }
    // Travadinha de rede (rajada do PTZ em 4G) não vira "Aguardando imagem": só depois de 3 s sem quadros.
    // Sem imagem por 45 s (a câmera demora 1–2 min a liberar sessões após reinício): avisa, sem travar os comandos.
    const t = window.setInterval(() => {
      const quiet = Date.now() - lastLive.current;
      if (quiet > 45_000) onStatus("offline", mode, stats);
      else if (quiet > 3_000) onStatus("connecting", mode, stats);
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, mode, stats.loss, stats.fellBack]);
  return (
    <VideoStream
      stream={stream}
      muted={prefs.muted}
      transport={prefs.transport}
      className="video-slot"
      onState={(s) => {
        setPlaying(s.playing);
        setMode(s.mode);
        // Redução automática de HD→SD: só com a conexão ruim de forma sustentada (imagem congelando
        // ou perdendo muitos pacotes por ~10 s), em qualquer transporte. Desce uma vez; não sobe sozinha.
        if (prefs.quality === "main" && !autoReducedThisSession && s.mode !== "—" && s.mode !== "mjpeg") {
          const bad = s.stalling || (s.loss != null && s.loss >= 8);
          badSeconds.current = bad ? badSeconds.current + 1 : Math.max(0, badSeconds.current - 2);
          if (badSeconds.current >= BAD_SECONDS_TO_REDUCE) {
            autoReducedThisSession = true;
            badSeconds.current = 0;
            lastLive.current = Date.now();
            prefsStore.set({ quality: "sub" }); // não grava no localStorage: a preferência do operador segue HD
          }
        }
        setStats((prev) =>
          prev.loss === s.loss && prev.fellBack === s.fellBack && prev.stalling === s.stalling && prev.reduced === autoReducedThisSession
            ? prev
            : { loss: s.loss, fellBack: s.fellBack, stalling: s.stalling, reduced: autoReducedThisSession },
        );
      }}
    />
  );
}

export function useBessCameraAdapter(): CameraAdapter {
  const utils = trpc.useUtils();
  const mutations = {
    move: trpc.camera.ptz.move.useMutation(),
    stop: trpc.camera.ptz.stop.useMutation(),
    home: trpc.camera.ptz.home.useMutation(),
    setHome: trpc.camera.ptz.setHome.useMutation(),
    gotoPreset: trpc.camera.presets.goto.useMutation(),
    savePreset: trpc.camera.presets.save.useMutation(),
    removePreset: trpc.camera.presets.remove.useMutation(),
    aux: trpc.camera.aux.useMutation(),
    focusMove: trpc.camera.focus.move.useMutation(),
    focusStop: trpc.camera.focus.stop.useMutation(),
    imaging: trpc.camera.imaging.set.useMutation(),
    probe: trpc.camera.probe.useMutation(),
    setMainQuality: trpc.camera.setMainQuality.useMutation(),
  };
  const m = useRef(mutations);
  m.current = mutations;
  // Faixas reais de imagem por câmera (para converter porcentagem -> valor da câmera).
  const ranges = useRef(new Map<string, StateOut["options"]>());

  return useMemo<CameraAdapter>(() => {
    const plantOf = async (siteId: number) => {
      const sites = await utils.camera.list.fetch();
      const s = sites.find((x) => x.siteId === siteId);
      return { name: s?.name ?? "Usina", slug: s?.slug ?? null };
    };
    return {
      async list() {
        const sites = await utils.camera.list.fetch();
        return sites.flatMap((s) => s.cameras.map((c) => toCamera(c, { name: s.name, slug: s.slug })));
      },
      async get(id) {
        const c = await utils.camera.get.fetch({ id: num(id) });
        return toCamera(c, c.site ? { name: c.site.name, slug: c.site.slug } : await plantOf(c.siteId));
      },
      async state(id) {
        const s = await utils.camera.state.fetch({ id: num(id) }, { staleTime: 0 });
        ranges.current.set(id, s.options);
        return toState(id, s);
      },
      async move(id, motion) {
        if (motion.kind === "focus") {
          await m.current.focusMove.mutateAsync({ id: num(id), speed: motion.direction * 0.6 });
          return;
        }
        await m.current.move.mutateAsync({
          id: num(id),
          pan: motion.x * motion.speed,
          tilt: motion.y * motion.speed,
          zoom: motion.zoom * motion.speed,
        });
      },
      async stop(id, kind) {
        if (kind === "focus") await m.current.focusStop.mutateAsync({ id: num(id) });
        else await m.current.stop.mutateAsync({ id: num(id) });
      },
      async home(id) {
        await m.current.home.mutateAsync({ id: num(id) });
      },
      async setHome(id) {
        await m.current.setHome.mutateAsync({ id: num(id) });
      },
      async gotoPreset(id, presetId) {
        await m.current.gotoPreset.mutateAsync({ id: num(id), token: presetId });
      },
      async savePreset(id, name, presetId) {
        await m.current.savePreset.mutateAsync({ id: num(id), name: name.trim().slice(0, 40), token: presetId });
        await utils.camera.state.invalidate({ id: num(id) });
      },
      async removePreset(id, presetId) {
        await m.current.removePreset.mutateAsync({ id: num(id), token: presetId });
        await utils.camera.state.invalidate({ id: num(id) });
      },
      async aux(id, action, value) {
        const camId = num(id);
        if (action === "wiper") {
          await m.current.aux.mutateAsync({ id: camId, kind: "wiper", on: true });
          window.setTimeout(() => m.current.aux.mutate({ id: camId, kind: "wiper", on: false }), 8000);
          return;
        }
        if (action === "light") {
          const on = Boolean(value);
          await m.current.aux.mutateAsync({ id: camId, kind: "lamp", on });
          try {
            localStorage.setItem(lampKey(id), on ? "1" : "0");
          } catch {
            /* sem armazenamento */
          }
          return;
        }
        if (typeof value === "string") {
          await m.current.imaging.mutateAsync({ id: camId, irCut: irTo[value] });
          await utils.camera.state.invalidate({ id: camId });
        }
      },
      async setImaging(id, v: Imaging) {
        const r = ranges.current.get(id);
        await m.current.imaging.mutateAsync({
          id: num(id),
          brightness: raw(v.brightness, r?.brightness),
          contrast: raw(v.contrast, r?.contrast),
          saturation: raw(v.saturation, r?.saturation),
          sharpness: raw(v.sharpness, r?.sharpness),
          wdr: v.wdr == null ? undefined : { mode: v.wdr ? "ON" : "OFF", level: null },
          blc: v.blc == null ? undefined : { mode: v.blc ? "ON" : "OFF", level: null },
        });
        await utils.camera.state.invalidate({ id: num(id) });
      },
      async probe(id) {
        await m.current.probe.mutateAsync({ id: num(id) });
        await utils.camera.get.invalidate({ id: num(id) });
        await utils.camera.state.invalidate({ id: num(id) });
      },
      async snapshot(id, cameraName) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        const slug = cameraName.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return { url: `/api/camera/${num(id)}/photo.jpg?download=1&t=${Date.now()}`, filename: `${slug || "camera"}-${stamp}.jpg` };
      },
      async setMuted(_id, muted) {
        prefsStore.set({ muted });
      },
      setQuality(_id, quality) {
        // Escolha manual do operador: grava e zera o estado de redução automática (dá nova chance ao HD).
        autoReducedThisSession = false;
        prefsStore.set({ quality });
        try {
          localStorage.setItem(QUALITY_KEY, quality);
        } catch {
          /* sem armazenamento */
        }
      },
      async setMainQuality(id, quality) {
        await m.current.setMainQuality.mutateAsync({ id: num(id), quality });
        await utils.camera.get.invalidate({ id: num(id) });
        await utils.camera.list.invalidate();
      },
      setTransport(_id, transport) {
        prefsStore.set({ transport });
        try {
          localStorage.setItem(TRANSPORT_KEY, transport);
        } catch {
          /* sem armazenamento */
        }
      },
      prefs: { subscribe: prefsStore.subscribe, get: prefsStore.get },
      renderStream(camera, onStatus, reloadKey) {
        return <LiveStream key={`${camera.id}-${reloadKey}`} camera={camera} onStatus={onStatus} />;
      },
    };
  }, [utils]);
}
