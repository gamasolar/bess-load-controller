/**
 * Vídeo ao vivo de uma câmera, pelo go2rtc do servidor (proxy autenticado em
 * /api/camera/g). Usa o elemento `video-rtc` do próprio go2rtc (vendorizado em
 * lib/vendor/video-rtc.js): tenta MSE (fMP4 em WebSocket), depois HLS (Safari
 * no iPhone) e por fim MJPEG. WebRTC entra primeiro quando o navegador consegue
 * alcançar o UDP do go2rtc (rede local ou porta encaminhada pela VPS).
 */

import { useEffect, useRef, useState } from "react";
import { VideoRTC } from "@/lib/vendor/video-rtc.js";

export type StreamMode = "mse" | "hls" | "mjpeg" | "webrtc" | "—";

class BessVideo extends VideoRTC {
  /**
   * Sem H.265 no MSE: o Safari do iPhone (e o Chrome nele) diz que decodifica
   * hvc1, mas fica em tela preta. O servidor converte para H.264 de qualquer
   * forma, então todos os navegadores recebem o mesmo fluxo.
   */
  codecs(isSupported: (type: string) => boolean): string {
    return this.CODECS
      .filter((c) => !c.startsWith("hvc1") && !c.startsWith("hev1"))
      .filter((c) => isSupported(`video/mp4; codecs="${c}"`))
      .join();
  }
}
if (!customElements.get("video-stream-bess")) customElements.define("video-stream-bess", BessVideo);

export interface VideoStreamHandle {
  element: HTMLElement | null;
}

interface Props {
  /** Nome do fluxo no go2rtc (ex.: cam1_sub). */
  stream: string;
  muted: boolean;
  /** "stable" força MSE (TCP pela Cloudflare). "auto" tenta WebRTC primeiro. */
  transport?: "auto" | "stable";
  onState?: (s: { mode: StreamMode; playing: boolean; width: number; height: number; loss: number | null; fellBack: boolean; stalling: boolean }) => void;
  className?: string;
}

/** Sem NENHUMA imagem por este tempo após abrir: se ainda tentava WebRTC, cai para MSE (4G: conecta e fica preto, ou o UDP não chega). */
const FIRST_IMAGE_S = 6;
/** Imagem congelada (currentTime parado) por este tempo, já tendo tocado antes: reconecta. MSE que trava com o WebSocket aberto não dispara "error" sozinho, então nada se recuperava. */
const STALL_RELOAD_S = 6;
/** Não reconecta mais de uma vez a cada este tempo (evita laço de reconexão). */
const RELOAD_COOLDOWN_S = 10;
/** Depois de uma queda nesta visita, as próximas aberturas já vão em MSE (o caminho WebRTC não serve neste acesso). */
let autoStable = false;

type RtcEl = HTMLElement & {
  src: string; mode: string; liveLatency: number; video: HTMLVideoElement | null; pc: RTCPeerConnection | null; pcState: number;
  mseCodecs: string; ws: WebSocket | null; background: boolean; ondisconnect: () => void;
};

export function VideoStream({ stream, muted, transport = "auto", onState, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const el = useRef<RtcEl | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = document.createElement("video-stream-bess") as RtcEl;
    const stable = transport === "stable" || autoStable;
    let fellBack = transport !== "stable" && autoStable;
    node.mode = stable ? "mse,hls,mjpeg" : "webrtc,mse,hls,mjpeg"; // WebRTC quando o UDP chega (LAN ou porta pela VPS); senão MSE
    node.background = false;
    node.liveLatency = 1; // 1 s de fila (como o original): 0,35 s travava em 4G a cada rajada do PTZ
    node.style.display = "block";
    node.style.width = "100%";
    node.style.height = "100%";
    host.current?.appendChild(node);
    if (node.video) { node.video.controls = false; node.video.setAttribute("playsinline", ""); }
    el.current = node;
    const src = `/api/camera/g/ws?src=${encodeURIComponent(stream)}`;
    node.src = src;
    setReady(true);

    // Estado do fluxo: perda do WebRTC (só para exibir), "conectou mas nunca mostrou imagem"
    // e "tocava e congelou". O travamento é medido pelo currentTime do vídeo (serve para MSE,
    // HLS e WebRTC): uma travadinha curta é blip e o buffer de 1 s absorve — só reconecta de fato
    // depois de STALL_RELOAD_S parado, e no máximo uma vez por RELOAD_COOLDOWN_S.
    let last = { recv: 0, lost: 0, frames: 0, seen: false };
    let loss: number | null = null;
    let stalling = false;
    let everPlayed = false;
    const createdAt = Date.now();
    let lastMode: StreamMode = "—";  // transporte do tick anterior (troca = atividade, não travamento)
    let lastCT = 0;                  // último currentTime observado
    let lastProgressAt = Date.now(); // quando o currentTime avançou pela última vez
    let lastReloadAt = 0;            // quando reconectou pela última vez
    const report = async () => {
      const v = node.video;
      const webrtcOn = !!node.pc && node.pcState === WebSocket.OPEN;
      const mode: StreamMode = webrtcOn ? "webrtc" : node.mseCodecs ? "mse" : v?.src?.startsWith("data:application/vnd.apple") ? "hls" : v?.src ? "mjpeg" : "—";
      const playing = !!v && (v.readyState >= 3 || (mode === "mjpeg" && !!v.poster)) && !v.paused;
      if (playing) everPlayed = true;
      const now = Date.now();

      if (webrtcOn && node.pc) {
        try {
          const stats = await node.pc.getStats();
          let recv = 0, lost = 0;
          stats.forEach((r: RTCStats & { kind?: string; packetsReceived?: number; packetsLost?: number }) => {
            if (r.type === "inbound-rtp" && r.kind === "video") { recv = r.packetsReceived ?? 0; lost = r.packetsLost ?? 0; }
          });
          if (last.seen) {
            const dr = recv - last.recv, dl = Math.max(0, lost - last.lost);
            if (dr + dl > 0) loss = Math.round((dl / (dr + dl)) * 100);
          }
          last = { recv, lost, frames: 0, seen: true };
        } catch {
          /* sem estatísticas neste navegador */
        }
      } else {
        loss = null;
        last = { recv: 0, lost: 0, frames: 0, seen: false };
      }

      // Travamento: o currentTime não VARIA embora o vídeo não esteja pausado. A troca de transporte
      // (go2rtc começa em MSE e sobe para WebRTC) reposiciona o relógio do vídeo — isso é atividade,
      // não travamento, então a cada troca a contagem recomeça. MJPEG (sem relógio) e fim do vídeo não contam.
      const ct = v?.currentTime ?? 0;
      if (mode !== lastMode) { lastMode = mode; lastCT = ct; lastProgressAt = now; }
      else if (Math.abs(ct - lastCT) > 0.05) { lastCT = ct; lastProgressAt = now; }
      else if (!everPlayed || mode === "mjpeg" || !v || v.ended) { lastCT = ct; lastProgressAt = now; }
      stalling = everPlayed && now - lastProgressAt > 2000;

      const canReload = now - lastReloadAt > RELOAD_COOLDOWN_S * 1000;
      if (!everPlayed && now - createdAt > FIRST_IMAGE_S * 1000 && node.mode.indexOf("webrtc") >= 0 && canReload) {
        // Abriu e nunca mostrou imagem: estava tentando WebRTC; passa a MSE (e assim fica nas próximas aberturas).
        autoStable = true; fellBack = true; loss = null; lastReloadAt = now;
        node.ondisconnect();
        node.mode = "mse,hls,mjpeg";
        node.src = src;
      } else if (everPlayed && (mode === "mse" || mode === "hls") && now - lastProgressAt > STALL_RELOAD_S * 1000 && canReload) {
        // Só MSE/HLS congelado (WebSocket pode seguir aberto; o MSE não dispara "error"). O WebRTC tem
        // recuperação própria e NÃO é derrubado no meio — mexer nele era o que causava o pisca-pisca.
        lastReloadAt = now; lastProgressAt = now; last = { recv: 0, lost: 0, frames: 0, seen: false };
        if (node.ws) node.ws.close(); else { node.ondisconnect(); node.src = src; }
      }

      onState?.({ mode, playing: mode === "mjpeg" ? !!v?.poster || !!v?.src : playing, width: v?.videoWidth ?? 0, height: v?.videoHeight ?? 0, loss, fellBack, stalling });
    };
    const timer = window.setInterval(() => void report(), 1000);
    return () => {
      window.clearInterval(timer);
      node.remove();
      el.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, transport]);

  useEffect(() => {
    const v = el.current?.video;
    if (v) { v.muted = muted; if (!muted) v.play().catch(() => undefined); }
  }, [muted, ready]);

  return <div ref={host} className={className} />;
}

/** Tela cheia do contêiner (ou do vídeo no iPhone, que não tem Fullscreen API). */
export function requestFullscreen(container: HTMLElement | null): void {
  if (!container) return;
  const video = container.querySelector("video") as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
  if (container.requestFullscreen) { container.requestFullscreen().catch(() => video?.webkitEnterFullscreen?.()); return; }
  video?.webkitEnterFullscreen?.();
}
