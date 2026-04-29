import { useEffect, useState } from "react";
import { colorsFor, captionFor, durationMinFromSince, type MotorPresetProps } from "./shared";

// Preset C — Sparkline (mini bar chart das últimas N leituras de loadPower).
export function MotorSparkline({ loadHealth, loadPower, loadFailureSince, loadHistory = [] }: MotorPresetProps) {
  const c = colorsFor(loadHealth);
  const failureSinceMs = loadFailureSince ? new Date(loadFailureSince).getTime() : null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (loadHealth !== "VERIFYING" && loadHealth !== "FAILED") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [loadHealth]);
  const durationMin = durationMinFromSince(loadFailureSince, now);

  // Histórico real (do prop). Inclui o valor atual no fim. Se loadHistory está vazio, mostra só o atual.
  const history = loadHistory.length > 0
    ? loadHistory
    : (loadPower != null ? [loadPower] : []);
  const max = Math.max(...history, 1);
  const loadLabel = loadPower == null ? "—" : (loadPower < 10 ? loadPower.toFixed(1) : loadPower.toFixed(0));

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="relative w-24 h-44 md:w-28 md:h-48 flex flex-col items-center justify-end p-2 rounded-md border border-zinc-800 bg-zinc-900/40"
           style={{ filter: c.glow ? `drop-shadow(0 0 14px ${c.glow})` : undefined }}>
        <div className="text-2xl font-bold font-mono text-foreground leading-none">{loadLabel}</div>
        <div className="text-[10px] text-muted-foreground mb-2">kW</div>
        <div className="flex items-end gap-0.5 h-16 w-full justify-center">
          {history.length === 0 ? (
            <div className="text-[9px] text-muted-foreground italic">sem histórico</div>
          ) : (
            history.map((v, i) => (
              <div key={i} className="w-1.5 rounded-sm" style={{
                height: `${Math.max(2, (v / max) * 100)}%`,
                backgroundColor: c.fill,
                opacity: i === history.length - 1 ? 1 : 0.4 + (i / history.length) * 0.4,
                transition: "all 0.5s",
              }} />
            ))
          )}
        </div>
      </div>
      <span className={`text-[10px] uppercase tracking-wider font-mono ${c.text}`}>{captionFor(loadHealth, durationMin)}</span>
    </div>
  );
}
