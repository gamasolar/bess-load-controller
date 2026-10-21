/**
 * Sonda de câmera: lê identificação, recursos, presets, posição e imagem de
 * uma câmera cadastrada, pela mesma camada que a aba de câmeras usa.
 *   npx tsx server/tools/camera-probe.ts [id]
 * Só leitura; não move nem altera nada.
 */
import "dotenv/config";
import { getCamera, onvifClient } from "../camera-store";
import { probeCamera } from "../camera-api";

(async () => {
  const id = Number(process.argv[2] ?? 1);
  const c = await getCamera(id);
  if (!c) { console.error(`câmera ${id} não cadastrada`); process.exit(1); }
  console.log(`câmera ${c.id} "${c.name}" host ${c.host}${c.viaHost ? ` via ${c.viaHost}:${c.viaHttpPort}` : ""}`);
  const f = await probeCamera(c);
  console.log("features:", JSON.stringify(f));
  const c2 = (await getCamera(id))!;
  const cl = onvifClient(c2);
  console.log("tokens:", c2.onvifProfile, c2.onvifVideoSource);
  const t = await cl.getDeviceTime();
  console.log("relógio da câmera (UTC):", t?.toISOString(), "| servidor:", new Date().toISOString(), "| diferença s:", t ? Math.round((t.getTime() - Date.now()) / 1000) : null);
  const presets = await cl.getPresets(c2.onvifProfile!);
  console.log("presets:", presets.length, JSON.stringify(presets.slice(0, 6)));
  console.log("status:", JSON.stringify(await cl.getStatus(c2.onvifProfile!)));
  try { const { raw, ...rest } = await cl.getImagingSettings(c2.onvifVideoSource!); console.log("imaging:", JSON.stringify(rest)); console.log("raw:", raw.replace(/\s+/g, " ").slice(0, 700)); } catch (e) { console.log("imaging ERR:", (e as Error).message); }
  try { console.log("options:", JSON.stringify(await cl.getImagingOptions(c2.onvifVideoSource!))); } catch (e) { console.log("options ERR:", (e as Error).message); }
  process.exit(0);
})().catch((e) => { console.error("ERRO:", e instanceof Error ? e.message : e); process.exit(1); });
