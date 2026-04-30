import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Settings2, History, AlertTriangle, Eye, Maximize2, X, BarChart3 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { ConfigModalV2 } from "./ConfigModalV2";
import { HistoryModal } from "./HistoryModal";
import { PumpStatsModal } from "./PumpStatsModal";
import { WeatherWidget } from "./WeatherWidget";
import { DecisionPanel } from "./DecisionPanel";
import { BatteryVisual } from "./BatteryVisual";
import { MotorPresetView, type MotorPreset } from "./motor-presets";
import type { LoadHealth } from "./motor-presets/shared";
import { ZoneBar } from "./ZoneBar";
import { PumpStatus } from "./PumpStatus";
import { useServerClock } from "@/hooks/useServerClock";

function CardClock() {
  const { date, time } = useServerClock();
  return (
    <div className="mt-auto pt-2 border-t border-white/5 font-mono text-[11px] tabular-nums text-muted-foreground flex items-center justify-between">
      <span>{date}</span>
      <span>{time}</span>
    </div>
  );
}

function ModeToggle({ slug, mode }: { slug: string; mode: "AUTO" | "MANUAL" }) {
  const utils = trpc.useUtils();
  const set = trpc.bess.setControlMode.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
      utils.bess.getSiteStatus.invalidate({ slug });
      utils.bess.getActions.invalidate({ slug });
    },
    onError: (e) => toast.error(e.message),
  });
  const next = mode === "AUTO" ? "MANUAL" : "AUTO";
  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-8 px-3 text-[11px] font-mono font-bold tracking-wider ${
        mode === "AUTO"
          ? "text-blue-300 border-blue-400/40 bg-blue-500/10 hover:bg-blue-500/20"
          : "text-amber-300 border-amber-400/40 bg-amber-500/10 hover:bg-amber-500/20"
      }`}
      disabled={set.isPending}
      onClick={() => set.mutate({ slug, mode: next })}
      aria-label={`Alternar para modo ${next}`}
      title={`Modo atual: ${mode}. Clique para mudar para ${next}.`}
    >
      {mode}
    </Button>
  );
}

type Status = NonNullable<ReturnType<typeof trpc.bess.getSiteStatus.useQuery>["data"]>;

export function PlantCardV2({ slug }: { slug: string }) {
  const utils = trpc.useUtils();
  const { isAdmin } = useAuth();
  const { data, isLoading, error } = trpc.bess.getSiteStatus.useQuery(
    { slug },
    { refetchInterval: 30_000 },
  );

  const [confirmOpen, setConfirmOpen] = useState<null | "ON" | "OFF">(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    // ESC do browser sai do fullscreen sem disparar nosso keydown; sincroniza
    // expanded=false quando o browser sai sozinho pra evitar overlay CSS órfão
    // (que sobrepõe a bateria e descoloca a logo).
    const onFsChange = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFsChange);
    // tenta fullscreen API (esconde browser chrome em monitor/TV)
    const elem = wrapperRef.current;
    if (elem && elem.requestFullscreen) {
      elem.requestFullscreen().catch(() => {/* fallback é o overlay CSS */});
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFsChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [expanded]);

  const command = trpc.bess.command.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
      utils.bess.getSiteStatus.invalidate({ slug });
      utils.bess.getActions.invalidate({ slug });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <Card className="border-white/5 min-h-[480px] animate-pulse">
        <CardContent className="p-6 flex items-center justify-center">
          <p className="text-muted-foreground">Carregando…</p>
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="p-6">
          <p className="text-red-500 text-sm">Erro ao carregar {slug}: {error?.message ?? "site não encontrado"}</p>
        </CardContent>
      </Card>
    );
  }

  const s = data as Status;
  const soc = s.derived.soc;
  const socForDisplay = soc !== null ? soc : (typeof s.state.currentSoc === "number" ? s.state.currentSoc : null);
  const isOn = s.derived.pumpState === "ON";
  const noHardware = !s.site.mqttTopic;
  const cooldownActive = s.derived.cooldownRemainingMs > 0;
  const inBlackout = soc !== null && soc <= s.config.socBlackout;

  const zones = {
    blackout: s.config.socBlackout,
    desliga: s.config.socMinDesliga,
    religa: s.config.socMinReliga,
  };

  const bgUrl = (s.site as { backgroundUrl?: string | null }).backgroundUrl ?? null;
  const bgIsVideo = bgUrl ? /\.(mp4|webm)$/i.test(bgUrl) : false;

  return (
    <div
      ref={wrapperRef}
      className={
        expanded
          ? "fixed inset-0 z-50 bg-black/95 overflow-y-auto p-5 md:p-10 flex items-start md:items-center justify-center"
          : "contents"
      }
    >
    {/* Logomarca institucional centralizada na borda preta superior (modo TV apenas) */}
    {expanded && (
      <img
        src="/logo-full.png"
        alt="Gama Solar"
        className="absolute top-3 md:top-5 left-1/2 -translate-x-1/2 h-5 md:h-7 object-contain opacity-85 z-10 pointer-events-none"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    )}
    <Card
      className={
        expanded
          ? "border-white/10 bg-gradient-to-br from-card to-card/60 backdrop-blur overflow-hidden relative w-full max-w-[1550px] md:text-[1.13em] py-0 max-h-full"
          : "border-white/5 bg-gradient-to-br from-card to-card/60 backdrop-blur overflow-hidden relative py-0 h-full"
      }
    >
      {bgUrl && (
        <>
          {bgIsVideo ? (
            <video
              src={bgUrl} autoPlay loop muted playsInline
              className="absolute inset-0 w-full h-full object-cover opacity-25 pointer-events-none"
            />
          ) : (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-25 pointer-events-none"
              style={{ backgroundImage: `url(${bgUrl})` }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-br from-card/70 via-card/60 to-card/80 pointer-events-none" />
        </>
      )}
      <CardContent className={expanded ? "pt-4 px-6 pb-4 md:pt-5 md:px-10 md:pb-5 space-y-5 relative flex flex-col flex-1" : "pt-3 px-4 pb-2.5 md:pt-3.5 md:px-5 md:pb-3 space-y-3 relative flex flex-col flex-1"}>
        {/* Header — esquerda fixada à borda; botões fixados à direita */}
        <div className="flex items-start justify-between gap-4 flex-nowrap">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg md:text-xl font-bold tracking-tight truncate leading-tight">{s.site.name}</h2>
            <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 whitespace-nowrap overflow-hidden">
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${s.site.fusionsolarConfigured ? "bg-emerald-500" : "bg-zinc-600"}`} />
              <span>FusionSolar {s.site.fusionsolarConfigured ? "OK" : "off"}</span>
              <span className="text-zinc-700">·</span>
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${s.state.mqttConnected ? "bg-emerald-500" : "bg-red-500"}`} />
              <span>MQTT {s.state.mqttConnected ? "OK" : "off"}</span>
            </p>
          </div>
          <div className="flex items-center gap-0.5 shrink-0 flex-nowrap">
            {/* Ícones secundários — todos com tooltip explicativo no hover */}
            {isAdmin && (
              <Button
                variant="ghost" size="icon" className="h-8 w-8"
                aria-label="Configurações"
                title="Configurações de controle (limites, intervalos, horários)"
                onClick={() => setConfigOpen(true)}
              >
                <Settings2 className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              aria-label={expanded ? "Sair de tela cheia" : "Tela cheia"}
              title={expanded ? "Sair do modo TV (Esc)" : "Modo TV / monitor cheio"}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <X className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              aria-label="Operação da bomba"
              title="Operação da bomba (gráfico de horas ligada)"
              onClick={() => setStatsOpen(true)}
            >
              <BarChart3 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              aria-label="Histórico"
              title="Histórico de ações e decisões"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="w-4 h-4" />
            </Button>
            {!isAdmin && (
              <span title="Acesso somente-leitura — pra alterar peça acesso de admin" className="text-zinc-500 px-1">
                <Eye className="w-4 h-4" />
              </span>
            )}
            {/* Botão AUTO/MANUAL fixado na extremidade direita, separado por gap maior */}
            <div className="ml-2">
              {isAdmin ? (
                <ModeToggle slug={slug} mode={s.config.controlMode as "AUTO" | "MANUAL"} />
              ) : (
                <span
                  className="h-8 px-3 inline-flex items-center text-[11px] font-mono font-bold tracking-wider rounded-md border border-zinc-700 bg-zinc-800/40 text-zinc-300"
                  title={`Modo de controle atual: ${s.config.controlMode} (somente-leitura)`}
                >
                  {s.config.controlMode}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Bateria + Motor lado a lado (padrão único — desktop, tablet e mobile) */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-row items-start justify-center gap-6 md:gap-8">
            <BatteryVisual
              soc={socForDisplay}
              socSource={s.derived.socSource as "REAL" | "ESTIMATED" | null}
              zones={zones}
              batteryPower={typeof s.state.currentBatteryPower === "number" ? s.state.currentBatteryPower : null}
              lastTelemetryAt={s.state.lastTelemetryAt as Date | string | null}
            />
            <MotorPresetView
              preset={(s.site as any).cardCustomization?.motorPreset as MotorPreset | undefined}
              loadHealth={(s.derived.loadHealth ?? "UNKNOWN") as LoadHealth}
              loadPower={typeof s.state.currentLoadPower === "number" ? s.state.currentLoadPower : null}
              loadFailureSince={(s.state as any).loadFailureSince ?? null}
              loadHistory={(s.derived as any).recentLoadPower ?? []}
              pumpPowerCv={(s.site as any).pumpPowerCv ?? 30}
              pumpCount={(s.site as any).pumpCount ?? 1}
              lastTelemetryAt={s.state.lastTelemetryAt as Date | string | null}
            />
          </div>

          {/* Zones + decisão ocupam toda a largura abaixo */}
          <div className="w-full space-y-2.5">
            <ZoneBar soc={socForDisplay} zones={zones} />
            <DecisionPanel s={s} />
          </div>
        </div>

        {/* Weather (acima do botão de ligar) */}
        <div className="flex justify-end">
          <WeatherWidget slug={slug} />
        </div>

        {/* Pump */}
        <div className="border-t border-white/5 pt-3">
          <PumpStatus
            pumpState={s.derived.pumpState as "ON" | "OFF" | "UNKNOWN"}
            noHardware={noHardware}
            readOnly={!isAdmin}
            cooldownActive={cooldownActive}
            cooldownRemainingMs={s.derived.cooldownRemainingMs}
            busy={command.isPending}
            onToggle={() => setConfirmOpen(isOn ? "OFF" : "ON")}
          />
        </div>

        {/* Blackout banner */}
        {inBlackout && (
          <div className="flex items-start gap-2 rounded-md bg-red-500/15 border border-red-500/40 px-3 py-2 animate-pulse">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-300">
              <strong>SOC em zona de BLACKOUT</strong> — desligamento forçado, mesmo em modo MANUAL.
            </p>
          </div>
        )}

        <CardClock />
      </CardContent>

      <AlertDialog open={confirmOpen !== null} onOpenChange={(v) => !v && setConfirmOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmOpen === "ON" ? "Ligar bomba?" : "Desligar bomba?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>{s.site.name} · SOC atual: <strong>{socForDisplay !== null ? socForDisplay.toFixed(0) : "—"}%</strong></p>
                {soc !== null && soc <= s.config.socMinDesliga && confirmOpen === "ON" && (
                  <p className="mt-2 text-yellow-500">
                    ⚠ SOC abaixo do mínimo ({s.config.socMinDesliga}%) — sistema vai desligar de novo automaticamente.
                  </p>
                )}
                {s.config.controlMode === "AUTO" && (
                  <p className="mt-2 text-muted-foreground text-xs">
                    Modo AUTO ativo: ação manual pode ser revertida na próxima avaliação.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmOpen) {
                  command.mutate({ slug, action: confirmOpen.toLowerCase() as "on" | "off" });
                  setConfirmOpen(null);
                }
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfigModalV2 open={configOpen} onOpenChange={setConfigOpen} slug={slug} initial={s.config} />
      <HistoryModal open={historyOpen} onOpenChange={setHistoryOpen} slug={slug} siteName={s.site.name} />
      <PumpStatsModal open={statsOpen} onOpenChange={setStatsOpen} slug={slug} siteName={s.site.name} />
    </Card>
    </div>
  );
}
