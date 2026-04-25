import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area, BarChart, Bar,
} from "recharts";
import { Download, Clock, Battery, Thermometer, Zap, Sun, Activity } from "lucide-react";

const PERIOD_OPTIONS = [
  { value: "1", label: "Última hora" },
  { value: "4", label: "Últimas 4 horas" },
  { value: "12", label: "Últimas 12 horas" },
  { value: "24", label: "Últimas 24 horas" },
  { value: "48", label: "Últimas 48 horas" },
  { value: "72", label: "Últimas 72 horas" },
  { value: "168", label: "Última semana" },
];

const SITE_OPTIONS = [
  { value: "piscinao", label: "Piscinão" },
  { value: "barragem", label: "Barragem" },
];

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function exportCSV(data: any[], siteName: string, period: string) {
  if (!data.length) return;
  const headers = ["Data/Hora", "SOC (%)", "SOH (%)", "Potência Bateria (kW)", "Temperatura (°C)", "Geração FV (kW)", "Consumo (kW)"];
  const rows = data.map(r => [
    new Date(r.timestamp).toLocaleString("pt-BR"),
    r.soc?.toFixed(1) ?? "",
    r.soh?.toFixed(1) ?? "",
    r.batteryPower?.toFixed(2) ?? "",
    r.batteryTemperature?.toFixed(1) ?? "",
    r.pvPower?.toFixed(2) ?? "",
    r.loadPower?.toFixed(2) ?? "",
  ]);
  const csv = [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bess_${siteName}_${period}h_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function History() {
  const [selectedSite, setSelectedSite] = useState("piscinao");
  const [selectedPeriod, setSelectedPeriod] = useState("4");

  const { data: readings = [], isLoading } = trpc.bess.readings.useQuery(
    { slug: selectedSite, hours: parseInt(selectedPeriod) },
    { refetchInterval: 10000 }
  );

  const { data: sites = [] } = trpc.bess.sites.useQuery();
  const currentSite = sites.find(s => s.slug === selectedSite);

  const chartData = useMemo(() => {
    return readings.map(r => ({
      ...r,
      time: formatTime(r.timestamp),
      dateTime: formatDateTime(r.timestamp),
    }));
  }, [readings]);

  const stats = useMemo(() => {
    if (!readings.length) return { min: 0, max: 0, avg: 0, count: 0, minTemp: 0, maxTemp: 0, avgTemp: 0 };
    const socs = readings.map(r => r.soc);
    const temps = readings.filter(r => r.batteryTemperature != null).map(r => r.batteryTemperature!);
    return {
      min: Math.min(...socs),
      max: Math.max(...socs),
      avg: socs.reduce((a, b) => a + b, 0) / socs.length,
      count: readings.length,
      minTemp: temps.length ? Math.min(...temps) : 0,
      maxTemp: temps.length ? Math.max(...temps) : 0,
      avgTemp: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0,
    };
  }, [readings]);

  const siteName = SITE_OPTIONS.find(s => s.value === selectedSite)?.label ?? selectedSite;
  const periodLabel = PERIOD_OPTIONS.find(p => p.value === selectedPeriod)?.label ?? "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Histórico</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Análise detalhada de dados históricos dos sistemas BESS
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedSite} onValueChange={setSelectedSite}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SITE_OPTIONS.map(s => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(p => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCSV(readings, selectedSite, selectedPeriod)}
            disabled={!readings.length}
          >
            <Download className="w-4 h-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Battery className="w-3 h-3" /> SOC Mín.
            </div>
            <p className="text-lg font-mono font-bold text-red-400">{stats.min.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Battery className="w-3 h-3" /> SOC Máx.
            </div>
            <p className="text-lg font-mono font-bold text-emerald-400">{stats.max.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Activity className="w-3 h-3" /> SOC Médio
            </div>
            <p className="text-lg font-mono font-bold text-blue-400">{stats.avg.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock className="w-3 h-3" /> Leituras
            </div>
            <p className="text-lg font-mono font-bold">{stats.count}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Thermometer className="w-3 h-3" /> Temp Mín.
            </div>
            <p className="text-lg font-mono font-bold text-cyan-400">{stats.minTemp.toFixed(1)}°C</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Thermometer className="w-3 h-3" /> Temp Máx.
            </div>
            <p className="text-lg font-mono font-bold text-orange-400">{stats.maxTemp.toFixed(1)}°C</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Zap className="w-3 h-3" /> Capacidade
            </div>
            <p className="text-lg font-mono font-bold">{currentSite ? `${currentSite.bessCount}x ${currentSite.bessCapacityKwh}` : "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* SOC Chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Battery className="w-4 h-4 text-primary" />
            Estado de Carga (SOC) — {siteName} — {periodLabel}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              Carregando dados...
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              Nenhuma leitura disponível para o período selecionado.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="socGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} unit="%" />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.dateTime ?? ""}
                  formatter={(value: number) => [`${value.toFixed(1)}%`, "SOC"]}
                />
                <Area type="monotone" dataKey="soc" stroke="#22c55e" fill="url(#socGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Power Chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            Potência — Bateria vs Geração FV
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground">
              Nenhuma leitura disponível.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} unit=" kW" />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.dateTime ?? ""}
                />
                <Legend />
                <Line type="monotone" dataKey="batteryPower" name="Bateria" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="pvPower" name="Geração FV" stroke="#eab308" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="loadPower" name="Consumo" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Temperature Chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-orange-400" />
            Temperatura da Bateria
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="h-[250px] flex items-center justify-center text-muted-foreground">
              Nenhuma leitura disponível.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} unit="°C" />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.dateTime ?? ""}
                  formatter={(value: number) => [`${value.toFixed(1)}°C`, "Temperatura"]}
                />
                <Area type="monotone" dataKey="batteryTemperature" stroke="#f97316" fill="url(#tempGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Tabela de Leituras ({readings.length} registros)
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCSV(readings, selectedSite, selectedPeriod)}
              disabled={!readings.length}
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Data/Hora</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">SOC</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">SOH</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Pot. Bat.</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Temp.</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Geração FV</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Consumo</th>
                </tr>
              </thead>
              <tbody>
                {readings.slice(-50).reverse().map((r, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-accent/30 transition-colors">
                    <td className="py-2 px-3 font-mono text-xs">{new Date(r.timestamp).toLocaleString("pt-BR")}</td>
                    <td className={`py-2 px-3 text-right font-mono text-xs font-bold ${r.soc < 20 ? "text-red-400" : r.soc < 50 ? "text-yellow-400" : "text-emerald-400"}`}>
                      {r.soc.toFixed(1)}%
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs">{r.soh?.toFixed(1) ?? "—"}%</td>
                    <td className={`py-2 px-3 text-right font-mono text-xs ${(r.batteryPower ?? 0) >= 0 ? "text-blue-400" : "text-orange-400"}`}>
                      {r.batteryPower?.toFixed(2) ?? "—"} kW
                    </td>
                    <td className={`py-2 px-3 text-right font-mono text-xs ${(r.batteryTemperature ?? 0) > 35 ? "text-red-400" : "text-cyan-400"}`}>
                      {r.batteryTemperature?.toFixed(1) ?? "—"}°C
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs text-yellow-400">
                      {r.pvPower?.toFixed(2) ?? "—"} kW
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs">
                      {r.loadPower?.toFixed(2) ?? "—"} kW
                    </td>
                  </tr>
                ))}
                {readings.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      Nenhuma leitura disponível para o período selecionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {readings.length > 50 && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Exibindo as 50 leituras mais recentes. Exporte o CSV para ver todas as {readings.length} leituras.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
