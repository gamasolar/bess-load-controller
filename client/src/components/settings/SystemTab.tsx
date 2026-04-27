import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Activity } from "lucide-react";
import { toast } from "sonner";

function StatRow({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const dot = tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-yellow-500" : tone === "bad" ? "bg-red-500" : "bg-zinc-500";
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-mono">{value}</span>
    </div>
  );
}

function fmtDate(t: Date | string | null | undefined): string {
  if (!t) return "—";
  return new Date(t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ClearAlarms() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(0);
  const clear = trpc.system.clearResolvedAlarms.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.removed} alarme(s) resolvido(s) excluído(s).`);
      utils.system.info.invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
        <Trash2 className="w-3.5 h-3.5" /> Limpar alarmes resolvidos
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar alarmes resolvidos</AlertDialogTitle>
            <AlertDialogDescription>
              Remove permanentemente alarmes <strong>já resolvidos</strong> (active=0)
              {days > 0 ? ` mais antigos que ${days} dia(s)` : " de qualquer idade"}. Alarmes ativos não são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="days">Manter dos últimos N dias (0 = limpar todos)</Label>
            <Input id="days" type="number" min={0} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-1.5" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => clear.mutate({ olderThanDays: days })}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SystemTab() {
  const { data, isLoading } = trpc.system.info.useQuery(undefined, { refetchInterval: 30_000 });

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        <Card className="border-white/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold">Integrações</h2>
            </div>
            {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
            {data && (
              <>
                <StatRow
                  label="FusionSolar"
                  value={data.fusionsolar.configured ? "Configurada" : "Não configurada"}
                  tone={data.fusionsolar.configured ? "ok" : "bad"}
                />
                <StatRow
                  label="Última telemetria"
                  value={fmtDate(data.fusionsolar.lastTelemetryAt)}
                  tone={data.fusionsolar.lastTelemetryAt ? "ok" : "warn"}
                />
                <StatRow
                  label="MQTT"
                  value={data.mqtt.anySiteConnected ? "Conectado" : data.mqtt.configured ? "Desconectado" : "Não configurado"}
                  tone={data.mqtt.anySiteConnected ? "ok" : "bad"}
                />
                <StatRow
                  label="Modo de controle"
                  value={<Badge variant="outline">{data.controlMode}</Badge>}
                  tone={data.controlMode === "v2" ? "ok" : "warn"}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/5">
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold mb-3">Atividade</h2>
            {data && (
              <>
                <StatRow label="Sites monitorados" value={data.sites} />
                <StatRow label="Alarmes ativos" value={data.counters.alarmsActive} tone={data.counters.alarmsActive > 0 ? "warn" : "ok"} />
                <StatRow label="Ações nas últimas 24h" value={data.counters.actions24h} />
                <StatRow label="Ações nos últimos 7 dias" value={data.counters.actions7d} />
                <StatRow label="Uptime" value={fmtUptime(data.uptimeSeconds)} />
                <StatRow label="Node.js" value={data.nodeVersion} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/5">
        <CardContent className="p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Manutenção</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Operações administrativas. Use com cuidado.
            </p>
          </div>
          <ClearAlarms />
        </CardContent>
      </Card>
    </div>
  );
}
