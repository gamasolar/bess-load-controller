import { trpc } from "@/lib/trpc";
import { Cloud, CloudRain, CloudSnow, Sun, CloudSun, CloudFog, Zap, Droplets } from "lucide-react";

/** Mapeia weather code WMO pra ícone + label curto. Veja: https://open-meteo.com/en/docs */
function codeToIconLabel(code: number, isDay: boolean): { icon: JSX.Element; label: string; color: string } {
  // 0: clear · 1-3: parcialmente nublado · 45/48: névoa
  // 51-67: chuva (várias intensidades)  · 71-77: neve · 80-86: pancadas
  // 95-99: tempestade
  if (code === 0) {
    return isDay
      ? { icon: <Sun className="w-4 h-4" />, label: "Limpo", color: "text-amber-400" }
      : { icon: <Sun className="w-4 h-4" />, label: "Limpo", color: "text-zinc-300" };
  }
  if (code <= 2) return { icon: <CloudSun className="w-4 h-4" />, label: "Parcial", color: "text-amber-300" };
  if (code === 3) return { icon: <Cloud className="w-4 h-4" />, label: "Nublado", color: "text-zinc-300" };
  if (code === 45 || code === 48) return { icon: <CloudFog className="w-4 h-4" />, label: "Névoa", color: "text-zinc-400" };
  if (code >= 95) return { icon: <Zap className="w-4 h-4" />, label: "Tempestade", color: "text-yellow-300" };
  if (code >= 71 && code <= 77) return { icon: <CloudSnow className="w-4 h-4" />, label: "Neve", color: "text-blue-200" };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 86)) {
    return { icon: <CloudRain className="w-4 h-4" />, label: "Chuva", color: "text-blue-400" };
  }
  return { icon: <Cloud className="w-4 h-4" />, label: "—", color: "text-zinc-300" };
}

export function WeatherWidget({ slug }: { slug: string }) {
  const { data, isLoading } = trpc.bess.weather.useQuery(
    { slug },
    { refetchInterval: 10 * 60_000, staleTime: 5 * 60_000 },
  );

  if (isLoading || !data) return null;
  if ("configured" in data && !data.configured) {
    return (
      <span className="text-[10px] text-muted-foreground italic">
        Defina coordenadas em Configurações → Sites
      </span>
    );
  }
  if ("available" in data && !data.available) {
    return <span className="text-[10px] text-muted-foreground italic">Clima indisponível</span>;
  }

  const cur = data.current;
  const meta = codeToIconLabel(cur.weatherCode, cur.isDay);

  // Probabilidade máxima de chuva nas próximas 6h
  const next6h = data.hourly.slice(0, 6);
  const rainPctMax = next6h.length > 0
    ? Math.max(...next6h.map((h) => h.precipitationProbabilityPct ?? 0))
    : 0;

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-black/30 border border-white/5 text-xs">
      <span className={meta.color}>{meta.icon}</span>
      <span className="font-mono font-semibold tabular-nums">{Math.round(cur.tempC)}°C</span>
      <span className="text-muted-foreground hidden sm:inline">{meta.label}</span>
      {rainPctMax >= 30 && (
        <span className="flex items-center gap-0.5 text-blue-300">
          <Droplets className="w-3 h-3" /> {rainPctMax}%
        </span>
      )}
    </div>
  );
}
