import { eq, desc, and, gte, lte, sql, count, avg, min, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  bessSites, bessReadings, bessEvents, bessAlarms, bessState, bessConfig,
  bessReports,
  bessSettings,
  type BessSite, type BessState, type BessConfig, type BessReading,
  type BessReport, type InsertBessReport, type BessSetting
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ───────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    if (user.passwordHash !== undefined) { values.passwordHash = user.passwordHash; updateSet.passwordHash = user.passwordHash; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Sites ───────────────────────────────────────────────────
export async function getAllSites() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bessSites).where(eq(bessSites.isActive, true));
}

export async function getSiteBySlug(slug: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(bessSites).where(eq(bessSites.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getSiteById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(bessSites).where(eq(bessSites.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function upsertSite(data: Partial<typeof bessSites.$inferInsert> & { slug: string }) {
  const db = await getDb();
  if (!db) return;
  const existing = await getSiteBySlug(data.slug);
  if (!existing) {
    await db.insert(bessSites).values(data as any);
  } else {
    await db.update(bessSites).set(data).where(eq(bessSites.id, existing.id));
  }
}

// ─── BESS State (per site) ──────────────────────────────────
export async function getBessState(siteId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(bessState).where(eq(bessState.siteId, siteId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertBessState(siteId: number, data: Partial<typeof bessState.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  const existing = await getBessState(siteId);
  if (!existing) {
    await db.insert(bessState).values({ siteId, ...data } as any);
  } else {
    await db.update(bessState).set(data).where(eq(bessState.id, existing.id));
  }
}

// ─── BESS Readings (per site) ───────────────────────────────
export async function addReading(siteId: number, data: {
  soc: number; soh?: number; batteryPower?: number; batteryTemperature?: number;
  busVoltage?: number; pvPower?: number; gridPower?: number; loadPower?: number;
  valid?: boolean;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(bessReadings).values({ siteId, valid: true, ...data });
}

export async function getReadings(siteId: number, hoursBack: number = 4) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  return db.select().from(bessReadings)
    .where(and(eq(bessReadings.siteId, siteId), gte(bessReadings.createdAt, since)))
    .orderBy(bessReadings.createdAt);
}

export async function getReadingsByDate(siteId: number, dateStr: string) {
  const db = await getDb();
  if (!db) return [];
  // dateStr format: "YYYY-MM-DD"
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59`);
  return db.select().from(bessReadings)
    .where(and(
      eq(bessReadings.siteId, siteId),
      gte(bessReadings.createdAt, dayStart),
      lte(bessReadings.createdAt, dayEnd),
    ))
    .orderBy(bessReadings.createdAt);
}

// ─── BESS Events (per site) ─────────────────────────────────
export async function addEvent(siteId: number, type: string, description: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(bessEvents).values({ siteId, type, description });
}

export async function getRecentEvents(siteId: number, limit: number = 30) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bessEvents)
    .where(eq(bessEvents.siteId, siteId))
    .orderBy(desc(bessEvents.createdAt)).limit(limit);
}

export async function getAllRecentEvents(limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bessEvents).orderBy(desc(bessEvents.createdAt)).limit(limit);
}

// ─── BESS Alarms (per site) ─────────────────────────────────
export async function getActiveAlarms(siteId?: number) {
  const db = await getDb();
  if (!db) return [];
  if (siteId) {
    return db.select().from(bessAlarms)
      .where(and(eq(bessAlarms.siteId, siteId), eq(bessAlarms.active, true)))
      .orderBy(desc(bessAlarms.openedAt));
  }
  return db.select().from(bessAlarms)
    .where(eq(bessAlarms.active, true))
    .orderBy(desc(bessAlarms.openedAt));
}

export async function addAlarm(siteId: number, severity: "CRITICAL" | "WARNING" | "INFO", type: string, description: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(bessAlarms).values({ siteId, severity, type, description, active: true });
}

// ─── BESS Config (per site) ─────────────────────────────────
export async function getBessConfig(siteId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(bessConfig).where(eq(bessConfig.siteId, siteId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertBessConfig(siteId: number, data: Partial<typeof bessConfig.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  const existing = await getBessConfig(siteId);
  if (!existing) {
    await db.insert(bessConfig).values({ siteId, ...data } as any);
  } else {
    await db.update(bessConfig).set(data).where(eq(bessConfig.id, existing.id));
  }
}

// ─── BESS Reports (periodic performance summaries) ──────────
export async function addReport(data: InsertBessReport) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(bessReports).values(data);
  return result;
}

/**
 * Check if a report already exists for the same site, type and overlapping period.
 * Used to prevent duplicate reports from the scheduler on restart.
 */
export async function hasRecentReport(
  siteId: number,
  reportType: "daily" | "weekly",
  periodStart: Date
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ c: count() }).from(bessReports)
    .where(and(
      eq(bessReports.siteId, siteId),
      eq(bessReports.reportType, reportType),
      gte(bessReports.periodStart, periodStart)
    ));
  return Number(rows[0]?.c ?? 0) > 0;
}

/**
 * Update the notificationSent flag for the most recent report of a given site and type.
 */
export async function updateReportNotification(
  siteId: number,
  reportType: "daily" | "weekly",
  notificationSent: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Get the latest report for this site/type
  const latest = await getLatestReport(siteId, reportType);
  if (latest) {
    await db.update(bessReports)
      .set({ notificationSent })
      .where(eq(bessReports.id, latest.id));
  }
}

export async function getReports(siteId?: number, limit: number = 50, offset: number = 0) {
  const db = await getDb();
  if (!db) return [];
  if (siteId) {
    return db.select().from(bessReports)
      .where(eq(bessReports.siteId, siteId))
      .orderBy(desc(bessReports.createdAt)).limit(limit).offset(offset);
  }
  return db.select().from(bessReports)
    .orderBy(desc(bessReports.createdAt)).limit(limit).offset(offset);
}

export async function getReportsCount(siteId?: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const conditions = siteId ? eq(bessReports.siteId, siteId) : undefined;
  const result = await db.select({ count: count() }).from(bessReports)
    .where(conditions);
  return result[0]?.count ?? 0;
}

export async function getReportsByPeriod(siteId: number, reportType: "daily" | "weekly", since: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bessReports)
    .where(and(
      eq(bessReports.siteId, siteId),
      eq(bessReports.reportType, reportType),
      gte(bessReports.periodStart, since)
    ))
    .orderBy(desc(bessReports.periodStart));
}

/**
 * Get report trend data: time-series of key metrics for charting.
 * Returns reports ordered by periodEnd ascending (oldest first) for line charts.
 * Optionally filter by siteId and reportType.
 */
export async function getReportTrends(
  options: {
    siteId?: number;
    reportType?: "daily" | "weekly";
    limit?: number;
    since?: Date;
  } = {}
) {
  const db = await getDb();
  if (!db) return [];
  const { siteId, reportType, limit = 100, since } = options;

  const conditions = [];
  if (siteId) conditions.push(eq(bessReports.siteId, siteId));
  if (reportType) conditions.push(eq(bessReports.reportType, reportType));
  if (since) conditions.push(gte(bessReports.periodEnd, since));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Order ascending by periodEnd so charts show oldest→newest
  const rows = whereClause
    ? await db.select().from(bessReports)
        .where(whereClause)
        .orderBy(bessReports.periodEnd)
        .limit(limit)
    : await db.select().from(bessReports)
        .orderBy(bessReports.periodEnd)
        .limit(limit);

  return rows.map(r => ({
    id: r.id,
    siteId: r.siteId,
    reportType: r.reportType,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    avgSoc: r.avgSoc,
    minSoc: r.minSoc,
    maxSoc: r.maxSoc,
    estimatedEnergyKwh: r.estimatedEnergyKwh,
    loadOnMinutes: r.loadOnMinutes,
    totalEvents: r.totalEvents,
    totalAlarms: r.totalAlarms,
    maneuverCount: r.maneuverCount,
    avgTemperature: r.avgTemperature,
    avgPvPower: r.avgPvPower,
    avgLoadPower: r.avgLoadPower,
  }));
}

export async function getLatestReport(siteId: number, reportType: "daily" | "weekly") {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(bessReports)
    .where(and(
      eq(bessReports.siteId, siteId),
      eq(bessReports.reportType, reportType)
    ))
    .orderBy(desc(bessReports.periodEnd))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Aggregate readings for a given site and time window.
 * Returns computed metrics: avg/min/max SOC, power stats, temperature, reading count.
 */
export async function aggregateReadings(siteId: number, periodStart: Date, periodEnd: Date) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select({
    totalReadings: count(),
    avgSoc: avg(bessReadings.soc),
    minSoc: min(bessReadings.soc),
    maxSoc: max(bessReadings.soc),
    avgPvPower: avg(bessReadings.pvPower),
    maxPvPower: max(bessReadings.pvPower),
    avgLoadPower: avg(bessReadings.loadPower),
    maxLoadPower: max(bessReadings.loadPower),
    avgBatteryPower: avg(bessReadings.batteryPower),
    avgTemperature: avg(bessReadings.batteryTemperature),
    maxTemperature: max(bessReadings.batteryTemperature),
  }).from(bessReadings)
    .where(and(
      eq(bessReadings.siteId, siteId),
      gte(bessReadings.createdAt, periodStart),
      lte(bessReadings.createdAt, periodEnd),
      eq(bessReadings.valid, true)
    ));

  if (!rows[0] || Number(rows[0].totalReadings) === 0) return null;

  const r = rows[0];
  return {
    totalReadings: Number(r.totalReadings),
    avgSoc: parseFloat(String(r.avgSoc ?? 0)),
    minSoc: parseFloat(String(r.minSoc ?? 0)),
    maxSoc: parseFloat(String(r.maxSoc ?? 0)),
    avgPvPower: r.avgPvPower ? parseFloat(String(r.avgPvPower)) : null,
    maxPvPower: r.maxPvPower ? parseFloat(String(r.maxPvPower)) : null,
    avgLoadPower: r.avgLoadPower ? parseFloat(String(r.avgLoadPower)) : null,
    maxLoadPower: r.maxLoadPower ? parseFloat(String(r.maxLoadPower)) : null,
    avgBatteryPower: r.avgBatteryPower ? parseFloat(String(r.avgBatteryPower)) : null,
    avgTemperature: r.avgTemperature ? parseFloat(String(r.avgTemperature)) : null,
    maxTemperature: r.maxTemperature ? parseFloat(String(r.maxTemperature)) : null,
  };
}

/**
 * Count events in a time window for a site.
 */
export async function countEvents(siteId: number, periodStart: Date, periodEnd: Date) {
  const db = await getDb();
  if (!db) return { total: 0, maneuvers: 0, alarms: 0 };

  // Total events
  const totalRows = await db.select({ c: count() }).from(bessEvents)
    .where(and(
      eq(bessEvents.siteId, siteId),
      gte(bessEvents.createdAt, periodStart),
      lte(bessEvents.createdAt, periodEnd)
    ));

  // Maneuver events (LOAD_ON, LOAD_OFF, MANUAL_CMD_ON, MANUAL_CMD_OFF)
  const maneuverRows = await db.select({ c: count() }).from(bessEvents)
    .where(and(
      eq(bessEvents.siteId, siteId),
      gte(bessEvents.createdAt, periodStart),
      lte(bessEvents.createdAt, periodEnd),
      sql`${bessEvents.type} IN ('LOAD_ON', 'LOAD_OFF', 'MANUAL_CMD_ON', 'MANUAL_CMD_OFF')`
    ));

  // Alarms opened in period
  const alarmRows = await db.select({ c: count() }).from(bessAlarms)
    .where(and(
      eq(bessAlarms.siteId, siteId),
      gte(bessAlarms.openedAt, periodStart),
      lte(bessAlarms.openedAt, periodEnd)
    ));

  return {
    total: Number(totalRows[0]?.c ?? 0),
    maneuvers: Number(maneuverRows[0]?.c ?? 0),
    alarms: Number(alarmRows[0]?.c ?? 0),
  };
}

/**
 * Estimate load-on minutes by counting LOAD_ON events and estimating time between events.
 * Each reading interval is ~1 minute in our seeded data.
 */
export async function estimateLoadOnMinutes(siteId: number, periodStart: Date, periodEnd: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Get all events in the period to track load state changes
  const events = await db.select().from(bessEvents)
    .where(and(
      eq(bessEvents.siteId, siteId),
      gte(bessEvents.createdAt, periodStart),
      lte(bessEvents.createdAt, periodEnd)
    ))
    .orderBy(bessEvents.createdAt);

  // Track load state transitions
  let loadOn = false;
  let lastOnTime: number | null = null;
  let totalMinutes = 0;

  for (const evt of events) {
    const time = new Date(evt.createdAt).getTime();
    if (evt.type === "LOAD_ON" || evt.type === "MANUAL_CMD_ON") {
      if (!loadOn) {
        loadOn = true;
        lastOnTime = time;
      }
    } else if (evt.type === "LOAD_OFF" || evt.type === "MANUAL_CMD_OFF") {
      if (loadOn && lastOnTime !== null) {
        totalMinutes += (time - lastOnTime) / 60000;
        loadOn = false;
        lastOnTime = null;
      }
    }
  }

  // If load is still on at end of period, count until periodEnd
  if (loadOn && lastOnTime !== null) {
    totalMinutes += (periodEnd.getTime() - lastOnTime) / 60000;
  }

  return Math.round(totalMinutes);
}

// ─── Seed Multi-Site Data ────────────────────────────────────
export async function seedMultiSiteData() {
  const db = await getDb();
  if (!db) return;

  // Check if sites already exist
  const existingSites = await getAllSites();
  if (existingSites.length > 0) return;

  console.log("[BESS] Seeding multi-site data...");

  // ── Site 1: Piscinão ──
  await db.insert(bessSites).values({
    slug: "piscinao",
    name: "BESS - Daniel Medeiros (Piscinão)",
    description: "2x LUNA2000-215KWH em paralelo com usina FV. Bomba de 100cv para irrigação do piscinão. Controle manual por enquanto, com possibilidade futura de acionamento remoto.",
    bessCount: 2,
    bessCapacityKwh: 215,
    bessModel: "LUNA2000-215KWH",
    pumpCount: 1,
    pumpPowerCv: 100,
    pumpDescription: "Bomba centrífuga 100cv para irrigação do piscinão",
    controlMode: "manual",
    mqttTopic: null,
    fusionsolarDeviceIds: null,
    fusionsolarPlantCode: null,
    isActive: true,
  });

  // ── Site 2: Barragem ──
  await db.insert(bessSites).values({
    slug: "barragem",
    name: "BESS - Daniel Medeiros (Barragem)",
    description: "1x LUNA2000-215KWH em paralelo com usina FV. 2 bombas de 30cv acionadas via contator controlado por Sonoff Tasmota + MQTT.",
    bessCount: 1,
    bessCapacityKwh: 215,
    bessModel: "LUNA2000-215KWH",
    pumpCount: 2,
    pumpPowerCv: 30,
    pumpDescription: "2x bombas 30cv acionadas via contator (Sonoff Tasmota MQTT)",
    controlMode: "auto_mqtt",
    mqttTopic: "bess_sonoff",
    fusionsolarDeviceIds: null,
    fusionsolarPlantCode: null,
    isActive: true,
  });

  // Get site IDs
  const piscinao = await getSiteBySlug("piscinao");
  const barragem = await getSiteBySlug("barragem");
  if (!piscinao || !barragem) return;

  // ── Seed State for both sites ──
  await db.insert(bessState).values({
    siteId: piscinao.id,
    loadStatus: "on",
    mode: "manual",
    currentSoc: 78.3,
    currentSoh: 98.5,
    currentBatteryPower: -12.5,
    currentTemperature: 32.1,
    currentPvPower: 45.2,
    currentLoadPower: 57.7,
    lowCounter: 0,
    highCounter: 3,
    lastManeuverAt: new Date(Date.now() - 120 * 60 * 1000),
    healthStatus: "healthy",
    lastDecision: "SOC em 78.3% — dentro da faixa segura. Bomba operando manualmente.",
    mqttConnected: false,
    sonoffOnline: false,
  });

  await db.insert(bessState).values({
    siteId: barragem.id,
    loadStatus: "on",
    mode: "auto",
    currentSoc: 65.7,
    currentSoh: 99.1,
    currentBatteryPower: -8.3,
    currentTemperature: 29.8,
    currentPvPower: 28.6,
    currentLoadPower: 36.9,
    lowCounter: 0,
    highCounter: 3,
    lastManeuverAt: new Date(Date.now() - 45 * 60 * 1000),
    healthStatus: "healthy",
    lastDecision: "SOC em 65.7% — acima do limite (20%). Carga mantida LIGADA.",
    mqttConnected: true,
    sonoffOnline: true,
  });

  // ── Seed Readings for both sites (4 hours) ──
  const now = Date.now();
  for (const site of [piscinao, barragem]) {
    const readingValues: any[] = [];
    let soc = site.slug === "piscinao" ? 50 : 40;
    for (let i = 240; i >= 0; i--) {
      const progress = (240 - i) / 240;
      if (progress < 0.1) soc = soc + progress * 80;
      else if (progress < 0.4) soc = soc + 8 + (progress - 0.1) * 50;
      else if (progress < 0.7) soc = soc + 23 + (progress - 0.4) * 10;
      else soc = soc + 26 - (progress - 0.7) * 8;
      soc = Math.round((soc + (Math.random() - 0.5) * 1.5) * 10) / 10;
      soc = Math.max(10, Math.min(100, soc));
      const battPower = -5 + Math.random() * 15 * (progress < 0.5 ? 1 : -0.5);
      const pvPower = site.slug === "piscinao"
        ? Math.max(0, 50 * Math.sin(progress * Math.PI) + (Math.random() - 0.5) * 5)
        : Math.max(0, 30 * Math.sin(progress * Math.PI) + (Math.random() - 0.5) * 3);
      readingValues.push({
        siteId: site.id,
        soc,
        soh: site.slug === "piscinao" ? 98.5 : 99.1,
        batteryPower: Math.round(battPower * 10) / 10,
        batteryTemperature: Math.round((28 + Math.random() * 6) * 10) / 10,
        pvPower: Math.round(pvPower * 10) / 10,
        loadPower: Math.round((Math.abs(battPower) + pvPower * 0.3) * 10) / 10,
        valid: true,
        createdAt: new Date(now - i * 60 * 1000),
      });
      // Reset soc for next iteration to avoid accumulation
      soc = readingValues[readingValues.length - 1].soc;
    }
    for (let i = 0; i < readingValues.length; i += 50) {
      await db.insert(bessReadings).values(readingValues.slice(i, i + 50));
    }
  }

  // ── Seed Events ──
  const eventSets = [
    { siteId: piscinao.id, events: [
      { type: "MODE_CHANGE", description: "Modo definido como MANUAL (controle local)", createdAt: new Date(now - 180 * 60 * 1000) },
      { type: "MANUAL_CMD_ON", description: "Bomba 100cv LIGADA manualmente pelo operador", createdAt: new Date(now - 120 * 60 * 1000) },
      { type: "LOAD_ON", description: "Bomba operando normalmente. SOC=78.3%", createdAt: new Date(now - 60 * 60 * 1000) },
    ]},
    { siteId: barragem.id, events: [
      { type: "MODE_CHANGE", description: "Modo alterado para AUTOMÁTICO", createdAt: new Date(now - 200 * 60 * 1000) },
      { type: "LOAD_OFF", description: "Carga DESLIGADA automaticamente. SOC=14% (2 leituras <= 15%)", createdAt: new Date(now - 170 * 60 * 1000) },
      { type: "FAILSAFE", description: "Fail-safe ativado: 5 ciclos sem leitura válida do BESS.", createdAt: new Date(now - 160 * 60 * 1000) },
      { type: "LOAD_ON", description: "Carga LIGADA automaticamente. SOC=22% (3 leituras >= 20%)", createdAt: new Date(now - 150 * 60 * 1000) },
      { type: "MANUAL_CMD_OFF", description: "Carga DESLIGADA manualmente pelo operador", createdAt: new Date(now - 90 * 60 * 1000) },
      { type: "MANUAL_CMD_ON", description: "Carga LIGADA manualmente pelo operador", createdAt: new Date(now - 85 * 60 * 1000) },
      { type: "LOAD_ON", description: "Carga LIGADA automaticamente. SOC=25% (3 leituras >= 20%)", createdAt: new Date(now - 45 * 60 * 1000) },
    ]},
  ];
  for (const set of eventSets) {
    for (const evt of set.events) {
      await db.insert(bessEvents).values({ siteId: set.siteId, ...evt });
    }
  }

  // ── Seed Alarms ──
  await db.insert(bessAlarms).values({
    siteId: barragem.id, severity: "WARNING", type: "STALE_DATA",
    description: "Telemetria com atraso > 5 minutos. Verificar conexão com FusionSolar.",
    active: true, openedAt: new Date(now - 12 * 60 * 1000),
  });
  await db.insert(bessAlarms).values({
    siteId: piscinao.id, severity: "INFO", type: "MANUAL_MODE",
    description: "Site operando em modo manual. Controle remoto não disponível.",
    active: true, openedAt: new Date(now - 60 * 60 * 1000),
  });

  // ── Seed Config ──
  await db.insert(bessConfig).values({
    siteId: piscinao.id, socLowLimit: 15, socHighLimit: 25,
    cooldownMinutes: 10, lowReadingsRequired: 2, highReadingsRequired: 3, presetName: "conservador",
  });
  await db.insert(bessConfig).values({
    siteId: barragem.id, socLowLimit: 15, socHighLimit: 20,
    cooldownMinutes: 5, lowReadingsRequired: 2, highReadingsRequired: 3, presetName: "padrao",
  });

  console.log("[BESS] Multi-site data seeded successfully.");
}


// ─── Settings ────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(bessSettings).where(eq(bessSettings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function upsertSetting(key: string, value: string, description?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(bessSettings).where(eq(bessSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(bessSettings).set({ value }).where(eq(bessSettings.key, key));
  } else {
    await db.insert(bessSettings).values({ key, value, description: description ?? null });
  }
}

export async function getAllSettings(): Promise<BessSetting[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bessSettings).orderBy(bessSettings.key);
}
