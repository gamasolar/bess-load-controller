/**
 * Compatibility shim.
 *
 * The original Manus deployment exposed OAuth callback routes here.
 * In the self-hosted build we use local email/password auth instead, so this
 * module simply re-exports `registerAuthRoutes` under the historic name
 * `registerOAuthRoutes` to minimize churn elsewhere in the codebase.
 */

import type { Express } from "express";
import { registerAuthRoutes } from "../auth";

export function registerOAuthRoutes(app: Express): void {
  registerAuthRoutes(app);
}
