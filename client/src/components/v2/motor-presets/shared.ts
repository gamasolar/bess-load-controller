// Helpers compartilhados pelos presets do motor.
// Cada preset (Impeller / Sparkline / Gauge / PID) consome cor + caption desta lib.

export type LoadHealth =
  | "OFF_OK"
  | "RUNNING_OK"
  | "VERIFYING"
  | "FAILED"
  | "RESIDUAL"
  | "UNKNOWN";

export type MotorPreset = "C" | "E" | "G" | "I";
export const DEFAULT_MOTOR_PRESET: MotorPreset = "E";

export interface MotorPresetProps {
  loadHealth: LoadHealth;
  loadPower: number | null;
  loadFailureSince: Date | string | null;
  loadHistory?: number[]; // últimas N leituras pra sparkline (variante C)
  pumpPowerCv?: number;   // pra calcular threshold visual
  pumpCount?: number;
  lastTelemetryAt?: Date | string | null;  // pra exibir "há Xmin" sob a caption
}

export interface PresetColors {
  fill: string;
  glow: string | null;
  stroke: string;
  text: string;
}

export function colorsFor(h: LoadHealth): PresetColors {
  // RUNNING_OK e OFF_OK usam emerald-500 (mesma cor do "FusionSolar" na BatteryVisual)
  // pra padronizar a leitura "tudo certo".
  switch (h) {
    case "RUNNING_OK": return { fill: "#10b981", glow: "rgba(16,185,129,0.45)", stroke: "#34d399", text: "text-emerald-500" };
    case "OFF_OK":     return { fill: "#52525b", glow: null,                    stroke: "#71717a", text: "text-emerald-500" };
    case "VERIFYING":  return { fill: "#eab308", glow: "rgba(234,179,8,0.35)",  stroke: "#facc15", text: "text-yellow-400" };
    case "FAILED":     return { fill: "#ef4444", glow: "rgba(239,68,68,0.55)",  stroke: "#f87171", text: "text-red-400" };
    case "RESIDUAL":   return { fill: "#3b82f6", glow: "rgba(59,130,246,0.30)", stroke: "#60a5fa", text: "text-blue-400" };
    default:           return { fill: "#3f3f46", glow: null,                    stroke: "#52525b", text: "text-zinc-500" };
  }
}

export function captionFor(h: LoadHealth, durationMin?: number): string {
  switch (h) {
    case "RUNNING_OK": return "Bomba funcionando";
    case "OFF_OK":     return "Bomba parada";
    case "VERIFYING":  return durationMin != null ? `Verificando · ${durationMin}min` : "Verificando…";
    case "FAILED":     return durationMin != null ? `FALHA · ${durationMin}min` : "FALHA";
    case "RESIDUAL":   return "Consumo residual?";
    default:           return "Sem dados";
  }
}

/** Formata "há Xmin" / "há Xh" no mesmo padrão da BatteryVisual. */
export function formatAgeLabel(since: Date | string | null | undefined, nowMs: number): string | null {
  if (!since) return null;
  const ms = nowMs - new Date(since).getTime();
  if (ms < 0) return null;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min}min`;
  const hr = Math.floor(min / 60);
  return `há ${hr}h`;
}

export function maxKwFor(pumpPowerCv: number, pumpCount: number): number {
  return Math.max(10, pumpPowerCv * pumpCount * 0.7355 * 1.5);
}

export function durationMinFromSince(since: Date | string | null, nowMs: number): number | undefined {
  if (!since) return undefined;
  const ms = nowMs - new Date(since).getTime();
  if (ms < 0) return undefined;
  return Math.floor(ms / 60_000);
}
