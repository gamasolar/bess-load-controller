/**
 * Vídeo das câmeras no navegador: o servidor sobe um go2rtc (binário em
 * tools/go2rtc, copiado do Frigate) como processo filho, com a configuração
 * gerada a partir do cadastro. O go2rtc puxa o RTSP da câmera e entrega ao
 * navegador por MSE (fMP4 em WebSocket), HLS ou MJPEG; H.265 vira H.264 e o
 * áudio µ-law vira AAC pelo ffmpeg só quando o navegador precisa.
 *
 * Só escuta em 127.0.0.1; o app faz o proxy com a sessão do usuário
 * (camera-routes.ts). CAMERA_STREAMS=off desliga tudo isto.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BessCamera } from "../drizzle/schema";
import { endpoints, streamNames } from "./camera-store";

export const GO2RTC_PORT = Number(process.env.GO2RTC_PORT ?? 1984);

export function isCameraStreamingEnabled(): boolean {
  return (process.env.CAMERA_STREAMS ?? "on").trim().toLowerCase() !== "off";
}

function yamlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Configuração do go2rtc. Cada câmera vira dois fluxos (sub e main), cada um
 * com a origem RTSP crua e as conversões por ffmpeg que o go2rtc só liga
 * quando algum consumidor exige (navegador sem H.265, áudio AAC, MJPEG).
 */
/** ffmpeg ≥ 5 que o go2rtc exige: GO2RTC_FFMPEG, ou tools/ffmpeg (estático), ou o do sistema. */
export function ffmpegBin(): string {
  const env = process.env.GO2RTC_FFMPEG?.trim();
  if (env) return env;
  const local = path.resolve(process.cwd(), "tools", "ffmpeg");
  return existsSync(local) ? local : "ffmpeg";
}

/**
 * WebRTC só quando configurado: `CAMERA_WEBRTC_LISTEN=:8556` abre o UDP/TCP do ICE e
 * `CAMERA_WEBRTC_CANDIDATES=ip:porta,...` anuncia o endereço público (porta encaminhada).
 * Sem isso, fica desligado e o navegador usa MSE.
 */
/**
 * Nível de log do go2rtc. Padrão `warn` (silencioso). `GO2RTC_LOG_LEVEL=debug` (ou trace) detalha
 * WebRTC e o canal de retorno RTSP para investigar o áudio de duas vias, sem floodar o resto.
 */
function logLine(): string {
  const lvl = process.env.GO2RTC_LOG_LEVEL?.trim().toLowerCase();
  if (lvl && lvl !== "warn") return `log: { level: info, webrtc: ${lvl}, rtsp: ${lvl}, exec: ${lvl} }`;
  return "log: { level: warn }";
}

function webrtcLine(): string {
  const listen = (process.env.CAMERA_WEBRTC_LISTEN ?? "").trim();
  if (!listen) return 'webrtc: { listen: "" }';
  const cands = (process.env.CAMERA_WEBRTC_CANDIDATES ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const candYaml = cands.length ? `, candidates: [${cands.map(yamlString).join(", ")}]` : "";
  return `webrtc: { listen: ${yamlString(listen)}${candYaml} }`;
}

export function go2rtcConfig(cameras: BessCamera[], apiPort = GO2RTC_PORT, ffmpeg = ffmpegBin()): string {
  const lines: string[] = [
    "# Gerado pelo BESS Load Controller a partir de bess_cameras. Não editar à mão.",
    `api: { listen: "127.0.0.1:${apiPort}", origin: "*" }`,
    // o servidor RTSP interno só em loopback: as origens "ffmpeg:<fluxo>" leem o fluxo por ele
    'rtsp: { listen: "127.0.0.1:8554" }',
    webrtcLine(),
    `ffmpeg: { bin: ${yamlString(ffmpeg)} }`,
    logLine(),
    "streams:",
  ];
  for (const c of cameras.filter((x) => x.isActive)) {
    const e = endpoints(c);
    const n = streamNames(c.id);
    lines.push(`  ${n.sub}:`);
    // backchannel=0: sem canal de retorno de áudio (câmeras XMeye travam no pedido); timeout folgado para o túnel
    lines.push(`    - ${yamlString(`${e.rtspSub}#backchannel=0#timeout=30`)}`);
    // A câmera está configurada para H.264 (ver docs em camera-api probe); as origens ffmpeg abaixo só entram
    // quando o navegador pede algo que a câmera não dá: áudio µ-law -> AAC 16 kHz (Safari), vídeo H.264 se a
    // câmera voltar a H.265, e MJPEG como último recurso.
    for (const name of [n.sub, n.main]) {
      if (name === n.main) { lines.push(`  ${n.main}:`); lines.push(`    - ${yamlString(`${e.rtspMain}#backchannel=0#timeout=30`)}`); }
      lines.push(`    - ${yamlString(`ffmpeg:${name}#audio=aac/16000`)}`);
      lines.push(`    - ${yamlString(`ffmpeg:${name}#audio=opus`)}`);
      lines.push(`    - ${yamlString(`ffmpeg:${name}#video=h264#audio=aac/16000`)}`);
      lines.push(`    - ${yamlString(`ffmpeg:${name}#video=mjpeg`)}`);
    }
    // Canal de retorno de voz (operador -> alto-falante da câmera), separado dos fluxos de vídeo:
    // os de vídeo mantêm backchannel=0 (XMeye pode travar o vídeo se o pedirem); este só sobe
    // quando alguém aperta "falar" no navegador, e só pelo WebRTC. SEM backchannel=0 = go2rtc pede
    // o canal ONVIF no DESCRIBE, e a câmera devolve a trilha de áudio sendonly (PCMA/PCMU).
    if ((c.features as { talk?: boolean } | null)?.talk === true) {
      lines.push(`  cam${c.id}_talk:`);
      lines.push(`    - ${yamlString(`${e.rtspSub}#timeout=30`)}`);
    }
  }
  return lines.join("\n") + "\n";
}

export class CameraStreamer {
  private child: ChildProcess | null = null;
  private stopping = false;
  private backoffMs = 3000;
  private readonly bin: string;
  private readonly configPath: string;

  constructor(private readonly storageDir: string) {
    this.bin = process.env.GO2RTC_BIN ?? path.resolve(process.cwd(), "tools", "go2rtc");
    this.configPath = path.join(storageDir, "go2rtc.yaml");
  }

  get available(): boolean { return existsSync(this.bin); }

  writeConfig(cameras: BessCamera[]): void {
    mkdirSync(this.storageDir, { recursive: true });
    writeFileSync(this.configPath, go2rtcConfig(cameras), { mode: 0o600 });
  }

  start(cameras: BessCamera[]): void {
    if (!this.available) {
      console.warn(`[Camera] go2rtc não encontrado em ${this.bin}; vídeo ao vivo desligado (fotos continuam)`);
      return;
    }
    this.writeConfig(cameras);
    this.stopping = false;
    this.spawn();
    const halt = () => { this.stop(); };
    process.once("SIGTERM", halt);
    process.once("SIGINT", halt);
  }

  /** Recarrega a configuração (cadastro mudou). */
  reload(cameras: BessCamera[]): void {
    if (!this.available) return;
    this.writeConfig(cameras);
    if (this.child) { this.child.kill("SIGTERM"); } else { this.spawn(); }
  }

  private spawn(): void {
    const child = spawn(this.bin, ["-config", this.configPath], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: this.storageDir } });
    this.child = child;
    const log = (prefix: string) => (buf: Buffer) => {
      for (const line of buf.toString().split("\n").filter(Boolean)) console.log(`[Camera] ${prefix}${line.replace(/rtsp:\/\/[^@\s]+@/g, "rtsp://***@")}`);
    };
    child.stdout?.on("data", log(""));
    child.stderr?.on("data", log(""));
    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.stopping) return;
      console.warn(`[Camera] go2rtc saiu (${signal ?? code}); volta em ${this.backoffMs / 1000}s`);
      setTimeout(() => { if (!this.stopping) this.spawn(); }, this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    });
    child.on("spawn", () => { this.backoffMs = 3000; console.log(`[Camera] go2rtc no ar em 127.0.0.1:${GO2RTC_PORT}`); });
    child.on("error", (e) => console.warn("[Camera] go2rtc falhou ao iniciar:", e.message));
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill("SIGTERM");
    this.child = null;
  }
}

let streamer: CameraStreamer | null = null;
export function getCameraStreamer(storageDir: string): CameraStreamer {
  if (!streamer) streamer = new CameraStreamer(storageDir);
  return streamer;
}
