type Zones = {
  blackout: number;
  desliga: number;
  religa: number;
};

export function ZoneBar({
  soc,
  zones,
}: {
  soc: number | null;
  zones: Zones;
}) {
  const value = soc !== null ? Math.max(0, Math.min(100, soc)) : null;

  const segments = [
    { from: 0, to: zones.blackout, color: "bg-red-500/85", label: "BLACKOUT" },
    { from: zones.blackout, to: zones.desliga, color: "bg-orange-500/80", label: "CRÍTICA" },
    { from: zones.desliga, to: zones.religa, color: "bg-yellow-500/75", label: "HISTERESE" },
    { from: zones.religa, to: 100, color: "bg-emerald-500/85", label: "OPERACIONAL" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-muted-foreground">
        <span>Zona de operação</span>
        {value !== null && (
          <span className="font-mono">SOC {value.toFixed(0)}%</span>
        )}
      </div>

      <div className="relative h-6 rounded-md overflow-hidden border border-white/10 bg-black/30">
        {/* Zone segments */}
        <div className="absolute inset-0 flex">
          {segments.map((seg, i) => (
            <div
              key={i}
              className={seg.color}
              style={{ width: `${seg.to - seg.from}%` }}
              title={`${seg.label}: ${seg.from}–${seg.to}%`}
            />
          ))}
        </div>

        {/* SOC marker */}
        {value !== null && (
          <div
            className="absolute top-0 h-full transition-all duration-700 ease-out"
            style={{ left: `calc(${value}% - 1px)` }}
          >
            <div className="w-0.5 h-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
            <div className="absolute -top-1 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-white" />
          </div>
        )}
      </div>

      {/* Threshold labels */}
      <div className="relative h-3 text-[9px] font-mono text-muted-foreground">
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${zones.blackout}%` }}
        >
          {zones.blackout}
        </span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${zones.desliga}%` }}
        >
          {zones.desliga}
        </span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${zones.religa}%` }}
        >
          {zones.religa}
        </span>
      </div>
    </div>
  );
}
