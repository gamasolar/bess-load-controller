/** Tipos mínimos do VideoRTC (go2rtc v1.9.10, MIT), só o que o app usa. */
export class VideoRTC extends HTMLElement {
  mode: string;
  background: boolean;
  visibilityThreshold: number;
  visibilityCheck: boolean;
  wsURL: string;
  video: HTMLVideoElement | null;
  ws: WebSocket | null;
  pc: RTCPeerConnection | null;
  mseCodecs: string;
  CODECS: string[];
  liveLatency: number;
  codecs(isSupported: (type: string) => boolean): string;
  set src(value: string | URL);
  play(): void;
  send(value: unknown): void;
  onconnect(): boolean;
  ondisconnect(): void;
}
