/**
 * Open-Meteo client com cache em memória.
 *
 * Open-Meteo é gratis, sem API key, alta precisão (modelo ECMWF + ICON + GFS).
 * Cache de 10 min por (lat, lng) — mais que suficiente: previsão muda pouco
 * em janela menor que isso, e respeita o servidor deles.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;
const TIMEZONE = "America/Sao_Paulo";

export type WeatherSnapshot = {
  fetchedAt: string;
  current: {
    tempC: number;
    apparentTempC: number;
    humidity: number;
    cloudCoverPct: number;
    precipitationMmH: number;
    windKmh: number;
    isDay: boolean;
    weatherCode: number; // WMO code
  };
  hourly: Array<{
    timeISO: string;
    tempC: number;
    precipitationMmH: number;
    precipitationProbabilityPct: number;
    weatherCode: number;
  }>;
  daily: Array<{
    dateISO: string;
    tempMaxC: number;
    tempMinC: number;
    precipitationSumMm: number;
    precipitationProbabilityMaxPct: number;
    weatherCode: number;
  }>;
};

type CacheEntry = { ts: number; data: WeatherSnapshot };
const _cache = new Map<string, CacheEntry>();
// Map de requests em voo: se 100 cards abrirem ao mesmo tempo (cache vazio), só
// 1 fetch sai pra Open-Meteo — os outros 99 esperam essa Promise resolver.
const _inFlight = new Map<string, Promise<WeatherSnapshot | null>>();

function key(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

export async function getWeatherFor(lat: number, lng: number): Promise<WeatherSnapshot | null> {
  const k = key(lat, lng);
  const cached = _cache.get(k);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  // Dedup: se já há uma request em voo pra esse ponto, retorna a mesma Promise.
  const inFlight = _inFlight.get(k);
  if (inFlight) return inFlight;

  const promise = doFetch(k, lat, lng, cached);
  _inFlight.set(k, promise);
  try {
    return await promise;
  } finally {
    _inFlight.delete(k);
  }
}

async function doFetch(
  k: string, lat: number, lng: number, cached: CacheEntry | undefined,
): Promise<WeatherSnapshot | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,cloud_cover,precipitation,wind_speed_10m,is_day,weather_code` +
    `&hourly=temperature_2m,precipitation,precipitation_probability,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code` +
    `&forecast_days=4` +
    `&timezone=${encodeURIComponent(TIMEZONE)}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[Weather] HTTP ${res.status} pra ${k}`);
      return cached?.data ?? null;
    }
    const json: any = await res.json();
    const cur = json.current ?? {};
    const hour = json.hourly ?? {};
    const day = json.daily ?? {};

    const nowIso = new Date().toISOString();
    const hourCount = Math.min(12, (hour.time ?? []).length);
    const dayCount = Math.min(4, (day.time ?? []).length);

    // Filtra próximas 12h a partir de "agora"
    const nowMs = Date.now();
    const hourly: WeatherSnapshot["hourly"] = [];
    const allTimes = (hour.time as string[]) ?? [];
    for (let i = 0; i < allTimes.length && hourly.length < 12; i++) {
      const t = new Date(allTimes[i]);
      if (t.getTime() < nowMs - 30 * 60_000) continue; // pula passado
      hourly.push({
        timeISO: allTimes[i],
        tempC: hour.temperature_2m?.[i] ?? 0,
        precipitationMmH: hour.precipitation?.[i] ?? 0,
        precipitationProbabilityPct: hour.precipitation_probability?.[i] ?? 0,
        weatherCode: hour.weather_code?.[i] ?? 0,
      });
    }

    const daily: WeatherSnapshot["daily"] = [];
    for (let i = 0; i < dayCount; i++) {
      daily.push({
        dateISO: day.time?.[i] ?? "",
        tempMaxC: day.temperature_2m_max?.[i] ?? 0,
        tempMinC: day.temperature_2m_min?.[i] ?? 0,
        precipitationSumMm: day.precipitation_sum?.[i] ?? 0,
        precipitationProbabilityMaxPct: day.precipitation_probability_max?.[i] ?? 0,
        weatherCode: day.weather_code?.[i] ?? 0,
      });
    }

    const snap: WeatherSnapshot = {
      fetchedAt: nowIso,
      current: {
        tempC: cur.temperature_2m ?? 0,
        apparentTempC: cur.apparent_temperature ?? 0,
        humidity: cur.relative_humidity_2m ?? 0,
        cloudCoverPct: cur.cloud_cover ?? 0,
        precipitationMmH: cur.precipitation ?? 0,
        windKmh: cur.wind_speed_10m ?? 0,
        isDay: !!cur.is_day,
        weatherCode: cur.weather_code ?? 0,
      },
      hourly,
      daily,
    };

    _cache.set(k, { ts: Date.now(), data: snap });
    return snap;
  } catch (e) {
    console.warn(`[Weather] erro fetch pra ${k}:`, (e as Error).message);
    return cached?.data ?? null;
  } finally {
    clearTimeout(tid);
  }
}
