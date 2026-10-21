/**
 * Modelo de tela das câmeras (não é o payload tRPC). O adaptador em
 * `adapter.tsx` converte as respostas reais de `trpc.camera.*` para isto.
 * Desenho original do front: entrega externa de 18/10/2026, integrada aqui.
 */
import type { ReactNode } from "react";

export type Motion =
  | { kind: "ptz"; x: number; y: number; zoom: number; speed: number }
  | { kind: "focus"; direction: -1 | 1 };
export type MotionKind = Motion["kind"];
export type StreamStatus = "connecting" | "live" | "offline";
export type StreamMode = "webrtc" | "mse" | "hls" | "mjpeg" | "—";
export type IrMode = "auto" | "day" | "night";

export type Camera = {
  id: string;
  name: string;
  plant: string;
  plantSlug: string | null;
  description: string;
  /** Quadro atual da câmera (JPEG leve); acrescente `?t=` para renovar. */
  poster: string;
  enabled: boolean;
  streams: { sub: string; main: string };
  info: {
    model: string | null;
    manufacturer: string | null;
    firmware: string | null;
    resolutionMain: string | null;
    resolutionSub: string | null;
    hasTunnel: boolean;
    /** Resolução atual do fluxo principal: "hd" (1080p) ou "uhd" (4K). */
    mainQuality: "hd" | "uhd";
  };
  capabilities: {
    ptz: boolean;
    focus: boolean;
    wiper: boolean;
    light: boolean;
    ir: boolean;
    imaging: boolean;
    snapshot: boolean;
    snapshot4k: boolean;
    audio: boolean;
    /** Falar na câmera (canal de retorno, só pelo WebRTC: PC ou Wi-Fi). */
    talk: boolean;
  };
};

export type Preset = { id: string; name: string; thumbnail: string | null };

/** Valores em porcentagem (0–100) da faixa que a câmera aceita; wdr/blc nulos quando a câmera não tem. */
export type Imaging = {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  wdr: boolean | null;
  blc: boolean | null;
};

export type CameraState = {
  online: boolean;
  light: boolean;
  ir: IrMode;
  irModes: IrMode[];
  imaging: Imaging;
  position: { pan: number | null; tilt: number | null; zoom: number | null } | null;
  presets: Preset[];
  clockOffsetSeconds: number | null;
};

/** "auto": WebRTC quando entrega imagem, senão MSE. "stable": só MSE (TCP pela Cloudflare; mais atraso, sem artefatos). */
export type Transport = "auto" | "stable";
export type PlayerPrefs = { muted: boolean; quality: "sub" | "main"; transport: Transport };
/** Perda de pacotes do WebRTC (%, últimos segundos), se o player caiu para MSE sozinho,
 * se a imagem está congelando (frames não avançam com pacotes chegando) e se a qualidade
 * foi reduzida automaticamente por conexão ruim. */
export type StreamStats = { loss: number | null; fellBack: boolean; stalling: boolean; reduced: boolean };

export interface CameraAdapter {
  list(): Promise<Camera[]>;
  get(id: string): Promise<Camera>;
  state(id: string): Promise<CameraState>;
  move(id: string, motion: Motion): Promise<void>;
  stop(id: string, kind: MotionKind): Promise<void>;
  home(id: string): Promise<void>;
  setHome(id: string): Promise<void>;
  gotoPreset(id: string, presetId: string): Promise<void>;
  savePreset(id: string, name: string, presetId?: string): Promise<void>;
  removePreset(id: string, presetId: string): Promise<void>;
  aux(id: string, action: "wiper" | "light" | "ir", value?: boolean | IrMode): Promise<void>;
  setImaging(id: string, value: Imaging): Promise<void>;
  /** Relê os recursos da câmera (modelo, firmware, comandos auxiliares). */
  probe(id: string): Promise<void>;
  snapshot(id: string, cameraName: string): Promise<{ url: string; filename: string }>;
  setMuted(id: string, muted: boolean): Promise<void>;
  setQuality(id: string, quality: PlayerPrefs["quality"]): void;
  /** Reconfigura o fluxo principal da câmera entre HD (1080p) e 4K. Reinicia o vídeo. */
  setMainQuality(id: string, quality: "hd" | "uhd"): Promise<void>;
  setTransport(id: string, transport: Transport): void;
  prefs: { subscribe(fn: () => void): () => void; get(): PlayerPrefs };
  renderStream(camera: Camera, onStatus: (status: StreamStatus, mode: StreamMode, stats: StreamStats) => void, reloadKey: number): ReactNode;
}
