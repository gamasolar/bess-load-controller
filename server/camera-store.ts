/**
 * Acesso às câmeras cadastradas e às formas de falar com elas.
 *
 * Regra: a credencial nunca sai daqui para a API. `publicCamera` é a versão
 * segura para o front; `endpoints` monta as URLs internas (com túnel quando
 * houver) para o servidor usar.
 */

import { eq } from "drizzle-orm";
import { bessCameras, type BessCamera, type InsertBessCamera } from "../drizzle/schema";
import { getDb as getDbMaybe } from "./db";

async function getDb() {
  const db = await getDbMaybe();
  if (!db) throw new Error("banco de dados indisponível");
  return db;
}
import { OnvifClient } from "./onvif";

export interface CameraFeatures {
  ptz?: boolean;
  zoom?: boolean;
  focus?: boolean;
  wiper?: boolean;
  lamp?: boolean;
  audio?: boolean;
  presets?: number | null;
  /** Vistas gravadas pelo operador: a câmera só guarda a posição no slot numerado e ignora o nome
   * (XMeye devolve 255 slots com nome = número), então o nome é guardado aqui, por token. */
  savedPresets?: { token: string; name: string }[];
  /** A câmera tem alto-falante e aceita o canal de retorno ONVIF (voz do operador → câmera).
   * Só vale pelo WebRTC (PC ou Wi-Fi); no 4G o WebRTC não conecta. Detectado no probe. */
  talk?: boolean;
  home?: boolean;
  /** Comandos auxiliares exatamente como a câmera anuncia (ex.: "tt:Wiper|On"). */
  aux?: string[];
  /** Codec real dos fluxos (o perfil ONVIF pode mentir). */
  codecMain?: string;
  codecSub?: string;
  resolutionMain?: string;
  resolutionSub?: string;
  /** Resolução atual do fluxo principal escolhida pelo operador: "hd" (1080p) ou "uhd" (4K). */
  mainQuality?: "hd" | "uhd";
  firmware?: string;
  serial?: string;
  manufacturer?: string;
  lastProbeAt?: string;
}

/** O que o front recebe. Sem credencial, sem portas internas. */
export interface PublicCamera {
  id: number;
  siteId: number;
  name: string;
  model: string | null;
  features: CameraFeatures;
  isActive: boolean;
  /** Nomes dos fluxos no go2rtc. */
  streams: { sub: string; main: string };
  hasTunnel: boolean;
}

export function publicCamera(c: BessCamera): PublicCamera {
  return {
    id: c.id, siteId: c.siteId, name: c.name, model: c.model,
    features: (c.features as CameraFeatures | null) ?? {},
    isActive: c.isActive,
    streams: streamNames(c.id),
    hasTunnel: !!c.viaHost,
  };
}

export function streamNames(id: number): { sub: string; main: string } {
  return { sub: `cam${id}_sub`, main: `cam${id}_main` };
}

/** Endereços que o servidor usa para alcançar a câmera. */
export function endpoints(c: BessCamera): { httpBase: string; rtspMain: string; rtspSub: string; snapshotUrl: string } {
  const host = c.viaHost ?? c.host;
  const httpPort = c.viaHost ? (c.viaHttpPort ?? c.httpPort) : c.httpPort;
  const rtspPort = c.viaHost ? (c.viaRtspPort ?? c.rtspPort) : c.rtspPort;
  const cred = c.username ? `${encodeURIComponent(c.username)}:${encodeURIComponent(c.password)}@` : "";
  const path = (p: string) => (p.startsWith("/") ? p : `/${p}`);
  return {
    httpBase: `http://${host}:${httpPort}`,
    rtspMain: `rtsp://${cred}${host}:${rtspPort}${path(c.streamMain)}`,
    rtspSub: `rtsp://${cred}${host}:${rtspPort}${path(c.streamSub)}`,
    snapshotUrl: `http://${host}:${httpPort}${path(c.snapshotPath)}`,
  };
}

/**
 * Um cliente por câmera, reaproveitado entre chamadas: ele descobre os caminhos ONVIF (GetCapabilities)
 * só na primeira vez, e cada comando PTZ passa a custar uma única viagem até a câmera.
 * Trocado quando o cadastro muda (endereço, credencial ou `updatedAt`).
 */
const clientCache = new Map<number, { key: string; client: OnvifClient }>();
export function onvifClient(c: BessCamera): OnvifClient {
  const key = `${endpoints(c).httpBase}|${c.username}|${c.password}|${c.updatedAt?.getTime() ?? 0}`;
  const hit = clientCache.get(c.id);
  if (hit && hit.key === key) return hit.client;
  const client = new OnvifClient({ baseUrl: endpoints(c).httpBase, username: c.username, password: c.password });
  clientCache.set(c.id, { key, client });
  return client;
}

export async function listCameras(): Promise<BessCamera[]> {
  const db = await getDb();
  return db.select().from(bessCameras).orderBy(bessCameras.siteId, bessCameras.id);
}

export async function getCamera(id: number): Promise<BessCamera | null> {
  const db = await getDb();
  const rows = await db.select().from(bessCameras).where(eq(bessCameras.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateCameraFeatures(id: number, features: CameraFeatures, extra: Partial<Pick<InsertBessCamera, "model" | "onvifProfile" | "onvifVideoSource">> = {}): Promise<void> {
  const db = await getDb();
  await db.update(bessCameras).set({ features, ...extra }).where(eq(bessCameras.id, id));
}

export async function upsertCamera(data: InsertBessCamera & { id?: number }): Promise<number> {
  const db = await getDb();
  if (data.id) {
    const { id, ...rest } = data;
    await db.update(bessCameras).set(rest).where(eq(bessCameras.id, id));
    return id;
  }
  const r = await db.insert(bessCameras).values(data);
  return Number((r as unknown as [{ insertId: number }])[0]?.insertId ?? 0);
}
