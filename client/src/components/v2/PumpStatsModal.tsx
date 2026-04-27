import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Activity, Clock, Zap, RefreshCcw } from "lucide-react";

type Range = "day" | "week" | "month" | "year";

const RANGE_LABELS: Record<Range, string> = {
  day: "Hoje (24h)",
  week: "7 dias",
  month: "30 dias",
  year: "12 meses",
};

export function PumpStatsModal({
  open, onOpenChange, slug, siteName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slug: string;
  siteName: string;
}) {
  const [range, setRange] = useState<Range>("week");
  const { data, isLoading, refetch, isFetching } = trpc.bess.pumpStats.useQuery(
    { slug, range },
    { enabled: open, refetchInterval: open ? 60_000 : false },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" /> Operação da bomba — {siteName}
          </DialogTitle>
          <DialogDescription>
            Tempo ligada e energia consumida estimada (baseada na potência configurada da bomba).
            {data && data.pumpKw > 0 && (
              <span className="block mt-1 font-mono text-[11px]">
                Potência total considerada: {data.pumpKw.toFixed(1)} kW
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-1.5">
            {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
              <Button
                key={r} variant={range === r ? "default" : "outline"} size="sm"
                onClick={() => setRange(r)} className="h-8"
              >
                {RANGE_LABELS[r]}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-8 gap-1.5">
            <RefreshCcw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Carregando…</p>
        ) : !data || data.buckets.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sem dados no período.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <SummaryCard icon={<Clock className="w-3.5 h-3.5" />} label="Total ligada" value={fmtHours(data.totalHoursOn)} />
              <SummaryCard icon={<Zap className="w-3.5 h-3.5" />} label="Energia est." value={`${data.totalKwh.toFixed(1)} kWh`} />
              <SummaryCard icon={<Activity className="w-3.5 h-3.5" />} label="Ciclos" value={String(data.totalCycles)} />
            </div>

            <div className="h-64 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.buckets} margin={{ top: 10, right: 10, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" stroke="#71717a" fontSize={11} />
                  <YAxis stroke="#71717a" fontSize={11} unit="h" />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, fontSize: 12,
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "hoursOn") return [`${value.toFixed(2)} h`, "Tempo ligada"];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="hoursOn" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <p className="text-[10px] text-muted-foreground mt-1">
              Atualiza a cada 60s. <strong>Atenção:</strong> só conta intervalos com TURN_ON e TURN_OFF
              registrados. Antes de 2026-04-26 18:26 (entrada do controle v2) os ligamentos não
              foram auditados, então o gráfico pode mostrar 0 nesse período. Daqui pra frente fica preciso ao segundo.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-black/30 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon} {label}
      </p>
      <p className="text-lg font-bold mt-0.5 tracking-tight">{value}</p>
    </div>
  );
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins > 0 ? `${whole}h ${mins}min` : `${whole}h`;
}
