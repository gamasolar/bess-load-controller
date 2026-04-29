import { useEffect, useState } from "react";
import {
  Activity, AlertTriangle, Clock, Hand, Power, Zap,
} from "lucide-react";

type Tone = "ok" | "warn" | "danger" | "info" | "neutral";

type Insight = {
  Icon: typeof Activity;
  iconColor: string;
  title: string;
  subtitle: string;
  detail?: string;
  tone: Tone;
};

const TONE_CARD: Record<Tone, string> = {
  ok: "border-emerald-500/25 bg-emerald-500/[0.04]",
  warn: "border-amber-500/30 bg-amber-500/[0.05]",
  danger: "border-red-500/30 bg-red-500/[0.05]",
  info: "border-blue-500/25 bg-blue-500/[0.04]",
  neutral: "border-white/5 bg-black/20",
};

const TONE_TITLE: Record<Tone, string> = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  danger: "text-red-300",
  info: "text-blue-300",
  neutral: "text-zinc-200",
};

function isWithinWindow(now: Date, startHHMM: string, endHHMM: string): boolean {
  const cur = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return cur >= startHHMM && cur < endHHMM;
}

function timeToSocHours(currentSoc: number, targetSoc: number, batteryPowerKw: number | null, capacityKwh: number): number | null {
  if (batteryPowerKw == null || capacityKwh <= 0) return null;
  const goingUp = targetSoc > currentSoc;
  if ((goingUp && batteryPowerKw <= 0) || (!goingUp && batteryPowerKw >= 0)) return null;
  const ppDiff = Math.abs(targetSoc - currentSoc);
  const kwhDiff = (ppDiff * capacityKwh) / 100;
  return kwhDiff / Math.abs(batteryPowerKw);
}

function fmtHours(h: number): string {
  if (h < 1 / 60) return "<1 min";
  if (h < 1) return `${Math.round(h * 60)} min`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (h < 24) return mins > 0 ? `${whole}h ${mins}min` : `${whole}h`;
  return `${Math.round(h)}h`;
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function DecisionPanel({ s }: { s: any }) {
  // Tick a cada 1s pra cooldown countdown ao vivo
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const insight = buildInsight(s, now);

  return (
    <div className={`rounded-lg border ${TONE_CARD[insight.tone]} px-3 py-2`}>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
        Próxima ação prevista
      </p>
      <div className="flex items-start gap-2.5">
        <insight.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${insight.iconColor}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${TONE_TITLE[insight.tone]}`}>{insight.title}</p>
          <p className="text-xs text-muted-foreground leading-snug mt-0.5">{insight.subtitle}</p>
          {insight.detail && (
            <p className="text-[10px] text-muted-foreground/70 mt-1 leading-snug">{insight.detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function buildInsight(s: any, now: Date): Insight {
  const isAuto = s.config.controlMode === "AUTO";
  // Usa pumpState (= sonoffPower, estado real) em vez de loadStatus (intent),
  // pra ficar consistente com decideAction e nunca mostrar uma ação que o
  // engine na verdade não vai executar.
  const pumpState: "ON" | "OFF" | "UNKNOWN" = s.derived?.pumpState ?? "UNKNOWN";
  const sonoffOnline: boolean = s.state.sonoffOnline ?? false;
  const isOn = pumpState === "ON";
  const soc: number | null = s.derived.soc;
  const cooldownMs: number = s.derived.cooldownRemainingMs ?? 0;
  const inWindow = isWithinWindow(now, s.config.horarioLiberacao, s.config.horarioCorte);
  const battKw: number | null = s.state.currentBatteryPower ?? null;
  const capKwh = (s.site.bessCapacityKwh ?? 0) * (s.site.bessCount ?? 1);

  if (!isAuto) {
    return {
      Icon: Hand, iconColor: "text-zinc-400", tone: "neutral",
      title: "Controle manual",
      subtitle: `Comandos automáticos desativados. Bomba ${isOn ? "LIGADA" : "DESLIGADA"} pelo operador.`,
      detail: "Mude pra AUTO no toggle do canto direito pra retomar o controle automático.",
    };
  }

  if (pumpState === "UNKNOWN" || !sonoffOnline) {
    return {
      Icon: AlertTriangle, iconColor: "text-amber-400", tone: "warn",
      title: "Sonoff offline",
      subtitle: "Sem comunicação com a chave da bomba. Sistema não pode atuar até reconectar.",
    };
  }

  if (soc === null) {
    return {
      Icon: AlertTriangle, iconColor: "text-amber-400", tone: "warn",
      title: "Sem dado de SOC",
      subtitle: "Aguardando telemetria do FusionSolar pra decidir o próximo passo.",
    };
  }

  if (cooldownMs > 0) {
    const cool = fmtCountdown(cooldownMs);
    return {
      Icon: Clock, iconColor: "text-amber-400", tone: "warn",
      title: `Cooldown · ${cool}`,
      subtitle: "Aguardando janela de proteção do contator antes de reavaliar.",
      detail: isOn
        ? `Após o cooldown: desliga se SOC ≤ ${s.config.socMinDesliga}%.`
        : `Após o cooldown: religa se SOC ≥ ${s.config.socMinReliga}% e dentro do horário.`,
    };
  }

  if (isOn) {
    const ppToOff = soc - s.config.socMinDesliga;
    const eta = timeToSocHours(soc, s.config.socMinDesliga, battKw, capKwh);
    if (ppToOff <= 0) {
      return {
        Icon: Power, iconColor: "text-red-400", tone: "danger",
        title: "Desligando agora",
        subtitle: `SOC ${soc.toFixed(1)}% atingiu o limite ${s.config.socMinDesliga}%. Comando MQTT em segundos.`,
      };
    }
    if (ppToOff <= s.config.margemZonaCritica) {
      return {
        Icon: AlertTriangle, iconColor: "text-amber-400", tone: "warn",
        title: "Próximo do desligamento",
        subtitle: `SOC ${soc.toFixed(1)}% (faltam ${ppToOff.toFixed(0)} pp pra ${s.config.socMinDesliga}%). Polling acelerado.`,
        detail: eta != null ? `Estimativa: desliga em ~${fmtHours(eta)} mantendo a descarga atual.` : undefined,
      };
    }
    return {
      Icon: Activity, iconColor: "text-emerald-400", tone: "ok",
      title: "Operando dentro do limite",
      subtitle: `Bomba LIGADA. Desliga quando SOC ≤ ${s.config.socMinDesliga}% (faltam ${ppToOff.toFixed(0)} pp).`,
      detail: eta != null
        ? `Estimativa de desligamento: ~${fmtHours(eta)} ${battKw && battKw < 0 ? "(descarga atual)" : ""}.`
        : (battKw != null && battKw >= 0 ? "BESS estável ou carregando — sem previsão de desligar tão cedo." : undefined),
    };
  }

  // Bomba OFF a partir daqui
  if (soc >= s.config.socMinReliga) {
    if (!inWindow) {
      return {
        Icon: Clock, iconColor: "text-amber-400", tone: "warn",
        title: "Aguardando janela de operação",
        subtitle: `SOC OK (${soc.toFixed(1)}% ≥ ${s.config.socMinReliga}%). Religa entre ${s.config.horarioLiberacao}–${s.config.horarioCorte}.`,
      };
    }
    return {
      Icon: Power, iconColor: "text-emerald-400", tone: "ok",
      title: "Religando em breve",
      subtitle: `SOC ${soc.toFixed(1)}% ≥ ${s.config.socMinReliga}%, dentro do horário. Próxima fetch confirma e liga.`,
    };
  }

  const ppToOn = s.config.socMinReliga - soc;
  const eta = timeToSocHours(soc, s.config.socMinReliga, battKw, capKwh);
  return {
    Icon: Zap, iconColor: "text-blue-400", tone: "info",
    title: "Aguardando recarga",
    subtitle: `Religa ao SOC ≥ ${s.config.socMinReliga}% (faltam ${ppToOn.toFixed(0)} pp).`,
    detail: eta != null
      ? `Estimativa de religar: ~${fmtHours(eta)} ${battKw && battKw > 0 ? "(carga solar atual)" : ""}.`
      : (!inWindow
        ? `Religa só entre ${s.config.horarioLiberacao}–${s.config.horarioCorte}.`
        : (battKw != null && battKw <= 0 ? "BESS sem carga solar entrando — pode demorar." : undefined)),
  };
}
