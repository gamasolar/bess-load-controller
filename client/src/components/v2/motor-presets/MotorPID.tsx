import { useEffect, useState } from "react";
import { colorsFor, captionFor, durationMinFromSince, type MotorPresetProps } from "./shared";

// Preset I — Esquema P&ID animado (engineering drawing).
export function MotorPID({ loadHealth, loadPower, loadFailureSince }: MotorPresetProps) {
  const c = colorsFor(loadHealth);
  const isFlowing = loadHealth === "RUNNING_OK";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (loadHealth !== "VERIFYING" && loadHealth !== "FAILED") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [loadHealth]);
  const durationMin = durationMinFromSince(loadFailureSince, now);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="relative">
        <svg viewBox="0 0 140 240" className="w-24 h-44 md:w-28 md:h-48"
             style={{ filter: c.glow ? `drop-shadow(0 0 12px ${c.glow})` : undefined }}>
          <defs>
            <pattern id={`grid-${loadHealth}`} width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#1c1c1f" strokeWidth="0.4" />
            </pattern>
            <linearGradient id={`flowGrad-${loadHealth}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.3" />
              {isFlowing && <animate attributeName="x1" from="-1" to="1" dur="1.6s" repeatCount="indefinite" />}
              {isFlowing && <animate attributeName="x2" from="0" to="2" dur="1.6s" repeatCount="indefinite" />}
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="140" height="240" fill={`url(#grid-${loadHealth})`} />
          <rect x="20" y="20" width="100" height="30" rx="2" fill="none" stroke="#71717a" strokeWidth="1.5" />
          <line x1="22" y1="38" x2="118" y2="38" stroke="#3b82f6" strokeWidth="0.8" opacity="0.6" />
          <line x1="22" y1="44" x2="118" y2="44" stroke="#3b82f6" strokeWidth="0.8" opacity="0.4" />
          <text x="70" y="34" textAnchor="middle" fontSize="7" fill="#71717a"
                style={{ fontFamily: "ui-monospace, monospace" }}>RESERVATÓRIO</text>
          <rect x="65" y="50" width="10" height="50" fill="none" stroke="#71717a" strokeWidth="1.5" />
          {(isFlowing || loadHealth === "VERIFYING") && (
            <rect x="66" y="50" width="8" height="50" fill={`url(#flowGrad-${loadHealth})`} />
          )}
          <g transform="translate(70,80)">
            <path d="M -8 -6 L 8 6 L 8 -6 L -8 6 Z" fill="none" stroke="#71717a" strokeWidth="1" />
          </g>
          <circle cx="70" cy="120" r="20" fill="none" stroke={c.stroke} strokeWidth="2.5"
                  style={{ transition: "stroke 0.5s" }} />
          <path d="M 56 120 L 80 120 M 73 113 L 80 120 L 73 127" fill="none" stroke={c.stroke}
                strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <text x="70" y="105" textAnchor="middle" fontSize="7" fontWeight="700" fill={c.stroke}>P-01</text>
          <rect x="65" y="140" width="10" height="50" fill="none" stroke="#71717a" strokeWidth="1.5" />
          {(isFlowing || loadHealth === "VERIFYING") && (
            <rect x="66" y="140" width="8" height="50" fill={`url(#flowGrad-${loadHealth})`} />
          )}
          <rect x="20" y="190" width="100" height="20" rx="2" fill="none" stroke="#71717a" strokeWidth="1.5" />
          <text x="70" y="203" textAnchor="middle" fontSize="6" fill="#71717a"
                style={{ fontFamily: "ui-monospace, monospace" }}>REDE</text>
          <text x="70" y="226" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fafafa"
                style={{ fontFamily: "ui-monospace, monospace" }}>
            {loadPower == null ? "—" : `${loadPower.toFixed(1)} kW`}
          </text>
        </svg>
      </div>
      <span className={`text-[10px] uppercase tracking-wider font-mono ${c.text}`}>{captionFor(loadHealth, durationMin)}</span>
    </div>
  );
}
