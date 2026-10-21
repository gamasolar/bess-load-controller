import { int, bigint, mysqlEnum, mysqlTable, text, timestamp, varchar, float, boolean, json, uniqueIndex, index } from "drizzle-orm/mysql-core";

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
  // MQTT config da automação (dispositivo Tasmota)
  mqttTopic: varchar("mqttTopic", { length: 128 }),
  // FusionSolar device IDs (JSON array of device IDs for this site)
  fusionsolarDeviceIds: text("fusionsolarDeviceIds"), // JSON string: battery device IDs ["id1","id2"]
  fusionsolarInverterIds: text("fusionsolarInverterIds"), // JSON string: inverter device IDs ["id1","id2"]
  fusionsolarPlantCode: varchar("fusionsolarPlantCode", { length: 64 }),
  // Optional background image (uploaded by admin, served via /storage)
  backgroundUrl: varchar("backgroundUrl", { length: 512 }),
  // Customização visual do card por-site (motorPreset, futuros: bgColor, layout, etc.)
  cardCustomization: json("cardCustomization"),
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
  // Saúde da bomba neste poll (RUNNING_OK / OFF_OK / VERIFYING / FAILED / RESIDUAL / UNKNOWN).
  // Permite cruzar comando ON (bess_actions) com operação real (loadHealth=RUNNING_OK).
  loadHealth: varchar("loadHealth", { length: 16 }),
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
  sonoffOfflineSince: timestamp("sonoffOfflineSince"),  // Quando a automação foi vista offline pela 1a vez (null = online).
  // Nome do campo mantido por consistência com sonoffOnline/sonoffPower — ver §14 do CLAUDE.md.
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
  // Compensação de overshoot BMS — DECISION-OVERSHOOT-COMPENSATION (2026-05-07).
  // Threshold efetivo TURN_OFF AUTO = socMinDesliga + |batteryPower|*overshootFactor (pp).
  // Aplica só com bomba ON + descarga. Default 0 = desligado (DECISION-RESPECT-CONFIG puro).
  overshootFactor: float("overshootFactor").default(0).notNull(),
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


// ─── Telemetria completa por equipamento ────────────────────
// Camada SEPARADA do controle da bomba (bess_state / bess_readings seguem
// sendo a fonte do control-engine). Aqui entra tudo o que cada equipamento
// reporta, de qualquer fonte, sem descartar campos. Ver docs/TELEMETRIA.md.
export const telemetryDevices = mysqlTable("telemetry_devices", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  // De onde vêm os dados: nuvem Huawei (Northbound) ou Modbus TCP local.
  source: mysqlEnum("source", ["fusionsolar", "modbus"]).notNull(),
  // Identificador na fonte: devId longo da FusionSolar, ou "unit:<n>" no Modbus.
  externalId: varchar("externalId", { length: 64 }).notNull(),
  // inverter | ess | plant | emi | meter | relay | other
  kind: varchar("kind", { length: 24 }).notNull(),
  devTypeId: int("devTypeId"),
  name: varchar("name", { length: 128 }),
  model: varchar("model", { length: 64 }),
  serial: varchar("serial", { length: 64 }),
  firmware: varchar("firmware", { length: 64 }),
  meta: json("meta"),
  firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt"),
  // Instante (do equipamento) da amostra mais recente gravada.
  lastSampleAt: timestamp("lastSampleAt"),
}, (t) => ({
  sourceExternal: uniqueIndex("telemetry_devices_source_external").on(t.source, t.externalId),
  bySite: index("telemetry_devices_site").on(t.siteId),
}));

export type TelemetryDevice = typeof telemetryDevices.$inferSelect;
export type InsertTelemetryDevice = typeof telemetryDevices.$inferInsert;

export const telemetrySamples = mysqlTable("telemetry_samples", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  deviceId: int("deviceId").notNull(),
  // Instante da medição segundo a fonte (collectTime da Huawei / relógio do coletor).
  collectedAt: timestamp("collectedAt").notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  // Pacote BRUTO, como veio da fonte. Nada é descartado nem renomeado aqui;
  // nome, unidade e grupo de cada campo vêm do catálogo na hora de exibir.
  data: json("data").notNull(),
}, (t) => ({
  // A Huawei repete o mesmo collectTime em consultas seguidas: a chave única evita duplicata.
  deviceTime: uniqueIndex("telemetry_samples_device_time").on(t.deviceId, t.collectedAt),
}));

export type TelemetrySample = typeof telemetrySamples.$inferSelect;
export type InsertTelemetrySample = typeof telemetrySamples.$inferInsert;

/**
 * Câmeras das usinas (ONVIF + RTSP). Uma linha por câmera; o site pode ter
 * zero ou mais. Credenciais ficam aqui e NUNCA saem pela API (ver
 * camera-store.ts → publicCamera). `via*` é o caminho até a câmera quando a
 * LAN da usina não é alcançável direto do servidor (túnel SSH/WireGuard).
 */
export const bessCameras = mysqlTable("bess_cameras", {
  id: int("id").autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  model: varchar("model", { length: 64 }),
  // Endereço real na LAN da usina
  host: varchar("host", { length: 64 }).notNull(),
  httpPort: int("httpPort").default(80).notNull(),
  rtspPort: int("rtspPort").default(554).notNull(),
  // Caminho alternativo (túnel) a partir do servidor; nulo = usa host direto
  viaHost: varchar("viaHost", { length: 64 }),
  viaHttpPort: int("viaHttpPort"),
  viaRtspPort: int("viaRtspPort"),
  username: varchar("username", { length: 64 }).default("admin").notNull(),
  password: varchar("password", { length: 128 }).default("").notNull(),
  // Caminhos RTSP (sem host nem credencial) e da foto nativa
  streamMain: varchar("streamMain", { length: 128 }).default("/stream0").notNull(),
  streamSub: varchar("streamSub", { length: 128 }).default("/stream1").notNull(),
  snapshotPath: varchar("snapshotPath", { length: 160 }).default("/cgi-bin/snapshot.cgi?channel=1").notNull(),
  // Tokens ONVIF (perfil de mídia e fonte de vídeo); nulos = descobrir
  onvifProfile: varchar("onvifProfile", { length: 64 }),
  onvifVideoSource: varchar("onvifVideoSource", { length: 64 }),
  // Recursos descobertos (ptz, zoom, foco, limpador, lâmpada, áudio, presets…)
  features: json("features"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  bySite: index("bess_cameras_site").on(t.siteId),
}));

export type BessCamera = typeof bessCameras.$inferSelect;
export type InsertBessCamera = typeof bessCameras.$inferInsert;

/**
 * Leitura AO VIVO do SmartLogger lida direto da usina (Modbus TCP pela rede
 * privada). Camada SEPARADA do controle da bomba: o control-engine continua
 * usando bess_state / bess_readings (ver CLAUDE.md §14). Esta tabela só
 * ARMAZENA o que o leitor direto coleta — a tela lê daqui, nada escreve no
 * controle a partir daqui.
 *
 * `source` registra qual camada serviu o valor (a escada: direto → nuvem →
 * estimado), para quando a tela escolher a melhor fonte disponível. O leitor
 * direto grava "direct"; `ok=false` + `err` marca uma falha de leitura (lacuna
 * visível no histórico, como faz o coletor do Pi).
 */
export const smartloggerLive = mysqlTable("smartlogger_live", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  siteId: int("siteId").notNull(),
  source: mysqlEnum("source", ["direct", "cloud", "estimated"]).default("direct").notNull(),
  // Instante da leitura no equipamento; createdAt = instante em que gravamos.
  readAt: timestamp("readAt").notNull(),
  ok: boolean("ok").default(true).notNull(),
  // Grandezas (convenção Huawei: essPowerKw positivo = DESCARGA; carga = potência total em ilha).
  soc: float("soc"),
  soh: float("soh"),
  essPowerKw: float("essPowerKw"),
  pvPowerKw: float("pvPowerKw"),
  loadKw: float("loadKw"),
  dischargeableKwh: float("dischargeableKwh"),
  maxDischargeKw: float("maxDischargeKw"),
  pcsRunning: int("pcsRunning"),
  voltageAbV: float("voltageAbV"),
  alarmSeq: int("alarmSeq"),
  err: varchar("err", { length: 120 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  bySiteTime: index("smartlogger_live_site_time").on(t.siteId, t.createdAt),
}));

export type SmartloggerLive = typeof smartloggerLive.$inferSelect;
export type InsertSmartloggerLive = typeof smartloggerLive.$inferInsert;

/**
 * Biblioteca de manuais dos equipamentos, guardados no servidor e servidos
 * com login. Uma linha por documento (PDF/MD). O arquivo fica em
 * storage-data/manuals/<filename>.
 */
export const equipmentManuals = mysqlTable("equipment_manuals", {
  id: int("id").autoincrement().primaryKey(),
  manufacturer: varchar("manufacturer", { length: 48 }).notNull(),
  // inverter | smartlogger | battery | relay | plant | other
  equipmentKind: varchar("equipmentKind", { length: 24 }).notNull(),
  model: varchar("model", { length: 160 }),
  title: varchar("title", { length: 255 }).notNull(),
  // user_manual | alarm_reference | modbus_def | datasheet | quickguide | note
  docType: varchar("docType", { length: 24 }).notNull(),
  lang: varchar("lang", { length: 8 }).default("EN").notNull(),
  issue: varchar("issue", { length: 64 }),
  // Nome do arquivo guardado em storage-data/manuals/ (sem caminho).
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 64 }).default("application/pdf").notNull(),
  sizeBytes: int("sizeBytes"),
  pages: int("pages"),
  source: varchar("source", { length: 255 }),
  isActive: boolean("isActive").default(true).notNull(),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
}, (t) => ({
  byKind: index("equipment_manuals_kind").on(t.manufacturer, t.equipmentKind),
}));

export type EquipmentManual = typeof equipmentManuals.$inferSelect;
export type InsertEquipmentManual = typeof equipmentManuals.$inferInsert;

/**
 * Catálogo de falhas por equipamento, transcrito dos manuais. É a fonte do
 * "interpretar a falha e mostrar a solução": quando um equipamento acusa uma
 * falha (Alarm ID da FusionSolar, ou alarme do SmartLogger por bit), casamos
 * aqui pelo (manufacturer, code[, subId]) e exibimos causa + ação.
 *
 * `code` = Alarm ID numérico (o mesmo que a API Northbound devolve; para o
 * SmartLogger, o alarmId da Tabela 2-2). `subId` = causeId/subId quando o
 * manual diferencia por causa (null = linha única).
 */
export const faultCatalog = mysqlTable("fault_catalog", {
  id: int("id").autoincrement().primaryKey(),
  manufacturer: varchar("manufacturer", { length: 48 }).notNull(),
  // inverter | smartlogger | battery | relay
  equipmentKind: varchar("equipmentKind", { length: 24 }).notNull(),
  family: varchar("family", { length: 200 }),
  modelsCovered: text("modelsCovered"),
  code: int("code").notNull(),
  subId: int("subId"),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  cause: text("cause"),
  action: text("action"),
  // critical | major | minor | warning
  severity: varchar("severity", { length: 16 }),
  sourcePdf: varchar("sourcePdf", { length: 255 }),
  page: varchar("page", { length: 16 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  byCode: index("fault_catalog_code").on(t.manufacturer, t.code),
  byKind: index("fault_catalog_kind").on(t.equipmentKind),
}));

export type FaultCatalogEntry = typeof faultCatalog.$inferSelect;
export type InsertFaultCatalogEntry = typeof faultCatalog.$inferInsert;
