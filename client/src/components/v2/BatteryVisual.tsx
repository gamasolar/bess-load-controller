import { Zap, ArrowDown } from "lucide-react";
import { useEffect, useState } from "react";

type Zones = {
  blackout: number;
  desliga: number;
  religa: number;
};

function zoneColor(soc: number, z: Zones) {
  if (soc <= z.blackout) return { fill: "#ef4444", glow: "rgba(239,68,68,0.45)" };
  if (soc <= z.desliga) return { fill: "#f97316", glow: "rgba(249,115,22,0.45)" };
  if (soc < z.religa) return { fill: "#eab308", glow: "rgba(234,179,8,0.45)" };
  return { fill: "#10b981", glow: "rgba(16,185,129,0.45)" };
}

export function BatteryVisual({
  soc,
  socSource,
  zones,
  batteryPower,
  lastTelemetryAt,
}: {
  soc: number | null;
  socSource: "REAL" | "ESTIMATED" | null;
  zones: Zones;
  batteryPower: number | null;
  lastTelemetryAt: Date | string | null;
}) {
  const hasData = soc !== null;
  const value = Math.max(0, Math.min(100, soc ?? 0));
  const colors = hasData
    ? zoneColor(value, zones)
    : { fill: "#3f3f46", glow: "rgba(63,63,70,0.3)" };

  const charging = batteryPower !== null && batteryPower > 0.05;
  const discharging = batteryPower !== null && batteryPower < -0.05;

  const fillHeight = (value / 100) * 200;
  const fillY = 220 - fillHeight;

  const lastTs = lastTelemetryAt ? new Date(lastTelemetryAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (lastTs === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastTs]);

  const ageSeconds = lastTs === null ? null : Math.max(0, Math.floor((now - lastTs) / 1000));
  const ageLabel =
    ageSeconds === null
      ? "—"
      : ageSeconds < 60
        ? `${ageSeconds}s`
        : ageSeconds < 3600
          ? `${Math.floor(ageSeconds / 60)}min ${ageSeconds % 60}s`
          : `${Math.floor(ageSeconds / 3600)}h ${Math.floor((ageSeconds % 3600) / 60)}min`;

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="relative">
        <svg
          viewBox="0 0 140 240"
          className="w-24 h-44 md:w-28 md:h-48 drop-shadow-2xl"
          style={{ filter: hasData ? `drop-shadow(0 0 18px ${colors.glow})` : undefined }}
        >
          {/* Battery cap (terminal) */}
          <rect x="55" y="6" width="30" height="14" rx="3" fill="#52525b" />

          {/* Battery body outline */}
          <rect
            x="14"
            y="20"
            width="112"
            height="208"
            rx="14"
            fill="#18181b"
            stroke="#3f3f46"
            strokeWidth="3"
          />

          {/* Inner bezel */}
          <rect
            x="20"
            y="26"
            width="100"
            height="196"
            rx="8"
            fill="#0a0a0a"
          />

          {/* Fill */}
          <defs>
            <linearGradient id="battFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.fill} stopOpacity="0.95" />
              <stop offset="100%" stopColor={colors.fill} stopOpacity="0.65" />
            </linearGradient>
          </defs>
          <rect
            x="20"
            y={fillY < 26 ? 26 : fillY}
            width="100"
            height={fillY < 26 ? fillHeight - (26 - fillY) : fillHeight}
            rx="8"
            fill="url(#battFillGrad)"
            style={{
              transition: "all 1s cubic-bezier(0.4,0,0.2,1)",
            }}
          />

          {/* Zone tick marks */}
          {hasData && [zones.blackout, zones.desliga, zones.religa].map((z) => {
            const y = 222 - (z / 100) * 200;
            return (
              <line
                key={z}
                x1="20" x2="120"
                y1={y} y2={y}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            );
          })}

          {/* Center label */}
          <text
            x="70"
            y="120"
            textAnchor="middle"
            fontSize="36"
            fontWeight="800"
            fill={hasData ? "#fafafa" : "#71717a"}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
          >
            {hasData ? value.toFixed(0) : "—"}
          </text>
          <text
            x="70"
            y="140"
            textAnchor="middle"
            fontSize="14"
            fontWeight="500"
            fill={hasData ? "#a1a1aa" : "#52525b"}
          >
            %
          </text>
        </svg>

        {/* Flow indicator: charging */}
        {charging && (
          <div
            className="absolute -right-2 top-1/2 -translate-y-1/2 bg-yellow-500/15 backdrop-blur-sm border border-yellow-500/40 rounded-full p-1.5 animate-pulse"
            title={`Carregando ${batteryPower!.toFixed(1)} kW`}
          >
            <Zap className="w-4 h-4 text-yellow-400 fill-yellow-400" />
          </div>
        )}
        {/* Flow indicator: discharging */}
        {discharging && (
          <div
            className="absolute -right-2 top-1/2 -translate-y-1/2 bg-orange-500/15 backdrop-blur-sm border border-orange-500/40 rounded-full p-1.5"
            title={`Descarregando ${Math.abs(batteryPower!).toFixed(1)} kW`}
          >
            <ArrowDown className="w-4 h-4 text-orange-400" />
          </div>
        )}
      </div>

      {/* Status caption */}
      <div className="flex flex-col items-center gap-0.5">
        {hasData ? (
          <>
            <span
              className={`text-[10px] uppercase tracking-wider font-mono ${
                socSource === "ESTIMATED" ? "text-yellow-500" : "text-emerald-500"
              }`}
            >
              {socSource === "ESTIMATED" ? "Coulomb" : "FusionSolar"}
            </span>
            <span className="text-[10px] text-muted-foreground">há {ageLabel}</span>
          </>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            sem dado fresco
          </span>
        )}
      </div>
    </div>
  );
}
