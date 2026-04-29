import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, float, boolean, json } from "drizzle-orm/mysql-core";

// ─── Users ───────────────────────────────────────────────────
// `openId` is kept as the primary user identifier (unique key) for backwards
// compatibility with existing code. For local email/password auth the openId
// is set to the normalized (lowercased) email.
// `passwordHash` stores a bcrypt hash; null means the account was created via
// an external mechanism and cannot log in with password.
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  disabled: boolean("disabled").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  avatarUrl: varchar("avatarUrl", { length: 512 }),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── User invitations (admin gera, link de uso único) ────────
export const userInvitations = mysqlTable("user_invitations", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdById: int("createdById"),
  expiresAt: timestamp("expiresAt"),
  usedAt: timestamp("usedAt"),
  usedByUserId: int("usedByUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UserInvitation = typeof userInvitations.$inferSelect;
export type InsertUserInvitation = typeof userInvitations.$inferInsert;

// ─── BESS Sites ──────────────────────────────────────────────
export const bessSites = mysqlTable("bess_sites", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 32 }).notNull().unique(), // "piscinao" | "barragem"
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  // Site specs
  bessCount: int("bessCount").default(1).notNull(),
  bessCapacityKwh: float("bessCapacityKwh").default(215).notNull(),
  bessModel: varchar("bessModel", { length: 64 }).default("LUNA2000-215KWH").notNull(),
  // Pump/load info
  pumpCount: int("pumpCount").default(1).notNull(),
  pumpPowerCv: float("pumpPowerCv").default(30).notNull(),
  pumpDescription: text("pumpDescription"),
  // Control mode
  controlMode: mysqlEnum("controlMode", ["manual", "auto_mqtt", "auto_future"]).default("manual").notNull(),
  // MQTT config for Sonoff/Tasmota
  mqttTopic: varchar("mqttTopic", { length: 128 }),
  // FusionSolar device IDs (JSON array of device IDs for this site)
  fusionsolarDeviceIds: text("fusionsolarDeviceIds"), // JSON string: battery device IDs ["id1","id2"]
  fusionsolarInverterIds: text("fusionsolarInverterIds"), // JSON string: inverter device IDs ["id1","id2"]
  fusionsolarPlantCode: varchar("fusionsolarPlantCode", { length: 64 }),
  // Optional background image (uploaded by admin, served via /storage)
  backgroundUrl: varchar("backgroundUrl", { length: 512 }),
  // Coordenadas da usina (pra clima, mapa, etc.)
  lat: float("lat"),
  lng: float("lng"),
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BessSite = typeof bessSites.$inferSelect;
export type InsertBessSite = typeof bessSites.$inferInsert;

// ─── BESS Readings (expanded: SOC, power, temperature, SOH) ─
export const bessReadings = mysqlTable("bess_readings", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  // Battery data
  soc: float("soc").notNull(),
  soh: float("soh"),
  batteryPower: float("batteryPower"), // kW, positive=charging, negative=discharging
  batteryTemperature: float("batteryTemperature"), // °C
  busVoltage: float("busVoltage"), // V
  // Plant data
  pvPower: float("pvPower"), // kW - solar generation
  gridPower: float("gridPower"), // kW - grid import/export
  loadPower: float("loadPower"), // kW - total load consumption
  // Validity
  valid: boolean("valid").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BessReading = typeof bessReadings.$inferSelect;

// ─── BESS Events ─────────────────────────────────────────────
export const bessEvents = mysqlTable("bess_events", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BessEvent = typeof bessEvents.$inferSelect;

// ─── BESS Alarms ─────────────────────────────────────────────
export const bessAlarms = mysqlTable("bess_alarms", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  severity: mysqlEnum("severity", ["CRITICAL", "WARNING", "INFO"]).notNull(),
  type: varchar("type", { length: 64 }).notNull(),
  description: text("description").notNull(),
  active: boolean("active").default(true).notNull(),
  openedAt: timestamp("openedAt").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
});

export type BessAlarm = typeof bessAlarms.$inferSelect;

// ─── BESS State (per site) ───────────────────────────────────
export const bessState = mysqlTable("bess_state", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  loadStatus: mysqlEnum("loadStatus", ["on", "off"]).default("off").notNull(),
  mode: mysqlEnum("mode", ["auto", "manual"]).default("auto").notNull(),
  currentSoc: float("currentSoc").default(0).notNull(),
  currentSoh: float("currentSoh"),
  currentBatteryPower: float("currentBatteryPower"),
  currentTemperature: float("currentTemperature"),
  currentPvPower: float("currentPvPower"),
  currentLoadPower: float("currentLoadPower"),
  lowCounter: int("lowCounter").default(0).notNull(),
  highCounter: int("highCounter").default(0).notNull(),
  lastManeuverAt: timestamp("lastManeuverAt"),
  healthStatus: mysqlEnum("healthStatus", ["healthy", "attention", "degraded", "critical"]).default("healthy").notNull(),
  lastDecision: text("lastDecision"),
  mqttConnected: boolean("mqttConnected").default(false).notNull(),
  sonoffOnline: boolean("sonoffOnline").default(false).notNull(),
  sonoffPower: mysqlEnum("sonoffPower", ["ON", "OFF", "UNKNOWN"]).default("UNKNOWN").notNull(),
  lastTelemetryAt: timestamp("lastTelemetryAt"),  // Last time SOC was updated from real FusionSolar data
  socSource: mysqlEnum("socSource", ["fusionsolar", "manual", "simulation", "unknown"]).default("unknown").notNull(),
  // ─── Load monitor (saúde da bomba) ───
  loadHealth: varchar("loadHealth", { length: 16 }),
  loadFailureSince: timestamp("loadFailureSince"),
  // ─── MVP v2: SOC estimation (Coulomb counting) + cooldown + pump runtime ───
  socEstimated: float("socEstimated"),
  lastEstimateAt: timestamp("lastEstimateAt"),
  dischargeRatePpPerMin: float("dischargeRatePpPerMin"),
  cooldownUntil: timestamp("cooldownUntil"),
  pumpOnSinceTimestamp: timestamp("pumpOnSinceTimestamp"),
  pumpOnSecondsToday: int("pumpOnSecondsToday").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BessState = typeof bessState.$inferSelect;

// ─── BESS Config (per site) ─────────────────────────────────
// v1 fields (socLowLimit, socHighLimit, cooldownMinutes, lowReadingsRequired,
// highReadingsRequired, presetName) preserved during MVP v2 transition; new
// code reads only the v2 fields below. Cleanup planned post-MVP merge.
export const bessConfig = mysqlTable("bess_config", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  socLowLimit: float("socLowLimit").default(15).notNull(),
  socHighLimit: float("socHighLimit").default(20).notNull(),
  cooldownMinutes: int("cooldownMinutes").default(5).notNull(),
  lowReadingsRequired: int("lowReadingsRequired").default(2).notNull(),
  highReadingsRequired: int("highReadingsRequired").default(3).notNull(),
  presetName: varchar("presetName", { length: 32 }).default("padrao").notNull(),
  // ─── MVP v2 fields ───
  socMinDesliga: int("socMinDesliga").default(25).notNull(),
  socMinReliga: int("socMinReliga").default(30).notNull(),
  socBlackout: int("socBlackout").default(15).notNull(),
  horarioLiberacao: varchar("horarioLiberacao", { length: 5 }).default("06:00").notNull(),
  horarioCorte: varchar("horarioCorte", { length: 5 }).default("17:30").notNull(),
  margemZonaCritica: int("margemZonaCritica").default(5).notNull(),
  intervaloPadrao: int("intervaloPadrao").default(15).notNull(),
  intervaloCritico: int("intervaloCritico").default(2).notNull(),
  intervaloNoturno: int("intervaloNoturno").default(60).notNull(),
  intervaloBombaSemSolar: int("intervaloBombaSemSolar").default(5).notNull(),
  cooldownAcao: int("cooldownAcao").default(5).notNull(),
  maxSemTelemetria: int("maxSemTelemetria").default(30).notNull(),
  controlMode: mysqlEnum("controlMode", ["AUTO", "MANUAL"]).default("AUTO").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BessConfig = typeof bessConfig.$inferSelect;

// ─── BESS Pump Daily (snapshot consolidado por dia, alimentado por job interno) ──
export const bessPumpDaily = mysqlTable("bess_pump_daily", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  secondsOn: float("secondsOn").default(0).notNull(),
  kwhEstimado: float("kwhEstimado").default(0).notNull(),
  cycles: int("cycles").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── BESS Actions (audit log of every control decision/manual action) ──
export const bessActions = mysqlTable("bess_actions", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  source: mysqlEnum("source", ["AUTO", "MANUAL", "BLACKOUT", "SYSTEM"]).notNull(),
  action: mysqlEnum("action", ["TURN_ON", "TURN_OFF", "MODE_CHANGE", "CONFIG_CHANGE", "ALERT"]).notNull(),
  socAtTime: int("socAtTime"),
  socSource: mysqlEnum("socSource", ["REAL", "ESTIMATED"]).default("REAL"),
  pumpStateBefore: mysqlEnum("pumpStateBefore", ["ON", "OFF", "UNKNOWN"]),
  pumpStateAfter: mysqlEnum("pumpStateAfter", ["ON", "OFF", "UNKNOWN"]),
  reason: varchar("reason", { length: 255 }),
  userId: int("userId"),
  metadata: json("metadata"),
});

export type BessAction = typeof bessActions.$inferSelect;
export type InsertBessAction = typeof bessActions.$inferInsert;

// ─── BESS Reports (periodic performance summaries) ──────────
export const bessReports = mysqlTable("bess_reports", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  // Report type and period
  reportType: mysqlEnum("reportType", ["daily", "weekly"]).notNull(),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  // SOC metrics
  avgSoc: float("avgSoc").notNull(),
  minSoc: float("minSoc").notNull(),
  maxSoc: float("maxSoc").notNull(),
  // Power metrics
  avgPvPower: float("avgPvPower"),
  maxPvPower: float("maxPvPower"),
  avgLoadPower: float("avgLoadPower"),
  maxLoadPower: float("maxLoadPower"),
  // Battery metrics
  avgBatteryPower: float("avgBatteryPower"),
  avgTemperature: float("avgTemperature"),
  maxTemperature: float("maxTemperature"),
  // Operating metrics
  totalReadings: int("totalReadings").default(0).notNull(),
  loadOnMinutes: int("loadOnMinutes").default(0).notNull(), // estimated time load was ON
  estimatedEnergyKwh: float("estimatedEnergyKwh").default(0).notNull(), // estimated energy consumed
  // Events summary
  totalEvents: int("totalEvents").default(0).notNull(),
  totalAlarms: int("totalAlarms").default(0).notNull(),
  maneuverCount: int("maneuverCount").default(0).notNull(),
  // Notification
  notificationSent: boolean("notificationSent").default(false).notNull(),
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BessReport = typeof bessReports.$inferSelect;
export type InsertBessReport = typeof bessReports.$inferInsert;


// ─── BESS Settings (global system configuration) ────────────
export const bessSettings = mysqlTable("bess_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type BessSetting = typeof bessSettings.$inferSelect;
export type InsertBessSetting = typeof bessSettings.$inferInsert;
