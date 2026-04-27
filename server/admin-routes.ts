import { z } from "zod";
import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { getSessionCookieOptions } from "./_core/cookies";
import { hashPassword, createSession, emailToOpenId } from "./auth";
import {
  getDb,
  listUsers, getUserById, updateUserMeta, setUserPasswordHash,
  createInvitation, listInvitations, getInvitationByToken,
  markInvitationUsed, revokeInvitation,
  getUserByOpenId, upsertUser,
  deleteResolvedAlarmsOlderThan,
  getActiveAlarms, getAllSites, getBessState,
  getSetting, upsertSetting,
  recordAction,
  listAllSitesIncludingInactive, updateSiteById, getSiteById,
} from "./db";
import { users, bessActions, bessSites } from "../drizzle/schema";
import { isFusionSolarConfigured, getFusionSolarClient } from "./fusionsolar";
import { isMqttConfigured } from "./mqtt-tasmota";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (v: unknown): v is string =>
  typeof v === "string" && EMAIL_RE.test(v.trim()) && v.length <= 320;

function genToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ─── Users ───────────────────────────────────────────────────
export const usersRouter = router({
  list: adminProcedure.query(async () => {
    const all = await listUsers();
    return all.map(u => ({
      id: u.id, openId: u.openId, name: u.name, email: u.email,
      role: u.role, disabled: u.disabled,
      createdAt: u.createdAt, lastSignedIn: u.lastSignedIn,
    }));
  }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(1).max(128).optional(),
      email: z.string().email().optional(),
      role: z.enum(["user", "admin"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Self-protection: admin não pode demover a si mesmo
      if (input.role === "user" && ctx.user.id === input.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Você não pode remover seu próprio papel de admin.",
        });
      }
      const target = await getUserById(input.id);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });

      const patch: Parameters<typeof updateUserMeta>[1] = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.email !== undefined) patch.email = input.email.toLowerCase();
      if (input.role !== undefined) patch.role = input.role;
      await updateUserMeta(input.id, patch);
      return { success: true };
    }),

  setDisabled: adminProcedure
    .input(z.object({ id: z.number().int().positive(), disabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.id === input.id && input.disabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode desativar a si mesmo." });
      }
      const target = await getUserById(input.id);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      await updateUserMeta(input.id, { disabled: input.disabled });
      return { success: true };
    }),

  changePassword: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      newPassword: z.string().min(8).max(256),
    }))
    .mutation(async ({ input }) => {
      const target = await getUserById(input.id);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      const hash = await hashPassword(input.newPassword);
      await setUserPasswordHash(input.id, hash);
      return { success: true };
    }),
});

// ─── Invitations ─────────────────────────────────────────────
export const invitationsRouter = router({
  list: adminProcedure.query(async () => {
    const all = await listInvitations();
    return all.map(i => ({
      id: i.id, token: i.token, role: i.role,
      createdById: i.createdById,
      expiresAt: i.expiresAt, usedAt: i.usedAt, usedByUserId: i.usedByUserId,
      createdAt: i.createdAt,
    }));
  }),

  create: adminProcedure
    .input(z.object({
      role: z.enum(["user", "admin"]),
      expiresInDays: z.number().int().min(1).max(30).default(7),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = genToken();
      const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000);
      await createInvitation({
        token, role: input.role,
        createdById: ctx.user.id,
        expiresAt,
      });
      return { token, role: input.role, expiresAt };
    }),

  revoke: adminProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const inv = await getInvitationByToken(input.token);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Convite não encontrado." });
      if (inv.usedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Convite já consumido ou revogado." });
      await revokeInvitation(input.token);
      return { success: true };
    }),

  // Public: somebody opening the invite link can preview the role.
  inspect: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const inv = await getInvitationByToken(input.token);
      if (!inv) return { valid: false as const, reason: "Convite não encontrado." };
      if (inv.usedAt) return { valid: false as const, reason: "Convite já utilizado ou revogado." };
      if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) {
        return { valid: false as const, reason: "Convite expirado." };
      }
      return { valid: true as const, role: inv.role, expiresAt: inv.expiresAt };
    }),

  // Public: consume invitation -> create user + auto-login
  consume: publicProcedure
    .input(z.object({
      token: z.string(),
      name: z.string().min(1).max(128),
      email: z.string().email().max(320),
      password: z.string().min(8).max(256),
    }))
    .mutation(async ({ input, ctx }) => {
      const inv = await getInvitationByToken(input.token);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Convite não encontrado." });
      if (inv.usedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Convite já utilizado ou revogado." });
      if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Convite expirado." });
      }

      if (!isValidEmail(input.email)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Email inválido." });
      }

      const openId = emailToOpenId(input.email);
      const existing = await getUserByOpenId(openId);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Já existe usuário com este email." });
      }

      const passwordHash = await hashPassword(input.password);
      await upsertUser({
        openId,
        email: openId,
        name: input.name.trim(),
        loginMethod: "local",
        passwordHash,
        role: inv.role,
        lastSignedIn: new Date(),
      });

      // Get newly created user to mark invitation
      const created = await getUserByOpenId(openId);
      if (!created) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao criar usuário." });
      }
      await markInvitationUsed(input.token, created.id);

      // Auto-login: set session cookie
      const sessionToken = await createSession(openId, { name: input.name.trim() });
      const cookieOpts = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOpts, maxAge: ONE_YEAR_MS });

      return {
        success: true,
        user: { openId, name: input.name.trim(), email: openId, role: inv.role },
      };
    }),
});

// ─── Sites (admin: list including inactive, edit fields, toggle isActive) ──
export const sitesRouter = router({
  list: adminProcedure.query(async () => {
    const all = await listAllSitesIncludingInactive();
    return all.map(s => ({
      id: s.id, slug: s.slug, name: s.name, description: s.description,
      bessCount: s.bessCount, bessCapacityKwh: s.bessCapacityKwh, bessModel: s.bessModel,
      pumpCount: s.pumpCount, pumpPowerCv: s.pumpPowerCv, pumpDescription: s.pumpDescription,
      controlMode: s.controlMode, mqttTopic: s.mqttTopic ?? "",
      fusionsolarPlantCode: s.fusionsolarPlantCode ?? "",
      fusionsolarDeviceIds: s.fusionsolarDeviceIds ?? "",
      fusionsolarInverterIds: s.fusionsolarInverterIds ?? "",
      backgroundUrl: s.backgroundUrl ?? null,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
      isActive: !!s.isActive,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    }));
  }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(1).max(128).optional(),
      description: z.string().max(2000).nullable().optional(),
      bessCount: z.number().int().min(1).max(64).optional(),
      bessCapacityKwh: z.number().positive().max(10000).optional(),
      bessModel: z.string().max(64).optional(),
      pumpCount: z.number().int().min(0).max(32).optional(),
      pumpPowerCv: z.number().min(0).max(10000).optional(),
      pumpDescription: z.string().max(2000).nullable().optional(),
      mqttTopic: z.string().max(128).optional(),
      fusionsolarPlantCode: z.string().max(64).optional(),
      fusionsolarDeviceIds: z.string().max(2000).optional(),
      fusionsolarInverterIds: z.string().max(2000).optional(),
      lat: z.number().min(-90).max(90).nullable().optional(),
      lng: z.number().min(-180).max(180).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const existing = await getSiteById(id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Site não encontrado." });
      await updateSiteById(id, patch as Partial<typeof bessSites.$inferInsert>);
      return { success: true };
    }),

  setActive: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      isActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const existing = await getSiteById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Site não encontrado." });
      await updateSiteById(input.id, { isActive: input.isActive });
      return { success: true, isActive: input.isActive };
    }),
});

// ─── System info + maintenance (admin endpoints, mesclado em system: no appRouter) ──
export const systemAdminEndpoints = {
  info: adminProcedure.query(async () => {
    const sites = await getAllSites();
    const fsOk = isFusionSolarConfigured();
    const mqttOk = isMqttConfigured();

    let mqttLive = false;
    let fsLastTelemetry: Date | null = null;
    for (const s of sites) {
      const st = await getBessState(s.id);
      if (st?.mqttConnected) mqttLive = true;
      if (st?.lastTelemetryAt && (!fsLastTelemetry || new Date(st.lastTelemetryAt) > fsLastTelemetry)) {
        fsLastTelemetry = new Date(st.lastTelemetryAt);
      }
    }

    const db = await getDb();
    let actions24h = 0, actions7d = 0, alarmsActive = 0;
    if (db) {
      const since24 = new Date(Date.now() - 86400_000);
      const since7d = new Date(Date.now() - 7 * 86400_000);
      const all = await db.select().from(bessActions);
      actions24h = all.filter(a => a.timestamp && new Date(a.timestamp) > since24).length;
      actions7d = all.filter(a => a.timestamp && new Date(a.timestamp) > since7d).length;
      alarmsActive = (await getActiveAlarms()).length;
    }

    return {
      buildAt: process.env.BUILD_TIME ?? null,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      fusionsolar: { configured: fsOk, lastTelemetryAt: fsLastTelemetry },
      mqtt: { configured: mqttOk, anySiteConnected: mqttLive },
      controlMode: process.env.USE_MVP_V2_CONTROL === "true" ? "v2" : "v1",
      counters: { actions24h, actions7d, alarmsActive },
      sites: sites.length,
    };
  }),

  clearResolvedAlarms: adminProcedure
    .input(z.object({ olderThanDays: z.number().int().min(0).max(365).default(0) }))
    .mutation(async ({ input, ctx }) => {
      const removed = await deleteResolvedAlarmsOlderThan(input.olderThanDays);
      return { removed, by: ctx.user.email ?? ctx.user.openId };
    }),
};

// ─── WhatsApp / Evolution API ────────────────────────────────
const WA_KEYS = {
  url: "whatsapp_evolution_url",
  instance: "whatsapp_instance_name",
  apiKey: "whatsapp_api_key",
  defaultTo: "whatsapp_default_recipient",
};

async function fetchEvolution(path: string, opts: RequestInit & { timeout?: number } = {}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = (await getSetting(WA_KEYS.url)) ?? "";
  const apiKey = (await getSetting(WA_KEYS.apiKey)) ?? "";
  if (!url) throw new TRPCError({ code: "BAD_REQUEST", message: "URL Evolution não configurada." });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout ?? 8000);
  try {
    const r = await fetch(`${url.replace(/\/+$/, "")}${path}`, {
      ...opts,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", apikey: apiKey, ...(opts.headers ?? {}) },
    });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* non-json */ }
    return { ok: r.ok, status: r.status, body };
  } finally {
    clearTimeout(t);
  }
}

export const whatsappRouter = router({
  getConfig: adminProcedure.query(async () => {
    return {
      url: (await getSetting(WA_KEYS.url)) ?? "",
      instance: (await getSetting(WA_KEYS.instance)) ?? "",
      apiKey: (await getSetting(WA_KEYS.apiKey)) ?? "",
      defaultTo: (await getSetting(WA_KEYS.defaultTo)) ?? "",
    };
  }),

  saveConfig: adminProcedure
    .input(z.object({
      url: z.string().url().optional().or(z.literal("")),
      instance: z.string().max(64).optional(),
      apiKey: z.string().max(256).optional(),
      defaultTo: z.string().max(32).optional(),
    }))
    .mutation(async ({ input }) => {
      if (input.url !== undefined) await upsertSetting(WA_KEYS.url, input.url, "Evolution API base URL");
      if (input.instance !== undefined) await upsertSetting(WA_KEYS.instance, input.instance, "Evolution instance name");
      if (input.apiKey !== undefined) await upsertSetting(WA_KEYS.apiKey, input.apiKey, "Evolution API key");
      if (input.defaultTo !== undefined) await upsertSetting(WA_KEYS.defaultTo, input.defaultTo, "Default recipient (E.164)");
      return { success: true };
    }),

  connectionState: adminProcedure.query(async () => {
    const instance = (await getSetting(WA_KEYS.instance)) ?? "";
    if (!instance) return { state: "not_configured" as const };
    try {
      const r = await fetchEvolution(`/instance/connectionState/${encodeURIComponent(instance)}`);
      return { state: r.ok ? "ok" as const : "error" as const, status: r.status, body: r.body };
    } catch (e) {
      return { state: "error" as const, error: (e as Error).message };
    }
  }),

  sendTest: adminProcedure
    .input(z.object({ to: z.string().min(8).max(32), text: z.string().min(1).max(1000) }))
    .mutation(async ({ input }) => {
      const instance = (await getSetting(WA_KEYS.instance)) ?? "";
      if (!instance) throw new TRPCError({ code: "BAD_REQUEST", message: "Instance não configurada." });
      const r = await fetchEvolution(`/message/sendText/${encodeURIComponent(instance)}`, {
        method: "POST",
        body: JSON.stringify({ number: input.to, text: input.text }),
      });
      return { success: r.ok, status: r.status, body: r.body };
    }),
});
