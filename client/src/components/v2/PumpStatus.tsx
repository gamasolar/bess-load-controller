import { Power, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PumpStatus({
  pumpState,
  noHardware,
  readOnly = false,
  cooldownActive,
  cooldownRemainingMs,
  busy,
  onToggle,
}: {
  pumpState: "ON" | "OFF" | "UNKNOWN";
  noHardware: boolean;
  readOnly?: boolean;
  cooldownActive: boolean;
  cooldownRemainingMs: number;
  busy: boolean;
  onToggle: () => void;
}) {
  const isOn = pumpState === "ON";
  const unknown = pumpState === "UNKNOWN";

  const ringClass = unknown
    ? "border-zinc-600 bg-zinc-800/60"
    : isOn
      ? "border-emerald-400/70 bg-emerald-500/15 shadow-[0_0_30px_rgba(16,185,129,0.35)]"
      : "border-zinc-600/70 bg-zinc-800/40";

  const iconColor = unknown
    ? "text-zinc-500"
    : isOn
      ? "text-emerald-300"
      : "text-zinc-500";

  return (
    <div className="flex items-center gap-4">
      {/* Visual: animated pump icon */}
      <div className="relative shrink-0">
        <div
          className={`w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${ringClass}`}
        >
          <Droplets
            className={`w-8 h-8 transition-all ${iconColor} ${isOn ? "animate-pulse" : ""}`}
          />
        </div>
        {/* Drop animation when ON */}
        {isOn && (
          <>
            <span className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-1 h-1 rounded-full bg-emerald-400/80 animate-[pumpDrop_1.6s_ease-in_infinite]" />
            <span className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-1 h-1 rounded-full bg-emerald-400/80 animate-[pumpDrop_1.6s_ease-in_0.8s_infinite]" />
          </>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Bomba</p>
        <p
          className={`text-2xl font-bold leading-tight tracking-tight ${
            unknown ? "text-zinc-500" : isOn ? "text-emerald-300" : "text-zinc-400"
          }`}
        >
          {noHardware ? "—" : unknown ? "DESCONHECIDO" : isOn ? "LIGADA" : "DESLIGADA"}
        </p>
        {cooldownActive && (
          <p className="text-[11px] text-amber-400 mt-0.5">
            ⏱ Cooldown {Math.ceil(cooldownRemainingMs / 1000)}s
          </p>
        )}
      </div>

      {!noHardware && !readOnly && (
        <Button
          variant={isOn ? "outline" : "default"}
          size="lg"
          className="min-h-[56px] min-w-[120px] text-base font-semibold"
          disabled={busy || cooldownActive}
          onClick={onToggle}
        >
          <Power className="w-5 h-5 mr-2" />
          {isOn ? "Desligar" : "Ligar"}
        </Button>
      )}
    </div>
  );
}
