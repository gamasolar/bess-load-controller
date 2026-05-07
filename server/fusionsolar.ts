/**
 * FusionSolar Northbound API Integration
 * 
 * Connects to Huawei FusionSolar to read real-time BESS data:
 * - Battery SOC, SOH, power, temperature
 * - PV generation, grid power, load power
 * - Station and device discovery
 * - Alarm retrieval
 * 
 * Authentication: XSRF-TOKEN based session with auto-refresh.
 * All timestamps from FusionSolar are in milliseconds (epoch).
 * 
 * ── Rate Limit Rules (Huawei Documentation V6) ──
 * - Real-time data: Roundup(plants/100) calls per 5 min → 1 call per 5 min for 2 plants
 * - Hourly/Daily data: Roundup(plants/100)+24 calls per day → 25 calls/day for 2 plants
 * - Device List: Roundup(plants/100)+24 calls per day → 25 calls/day for 2 plants
 * - ONLY 1 concurrent request per minute across ALL endpoints
 * - Exceeding limits → failCode=407 (ACCESS_FREQUENCY_IS_TOO_HIGH)
 * 
 * ── Optimization Strategy ──
 * - Serialize all API calls (no Promise.all) to respect 1 concurrent req/min
 * - Add 10s delay between each API call
 * - Skip redundant getStationRealKpi when device-level data is available
 * - Login interval set to 25min (session lasts 30min)
 * - Exponential backoff on 407 errors
 */

import { ENV } from "./_core/env";

// ─── Types ──────────────────────────────────────────────────

export interface FusionSolarStation {
  stationCode: string;
  stationName: string;
  stationAddr?: string;
  capacity?: number;
  buildState?: number;
  combineType?: number;
  aidType?: number;
}

export interface FusionSolarDevice {
  // The Northbound `getDevList` response actually returns `id` (long, e.g.
  // 1000000054174514) and `devDn` (e.g. "NE=54174514"). Older code referenced
  // `devId` which is NOT in the response — kept here for back-compat only.
  // The long `id` is the one accepted by `getDevRealKpi`; the short `devDn`
  // is what shows up in the portal URL.
  id?: number | string;
  devDn?: string;
  devId?: string;
  devName: string;
  devTypeId: number;
  stationCode: string;
  esnCode?: string;
  softwareVersion?: string;
  invType?: string;
}

export interface BatteryRealTimeData {
  battery_soc?: number;
  battery_soh?: number;
  battery_power?: number;       // kW, positive=charging, negative=discharging
  battery_temperature?: number; // °C
  bus_voltage?: number;         // V
  max_charge_power?: number;    // kW
  max_discharge_power?: number; // kW
  ch_discharge_model?: number;  // charge/discharge model
  collectTime?: number;         // ms epoch
  [key: string]: unknown;
}

export interface StationRealTimeData {
  day_power?: number;           // kWh - daily generation
  month_power?: number;         // kWh - monthly generation
  total_power?: number;         // kWh - total generation
  day_income?: number;          // daily income
  real_health_state?: number;   // station health
  [key: string]: unknown;
}

export interface FusionSolarAlarm {
  alarmId: string;
  alarmName: string;
  devName: string;
  devTypeId: number;
  stationCode: string;
  stationName: string;
  severity: number;             // 1=critical, 2=major, 3=minor, 4=warning
  causeId?: number;
  raiseTime: number;            // ms epoch
  [key: string]: unknown;
}

export interface InverterRealTimeData {
  active_power?: number;        // kW - instantaneous PV output power
  day_cap?: number;             // kWh - daily generation
  mppt_power?: number;          // kW - MPPT power
  efficiency?: number;          // %
  temperature?: number;         // °C
  collectTime?: number;         // ms epoch
  [key: string]: unknown;
}

export interface TelemetryResult {
  success: boolean;
  data: BatteryRealTimeData | null;
  stationData: StationRealTimeData | null;
  inverterData: InverterRealTimeData | null;
  error?: string;
  dataAge?: number;             // seconds since data was collected
}

// ─── Rate Limit Helpers ─────────────────────────────────────

const API_CALL_DELAY_MS = 70_000; // 70s between calls — Huawei `getDevRealKpi` é 1/min POR ENDPOINT, e bat+inv batem no mesmo endpoint. 60s + 10s de margem pra clock skew.
const BACKOFF_BASE_MS = 60_000;   // 1 minute base backoff on 407
const MAX_BACKOFF_MS = 600_000;   // 10 minutes max backoff

let _lastApiCallTime = 0;
let _backoffUntil = 0;
let _consecutiveRateLimits = 0;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Wait until rate limit window allows another call */
async function waitForRateLimit(): Promise<void> {
  // Skip delays in test environment to avoid test timeouts
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;

  const now = Date.now();
  
  // Check backoff from 407 errors
  if (now < _backoffUntil) {
    const waitMs = _backoffUntil - now;
    console.log(`[FusionSolar] Rate limit backoff: waiting ${Math.round(waitMs / 1000)}s before next call...`);
    await delay(waitMs);
  }
  
  // Ensure minimum delay between calls
  const elapsed = Date.now() - _lastApiCallTime;
  if (elapsed < API_CALL_DELAY_MS) {
    const waitMs = API_CALL_DELAY_MS - elapsed;
    await delay(waitMs);
  }
  
  _lastApiCallTime = Date.now();
}

/**
 * Handle 407 rate limit: set exponential backoff (global — Huawei rate limit é por
 * API key compartilhada) e abre alarme RATE_LIMIT_FUSIONSOLAR.
 *
 * Se `siteId` for passado, abre alarme APENAS naquele site (chamada com contexto
 * de polling de um site específico). Senão (login, station list, etc.) abre em
 * todos os sites com FusionSolar configurado — fallback conservador.
 */
function onRateLimitHit(siteId?: number): void {
  _consecutiveRateLimits++;
  const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, _consecutiveRateLimits - 1), MAX_BACKOFF_MS);
  _backoffUntil = Date.now() + backoffMs;
  console.warn(`[FusionSolar] Rate limit 407 hit (${_consecutiveRateLimits}x)${siteId ? ` [siteId=${siteId}]` : ""}. Backing off for ${Math.round(backoffMs / 1000)}s.`);
  openRateLimitAlarms(backoffMs, siteId).catch(e => console.warn("[FusionSolar] openRateLimitAlarms err:", e));
}

/**
 * Reset backoff counter and close alarmes RATE_LIMIT_FUSIONSOLAR.
 *
 * Quando `siteId` é passado, fecha apenas o alarme daquele site (comportamento
 * granular pra escala). Sem siteId, fecha em todos os sites — usado por
 * caminhos sem contexto de site (login, etc.).
 */
function onApiSuccess(siteId?: number): void {
  if (_consecutiveRateLimits > 0) {
    _consecutiveRateLimits = 0;
  }
  closeRateLimitAlarms(siteId).catch(e => console.warn("[FusionSolar] closeRateLimitAlarms err:", e));
}

async function openRateLimitAlarms(backoffMs: number, siteId?: number): Promise<void> {
  const { getAllSites, getSiteById, openAlarmIfMissing } = await import("./db");
  const seconds = Math.round(backoffMs / 1000);
  const desc = `Huawei FusionSolar respondeu 407 (rate limit). Polling pausado por ~${seconds}s. Próximo fetch após backoff.`;
  if (siteId) {
    const site = await getSiteById(siteId);
    if (site?.fusionsolarPlantCode) {
      await openAlarmIfMissing(siteId, "WARNING", "RATE_LIMIT_FUSIONSOLAR", desc);
    }
    return;
  }
  // Sem contexto de site → abre em todos os sites com FS configurado
  const sites = await getAllSites();
  for (const site of sites) {
    if (site.fusionsolarPlantCode) {
      await openAlarmIfMissing(site.id, "WARNING", "RATE_LIMIT_FUSIONSOLAR", desc);
    }
  }
}

async function closeRateLimitAlarms(siteId?: number): Promise<void> {
  const { closeAlarmsByType } = await import("./db");
  await closeAlarmsByType("RATE_LIMIT_FUSIONSOLAR", siteId);
}

// ─── FusionSolar Client ─────────────────────────────────────

class FusionSolarClient {
  private baseUrl: string;
  private username: string;
  private systemCode: string;
  private xsrfToken: string | null = null;
  private cookies: string[] = [];
  private lastLoginTime: number = 0;
  private loginInterval: number = 25 * 60 * 1000; // 25 min (session lasts 30min)

  constructor() {
    this.baseUrl = ENV.fusionsolarBaseUrl;
    this.username = ENV.fusionsolarUsername;
    this.systemCode = ENV.fusionsolarSystemCode;
  }

  get isConfigured(): boolean {
    return !!(this.username && this.systemCode);
  }

  // ── Authentication ──────────────────────────────────────

  async login(): Promise<boolean> {
    if (!this.isConfigured) {
      console.warn("[FusionSolar] Not configured — username or systemCode missing");
      return false;
    }

    try {
      await waitForRateLimit(); // Login also counts as an API call
      
      const resp = await fetch(`${this.baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: this.username,
          systemCode: this.systemCode,
        }),
      });

      const data = await resp.json();

      if (data.success === true || data.failCode === 0) {
        // Extract XSRF-TOKEN from set-cookie headers
        const setCookies = resp.headers.getSetCookie?.() ?? [];
        this.cookies = setCookies;
        
        for (const cookie of setCookies) {
          const match = cookie.match(/XSRF-TOKEN=([^;]+)/);
          if (match) {
            this.xsrfToken = match[1];
            break;
          }
        }

        if (this.xsrfToken) {
          this.lastLoginTime = Date.now();
          onApiSuccess();
          console.log("[FusionSolar] Login successful");
          return true;
        } else {
          console.warn("[FusionSolar] Login OK but XSRF-TOKEN not found in cookies");
          return false;
        }
      } else {
        if (data.failCode === 407) {
          onRateLimitHit();
        }
        console.error(`[FusionSolar] Login failed: failCode=${data.failCode}, message=${data.message}`);
        return false;
      }
    } catch (error) {
      console.error("[FusionSolar] Login error:", error);
      return false;
    }
  }

  private async ensureAuthenticated(): Promise<boolean> {
    if (!this.xsrfToken) return this.login();
    if (Date.now() - this.lastLoginTime > this.loginInterval) {
      console.log("[FusionSolar] Token may be expiring, re-authenticating...");
      return this.login();
    }
    return true;
  }

  private async apiPost(endpoint: string, payload: Record<string, unknown>, siteId?: number): Promise<any> {
    if (!await this.ensureAuthenticated()) {
      throw new Error("FusionSolar authentication failed");
    }

    await waitForRateLimit(); // Enforce delay between API calls

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "XSRF-TOKEN": this.xsrfToken!,
    };

    // Include cookies for session
    if (this.cookies.length > 0) {
      const cookieStr = this.cookies
        .map(c => c.split(";")[0])
        .join("; ");
      headers["Cookie"] = cookieStr;
    }

    const resp = await fetch(`${this.baseUrl}/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (data.success === true || data.failCode === 0) {
      onApiSuccess(siteId);
      return data.data;
    }

    // Handle rate limit (failCode 407)
    if (data.failCode === 407) {
      onRateLimitHit(siteId);
      throw new Error(`FusionSolar API rate limited (407) on ${endpoint}. Backing off.`);
    }

    // Handle token expiration (failCode 305)
    if (data.failCode === 305) {
      console.warn("[FusionSolar] Token expired, re-authenticating...");
      this.xsrfToken = null;
      if (await this.login()) {
        await waitForRateLimit(); // Wait before retry
        // Retry once
        headers["XSRF-TOKEN"] = this.xsrfToken!;
        if (this.cookies.length > 0) {
          headers["Cookie"] = this.cookies.map(c => c.split(";")[0]).join("; ");
        }
        const retryResp = await fetch(`${this.baseUrl}/${endpoint}`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        const retryData = await retryResp.json();
        if (retryData.success === true || retryData.failCode === 0) {
          onApiSuccess(siteId);
          return retryData.data;
        }
        if (retryData.failCode === 407) {
          onRateLimitHit(siteId);
          throw new Error(`FusionSolar API rate limited (407) on ${endpoint} retry. Backing off.`);
        }
      }
    }

    throw new Error(`FusionSolar API error: failCode=${data.failCode}, message=${data.message}`);
  }

  // ── Station & Device Discovery ──────────────────────────

  async getStationList(): Promise<FusionSolarStation[]> {
    try {
      const data = await this.apiPost("getStationList", { pageNo: 1, pageSize: 100 });
      return data?.list ?? [];
    } catch (error) {
      console.error("[FusionSolar] getStationList error:", error);
      return [];
    }
  }

  async getDeviceList(stationCode: string): Promise<FusionSolarDevice[]> {
    try {
      const data = await this.apiPost("getDevList", { stationCodes: stationCode });
      return data ?? [];
    } catch (error) {
      console.error("[FusionSolar] getDeviceList error:", error);
      return [];
    }
  }

  // ── Real-Time Data ──────────────────────────────────────

  async getBatteryRealKpi(devIds: string, devTypeId: number = 41, siteId?: number): Promise<BatteryRealTimeData | null> {
    try {
      const data = await this.apiPost("getDevRealKpi", { devIds, devTypeId }, siteId);
      if (!data || !Array.isArray(data) || data.length === 0) return null;

      const deviceData = data[0];
      const dataItemMap = deviceData?.dataItemMap ?? {};

      // LUNA2000-215kWh não retorna battery_power; usa ch_discharge_power em watts
      // com convenção INVERTIDA do código (positivo=descarga). Validado empiricamente
      // 2026-04-29: 10 amostras consecutivas com SOC caindo 94→69 e ch_discharge_power
      // sempre positivo (0.255 a 52 kW). Invertemos o sinal pra bater com a convenção
      // interna `batteryPower < 0 = descarga` (poll-scheduler.ts:159, routers.ts:1478).
      const rawPower = dataItemMap.battery_power ?? (
        dataItemMap.ch_discharge_power != null ? -Number(dataItemMap.ch_discharge_power) / 1000 : undefined
      );

      return {
        battery_soc: dataItemMap.battery_soc != null ? Number(dataItemMap.battery_soc) : undefined,
        battery_soh: dataItemMap.battery_soh != null ? Number(dataItemMap.battery_soh) : undefined,
        battery_power: rawPower != null ? Number(rawPower) : undefined,
        battery_temperature: dataItemMap.battery_temperature != null ? Number(dataItemMap.battery_temperature) : undefined,
        bus_voltage: dataItemMap.bus_voltage != null ? Number(dataItemMap.bus_voltage) : undefined,
        max_charge_power: dataItemMap.max_charge_power != null ? Number(dataItemMap.max_charge_power) : undefined,
        max_discharge_power: dataItemMap.max_discharge_power != null ? Number(dataItemMap.max_discharge_power) : undefined,
        ch_discharge_model: dataItemMap.ch_discharge_model != null ? Number(dataItemMap.ch_discharge_model) : undefined,
        collectTime: deviceData.collectTime != null ? Number(deviceData.collectTime) : undefined,
      };
    } catch (error) {
      console.error("[FusionSolar] getBatteryRealKpi error:", error);
      return null;
    }
  }

  async getInverterRealKpi(devIds: string, devTypeId: number = 1): Promise<InverterRealTimeData | null> {
    try {
      const data = await this.apiPost("getDevRealKpi", { devIds, devTypeId });
      if (!data || !Array.isArray(data) || data.length === 0) return null;

      // Sum active_power across all inverters
      let totalActivePower = 0;
      let totalDayCap = 0;
      let latestCollectTime: number | undefined;

      for (const deviceData of data) {
        const m = deviceData?.dataItemMap ?? {};
        if (m.active_power != null) totalActivePower += Number(m.active_power);
        if (m.day_cap != null) totalDayCap += Number(m.day_cap);
        if (deviceData.collectTime != null) {
          const ct = Number(deviceData.collectTime);
          if (!latestCollectTime || ct > latestCollectTime) latestCollectTime = ct;
        }
      }

      return {
        active_power: totalActivePower,
        day_cap: totalDayCap,
        collectTime: latestCollectTime,
      };
    } catch (error) {
      console.error("[FusionSolar] getInverterRealKpi error:", error);
      return null;
    }
  }

  // Auto-discover device IDs for a station.
  //
  // The Northbound API expects the LONG numeric id (e.g. "1000000054174514")
  // for `getDevRealKpi`. The short id "54174514" that appears in the portal
  // URL (returned here as `devDn` = "NE=54174514") returns EMPTY for ESS
  // (devTypeId=41) and inverters (devTypeId=1).
  //
  // We pick `dev.id` first, then fall back to the bare numeric tail of
  // `devDn` only if `id` is missing.
  async discoverDeviceIds(stationCode: string): Promise<{ batteryIds: string[]; inverterIds: string[] }> {
    const devices = await this.getDeviceList(stationCode);
    const batteryIds: string[] = [];
    const inverterIds: string[] = [];

    const pickId = (dev: FusionSolarDevice): string | null => {
      if (dev.id !== undefined && dev.id !== null && String(dev.id).length > 0) {
        return String(dev.id);
      }
      // Legacy / fallback: strip the "NE=" prefix from devDn (or use devId).
      const fallback = dev.devDn ?? dev.devId ?? "";
      const stripped = String(fallback).replace(/^NE=/, "");
      return stripped.length > 0 ? stripped : null;
    };

    for (const dev of devices) {
      const id = pickId(dev);
      if (!id) continue;
      if (dev.devTypeId === 41) batteryIds.push(id);
      else if (dev.devTypeId === 1) inverterIds.push(id);
    }
    return { batteryIds, inverterIds };
  }

  async getStationRealKpi(stationCodes: string): Promise<StationRealTimeData | null> {
    try {
      const data = await this.apiPost("getStationRealKpi", { stationCodes });
      if (!data || !Array.isArray(data) || data.length === 0) return null;

      const stationData = data[0];
      const dataItemMap = stationData?.dataItemMap ?? {};

      return {
        day_power: dataItemMap.day_power != null ? Number(dataItemMap.day_power) : undefined,
        month_power: dataItemMap.month_power != null ? Number(dataItemMap.month_power) : undefined,
        total_power: dataItemMap.total_power != null ? Number(dataItemMap.total_power) : undefined,
        day_income: dataItemMap.day_income != null ? Number(dataItemMap.day_income) : undefined,
        real_health_state: dataItemMap.real_health_state != null ? Number(dataItemMap.real_health_state) : undefined,
      };
    } catch (error) {
      console.error("[FusionSolar] getStationRealKpi error:", error);
      return null;
    }
  }

  // ── Historical Data ─────────────────────────────────────

  async getDevHistoryKpi(devIds: string, devTypeId: number, startTime: number, endTime: number): Promise<any[]> {
    try {
      const data = await this.apiPost("getDevHistoryKpi", {
        devIds,
        devTypeId,
        startTime,
        endTime,
      });
      return data ?? [];
    } catch (error) {
      console.error("[FusionSolar] getDevHistoryKpi error:", error);
      return [];
    }
  }

  async getStationHourKpi(stationCodes: string, collectTime: number): Promise<any[]> {
    try {
      const data = await this.apiPost("getKpiStationHour", {
        stationCodes,
        collectTime,
      });
      return data ?? [];
    } catch (error) {
      console.error("[FusionSolar] getStationHourKpi error:", error);
      return [];
    }
  }

  // ── Alarms ──────────────────────────────────────────────

  async getAlarmList(stationCodes: string, beginTime?: number, endTime?: number): Promise<FusionSolarAlarm[]> {
    try {
      const payload: Record<string, unknown> = {
        stationCodes,
        pageNo: 1,
        pageSize: 100,
        language: "pt_BR",
      };
      if (beginTime) payload.beginTime = beginTime;
      if (endTime) payload.endTime = endTime;

      const data = await this.apiPost("getAlarmList", payload);
      return data?.list ?? [];
    } catch (error) {
      console.error("[FusionSolar] getAlarmList error:", error);
      return [];
    }
  }

  // ── Combined Telemetry (for the controller loop) ────────
  // OPTIMIZED: Serialized calls instead of Promise.all to respect 1 concurrent req/min
  // OPTIMIZED: Skip getStationRealKpi when we have device-level battery data (redundant)

  async getFullTelemetry(
    batteryDevIds: string,
    stationCode: string,
    inverterDevIds?: string,
    devTypeId: number = 41
  ): Promise<TelemetryResult> {
    try {
      // 1. Battery data (most important — gives SOC)
      const batteryData = await this.getBatteryRealKpi(batteryDevIds, devTypeId);
      
      if (!batteryData) {
        return { success: false, data: null, stationData: null, inverterData: null, error: "No battery data returned" };
      }

      // 2. Inverter data (gives real-time PV power) — only if configured
      let inverterData: InverterRealTimeData | null = null;
      if (inverterDevIds) {
        inverterData = await this.getInverterRealKpi(inverterDevIds);
      }

      // 3. Station data — SKIP if we already have battery + inverter data
      //    Station-level only adds day_power (kWh total), which is less useful than
      //    inverter active_power (kW instantaneous). Saves 1 API call per cycle.
      let stationData: StationRealTimeData | null = null;
      if (!inverterData) {
        // Only fetch station data as fallback when inverter data is unavailable
        stationData = await this.getStationRealKpi(stationCode);
      }

      // Calculate data age
      let dataAge: number | undefined;
      if (batteryData.collectTime) {
        dataAge = Math.round((Date.now() - batteryData.collectTime) / 1000);
      }

      return {
        success: true,
        data: batteryData,
        stationData,
        inverterData,
        dataAge,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        stationData: null,
        inverterData: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────

let _client: FusionSolarClient | null = null;

export function getFusionSolarClient(): FusionSolarClient {
  if (!_client) {
    _client = new FusionSolarClient();
  }
  return _client;
}

export function isFusionSolarConfigured(): boolean {
  return !!(ENV.fusionsolarUsername && ENV.fusionsolarSystemCode);
}
