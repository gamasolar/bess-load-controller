import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "node:path";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "../auth";
import { registerUploadRoutes } from "../upload-routes";
import { appRouter, startAutoFetch, startMqttStateSync } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startAdaptivePolling } from "../poll-scheduler";
import { startPumpDailyJob } from "../pump-daily-job";
import { getFusionSolarClient, isFusionSolarConfigured, setRawKpiListener } from "../fusionsolar";
import { captureFusionSolarKpi, isTelemetryCaptureEnabled } from "../telemetry-capture";
import { HUAWEI_ALARM_FIRST_DELAY_MS, HUAWEI_ALARM_INTERVAL_MS, isHuaweiAlarmPollingEnabled, sweepHuaweiAlarms } from "../huawei-alarms";
import { addEvent, closeAlarmsByType, getActiveAlarms, getAllSites, getReadings, openAlarmIfMissing } from "../db";
import { energyAlarmConfigFromEnv, isEnergyAlertsEnabled, sweepEnergyAlarms } from "../energy-alarm";
import { getSiteRuntimeState } from "../control-engine";
import { notifyOwner } from "./notification";
import { registerCameraRoutes } from "../camera-routes";
import { registerManualRoutes } from "../manuals-routes";
import { getCameraStreamer, isCameraStreamingEnabled } from "../camera-stream";
import { listCameras } from "../camera-store";
import { startSmartloggerLive } from "../smartlogger-live";
import { startWaveshareLive, sweepWaveshareAlarms, isWaveshareLiveEnabled } from "../waveshare-live";

function getStorageRoot(): string {
  const override = process.env.STORAGE_DIR;
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  return path.resolve(process.cwd(), "storage-data");
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const server = createServer(app);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Static storage for generated PDFs / report assets (replaces Manus S3 proxy).
  app.use("/storage", express.static(getStorageRoot()));

  // Local email/password auth: POST /api/auth/{login,register}, GET /api/auth/status
  registerAuthRoutes(app);

  // Admin uploads: POST/DELETE /api/admin/sites/:id/background
  registerUploadRoutes(app);

  // Câmeras: foto, quadro e proxy de vídeo (go2rtc) com a sessão do app
  registerCameraRoutes(app, server);

  // Biblioteca de manuais: serve o PDF por id, com login
  registerManualRoutes(app, getStorageRoot());

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000", 10);
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // MVP v2 control loop is gated by env flag — defaults to v1 until
    // validated in Fase 4. Set USE_MVP_V2_CONTROL=true to switch.
    const useMvpV2 = process.env.USE_MVP_V2_CONTROL === "true";
    if (useMvpV2) {
      console.log("[Boot] USE_MVP_V2_CONTROL=true — adaptive polling + control-engine ATIVOS");
      startAdaptivePolling();
    } else {
      startAutoFetch();
    }
    // MQTT polling + DB sync runs in both modes (state observation only)
    // Telemetria completa: grava o pacote bruto que a FusionSolar já entrega.
    // Sem consultas a mais; não participa do controle. TELEMETRY_CAPTURE=off desliga.
    if (isTelemetryCaptureEnabled()) {
      setRawKpiListener((devTypeId, items) => { void captureFusionSolarKpi(devTypeId, items); });
      console.log("[Boot] Telemetria completa ATIVA (captura do pacote bruto da FusionSolar)");
    }

    if (isHuaweiAlarmPollingEnabled() && isFusionSolarConfigured()) {
      const yields = { count: 0 };
      const run = async () => {
        try {
          const r = await sweepHuaweiAlarms({
            yields,
            listSites: async () => (await getAllSites())
              .filter((x) => !!x.fusionsolarPlantCode)
              .map((x) => ({ id: x.id, name: x.name, plantCode: x.fusionsolarPlantCode as string })),
            anySiteCritical: async () => {
              for (const x of await getAllSites()) {
                if ((await getSiteRuntimeState(x.slug))?.inCriticalZone) return true;
              }
              return false;
            },
            fetchAlarms: (codes, begin, end) => getFusionSolarClient().getAlarmListOrNull(codes, begin, end),
            listOpen: async () => (await getActiveAlarms()).map((a) => ({ siteId: a.siteId, type: a.type })),
            open: (a) => openAlarmIfMissing(a.siteId, a.severity, a.type, a.description),
            close: (a) => closeAlarmsByType(a.type, a.siteId),
            notify: async (siteName, message) => {
              try { await notifyOwner({ title: `⚠️ ALARME CRÍTICO — ${siteName}`, content: message }); } catch { /* canal de saída é opcional */ }
            },
          });
          console.log("[HuaweiAlarms]", JSON.stringify(r));
        } catch (e) {
          console.warn("[HuaweiAlarms] erro:", e instanceof Error ? e.message : e);
        }
      };
      setTimeout(() => { void run(); setInterval(() => void run(), HUAWEI_ALARM_INTERVAL_MS); }, HUAWEI_ALARM_FIRST_DELAY_MS);
      console.log("[Boot] Alarmes do fabricante: consulta a cada 30 min (primeira em 5 min)");
    }
    // Alertas de energia (SOC baixo, bombas ligadas sem sol, carga noturna alta):
    // só observa e avisa; nada de atuação. ENERGY_ALERTS=off desliga.
    if (isEnergyAlertsEnabled()) {
      const cfg = energyAlarmConfigFromEnv();
      const watched = (process.env.ENERGY_ALERT_SITES ?? "barragem").split(",").map((s) => s.trim()).filter(Boolean);
      const run = async () => {
        try {
          const r = await sweepEnergyAlarms({
            config: cfg,
            sites: watched,
            listSites: async () => (await getAllSites()).map((x) => ({ id: x.id, slug: x.slug, name: x.name })),
            latestReading: async (siteId) => {
              const rows = await getReadings(siteId, 2);
              const last = rows.length ? rows[rows.length - 1] : null;
              if (!last) return null;
              const num = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
              return { soc: num(last.soc), loadKw: num(last.loadPower), batteryKw: num(last.batteryPower), at: new Date(last.createdAt) };
            },
            listOpen: async (siteId) => (await getActiveAlarms(siteId)).map((a) => a.type),
            open: (siteId, a) => openAlarmIfMissing(siteId, a.severity, a.type, a.description),
            close: (siteId, type) => closeAlarmsByType(type, siteId),
            event: (siteId, type, description) => addEvent(siteId, type, description),
            notify: async (siteName, a) => {
              const title = a.severity === "CRITICAL" ? `⚠️ ALARME CRÍTICO — ${siteName}` : `⚠️ Aviso — ${siteName}`;
              try { await notifyOwner({ title, content: a.description }); } catch { /* canal de saída é opcional */ }
            },
          });
          if (r.opened || r.closed) console.log("[EnergyAlerts]", JSON.stringify(r));
        } catch (e) {
          console.warn("[EnergyAlerts] erro:", e instanceof Error ? e.message : e);
        }
      };
      setTimeout(() => { void run(); setInterval(() => void run(), 60_000); }, 20_000);
      console.log(`[Boot] Alertas de energia ativos (${watched.join(", ")}): SOC crítico ${cfg.socCritico}%, SOC noite ${cfg.socNoite}%, bombas ≥ ${cfg.bombaKw} kW das ${cfg.noiteInicio}h às ${cfg.noiteFim}h`);
    }
    // Vídeo das câmeras: go2rtc como processo filho, só em 127.0.0.1. CAMERA_STREAMS=off desliga.
    if (isCameraStreamingEnabled()) {
      listCameras().then((cams) => {
        if (cams.length === 0) { console.log("[Camera] nenhuma câmera cadastrada; go2rtc não iniciado"); return; }
        getCameraStreamer(getStorageRoot()).start(cams);
      }).catch((e) => console.warn("[Camera] não li o cadastro de câmeras:", e instanceof Error ? e.message : e));
    }
    startMqttStateSync();
    // Snapshot diário da operação da bomba (recovery + cron horário)
    startPumpDailyJob();
    // Leitura AO VIVO do SmartLogger direto da usina (camada 1 da escada de
    // fontes). Só lê e grava em smartlogger_live; não toca no controle da bomba.
    // SMARTLOGGER_LIVE=off desliga. Ver smartlogger-live.ts.
    startSmartloggerLive().catch((e) =>
      console.warn("[SmartloggerLive] falhou ao iniciar:", e instanceof Error ? e.message : e));
    // SUPERVISÃO do relé Waveshare (braço atuador da bomba) — Fase 1 do Caminho 2.
    // Só leitura: estado do relé + retorno do contator para a tela e os alarmes
    // RELE_OFFLINE / DIVERGENCIA_RETORNO. Não comanda nada. WAVESHARE_LIVE=off desliga.
    if (isWaveshareLiveEnabled()) {
      startWaveshareLive().catch((e) =>
        console.warn("[WaveshareLive] falhou ao iniciar:", e instanceof Error ? e.message : e));
      const runRele = async () => {
        try {
          const r = await sweepWaveshareAlarms({
            listSites: async () => (await getAllSites()).map((x) => ({ id: x.id, slug: x.slug, name: x.name })),
            listOpen: async (siteId) => (await getActiveAlarms(siteId)).map((a) => a.type),
            open: (siteId, a) => openAlarmIfMissing(siteId, a.severity, a.type, a.description),
            close: (siteId, type) => closeAlarmsByType(type, siteId),
            event: (siteId, type, description) => addEvent(siteId, type, description),
            notify: async (siteName, a) => {
              const title = a.severity === "CRITICAL" ? `⚠️ ALARME CRÍTICO — ${siteName}` : `⚠️ Aviso — ${siteName}`;
              try { await notifyOwner({ title, content: a.description }); } catch { /* canal de saída é opcional */ }
            },
          });
          if (r.opened || r.closed) console.log("[WaveshareAlarms]", JSON.stringify(r));
        } catch (e) {
          console.warn("[WaveshareAlarms] erro:", e instanceof Error ? e.message : e);
        }
      };
      setTimeout(() => { void runRele(); setInterval(() => void runRele(), 30_000); }, 25_000);
      console.log("[Boot] Supervisão do relé Waveshare ativa (RELE_OFFLINE / DIVERGENCIA_RETORNO).");
    }
  });
}

startServer().catch(console.error);
