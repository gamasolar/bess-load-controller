import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { ChevronLeft, ChevronRight, TrendingUp, Calendar } from "lucide-react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from "recharts";

// ─── Helpers ────────────────────────────────────────────────
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function displayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function isToday(dateStr: string): boolean {
  return dateStr === formatDate(new Date());
}

// ─── Custom Tooltip ─────────────────────────────────────────
function EnergyTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;

  const pvOutput = payload.find((p: any) => p.dataKey === "pvOutput")?.value ?? 0;
  const essDischarge = payload.find((p: any) => p.dataKey === "essDischarge")?.value ?? 0;
  const essCharge = payload.find((p: any) => p.dataKey === "essCharge")?.value ?? 0;

  return (
    <div className="bg-[#1e293b] border border-white/10 rounded-lg px-4 py-3 text-xs shadow-xl">
      <p className="text-muted-foreground mb-2 font-medium">{label}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        <div>
          <p className="text-muted-foreground text-[10px] mb-1">Fontes de energia</p>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-blue-500 rounded-full inline-block" />
            <span className="text-slate-300">Descarga ESS</span>
            <span className="text-white font-mono ml-auto">{essDischarge.toFixed(1)} kW</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-2.5 h-0.5 bg-green-500 rounded-full inline-block" />
            <span className="text-slate-300">Saída PV</span>
            <span className="text-white font-mono ml-auto">{pvOutput.toFixed(1)} kW</span>
          </div>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] mb-1">Dissipadores de energia</p>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-blue-400 rounded-full inline-block border-b border-dashed border-blue-400" />
            <span className="text-slate-300">Carga ESS</span>
            <span className="text-white font-mono ml-auto">{essCharge.toFixed(1)} kW</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────
export default function EnergyTrendChart({ slug }: { slug: string }) {
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));

  const { data, isLoading } = trpc.bess.energyTrend.useQuery(
    { slug, date: selectedDate },
    { refetchInterval: isToday(selectedDate) ? 60_000 : false }
  );

  const navigateDate = (direction: -1 | 1) => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + direction);
    if (d <= new Date()) {
      setSelectedDate(formatDate(d));
    }
  };

  // Thin out data for readability (max ~200 points)
  const chartData = useMemo(() => {
    if (!data?.points || data.points.length === 0) return [];
    const pts = data.points;
    if (pts.length <= 200) return pts;
    const step = Math.ceil(pts.length / 200);
    return pts.filter((_: any, i: number) => i % step === 0);
  }, [data?.points]);

  // Calculate max Y for domain
  const maxY = useMemo(() => {
    if (chartData.length === 0) return 120;
    let m = 0;
    for (const p of chartData) {
      m = Math.max(m, p.pvOutput ?? 0, p.essDischarge ?? 0, p.essCharge ?? 0);
    }
    return Math.ceil(m / 20) * 20 + 20;
  }, [chartData]);

  return (
    <Card className="border-white/5 bg-card">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <TrendingUp size={14} className="text-green-500" />
            Tendência de Energia
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Yield */}
            <div className="text-right mr-3">
              <p className="text-[10px] text-muted-foreground">Rendimento</p>
              <p className="text-lg font-bold text-white font-mono">
                {data?.yieldKwh?.toFixed(2) ?? "—"} <span className="text-xs text-muted-foreground font-normal">kWh</span>
              </p>
            </div>
            {/* Date Navigation */}
            <div className="flex items-center gap-1 bg-muted/30 rounded-lg px-1 py-0.5">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigateDate(-1)}>
                <ChevronLeft size={14} />
              </Button>
              <div className="flex items-center gap-1.5 px-2 min-w-[100px] justify-center">
                <Calendar size={12} className="text-muted-foreground" />
                <span className="text-xs font-mono text-foreground">{displayDate(selectedDate)}</span>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6"
                onClick={() => navigateDate(1)}
                disabled={isToday(selectedDate)}>
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3">
        {isLoading ? (
          <Skeleton className="w-full h-[300px] rounded-lg" />
        ) : chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
            <Calendar size={32} className="mb-2 opacity-50" />
            <p className="text-sm">Sem dados para {displayDate(selectedDate)}</p>
            <p className="text-xs mt-1">Os dados são coletados automaticamente do FusionSolar</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="pvGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="dischargeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="time"
                tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                domain={[0, maxY]}
                tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                tickLine={false}
                tickFormatter={(v) => `${v}`}
                label={{ value: "kW", position: "insideTopLeft", offset: -5, style: { fill: "#64748b", fontSize: 11 } }}
              />
              <RechartsTooltip content={<EnergyTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "11px", color: "#94a3b8", paddingTop: "8px" }}
                formatter={(value: string) => <span className="text-slate-400 text-[11px]">{value}</span>}
              />
              {/* PV Output - green area */}
              <Area
                type="monotone"
                dataKey="pvOutput"
                name="Saída PV"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#pvGrad)"
                dot={false}
                animationDuration={500}
              />
              {/* ESS Discharge - blue solid line */}
              <Line
                type="monotone"
                dataKey="essDischarge"
                name="Descarga ESS"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                animationDuration={500}
              />
              {/* ESS Charge - blue dashed line */}
              <Line
                type="monotone"
                dataKey="essCharge"
                name="Carga ESS"
                stroke="#60a5fa"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                animationDuration={500}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
