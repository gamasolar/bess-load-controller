import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "logo.png", "logo-full.png"],
      manifest: {
        name: "BESS Load Controller — Gama Solar",
        short_name: "BESS Gama",
        description: "Monitoramento e controle das microrredes BESS Gama Solar",
        start_url: "/tablet",
        scope: "/",
        // `display: "fullscreen"` esconde URL bar do Chrome, barra de status do
        // Android e a barra de navegação. `display_override` declara cadeia de
        // fallback pra navegadores que não suportam fullscreen (cai pra
        // standalone ou minimal-ui).
        display: "fullscreen",
        display_override: ["fullscreen", "standalone", "minimal-ui"],
        orientation: "landscape",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        lang: "pt-BR",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true, // remove precaches de versões antigas ao ativar a nova
        navigateFallback: "/index.html",
        // O fallback de navegação (servir /index.html) NUNCA pode pegar as rotas
        // de backend: abrir um PDF de manual ou um arquivo em nova aba é uma
        // navegação, e sem esta lista o service worker devolvia a casca do app
        // no lugar do arquivo ("manual não abre").
        navigateFallbackDenylist: [/^\/api\//, /^\/storage\//],
        runtimeCaching: [
          {
            // Arquivos binários autenticados (PDF de manual, foto/quadro da
            // câmera, proxy go2rtc): direto da rede, sem cache e SEM timeout.
            // O timeout de 5s do /api/ derrubava o snapshot da câmera quando a
            // Starlink passava de 5s ("câmera não aparece").
            urlPattern: /\/api\/(manuals|camera|storage)\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" && !url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "html-cache",
              networkTimeoutSeconds: 3,
            },
          },
          {
            urlPattern: /\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: /\/assets\//,
            handler: "CacheFirst",
            options: {
              cacheName: "assets-cache",
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
