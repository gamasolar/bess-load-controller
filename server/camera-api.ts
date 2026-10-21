/**
 * API (tRPC) das câmeras: cadastro visível, estado e comandos ONVIF.
 * Comandos exigem usuário logado; o que muda a câmera de forma duradoura
 * (presets, lâmpada, imagem) vira evento no histórico da usina.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { protectedProcedure, router } from "./_core/trpc";
import { addEvent, getAllSites } from "./db";
import { getCamera, listCameras, onvifClient, publicCamera, streamNames, updateCameraFeatures, type CameraFeatures } from "./camera-store";
import { OnvifError, type ImagingPatch } from "./onvif";
import { grabFrame } from "./camera-routes";
import { getCameraStreamer } from "./camera-stream";
import type { BessCamera } from "../drizzle/schema";

const id = z.object({ id: z.number().int().positive() });

const MAIN_ENCODER_TOKEN = "VideoEncodeMain";
const MAIN_SPECS = {
  hd: { width: 1920, height: 1080, fps: 20, kbps: 3072, gop: 20 },
  uhd: { width: 3840, height: 2160, fps: 20, kbps: 6144, gop: 40 },
} as const;

function storageRoot(): string {
  const o = process.env.STORAGE_DIR;
  return o && o.trim() ? path.resolve(o.trim()) : path.resolve(process.cwd(), "storage-data");
}
function presetThumbPath(camId: number, token: string): { file: string; url: string } {
  const safe = token.replace(/[^\w-]+/g, "_");
  const dir = path.join(storageRoot(), "cameras", String(camId));
  return { file: path.join(dir, `preset-${safe}.jpg`), url: `/storage/cameras/${camId}/preset-${safe}.jpg` };
}

async function cam(idValue: number): Promise<BessCamera> {
  const c = await getCamera(idValue);
  if (!c || !c.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Câmera não encontrada" });
  return c;
}

/** Erro da câmera vira mensagem legível, não stack. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    // 422 (não 502): "a câmera recusou/não respondeu" é erro do dispositivo, mas precisa chegar como
    // JSON na tela. O Cloudflare troca respostas 5xx pela PÁGINA DE ERRO dele (HTML), e aí o front
    // quebrava com "Unexpected token '<'". 4xx passa direto, então a mensagem real aparece.
    if (e instanceof OnvifError) throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: e.message });
    throw e;
  }
}

/** Perfil e fonte de vídeo ONVIF; descobre e guarda na primeira vez. */
async function tokens(c: BessCamera): Promise<{ profile: string; videoSource: string }> {
  if (c.onvifProfile && c.onvifVideoSource) return { profile: c.onvifProfile, videoSource: c.onvifVideoSource };
  const client = onvifClient(c);
  const profiles = await client.getProfiles();
  const main = profiles.find((p) => p.ptzConfig) ?? profiles[0];
  if (!main) throw new OnvifError("câmera sem perfil de mídia ONVIF");
  const videoSource = main.videoSource ?? "VideoSourceMain";
  await updateCameraFeatures(c.id, (c.features as CameraFeatures | null) ?? {}, { onvifProfile: main.token, onvifVideoSource: videoSource });
  return { profile: main.token, videoSource };
}

/** Pergunta à câmera o que ela sabe fazer e guarda no cadastro. */
export async function probeCamera(c: BessCamera): Promise<CameraFeatures> {
  const client = onvifClient(c);
  const info = await client.getDeviceInformation();
  const profiles = await client.getProfiles();
  const main = profiles.find((p) => p.ptzConfig) ?? profiles[0];
  const sub = profiles.find((p) => p !== main);
  let nodes: Awaited<ReturnType<typeof client.getPtzNodes>> = [];
  try { nodes = await client.getPtzNodes(); } catch { /* sem PTZ */ }
  const node = nodes[0];
  const aux = node?.aux ?? [];
  let focus = false;
  try {
    const opts = await client.getImagingOptions(main?.videoSource ?? "VideoSourceMain");
    focus = opts.focusModes.length > 0 || !!opts.focusSpeed;
  } catch { /* sem imaging */ }
  const prev = (c.features as CameraFeatures | null) ?? {};
  const features: CameraFeatures = {
    ...prev,
    manufacturer: info.manufacturer || prev.manufacturer, firmware: info.firmware || prev.firmware, serial: info.serial || prev.serial,
    ptz: !!node && (node.continuousPanTilt || node.absolutePanTilt),
    zoom: !!node && (node.continuousZoom || node.absoluteZoom),
    focus,
    wiper: aux.some((a) => /wiper/i.test(a)),
    lamp: aux.some((a) => /lamp|light/i.test(a)),
    audio: profiles.some((p) => p.hasAudio),
    presets: node?.maxPresets ?? null,
    home: node?.homeSupported ?? false,
    aux,
    resolutionMain: main && main.width ? `${main.width}×${main.height}` : prev.resolutionMain,
    resolutionSub: sub && sub.width ? `${sub.width}×${sub.height}` : prev.resolutionSub,
    lastProbeAt: new Date().toISOString(),
  };
  await updateCameraFeatures(c.id, features, { model: info.model || c.model, onvifProfile: main?.token ?? c.onvifProfile, onvifVideoSource: main?.videoSource ?? c.onvifVideoSource });
  return features;
}

/** Comando auxiliar no formato que a câmera anunciou (ex.: tt:Wiper|On). */
function auxCommand(features: CameraFeatures, kind: "wiper" | "lamp", on: boolean): string {
  const list = features.aux ?? [];
  const want = kind === "wiper" ? /wiper/i : /lamp|light/i;
  const state = on ? /\|?on$/i : /\|?off$/i;
  return list.find((a) => want.test(a) && state.test(a)) ?? `tt:${kind === "wiper" ? "Wiper" : "Lamp"}|${on ? "On" : "Off"}`;
}

export const cameraRouter = router({
  /** Cartões: todas as usinas, com suas câmeras (ou nenhuma). */
  list: protectedProcedure.query(async () => {
    const [sites, cameras] = await Promise.all([getAllSites(), listCameras()]);
    return sites.filter((s) => s.isActive).map((s) => ({
      siteId: s.id, slug: s.slug, name: s.name,
      cameras: cameras.filter((c) => c.siteId === s.id && c.isActive).map(publicCamera),
    }));
  }),

  get: protectedProcedure.input(id).query(async ({ input }) => {
    const c = await cam(input.id);
    const sites = await getAllSites();
    const site = sites.find((s) => s.id === c.siteId);
    return { ...publicCamera(c), site: site ? { id: site.id, slug: site.slug, name: site.name } : null };
  }),

  /** Estado vivo: presets, posição, imagem, relógio. Falhas parciais não derrubam o resto. */
  state: protectedProcedure.input(id).query(async ({ input }) => {
    const c = await cam(input.id);
    const client = onvifClient(c);
    const t = await run(() => tokens(c));
    const [presets, status, imaging, options, clock] = await Promise.all([
      client.getPresets(t.profile).catch(() => null),
      client.getStatus(t.profile).catch(() => null),
      client.getImagingSettings(t.videoSource).catch(() => null),
      client.getImagingOptions(t.videoSource).catch(() => null),
      client.getDeviceTime().catch(() => null),
    ]);
    // A lista de vistas vem do nosso cadastro (nome + miniatura); a câmera só confirma que o PTZ responde
    // (ela devolve 255 slots com nome = número, então não dá pra distinguir os gravados pelo que ela diz).
    const saved = ((c.features as CameraFeatures | null)?.savedPresets) ?? [];
    const named = saved.map((p) => {
      const thumb = presetThumbPath(c.id, p.token);
      return { token: p.token, name: p.name, thumb: existsSync(thumb.file) ? thumb.url : null };
    });
    const { raw: _raw, ...img } = imaging ?? { raw: "" } as NonNullable<typeof imaging>;
    return {
      online: !!(presets || status || imaging),
      presets: named,
      status,
      imaging: imaging ? img : null,
      options,
      clockOffsetSeconds: clock ? Math.round((clock.getTime() - Date.now()) / 1000) : null,
    };
  }),

  probe: protectedProcedure.input(id).mutation(async ({ input }) => run(async () => probeCamera(await cam(input.id)))),

  ptz: router({
    move: protectedProcedure.input(id.extend({ pan: z.number().min(-1).max(1).default(0), tilt: z.number().min(-1).max(1).default(0), zoom: z.number().min(-1).max(1).default(0) }))
      .mutation(async ({ input }) => run(async () => {
        const c = await cam(input.id); const t = await tokens(c);
        await onvifClient(c).continuousMove(t.profile, input, 5);
        return { ok: true };
      })),
    stop: protectedProcedure.input(id).mutation(async ({ input }) => run(async () => {
      const c = await cam(input.id); const t = await tokens(c);
      await onvifClient(c).stop(t.profile);
      return { ok: true };
    })),
    home: protectedProcedure.input(id).mutation(async ({ input }) => run(async () => {
      const c = await cam(input.id); const t = await tokens(c);
      await onvifClient(c).gotoHome(t.profile);
      return { ok: true };
    })),
    setHome: protectedProcedure.input(id).mutation(async ({ input, ctx }) => run(async () => {
      const c = await cam(input.id); const t = await tokens(c);
      await onvifClient(c).setHome(t.profile);
      await addEvent(c.siteId, "CAMERA", `Câmera ${c.name}: posição inicial redefinida por ${ctx.user.name ?? ctx.user.email}`);
      return { ok: true };
    })),
    status: protectedProcedure.input(id).query(async ({ input }) => run(async () => {
      const c = await cam(input.id); const t = await tokens(c);
      return onvifClient(c).getStatus(t.profile);
    })),
  }),

  presets: router({
    goto: protectedProcedure.input(id.extend({ token: z.string().min(1).max(64) })).mutation(async ({ input }) => run(async () => {
      const c = await cam(input.id); const t = await tokens(c);
      await onvifClient(c).gotoPreset(t.profile, input.token);
      return { ok: true };
    })),
    /** Grava a posição atual com nome e guarda uma miniatura do que a câmera vê. */
    save: protectedProcedure.input(id.extend({ name: z.string().trim().min(1).max(40), token: z.string().max(64).optional() })).mutation(async ({ input, ctx }) => run(async () => {
      const c = await cam(input.id); const t = await tokens(c);
      const features = (c.features as CameraFeatures | null) ?? {};
      const saved = features.savedPresets ?? [];
      // Token: o informado (regravar/renomear) ou o menor número livre 1–255 (a câmera guarda a posição nesse slot).
      let token = input.token?.trim() ?? "";
      if (!token) {
        const used = new Set(saved.map((p) => p.token));
        for (let n = 1; n <= 255 && !token; n++) if (!used.has(String(n))) token = String(n);
        if (!token) throw new OnvifError("limite de 255 vistas atingido");
      }
      await onvifClient(c).setPreset(t.profile, input.name, token);
      const thumb = presetThumbPath(c.id, token);
      const frame = await grabFrame(streamNames(c.id).sub, 8000);
      if (frame) { mkdirSync(path.dirname(thumb.file), { recursive: true }); writeFileSync(thumb.file, frame); }
      const next = [...saved.filter((p) => p.token !== token), { token, name: input.name }];
      await updateCameraFeatures(c.id, { ...features, savedPresets: next });
      await addEvent(c.siteId, "CAMERA", `Câmera ${c.name}: posição "${input.name}" gravada por ${ctx.user.name ?? ctx.user.email}`);
      return { token, thumb: frame ? thumb.url : null };
    })),
    remove: protectedProcedure.input(id.extend({ token: z.string().min(1).max(64) })).mutation(async ({ input, ctx }) => run(async () => {
      const c = await cam(input.id); const t = await tokens(c);
      await onvifClient(c).removePreset(t.profile, input.token).catch(() => undefined); // o nome é nosso; se a câmera recusar, seguimos
      const features = (c.features as CameraFeatures | null) ?? {};
      if (features.savedPresets?.some((p) => p.token === input.token)) {
        await updateCameraFeatures(c.id, { ...features, savedPresets: features.savedPresets.filter((p) => p.token !== input.token) });
      }
      const thumb = presetThumbPath(c.id, input.token);
      if (existsSync(thumb.file)) unlinkSync(thumb.file);
      await addEvent(c.siteId, "CAMERA", `Câmera ${c.name}: posição ${input.token} apagada por ${ctx.user.name ?? ctx.user.email}`);
      return { ok: true };
    })),
  }),

  /** Limpador de lente e lâmpada. */
  aux: protectedProcedure.input(id.extend({ kind: z.enum(["wiper", "lamp"]), on: z.boolean() })).mutation(async ({ input, ctx }) => run(async () => {
    const c = await cam(input.id); const t = await tokens(c);
    const features = (c.features as CameraFeatures | null) ?? {};
    const command = auxCommand(features, input.kind, input.on);
    // Manha da XMeye: ela ANUNCIA "tt:Lamp|Off" mas só aceita "tt:Lamp|OFF" (e o Wiper é o contrário).
    // Se recusar o caso anunciado, tenta uma vez com a caixa do sufixo trocada, pra não quebrar se a
    // câmera for re-sondada e a lista voltar ao caso errado.
    const reply = await onvifClient(c).sendAuxiliary(t.profile, command).catch((e) => {
      if (!(e instanceof OnvifError)) throw e;
      const i = command.lastIndexOf("|");
      if (i < 0) throw e;
      const suf = command.slice(i + 1);
      const flipped = command.slice(0, i + 1) + (suf === suf.toUpperCase() ? suf.charAt(0) + suf.slice(1).toLowerCase() : suf.toUpperCase());
      return onvifClient(c).sendAuxiliary(t.profile, flipped);
    });
    if (input.kind === "lamp") await addEvent(c.siteId, "CAMERA", `Câmera ${c.name}: lâmpada ${input.on ? "ligada" : "desligada"} por ${ctx.user.name ?? ctx.user.email}`);
    return { ok: true, reply };
  })),

  /** Alterna a resolução do fluxo principal entre HD (1080p) e 4K. Reinicia o go2rtc para pegar a nova resolução. */
  setMainQuality: protectedProcedure.input(id.extend({ quality: z.enum(["hd", "uhd"]) })).mutation(async ({ input, ctx }) => run(async () => {
    const c = await cam(input.id);
    const spec = MAIN_SPECS[input.quality];
    await onvifClient(c).setVideoEncoder(MAIN_ENCODER_TOKEN, spec);
    const prev = (c.features as CameraFeatures | null) ?? {};
    await updateCameraFeatures(c.id, { ...prev, mainQuality: input.quality, resolutionMain: `${spec.width}x${spec.height}` });
    getCameraStreamer(storageRoot()).reload(await listCameras());
    await addEvent(c.siteId, "CAMERA", `Câmera ${c.name}: qualidade ${input.quality === "uhd" ? "4K" : "HD"} por ${ctx.user.name ?? ctx.user.email}`);
    return { ok: true, quality: input.quality };
  })),

  focus: router({
    move: protectedProcedure.input(id.extend({ speed: z.number().min(-1).max(1) })).mutation(async ({ input }) => run(async () => {
      const c = await cam(input.id); const t = await tokens(c);
      await onvifClient(c).focusMove(t.videoSource, input.speed);
      return { ok: true };
    })),
    stop: protectedProcedure.input(id).mutation(async ({ input }) => run(async () => {
      const c = await cam(input.id); const t = await tokens(c);
      await onvifClient(c).focusStop(t.videoSource);
      return { ok: true };
    })),
  }),

  imaging: router({
    set: protectedProcedure.input(id.extend({
      brightness: z.number().optional(), contrast: z.number().optional(), saturation: z.number().optional(), sharpness: z.number().optional(),
      irCut: z.enum(["ON", "OFF", "AUTO"]).optional(), focusMode: z.enum(["AUTO", "MANUAL"]).optional(), defog: z.enum(["ON", "OFF", "AUTO"]).optional(),
      wdr: z.object({ mode: z.enum(["ON", "OFF"]), level: z.number().nullable() }).optional(),
      blc: z.object({ mode: z.enum(["ON", "OFF"]), level: z.number().nullable() }).optional(),
    })).mutation(async ({ input, ctx }) => run(async () => {
      const { id: camId, ...patch } = input;
      const c = await cam(camId); const t = await tokens(c);
      const after = await onvifClient(c).setImagingSettings(t.videoSource, patch as ImagingPatch);
      const changed = Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
      await addEvent(c.siteId, "CAMERA", `Câmera ${c.name}: imagem ajustada (${changed}) por ${ctx.user.name ?? ctx.user.email}`);
      const { raw: _raw, ...rest } = after;
      return rest;
    })),
  }),
});
