import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Power, Settings2, History, AlertTriangle, Battery } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ConfigModalV2 } from "./ConfigModalV2";
import { HistoryModal } from "./HistoryModal";

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
      className={`h-7 px-2.5 text-[11px] font-mono ${
        mode === "AUTO" ? "text-blue-400 border-blue-400/30 bg-blue-500/5" : "text-amber-400 border-amber-400/30 bg-amber-500/5"
      }`}
      disabled={set.isPending}
      onClick={() => set.mutate({ slug, mode: next })}
      aria-label={`Alternar para modo ${next}`}
    >
      {mode}
    </Button>
  );
}

type Status = NonNullable<ReturnType<typeof trpc.bess.getSiteStatus.useQuery>["data"]>;

function socColor(soc: number, blackout: number, desliga: number, religa: number): string {
  if (soc <= blackout) return "bg-red-600 text-white";
  if (soc <= desliga) return "bg-orange-500 text-white";
  if (soc <= religa) return "bg-yellow-500 text-black";
  return "bg-emerald-500 text-white";
}

function freshnessLabel(ageSeconds: number | null, lastTelemetryAt: Date | string | null): { text: string; tone: "ok" | "warn" | "stale" } {
  if (lastTelemetryAt === null && ageSeconds === null) return { text: "sem telemetria", tone: "stale" };
  const age = ageSeconds ?? 0;
  if (age < 60) return { text: "atualizado agora", tone: "ok" };
  if (age < 600) return { text: `há ${Math.round(age / 60)}min`, tone: "ok" };
  if (age < 1800) return { text: `há ${Math.round(age / 60)}min`, tone: "warn" };
  return { text: `há ${Math.round(age / 60)}min`, tone: "stale" };
}

export function PlantCardV2({ slug }: { slug: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.bess.getSiteStatus.useQuery(
    { slug },
    { refetchInterval: 30_000 },
  );

  const [confirmOpen, setConfirmOpen] = useState<null | "ON" | "OFF">(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

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
      <Card className="border-white/5 min-h-[280px] animate-pulse">
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
  const socDisplay = soc !== null ? soc.toFixed(1) : (s.state.currentSoc?.toFixed?.(1) ?? "—");
  const colorClass = soc !== null
    ? socColor(soc, s.config.socBlackout, s.config.socMinDesliga, s.config.socMinReliga)
    : "bg-muted text-muted-foreground";
  const fresh = freshnessLabel(s.derived.socAgeSeconds, s.state.lastTelemetryAt as any);
  const isOn = s.derived.pumpState === "ON";
  const noHardware = !s.site.mqttTopic;
  const cooldownActive = s.derived.cooldownRemainingMs > 0;

  return (
    <Card className="border-white/5 bg-card">
      <CardContent className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClass}`}>
              <Battery className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{s.site.name}</h2>
              <p className="text-xs text-muted-foreground">
                {fresh.text}
                <span className={`inline-block w-1.5 h-1.5 rounded-full ml-2 align-middle ${
                  fresh.tone === "ok" ? "bg-emerald-500" : fresh.tone === "warn" ? "bg-yellow-500" : "bg-red-500"
                }`} />
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ModeToggle slug={slug} mode={s.config.controlMode as "AUTO" | "MANUAL"} />
            <Button variant="ghost" size="icon" aria-label="Configurações" onClick={() => setConfigOpen(true)}>
              <Settings2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Histórico" onClick={() => setHistoryOpen(true)}>
              <History className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* SOC display */}
        <div className="text-center py-2">
          <div className={`text-6xl md:text-7xl font-bold font-mono ${
            soc !== null && soc <= s.config.socMinDesliga ? "text-red-500"
            : soc !== null && soc <= s.config.socMinReliga ? "text-yellow-500"
            : "text-foreground"
          }`}>
            {socDisplay}
            <span className="text-2xl text-muted-foreground ml-1">%</span>
          </div>
          {s.derived.socSource === "ESTIMATED" && (
            <Badge variant="outline" className="mt-2 text-xs">SOC estimado (Coulomb)</Badge>
          )}
          {soc === null && (
            <Badge variant="outline" className="mt-2 text-xs text-muted-foreground">Sem dado fresco</Badge>
          )}
        </div>

        {/* SOC bar */}
        <div className="relative h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 transition-all ${
              soc !== null && soc <= s.config.socBlackout ? "bg-red-600"
              : soc !== null && soc <= s.config.socMinDesliga ? "bg-orange-500"
              : soc !== null && soc <= s.config.socMinReliga ? "bg-yellow-500"
              : "bg-emerald-500"
            }`}
            style={{ width: soc !== null ? `${Math.min(100, Math.max(0, soc))}%` : "0%" }}
          />
        </div>

        {/* Pump control */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Bomba</p>
            <p className={`text-xl font-bold ${isOn ? "text-emerald-500" : "text-muted-foreground"}`}>
              {noHardware ? "—" : (isOn ? "LIGADA" : "DESLIGADA")}
            </p>
            {cooldownActive && (
              <p className="text-xs text-yellow-500 mt-1">
                Cooldown {Math.ceil(s.derived.cooldownRemainingMs / 1000)}s
              </p>
            )}
          </div>
          {!noHardware && (
            <Button
              variant={isOn ? "outline" : "default"}
              size="lg"
              className="min-h-[60px] min-w-[120px] text-lg"
              disabled={command.isPending || cooldownActive}
              onClick={() => setConfirmOpen(isOn ? "OFF" : "ON")}
            >
              <Power className="w-5 h-5 mr-2" />
              {isOn ? "Desligar" : "Ligar"}
            </Button>
          )}
        </div>

        {/* Next action hint */}
        {s.nextAction && (
          <div className="rounded-md border border-white/5 bg-muted/30 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Próxima ação prevista</p>
            <p className="text-sm">
              <span className={`font-mono ${
                s.nextAction.kind === "TURN_ON" ? "text-emerald-500"
                : s.nextAction.kind === "TURN_OFF" ? "text-red-500"
                : "text-muted-foreground"
              }`}>{s.nextAction.kind}</span>
              <span className="text-muted-foreground"> · {s.nextAction.reason}</span>
            </p>
          </div>
        )}

        {soc !== null && soc <= s.config.socBlackout && (
          <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-500">SOC em zona de blackout — desligamento forçado.</p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen !== null} onOpenChange={(v) => !v && setConfirmOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmOpen === "ON" ? "Ligar bomba?" : "Desligar bomba?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {s.site.name} · SOC atual: {socDisplay}%
              {soc !== null && soc <= s.config.socMinDesliga && confirmOpen === "ON" && (
                <span className="block mt-2 text-yellow-500">
                  ⚠ SOC abaixo do mínimo ({s.config.socMinDesliga}%) — sistema vai desligar de novo automaticamente.
                </span>
              )}
              {s.config.controlMode === "AUTO" && (
                <span className="block mt-2 text-muted-foreground text-xs">
                  Modo AUTO ativo: ação manual pode ser revertida na próxima avaliação.
                </span>
              )}
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
    </Card>
  );
}
