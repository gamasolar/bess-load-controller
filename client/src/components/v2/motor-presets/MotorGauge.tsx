import { useEffect, useState } from "react";
import { colorsFor, captionFor, durationMinFromSince, maxKwFor, type MotorPresetProps } from "./shared";

// Preset G — Gauge industrial moderno (gradiente, halo, glass effect).
export function MotorGauge({ loadHealth, loadPower, loadFailureSince, pumpPowerCv = 30, pumpCount = 1 }: MotorPresetProps) {
  const c = colorsFor(loadHealth);
  const maxKw = maxKwFor(pumpPowerCv, pumpCount);
  const lp = loadPower ?? 0;
  const pct = Math.min(1, Math.max(0, lp / maxKw));

  const angle = -135 + pct * 270;
  const rad = (angle * Math.PI) / 180;
  const needleX = 70 + Math.cos(rad) * 46;
  const needleY = 130 + Math.sin(rad) * 46;
  const arcStart = { x: 70 + Math.cos((-135 * Math.PI) / 180) * 54, y: 130 + Math.sin((-135 * Math.PI) / 180) * 54 };
  const arcEnd = { x: 70 + Math.cos((135 * Math.PI) / 180) * 54, y: 130 + Math.sin((135 * Math.PI) / 180) * 54 };
  const arcPath = `M ${arcStart.x} ${arcStart.y} A 54 54 0 1 1 ${arcEnd.x} ${arcEnd.y}`;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (loadHealth !== "VERIFYING" && loadHealth !== "FAILED") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [loadHealth]);
  const durationMin = durationMinFromSince(loadFailureSince, now);
  const loadLabel = loadPower == null ? "—" : (loadPower < 10 ? loadPower.toFixed(1) : loadPower.toFixed(0));

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="relative">
        <svg viewBox="0 0 140 240" className="w-24 h-44 md:w-28 md:h-48"
             style={{ filter: c.glow ? `drop-shadow(0 0 20px ${c.glow})` : "drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}>
          <defs>
            <linearGradient id={`gaugeFill-${loadHealth}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={c.fill} stopOpacity="0.4" />
              <stop offset="100%" stopColor={c.fill} stopOpacity="1" />
            </linearGradient>
            <radialGradient id={`gaugeBg-${loadHealth}`} cx="0.5" cy="0.4" r="0.8">
              <stop offset="0%" stopColor="#1c1c20" />
              <stop offset="60%" stopColor="#0e0e10" />
              <stop offset="100%" stopColor="#050507" />
            </radialGradient>
            <filter id={`halo-${loadHealth}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <circle cx="70" cy="130" r="62" fill={`url(#gaugeBg-${loadHealth})`} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <ellipse cx="70" cy="80" rx="42" ry="14" fill="rgba(255,255,255,0.04)" />
          <path d={arcPath} fill="none" stroke="#27272a" strokeWidth="10" strokeLinecap="round" />
          <path d={arcPath} fill="none" stroke={`url(#gaugeFill-${loadHealth})`} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${pct * 254} 254`}
                filter={c.glow ? `url(#halo-${loadHealth})` : undefined}
                style={{ transition: "stroke-dasharray 1s cubic-bezier(0.4,0,0.2,1)" }} />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const a = (-135 + t * 270) * Math.PI / 180;
            const x1 = 70 + Math.cos(a) * 60, y1 = 130 + Math.sin(a) * 60;
            const x2 = 70 + Math.cos(a) * 66, y2 = 130 + Math.sin(a) * 66;
            return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#71717a" strokeWidth="1" opacity="0.5" />;
          })}
          <line x1="70" y1="130" x2={needleX} y2={needleY} stroke="#fafafa" strokeWidth="2.5" strokeLinecap="round"
                style={{ transition: "all 1s cubic-bezier(0.4,0,0.2,1)", filter: "drop-shadow(0 0 4px rgba(255,255,255,0.6))" }} />
          <circle cx="70" cy="130" r="7" fill="#27272a" stroke={c.stroke} strokeWidth="1.5" />
          <circle cx="70" cy="130" r="3" fill={c.stroke} />
          <circle cx="68" cy="128" r="1.5" fill="rgba(255,255,255,0.6)" />
          <text x="70" y="206" textAnchor="middle" fontSize="22" fontWeight="800" fill="#fafafa"
                style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "-0.02em" }}>{loadLabel}</text>
          <text x="70" y="222" textAnchor="middle" fontSize="10" fill="#a1a1aa" letterSpacing="0.1em">kW</text>
        </svg>
      </div>
      <span className={`text-[10px] uppercase tracking-wider font-mono ${c.text}`}>{captionFor(loadHealth, durationMin)}</span>
    </div>
  );
}
