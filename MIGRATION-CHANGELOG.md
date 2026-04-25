# MIGRATION-CHANGELOG.md

Self-hosted migration of the BESS Load Controller Dashboard, off the Manus
platform. This file lists every file touched and why.

Date: 2026-04-22

---

## 1. Authentication: OAuth Manus → Local email/password (Task 1)

| File | Change |
|---|---|
| `drizzle/schema.ts` | Added `passwordHash: varchar(255)` (nullable) to `users` table. |
| `drizzle/0009_add_password_hash.sql` | **New.** Manual ALTER TABLE migration (used if you skip `drizzle-kit generate`). |
| `server/auth.ts` | **New.** bcrypt hashing + `jose` JWT signing/verifying. Exports `hashPassword`, `verifyPassword`, `createSession`, `verifySession`, `registerAuthRoutes`. Mounts `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/status`. |
| `server/_core/context.ts` | Rewritten. Reads JWT from cookie `app_session_id`, calls `verifySession`, looks up user via `db.getUserByOpenId`. No more SDK calls. |
| `server/_core/oauth.ts` | Reduced to a compatibility shim: `registerOAuthRoutes(app)` now just calls `registerAuthRoutes(app)`. |
| `server/_core/sdk.ts` | **Deleted.** OAuth SDK no longer needed. |
| `server/_core/types/manusTypes.ts` | **Deleted.** OAuth types no longer needed. |
| `server/db.ts` | Removed dead `OWNER_OPEN_ID` admin promotion logic. Added `passwordHash` handling to `upsertUser`. Removed orphan `import { ENV }`. |
| `server/auth.logout.test.ts` | Updated mock user (`loginMethod: "local"`, `passwordHash: null`). |
| `server/reports.test.ts` | Same mock update. |
| `client/src/const.ts` | Removed OAuth `getLoginUrl()` URL builder. Now exports `LOGIN_PATH = "/login"` and a backwards-compat `getLoginUrl()` that just returns it. |
| `client/src/_core/hooks/useAuth.ts` | Removed `manus-runtime-user-info` localStorage write. Logout now redirects to `/login`. |
| `client/src/main.tsx` | Replaced `getLoginUrl()` with `LOGIN_PATH`. Added redirect-loop guard. |
| `client/src/App.tsx` | Added a `/login` route that renders `<Login />` outside `DashboardLayout` (so the auth gate in the layout doesn't kick the user back). |
| `client/src/pages/Login.tsx` | **New.** Email + password form with login/register toggle. Auto-detects "no users yet" and switches to "create admin" mode. |
| `client/src/components/DashboardLayout.tsx` | Login button now navigates to `/login` instead of OAuth portal. |

### Security model

- Sessions are JWTs (HS256) signed with `JWT_SECRET`, valid for 1 year.
- Stored in an `httpOnly` cookie called `app_session_id` (`sameSite=none`, `secure` when behind HTTPS).
- `bcryptjs` cost factor 10.
- The first user registered when the `users` table is empty is promoted to `role=admin`.
- Subsequent registrations create `role=user`.
- Set `ALLOW_SIGNUP=false` in `.env` to disable signup once the team is set up.
- The `email` column doubles as the canonical `openId` (lowercased, trimmed) so the existing unique constraint keeps working without a schema redesign.

---

## 2. Storage: S3 (Forge) → Local filesystem (Task 2)

| File | Change |
|---|---|
| `server/storage.ts` | Rewritten. `storagePut` writes to `./storage-data/<key>` (override with `STORAGE_DIR` env). Returns URL `/storage/<key>`. `storageGet` and `storageGetSignedUrl` return the same path (no signing needed for filesystem). |
| `server/_core/storageProxy.ts` | **Deleted.** No more S3 presign proxy. |
| `server/_core/index.ts` | Replaced `registerStorageProxy(app)` with `app.use("/storage", express.static(getStorageRoot()))`. |

The `report-generator.ts` keeps using `storagePut` exactly as before; only the implementation changed.

---

## 3. Notifications: Forge Notification Service → Telegram (Task 3)

| File | Change |
|---|---|
| `server/_core/notification.ts` | Rewritten. `notifyOwner` now calls `https://api.telegram.org/bot<TOKEN>/sendMessage` with markdown-escaped body. Times out after 10 s. Returns `false` (no throw) if `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are missing — the BESS control loop is never blocked by missing notification config. |

Callers (`server/routers.ts:69` for critical alarms, `server/report-generator.ts:234` for daily/weekly reports) are unchanged.

---

## 4. Cleanup of Manus-only code (Task 4)

### Deleted (server-side, never used by BESS):

- `server/_core/llm.ts`
- `server/_core/imageGeneration.ts`
- `server/_core/map.ts`
- `server/_core/dataApi.ts`
- `server/_core/voiceTranscription.ts`
- `server/_core/systemRouter.ts` — was only `health` + `notifyOwner` mutation. Replaced by an inline router in `server/routers.ts` that keeps `system.health` working.

### Deleted (client-side, never imported):

- `client/src/components/Map.tsx` — Google Maps wrapper, used `VITE_FRONTEND_FORGE_API_KEY`.
- `client/src/components/AIChatBox.tsx` — Manus LLM chat widget.
- `client/src/components/ManusDialog.tsx` — Manus-branded dialog.
- `client/src/pages/ComponentShowcase.tsx` — 57 KB demo page that imported `AIChatBox`.

### Modified:

| File | Change |
|---|---|
| `vite.config.ts` | Removed `vite-plugin-manus-runtime`, `@builder.io/vite-plugin-jsx-loc`, the in-file `vitePluginManusDebugCollector`, and `*.manus.computer` / `*.manuspre.computer` etc. from `allowedHosts`. Plugins are now just `[react(), tailwindcss()]`. |
| `client/index.html` | Removed Umami analytics `<script>`. |
| `package.json` | **Removed** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@builder.io/vite-plugin-jsx-loc`, `vite-plugin-manus-runtime`. **Added** `bcryptjs` and `@types/bcryptjs`. |
| `server/_core/env.ts` | Trimmed to only the env vars that are actually used: `JWT_SECRET`, `DATABASE_URL`, `FUSIONSOLAR_*`, `MQTT_*`, `NODE_ENV`. Removed `appId`, `oAuthServerUrl`, `ownerOpenId`, `forgeApiUrl`, `forgeApiKey`. |
| `server/routers.ts` | Removed `import { systemRouter }`. Replaced `system: systemRouter` with an inline `router({ health: ... })`. |

---

## 5. Build (Task 5)

`package.json` scripts are unchanged:

```
"build": "vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
"start": "NODE_ENV=production node dist/index.js"
```

`server/_core/index.ts` already binds to `process.env.PORT || 3000` — no port hardcoded.

---

## 6. `.env.example` (Task 6)

**New.** Documents every env var the server reads, with sensible defaults and comments. See file at the repo root.

---

## 7. Tests (Task 7)

143 tests in 11 files. Untouched except for the two mock-user updates listed above. The lock file (`pnpm-lock.yaml`) was **not** regenerated — run `pnpm install` once on the target server to refresh it after the dependency edits.

Some `fusionsolar.test.ts` tests hit the real Huawei API and may timeout under rate-limit (407). This is expected.

---

## 8. Deployment artifacts (Task 8)

| File | Purpose |
|---|---|
| `deploy/bess-dashboard.service` | systemd unit. Runs `node dist/index.js` as `gamaserver` from `/opt/bess-dashboard`, loads `.env`, restarts on failure with hardening (`NoNewPrivileges`, `ProtectSystem=strict`, etc.). |
| `deploy/nginx.conf` | nginx reverse proxy server block for `bess.gamatech.cloud` → `127.0.0.1:3000`. Includes `/healthz` for monitoring. |

See `DEPLOY.md` for full step-by-step server provisioning.

---

## What was NOT modified (per the spec)

- `server/fusionsolar.ts` — FusionSolar Northbound client with rate-limit handling. **Exception:** see "Bug fix: device-ID parsing" below.
- `server/mqtt-tasmota.ts` — MQTT client for Sonoff POWR316D.
- `server/routers.ts` — only the two import lines + inline systemRouter (everything else, including all BESS business logic, untouched).
- `server/report-generator.ts` — unchanged.
- `server/db.ts` — only the dead OWNER_OPEN_ID branch and the orphan ENV import; all BESS data accessors untouched.
- `shared/energy-flow-logic.ts` — unchanged.
- `client/src/components/ui/` — shadcn/ui primitives untouched.
- All FusionSolar rate-limit constants, MQTT topics, control thresholds — untouched.

---

## 9. Bug fix: FusionSolar device-ID parsing

This was discovered after the initial migration. **Root cause:** the
`getDevList` Northbound endpoint returns devices with the fields `id` (long
numeric, e.g. `1000000054174514`) and `devDn` (e.g. `"NE=54174514"`). The
old code declared the interface as `devId: string` and read `dev.devId`,
which always returned `undefined` because that field doesn't exist in the
API response.

**Symptom:** `discoverDeviceIds()` populated `batteryIds` and `inverterIds`
with the literal string `"undefined"`. Manual configuration with the short
ID from the portal URL also failed: `getDevRealKpi` returns EMPTY for both
ESS (devTypeId=41) and inverters (devTypeId=1) when called with the short
ID. Only the long `id` works.

**Fix in `server/fusionsolar.ts`:**

| Change | Why |
|---|---|
| `interface FusionSolarDevice` — added optional `id?: number \| string` and `devDn?: string`. Kept `devId?` for any legacy reader. | Reflect what the API actually returns. |
| `discoverDeviceIds()` — now picks `dev.id` first, with a `devDn`/`devId` fallback (stripping the `"NE="` prefix). Skips devices with no usable id instead of pushing `"undefined"`. | Use the long ID that `getDevRealKpi` actually accepts. |

No other behavior changed. Rate limit, backoff, login interval, auto-fetch
period are untouched. The fix is additive on the type level (existing
callers still compile).

**Operational impact:** the `DEPLOY.md` SQL `UPDATE` statements were
corrected to use the long IDs (`1000000054175052`, etc.) instead of the
short portal IDs (`54175052`). If you already applied the old SQL, re-run
the new one — it's idempotent.
