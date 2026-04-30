import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Activity, Clock, Zap, RefreshCcw, ArrowLeft } from "lucide-react";

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
  type ViewState = { range: Range; anchor: number | null };
  const [view, setView] = useState<ViewState>({ range: "week", anchor: null });
  const [history, setHistory] = useState<ViewState[]>([]);
  const { range, anchor } = view;

  const { data, isLoading, refetch, isFetching } = trpc.bess.pumpStats.useQuery(
    { slug, range, anchor: anchor ?? undefined },
    { enabled: open, refetchInterval: open && anchor === null ? 60_000 : false },
  );

  const canDrillDown = range === "year" || range === "month" || range === "week";
  const canGoBack = history.length > 0;

  function handleBarClick(p: any) {
    // Recharts entrega { ...barProps, payload: dataPoint } — ts vem em payload.
    const ts: number | undefined = p?.payload?.ts ?? p?.ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) return;
    let next: ViewState | null = null;
    if (range === "year") next = { range: "month", anchor: ts };
    else if (range === "month" || range === "week") next = { range: "day", anchor: ts };
    if (!next) return;
    setHistory((h) => [...h, view]);
    setView(next);
  }

  function handleBack() {
    if (history.length === 0) return;
    setView(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  }

  function handleRangeButton(r: Range) {
    setHistory([]);
    setView({ range: r, anchor: null });
  }

  const contextLabel = (() => {
    if (anchor === null) return RANGE_LABELS[range];
    const d = new Date(anchor);
    if (range === "day") return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    if (range === "month") return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return RANGE_LABELS[range];
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" /> Operação da bomba — {siteName}
          </DialogTitle>
          <DialogDescription>
            <span className="text-emerald-400">Verde</span> = comando ON (sistema armado).
            {" "}<span className="text-orange-400">Laranja</span> = bomba realmente operando (carga detectada).
            {" "}Diferença = sistema acionou mas motor não rodou (falha softstarter, manual, manutenção).
            {data && data.pumpKw > 0 && (
              <span className="block mt-1 font-mono text-[11px]">
                Potência total considerada: {data.pumpKw.toFixed(1)} kW
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {canGoBack && (
              <Button variant="outline" size="sm" onClick={handleBack} className="h-8 gap-1">
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar
              </Button>
            )}
            {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
              <Button
                key={r}
                variant={range === r && anchor === null ? "default" : "outline"}
                size="sm"
                onClick={() => handleRangeButton(r)}
                className="h-8"
              >
                {RANGE_LABELS[r]}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-8 gap-1.5">
            <RefreshCcw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>

        <div className="flex items-baseline gap-2 -mt-1">
          <span className="text-sm font-semibold capitalize">{contextLabel}</span>
          {canDrillDown && (
            <span className="text-[10px] text-muted-foreground">
              · clique numa barra pra abrir {range === "year" ? "o mês" : "o dia"}
            </span>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Carregando…</p>
        ) : !data || data.buckets.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sem dados no período.</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              <SummaryCard icon={<Clock className="w-3.5 h-3.5" />} label="Comando ON" value={fmtHours(data.totalHoursOn)} colorClass="text-emerald-400" />
              <SummaryCard icon={<Activity className="w-3.5 h-3.5" />} label="Operando" value={fmtHours(data.totalHoursRunning ?? 0)} colorClass="text-orange-400" />
              <SummaryCard icon={<Zap className="w-3.5 h-3.5" />} label="Energia est." value={`${(data.totalKwhEffective ?? data.totalKwh).toFixed(1)} kWh`} />
              <SummaryCard icon={<Activity className="w-3.5 h-3.5" />} label="Ciclos" value={String(data.totalCycles)} />
            </div>

            <div className="h-64 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.buckets} margin={{ top: 10, right: 10, bottom: 4, left: 0 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" stroke="#71717a" fontSize={11} />
                  <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtHours} width={56} />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, fontSize: 12,
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "hoursOn") return [fmtHours(value), "Comando ON"];
                      if (name === "hoursRunning") return [fmtHours(value), "Operando"];
                      return [value, name];
                    }}
                  />
                  <Bar
                    dataKey="hoursOn"
                    fill="#10b981"
                    radius={[3, 3, 0, 0]}
                    cursor={canDrillDown ? "pointer" : "default"}
                    onClick={canDrillDown ? (p: any) => handleBarClick(p) : undefined}
                  />
                  <Bar
                    dataKey="hoursRunning"
                    fill="#fb923c"
                    radius={[3, 3, 0, 0]}
                    cursor={canDrillDown ? "pointer" : "default"}
                    onClick={canDrillDown ? (p: any) => handleBarClick(p) : undefined}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <p className="text-[10px] text-muted-foreground mt-1">
              {anchor === null && "Atualiza a cada 60s. "}
              <strong>Atenção:</strong> só conta intervalos com TURN_ON e TURN_OFF
              registrados. Antes de 2026-04-26 18:26 (entrada do controle v2) os ligamentos não
              foram auditados, então o gráfico pode mostrar 0 nesse período. Daqui pra frente fica preciso ao segundo.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ icon, label, value, colorClass }: { icon: React.ReactNode; label: string; value: string; colorClass?: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-black/30 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon} {label}
      </p>
      <p className={`text-lg font-bold mt-0.5 tracking-tight ${colorClass ?? ""}`}>{value}</p>
    </div>
  );
}

function fmtHours(h: number): string {
  if (h <= 0) return "0";
  if (h < 1) return `${Math.round(h * 60)} min`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins > 0 ? `${whole}h ${mins}min` : `${whole}h`;
}
