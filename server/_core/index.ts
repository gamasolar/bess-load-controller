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
    startMqttStateSync();
    // Snapshot diário da operação da bomba (recovery + cron horário)
    startPumpDailyJob();
  });
}

startServer().catch(console.error);
