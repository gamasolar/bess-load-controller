import { trpc } from "@/lib/trpc";
import { useMemo, useState, useCallback } from "react";
import { exportReportPDF } from "@/lib/report-pdf";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
  ReferenceLine,
} from "recharts";
import {
  BarChart3,
  Battery,
  Clock,
  FileText,
  Loader2,
  RefreshCw,
  Sun,
  Thermometer,
  Zap,
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Download,
  ChevronLeft,
  ChevronRight,
  Settings,
  Power,
} from "lucide-react";
import { toast } from "sonner";

// ── Helpers ──────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatChartDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Stat Card ────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  color = "text-emerald-400",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg bg-background/50 ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-lg font-mono font-bold text-foreground">
              {value}
              {unit && <span className="text-xs text-muted-foreground ml-1">{unit}</span>}
            </p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Custom Tooltip ──────────────────────────────────────────

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border border-border rounded-lg p-3 shadow-lg text-xs">
      <p className="font-medium mb-1.5">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-mono font-medium">
            {typeof entry.value === "number" ? entry.value.toFixed(2) : entry.value}
            {entry.unit ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Report Card (expandable) ────────────────────────────────

function ReportCard({
  report,
  siteName,
}: {
  report: {
    id: number;
    siteId: number;
    reportType: string;
    periodStart: Date | string;
    periodEnd: Date | string;
    avgSoc: number;
    minSoc: number;
    maxSoc: number;
    avgPvPower: number | null;
    maxPvPower: number | null;
    avgLoadPower: number | null;
    maxLoadPower: number | null;
    avgBatteryPower: number | null;
    avgTemperature: number | null;
    maxTemperature: number | null;
    totalReadings: number;
    loadOnMinutes: number;
    estimatedEnergyKwh: number;
    totalEvents: number;
    totalAlarms: number;
    maneuverCount: number;
    notificationSent: boolean;
    createdAt: Date | string;
  };
  siteName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const typeLabel = report.reportType === "daily" ? "Diário" : "Semanal";
  const typeBadgeColor =
    report.reportType === "daily"
      ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
      : "bg-purple-500/20 text-purple-400 border-purple-500/30";

  return (
    <Card className="bg-card/50 border-border/50 hover:border-border transition-colors">
      <CardContent className="p-0">
        {/* Header row */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between p-4 text-left cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <FileText className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${typeBadgeColor}`}>
                  {typeLabel}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {formatShortDate(report.periodStart)} — {formatShortDate(report.periodEnd)}
                </span>
                {siteName && (
                  <span className="text-xs text-muted-foreground">({siteName})</span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                <span>SOC: {report.avgSoc}%</span>
                <span>{formatDuration(report.loadOnMinutes)} operação</span>
                <span>{report.estimatedEnergyKwh} kWh</span>
                {report.notificationSent && (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Bell className="w-3 h-3" /> Notificado
                  </span>
                )}
              </div>
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="px-4 pb-4 border-t border-border/50">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-4">
              <StatCard
                icon={Battery}
                label="SOC Médio"
                value={report.avgSoc}
                unit="%"
                sub={`Min: ${report.minSoc}% / Max: ${report.maxSoc}%`}
                color="text-emerald-400"
              />
              {report.avgPvPower != null && (
                <StatCard
                  icon={Sun}
                  label="Geração FV Média"
                  value={report.avgPvPower}
                  unit="kW"
                  sub={report.maxPvPower != null ? `Pico: ${report.maxPvPower} kW` : undefined}
                  color="text-yellow-400"
                />
              )}
              {report.avgLoadPower != null && (
                <StatCard
                  icon={Zap}
                  label="Consumo Médio"
                  value={report.avgLoadPower}
                  unit="kW"
                  sub={report.maxLoadPower != null ? `Pico: ${report.maxLoadPower} kW` : undefined}
                  color="text-orange-400"
                />
              )}
              {report.avgTemperature != null && (
                <StatCard
                  icon={Thermometer}
                  label="Temperatura Média"
                  value={report.avgTemperature}
                  unit="°C"
                  sub={report.maxTemperature != null ? `Max: ${report.maxTemperature}°C` : undefined}
                  color="text-red-400"
                />
              )}
              <StatCard
                icon={Clock}
                label="Tempo de Operação"
                value={formatDuration(report.loadOnMinutes)}
                color="text-blue-400"
              />
              <StatCard
                icon={Zap}
                label="Energia Estimada"
                value={report.estimatedEnergyKwh}
                unit="kWh"
                color="text-cyan-400"
              />
              <StatCard
                icon={BarChart3}
                label="Leituras"
                value={report.totalReadings}
                sub={`${report.totalEvents} eventos, ${report.maneuverCount} manobras`}
                color="text-indigo-400"
              />
              <StatCard
                icon={AlertTriangle}
                label="Alarmes"
                value={report.totalAlarms}
                color={report.totalAlarms > 0 ? "text-red-400" : "text-emerald-400"}
              />
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30">
              <p className="text-xs text-muted-foreground">
                Gerado em {formatDate(report.createdAt)}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  try {
                    exportReportPDF(report, siteName ?? "Site");
                    toast.success("PDF exportado com sucesso!");
                  } catch (err) {
                    toast.error("Erro ao gerar PDF.");
                  }
                }}
                className="gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar PDF
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Trend Charts Section ────────────────────────────────────

const TREND_PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "14", label: "Últimos 14 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "all", label: "Todo o período" },
];

function TrendCharts({
  selectedSite,
  selectedType,
  siteNameMap,
}: {
  selectedSite: string;
  selectedType: string;
  siteNameMap: Record<number, string>;
}) {
  const [trendPeriod, setTrendPeriod] = useState("30");

  const trendInput = useMemo(
    () => ({
      slug: selectedSite === "all" ? undefined : selectedSite,
      reportType: selectedType === "all" ? undefined : (selectedType as "daily" | "weekly"),
      limit: 100,
      sinceDays: trendPeriod === "all" ? undefined : parseInt(trendPeriod),
    }),
    [selectedSite, selectedType, trendPeriod]
  );

  const { data: trends, isLoading } = trpc.bess.reportTrends.useQuery(trendInput, {
    refetchInterval: 120_000,
  });

  // Build chart data: group by site for multi-line charts
  const { socChartData, energyChartData, tempAlarmChartData, siteIds } = useMemo(() => {
    if (!trends?.length) return { socChartData: [], energyChartData: [], tempAlarmChartData: [], siteIds: [] };

    // Collect unique site IDs
    const ids = Array.from(new Set(trends.map((t) => t.siteId))).sort();

    // Group by periodEnd timestamp for alignment
    const socMap = new Map<string, Record<string, any>>();
    const energyMap = new Map<string, Record<string, any>>();
    const tempAlarmMap = new Map<string, Record<string, any>>();

    for (const t of trends) {
      const key = formatChartDate(t.periodEnd);

      // SOC chart
      if (!socMap.has(key)) {
        socMap.set(key, { date: key });
      }
      const socEntry = socMap.get(key)!;
      socEntry[`soc_${t.siteId}`] = t.avgSoc;
      socEntry[`min_${t.siteId}`] = t.minSoc;
      socEntry[`max_${t.siteId}`] = t.maxSoc;

      // Energy chart
      if (!energyMap.has(key)) {
        energyMap.set(key, { date: key });
      }
      const energyEntry = energyMap.get(key)!;
      energyEntry[`energy_${t.siteId}`] = t.estimatedEnergyKwh;
      energyEntry[`opMinutes_${t.siteId}`] = t.loadOnMinutes;

      // Temperature & Alarms chart
      if (!tempAlarmMap.has(key)) {
        tempAlarmMap.set(key, { date: key });
      }
      const taEntry = tempAlarmMap.get(key)!;
      if (t.avgTemperature != null) {
        taEntry[`temp_${t.siteId}`] = t.avgTemperature;
      }
      taEntry[`alarms_${t.siteId}`] = t.totalAlarms;
    }

    return {
      socChartData: Array.from(socMap.values()),
      energyChartData: Array.from(energyMap.values()),
      tempAlarmChartData: Array.from(tempAlarmMap.values()),
      siteIds: ids,
    };
  }, [trends, siteNameMap]);

  const SITE_COLORS: Record<number, { main: string; light: string; gradient: string }> = {
    1: { main: "#22c55e", light: "#22c55e40", gradient: "socGrad1" },
    2: { main: "#3b82f6", light: "#3b82f640", gradient: "socGrad2" },
    3: { main: "#f59e0b", light: "#f59e0b40", gradient: "socGrad3" },
    4: { main: "#ef4444", light: "#ef444440", gradient: "socGrad4" },
  };

  const getColor = (siteId: number) =>
    SITE_COLORS[siteId] ?? { main: "#8b5cf6", light: "#8b5cf640", gradient: `socGrad${siteId}` };

  const ENERGY_COLORS: Record<number, string> = {
    1: "#06b6d4",
    2: "#f97316",
    3: "#a855f7",
    4: "#ec4899",
  };

  const getEnergyColor = (siteId: number) => ENERGY_COLORS[siteId] ?? "#8b5cf6";

  const TEMP_COLORS: Record<number, string> = {
    1: "#f97316",
    2: "#ef4444",
    3: "#eab308",
    4: "#f472b6",
  };

  const getTempColor = (siteId: number) => TEMP_COLORS[siteId] ?? "#fb923c";

  const ALARM_COLORS: Record<number, string> = {
    1: "#ef444480",
    2: "#f59e0b80",
    3: "#8b5cf680",
    4: "#ec489980",
  };

  const getAlarmColor = (siteId: number) => ALARM_COLORS[siteId] ?? "#ef444480";

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mr-2" />
          <span className="text-muted-foreground text-sm">Carregando tendências...</span>
        </CardContent>
      </Card>
    );
  }

  if (!socChartData.length) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="flex flex-col items-center justify-center py-8">
          <TrendingUp className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">
            Dados insuficientes para gráficos de tendência.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Gere mais relatórios para visualizar a evolução ao longo do tempo.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Period selector for trends */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Gráficos de Tendência</span>
        </div>
        <Select value={trendPeriod} onValueChange={setTrendPeriod}>
          <SelectTrigger className="w-[180px] bg-card/50 border-border/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TREND_PERIOD_OPTIONS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* SOC Trend Chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Battery className="w-4 h-4 text-emerald-400" />
            Tendência SOC Médio
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Evolução do estado de carga médio, mínimo e máximo por período
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={socChartData}>
              <defs>
                {siteIds.map((id) => {
                  const c = getColor(id);
                  return (
                    <linearGradient key={c.gradient} id={c.gradient} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={c.main} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={c.main} stopOpacity={0} />
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#64748b", fontSize: 10 }}
                angle={-20}
                textAnchor="end"
                height={50}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "#64748b", fontSize: 11 }}
                unit="%"
              />
              <Tooltip content={<TrendTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              />
              <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="5 5" strokeOpacity={0.5} />
              <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="5 5" strokeOpacity={0.5} />
              {siteIds.map((id) => {
                const c = getColor(id);
                const name = siteNameMap[id] ?? `Site ${id}`;
                return (
                  <Area
                    key={`soc_${id}`}
                    type="monotone"
                    dataKey={`soc_${id}`}
                    name={`SOC ${name}`}
                    stroke={c.main}
                    fill={`url(#${c.gradient})`}
                    strokeWidth={2}
                    dot={{ r: 3, fill: c.main }}
                    activeDot={{ r: 5 }}
                    unit="%"
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Energy Trend Chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            Tendência Energia Estimada
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Energia consumida estimada (kWh) por período e site
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={energyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#64748b", fontSize: 10 }}
                angle={-20}
                textAnchor="end"
                height={50}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 11 }}
                unit=" kWh"
              />
              <Tooltip content={<TrendTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              />
              {siteIds.map((id) => {
                const name = siteNameMap[id] ?? `Site ${id}`;
                return (
                  <Bar
                    key={`energy_${id}`}
                    dataKey={`energy_${id}`}
                    name={`Energia ${name}`}
                    fill={getEnergyColor(id)}
                    radius={[4, 4, 0, 0]}
                    unit=" kWh"
                  />
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      </div>

      {/* Temperature & Alarms Combined Chart — full width */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-orange-400" />
            Temperatura Média
            <span className="text-muted-foreground font-normal">&</span>
            <AlertTriangle className="w-4 h-4 text-red-400" />
            Alarmes
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Evolução da temperatura média das baterias (linhas) e contagem de alarmes (barras) por período
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={tempAlarmChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#64748b", fontSize: 10 }}
                angle={-20}
                textAnchor="end"
                height={50}
              />
              <YAxis
                yAxisId="temp"
                orientation="left"
                tick={{ fill: "#64748b", fontSize: 11 }}
                unit="°C"
                domain={["auto", "auto"]}
              />
              <YAxis
                yAxisId="alarms"
                orientation="right"
                tick={{ fill: "#64748b", fontSize: 11 }}
                allowDecimals={false}
              />
              <Tooltip content={<TrendTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              />
              <ReferenceLine yAxisId="temp" y={45} stroke="#ef4444" strokeDasharray="5 5" strokeOpacity={0.5} />
              {siteIds.map((id) => {
                const name = siteNameMap[id] ?? `Site ${id}`;
                return (
                  <Bar
                    key={`alarms_${id}`}
                    yAxisId="alarms"
                    dataKey={`alarms_${id}`}
                    name={`Alarmes ${name}`}
                    fill={getAlarmColor(id)}
                    radius={[4, 4, 0, 0]}
                  />
                );
              })}
              {siteIds.map((id) => {
                const name = siteNameMap[id] ?? `Site ${id}`;
                return (
                  <Line
                    key={`temp_${id}`}
                    yAxisId="temp"
                    type="monotone"
                    dataKey={`temp_${id}`}
                    name={`Temp ${name}`}
                    stroke={getTempColor(id)}
                    strokeWidth={2}
                    dot={{ r: 3, fill: getTempColor(id) }}
                    activeDot={{ r: 5 }}
                    unit="°C"
                    connectNulls
                  />
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Scheduler Settings Panel ─────────────────────────────────────────

const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function SchedulerSettingsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const { data: settings, refetch } = trpc.bess.schedulerSettings.useQuery();
  const updateMutation = trpc.bess.updateSchedulerSettings.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Configurações do scheduler atualizadas!");
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  if (!settings) return null;

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader
        className="cursor-pointer py-3 px-4"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Configurações do Scheduler</CardTitle>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                settings.enabled
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              <Power className="w-3 h-3" />
              {settings.enabled ? "Ativo" : "Inativo"}
            </span>
          </div>
          {isOpen ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="px-4 pb-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Enabled toggle */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Scheduler Automático</label>
              <div className="flex gap-2">
                <Button
                  variant={settings.enabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateMutation.mutate({ enabled: true })}
                  disabled={updateMutation.isPending}
                  className="flex-1"
                >
                  Ativado
                </Button>
                <Button
                  variant={!settings.enabled ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => updateMutation.mutate({ enabled: false })}
                  disabled={updateMutation.isPending}
                  className="flex-1"
                >
                  Desativado
                </Button>
              </div>
            </div>

            {/* Daily hour */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Horário do Relatório Diário</label>
              <Select
                value={String(settings.dailyHour)}
                onValueChange={(v) => updateMutation.mutate({ dailyHour: parseInt(v, 10) })}
              >
                <SelectTrigger className="bg-card/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {String(i).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Weekly day */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Dia do Relatório Semanal</label>
              <Select
                value={String(settings.weeklyDay)}
                onValueChange={(v) => updateMutation.mutate({ weeklyDay: parseInt(v, 10) })}
              >
                <SelectTrigger className="bg-card/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_NAMES.map((name, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            O relatório diário é gerado todos os dias às {String(settings.dailyHour).padStart(2, "0")}:00.
            O relatório semanal é gerado toda {DAY_NAMES[settings.weeklyDay]} às {String(settings.dailyHour).padStart(2, "0")}:00.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

// ── Main Reports Page ────────────────────────────────────────────────

const PAGE_SIZE = 20;
export default function Reports() {
  const [selectedSite, setSelectedSite] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);

  const { data: sites } = trpc.bess.sites.useQuery();

  // Reset page when filters change
  const handleSiteChange = useCallback((v: string) => { setSelectedSite(v); setCurrentPage(1); }, []);
  const handleTypeChange = useCallback((v: string) => { setSelectedType(v); setCurrentPage(1); }, []);

  const reportsInput = useMemo(
    () => ({
      slug: selectedSite === "all" ? undefined : selectedSite,
      limit: PAGE_SIZE,
      page: currentPage,
    }),
    [selectedSite, currentPage]
  );

  const {
    data: reportsData,
    isLoading,
    refetch: refetchReports,
  } = trpc.bess.reports.useQuery(reportsInput, {
    refetchInterval: 60_000,
  });

  const reports = reportsData?.items;
  const totalPages = reportsData?.totalPages ?? 1;
  const totalCount = reportsData?.totalCount ?? 0;

  const generateMutation = trpc.bess.generateReport.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        refetchReports();
      } else {
        toast.error(data.message);
      }
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  const generateAllMutation = trpc.bess.generateAllReports.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(
          `Relatórios gerados${data.notified ? " e notificação enviada" : ""}.`
        );
        refetchReports();
      } else {
        toast.error("Falha ao gerar relatórios.");
      }
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  // Filter reports by type (client-side filter on current page)
  const filteredReports = useMemo(() => {
    if (!reports) return [];
    if (selectedType === "all") return reports;
    return reports.filter((r: typeof reports[number]) => r.reportType === selectedType);
  }, [reports, selectedType]);

  // Build site name map
  const siteNameMap = useMemo(() => {
    const map: Record<number, string> = {};
    if (sites) {
      for (const s of sites) {
        map[s.id] = s.name.replace("BESS - Daniel Medeiros ", "").replace("(", "").replace(")", "");
      }
    }
    return map;
  }, [sites]);

  // Summary stats from current page reports
  const summary = useMemo(() => {
    if (!filteredReports || filteredReports.length === 0) return null;
    const latest = filteredReports[0];
    const totalEnergy = filteredReports.reduce((sum: number, r: typeof filteredReports[number]) => sum + r.estimatedEnergyKwh, 0);
    const totalMinutes = filteredReports.reduce((sum: number, r: typeof filteredReports[number]) => sum + r.loadOnMinutes, 0);
    return {
      totalReports: totalCount,
      latestAvgSoc: latest.avgSoc,
      totalEnergy: Math.round(totalEnergy * 100) / 100,
      totalMinutes,
    };
  }, [filteredReports, totalCount]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Relatórios de Performance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Resumos automáticos diários e semanais de operação dos sistemas BESS
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateAllMutation.mutate({ reportType: "daily" })}
            disabled={generateAllMutation.isPending}
          >
            {generateAllMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1" />
            )}
            Gerar Diário
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateAllMutation.mutate({ reportType: "weekly" })}
            disabled={generateAllMutation.isPending}
          >
            {generateAllMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1" />
            )}
            Gerar Semanal
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedSite} onValueChange={handleSiteChange}>
          <SelectTrigger className="w-[200px] bg-card/50 border-border/50">
            <SelectValue placeholder="Todos os sites" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os sites</SelectItem>
            {sites?.map((s) => (
              <SelectItem key={s.slug} value={s.slug}>
                {s.name.replace("BESS - Daniel Medeiros ", "").replace("(", "").replace(")", "")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedType} onValueChange={handleTypeChange}>
          <SelectTrigger className="w-[160px] bg-card/50 border-border/50">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="daily">Diário</SelectItem>
            <SelectItem value="weekly">Semanal</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={FileText}
            label="Total de Relatórios"
            value={summary.totalReports}
            color="text-indigo-400"
          />
          <StatCard
            icon={Battery}
            label="SOC Médio (último)"
            value={summary.latestAvgSoc}
            unit="%"
            color="text-emerald-400"
          />
          <StatCard
            icon={Zap}
            label="Energia Total"
            value={summary.totalEnergy}
            unit="kWh"
            color="text-cyan-400"
          />
          <StatCard
            icon={Clock}
            label="Operação Total"
            value={formatDuration(summary.totalMinutes)}
            color="text-blue-400"
          />
        </div>
      )}

      {/* ── Trend Charts ── */}
      <TrendCharts
        selectedSite={selectedSite}
        selectedType={selectedType}
        siteNameMap={siteNameMap}
      />

      {/* Reports list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Carregando relatórios...</span>
        </div>
      ) : filteredReports.length === 0 ? (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-center">
              Nenhum relatório encontrado.
            </p>
            <p className="text-xs text-muted-foreground text-center mt-1">
              Relatórios são gerados automaticamente a cada 24h (diário) e 7 dias (semanal).
              <br />
              Você também pode gerar manualmente usando os botões acima.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredReports.map((report: typeof filteredReports[number]) => (
            <ReportCard
              key={report.id}
              report={report}
              siteName={selectedSite === "all" ? siteNameMap[report.siteId] : undefined}
            />
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-muted-foreground">
                Página {currentPage} de {totalPages} ({totalCount} relatórios)
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Anterior
                </Button>
                {/* Page numbers */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={pageNum === currentPage ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCurrentPage(pageNum)}
                      className="w-8 h-8 p-0"
                    >
                      {pageNum}
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="gap-1"
                >
                  Próxima
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scheduler Settings */}
      <SchedulerSettingsPanel />

      {/* Info footer */}
      <Card className="bg-card/30 border-border/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Bell className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                <strong className="text-foreground">Relatórios automáticos:</strong> O sistema gera
                relatórios no horário configurado abaixo, automaticamente para cada
                site. Uma notificação push é enviada ao proprietário com o resumo.
              </p>
              <p>
                <strong className="text-foreground">Gráficos de tendência:</strong> Os gráficos acima
                mostram a evolução do SOC médio e da energia estimada ao longo do tempo, permitindo
                análise comparativa entre períodos e sites.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
