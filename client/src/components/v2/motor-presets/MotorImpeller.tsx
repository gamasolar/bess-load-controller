import { AlertTriangle, HelpCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { colorsFor, captionFor, durationMinFromSince, type MotorPresetProps } from "./shared";

// Preset E — Impeller (vista frontal do impulsor da bomba centrífuga, original).
export function MotorImpeller({ loadHealth, loadPower, loadFailureSince }: MotorPresetProps) {
  const c = colorsFor(loadHealth);
  const isUnknown = loadHealth === "UNKNOWN";
  const failureSinceMs = loadFailureSince ? new Date(loadFailureSince).getTime() : null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (loadHealth !== "VERIFYING" && loadHealth !== "FAILED") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [loadHealth]);

  const durationMin = durationMinFromSince(loadFailureSince, now);
  const loadLabel = loadPower == null ? "—" : loadPower < 1 ? `${loadPower.toFixed(2)} kW` : `${loadPower.toFixed(1)} kW`;
  const subCaption =
    loadHealth === "FAILED" && durationMin != null ? `${durationMin}min · sem consumo` :
    loadHealth === "VERIFYING" && durationMin != null ? `há ${durationMin}min` :
    null;

  const rotorAnim =
    loadHealth === "RUNNING_OK" ? "spin 3s linear infinite" :
    loadHealth === "VERIFYING" ? "pulse 2s ease-in-out infinite" :
    "none";
  const rotorBlur = loadHealth === "RUNNING_OK" ? "blur(0.4px)" : undefined;

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="relative">
        <svg viewBox="0 0 140 240"
             className={`w-24 h-44 md:w-28 md:h-48 drop-shadow-2xl ${loadHealth === "FAILED" ? "animate-pulse" : ""}`}
             style={{ filter: c.glow ? `drop-shadow(0 0 18px ${c.glow})` : undefined }}>
          <circle cx="70" cy="130" r="58" fill="#18181b" stroke={c.stroke} strokeWidth="3"
                  style={{ transition: "stroke 1s cubic-bezier(0.4,0,0.2,1)" }} />
          <circle cx="70" cy="130" r="48" fill="#0a0a0a" />
          <g style={{
            transformOrigin: "70px 130px",
            animation: rotorAnim,
            filter: rotorBlur,
            willChange: "transform",
          }}>
            {[0, 60, 120, 180, 240, 300].map((deg) => (
              <path key={deg} d="M 70 98 Q 78 114 70 126 Q 62 114 70 98 Z"
                    fill={c.fill} opacity="0.85" transform={`rotate(${deg} 70 130)`} />
            ))}
            <circle cx="70" cy="130" r="10" fill={c.stroke} />
            <circle cx="70" cy="130" r="4" fill="#0a0a0a" />
          </g>
          <text x="70" y="208" textAnchor="middle" fontSize="16" fontWeight="700"
                fill={isUnknown ? "#52525b" : "#fafafa"}
                style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
            {loadLabel}
          </text>
          {loadHealth === "FAILED" && (
            <g transform="translate(95,95)">
              <circle r="14" fill="#0a0a0a" stroke="#f87171" strokeWidth="2" />
              <text x="0" y="5" textAnchor="middle" fontSize="20" fontWeight="900" fill="#f87171">!</text>
            </g>
          )}
          {isUnknown && (
            <g transform="translate(95,95)">
              <circle r="14" fill="#0a0a0a" stroke="#71717a" strokeWidth="2" />
              <text x="0" y="5" textAnchor="middle" fontSize="18" fontWeight="900" fill="#71717a">?</text>
            </g>
          )}
        </svg>
        {loadHealth === "FAILED" && (
          <div className="absolute -top-2 -right-2 bg-red-500/15 backdrop-blur-sm border border-red-500/40 rounded-full p-1">
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
        )}
        {isUnknown && (
          <div className="absolute -top-2 -right-2 bg-zinc-700/40 border border-zinc-600 rounded-full p-1">
            <HelpCircle className="w-4 h-4 text-zinc-400" />
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <span className={`text-[10px] uppercase tracking-wider font-mono ${c.text}`}>{captionFor(loadHealth, durationMin)}</span>
        {subCaption && <span className={`text-[10px] ${c.text}`}>{subCaption}</span>}
      </div>
    </div>
  );
}
