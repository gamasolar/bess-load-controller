/**
 * Local email/password authentication module.
 *
 * Replaces the OAuth-based Manus authentication with a self-hosted scheme:
 *   - Passwords are hashed with bcrypt (cost factor 10).
 *   - Sessions are JWTs (HS256, signed with `JWT_SECRET`) stored in an
 *     httpOnly cookie under the name `app_session_id` (`COOKIE_NAME`).
 *   - The first registered user is automatically promoted to `admin`.
 *   - Subsequent registrations create `user` accounts and may be disabled
 *     globally via the `ALLOW_SIGNUP=false` environment variable.
 *
 * Public surface:
 *   - hashPassword(password)     -> Promise<string>
 *   - verifyPassword(pwd, hash)  -> Promise<boolean>
 *   - createSession(openId, ?)   -> Promise<string>  (JWT token)
 *   - verifySession(token)       -> Promise<JwtPayload | null>
 *   - registerAuthRoutes(app)    -> mounts POST /api/auth/login and
 *                                   POST /api/auth/register on Express
 */

import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import bcrypt from "bcryptjs";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import * as db from "./db";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { count } from "drizzle-orm";
import { ENV } from "./_core/env";
import { getSessionCookieOptions } from "./_core/cookies";

const BCRYPT_COST = 10;

// ─── Password hashing ──────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(
  password: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash || typeof password !== "string" || password.length === 0) {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

// ─── JWT session ───────────────────────────────────────────────────────────

export type JwtPayload = {
  openId: string;
  name: string;
};

function getSecret(): Uint8Array {
  const secret = ENV.cookieSecret;
  if (!secret || secret.length < 16) {
    throw new Error(
      "JWT_SECRET is not configured or is too short (>=32 hex chars recommended)",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(
  openId: string,
  options: { expiresInMs?: number; name?: string } = {},
): Promise<string> {
  const issuedAt = Date.now();
  const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
  const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);

  return new SignJWT({
    openId,
    name: options.name ?? "",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(getSecret());
}

export async function verifySession(
  token: string | undefined | null,
): Promise<JwtPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    const openId = typeof payload.openId === "string" ? payload.openId : null;
    const name = typeof payload.name === "string" ? payload.name : "";
    if (!openId) return null;
    return { openId, name };
  } catch {
    return null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Normalize an email to use as the canonical user openId. */
export function emailToOpenId(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_RE.test(value.trim()) && value.length <= 320;
}
function isValidPassword(value: unknown): value is string {
  // Minimum 8 chars; we don't impose composition rules here, that's a UX choice.
  return typeof value === "string" && value.length >= 8 && value.length <= 256;
}

/** Returns the number of users currently in the database, or 0 if the DB is unreachable. */
async function getUserCount(): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  try {
    const rows = await database.select({ value: count() }).from(users);
    return Number(rows[0]?.value ?? 0);
  } catch (error) {
    console.error("[Auth] Failed to count users:", error);
    return 0;
  }
}

function isSignupAllowed(): boolean {
  // Default true so that the very first deployment can register the admin
  // account. Operators can flip ALLOW_SIGNUP=false after the team is set up.
  const raw = (process.env.ALLOW_SIGNUP ?? "true").trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(raw);
}

// ─── Express routes ────────────────────────────────────────────────────────

function setSessionCookie(req: Request, res: Response, token: string): void {
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
}

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name } = (req.body ?? {}) as {
        email?: unknown;
        password?: unknown;
        name?: unknown;
      };

      if (!isValidEmail(email)) {
        res.status(400).json({ error: "Email inválido." });
        return;
      }
      if (!isValidPassword(password)) {
        res.status(400).json({ error: "Senha deve ter no mínimo 8 caracteres." });
        return;
      }

      const openId = emailToOpenId(email);
      const existing = await db.getUserByOpenId(openId);

      // Decide role based on current user count BEFORE we create the new one.
      const currentCount = await getUserCount();
      const isFirstUser = currentCount === 0;

      // After the first user exists, signups can be globally disabled.
      if (!isFirstUser && !isSignupAllowed()) {
        res.status(403).json({ error: "Cadastro de novos usuários está desabilitado." });
        return;
      }

      if (existing) {
        res.status(409).json({ error: "Já existe um usuário com este email." });
        return;
      }

      const passwordHash = await hashPassword(password);
      const displayName =
        typeof name === "string" && name.trim().length > 0 ? name.trim() : openId;

      const role = isFirstUser ? "admin" : "user";

      await db.upsertUser({
        openId,
        email: openId,
        name: displayName,
        loginMethod: "local",
        passwordHash,
        role,
        lastSignedIn: new Date(),
      });

      const token = await createSession(openId, { name: displayName });
      setSessionCookie(req, res, token);

      res.status(201).json({
        success: true,
        user: { openId, email: openId, name: displayName, role },
      });
    } catch (error) {
      console.error("[Auth] /register failed:", error);
      res.status(500).json({ error: "Erro interno ao registrar." });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = (req.body ?? {}) as {
        email?: unknown;
        password?: unknown;
      };

      if (!isValidEmail(email) || typeof password !== "string" || password.length === 0) {
        res.status(400).json({ error: "Email e senha são obrigatórios." });
        return;
      }

      const openId = emailToOpenId(email);
      const user = await db.getUserByOpenId(openId);

      // Generic message: do not leak which side (email or password) failed.
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        res.status(401).json({ error: "Email ou senha incorretos." });
        return;
      }

      // Refresh lastSignedIn (best effort).
      try {
        await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
      } catch {
        /* non-fatal */
      }

      const token = await createSession(user.openId, { name: user.name ?? "" });
      setSessionCookie(req, res, token);

      res.json({
        success: true,
        user: {
          openId: user.openId,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (error) {
      console.error("[Auth] /login failed:", error);
      res.status(500).json({ error: "Erro interno ao autenticar." });
    }
  });

  // Lightweight endpoint frontend can poll to know if any account exists.
  // Used by the Login page to switch between "Login" and "Create admin" modes.
  app.get("/api/auth/status", async (_req: Request, res: Response) => {
    try {
      const userCount = await getUserCount();
      res.json({
        hasUsers: userCount > 0,
        signupAllowed: userCount === 0 || isSignupAllowed(),
      });
    } catch (error) {
      console.error("[Auth] /status failed:", error);
      res.status(500).json({ error: "Erro ao consultar status." });
    }
  });
}
