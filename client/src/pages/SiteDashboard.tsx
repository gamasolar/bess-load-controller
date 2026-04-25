import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoute, useLocation } from "wouter";
import { useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Battery, BatteryCharging, Sun, Droplets, Mountain, AlertTriangle,
  ArrowLeft, Zap, Thermometer, Wifi, WifiOff, Power, PowerOff,
  Activity, Clock, TrendingDown, TrendingUp, Settings, ChevronDown,
  ChevronUp, Shield, Heart, AlertOctagon,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar, Legend,
} from "recharts";
import EnergyFlowDiagram from "@/components/EnergyFlowDiagram";
import EnergyTrendChart from "@/components/EnergyTrendChart";

// ─── Helper ──────────────────────────────────────────────────
function timeAgo(date: Date | string | null | undefined) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s atrás`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min atrás`;
  return `${Math.floor(hours / 24)}d atrás`;
}

// ─── Status Card ─────────────────────────────────────────────
function StatusCard({ title, value, subtitle, icon, color }: {
  title: string; value: string; subtitle?: string; icon: React.ReactNode; color: string;
}) {
  return (
    <Card className="border-white/5 bg-card">
      <CardContent className="p-3">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${color}15` }}>
            <div style={{ color }}>{icon}</div>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-sm font-bold font-mono mt-0.5" style={{ color }}>{value}</p>
            {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Event Badge ─────────────────────────────────────────────
function EventBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    LOAD_ON: "#22c55e", LOAD_OFF: "#ef4444", MANUAL_CMD_ON: "#3b82f6",
    MANUAL_CMD_OFF: "#f97316", FAILSAFE: "#ef4444", DIVERGENCE: "#f59e0b",
    MODE_CHANGE: "#8b5cf6",
  };
  const color = colors[type] ?? "#64748b";
  return (
    <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: color }} />
  );
}

// ─── Config Slider ───────────────────────────────────────────
function ConfigSlider({ label, value, min, max, step, unit, color, onChange, description }: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; color: string; onChange: (v: number) => void; description?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-bold font-mono" style={{ color }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full" style={{ accentColor: color }} />
      {description && <p className="text-[10px] text-muted-foreground/60">{description}</p>}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────
export default function SiteDashboard() {
  const [, params] = useRoute("/site/:slug");
  const [, setLocation] = useLocation();
  const slug = params?.slug ?? "";

  // Data queries
  const { data: detail, isLoading } = trpc.bess.siteDetail.useQuery(
    { slug }, { refetchInterval: 30_000, enabled: !!slug }
  );
  const { data: readings } = trpc.bess.readings.useQuery(
    { slug, hours: 4 }, { refetchInterval: 60_000, enabled: !!slug }
  );
  const { data: events } = trpc.bess.events.useQuery(
    { slug }, { refetchInterval: 60_000, enabled: !!slug }
  );
  const { data: stats } = trpc.bess.stats.useQuery(
    { slug }, { refetchInterval: 60_000, enabled: !!slug }
  );

  // Mutations
  const utils = trpc.useUtils();
  const commandMutation = trpc.bess.command.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
      utils.bess.siteDetail.invalidate({ slug });
      utils.bess.events.invalidate({ slug });
    },
    onError: () => toast.error("Erro ao executar comando."),
  });
  const toggleModeMutation = trpc.bess.toggleMode.useMutation({
    onSuccess: (res) => {
      toast.success(`Modo alterado para ${res.mode === "auto" ? "AUTOMÁTICO" : "MANUAL"}`);
      utils.bess.siteDetail.invalidate({ slug });
      utils.bess.events.invalidate({ slug });
    },
  });
  const updateConfigMutation = trpc.bess.updateConfig.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
      utils.bess.siteDetail.invalidate({ slug });
    },
  });
  // Simulate tick
  const simulateMutation = trpc.bess.simulateTick.useMutation({
    onSuccess: () => {
      utils.bess.siteDetail.invalidate({ slug });
      utils.bess.readings.invalidate({ slug });
      utils.bess.events.invalidate({ slug });
      utils.bess.stats.invalidate({ slug });
      utils.bess.alarms.invalidate({ slug });
      utils.bess.sites.invalidate();
    },
  });
  // Manual SOC update
  const updateSocMutation = trpc.bess.updateSoc.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success(res.message);
        setShowSocInput(false);
      } else toast.error(res.message);
      utils.bess.siteDetail.invalidate({ slug });
      utils.bess.events.invalidate({ slug });
    },
    onError: () => toast.error("Erro ao atualizar SOC."),
  });
  const [showSocInput, setShowSocInput] = useState(false);
  const [manualSocValue, setManualSocValue] = useState("");

  // Config form state
  const [showConfig, setShowConfig] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [configForm, setConfigForm] = useState({
    socLowLimit: 15, socHighLimit: 20, cooldownMinutes: 5,
    lowReadingsRequired: 2, highReadingsRequired: 3, presetName: "padrao",
  });
  const [configInitialized, setConfigInitialized] = useState(false);

  // Initialize config form from server data
  if (detail?.config && !configInitialized) {
    setConfigForm({
      socLowLimit: detail.config.socLowLimit,
      socHighLimit: detail.config.socHighLimit,
      cooldownMinutes: detail.config.cooldownMinutes,
      lowReadingsRequired: detail.config.lowReadingsRequired,
      highReadingsRequired: detail.config.highReadingsRequired,
      presetName: detail.config.presetName,
    });
    setConfigInitialized(true);
  }

  const updateFormField = useCallback((field: string, value: number | string) => {
    setConfigForm(prev => ({ ...prev, [field]: value, presetName: "personalizado" }));
  }, []);

  const applyPreset = useCallback((name: string) => {
    const presets: Record<string, any> = {
      conservador: { socLowLimit: 20, socHighLimit: 30, cooldownMinutes: 10, lowReadingsRequired: 3, highReadingsRequired: 4 },
      padrao: { socLowLimit: 15, socHighLimit: 20, cooldownMinutes: 5, lowReadingsRequired: 2, highReadingsRequired: 3 },
      agressivo: { socLowLimit: 10, socHighLimit: 15, cooldownMinutes: 3, lowReadingsRequired: 1, highReadingsRequired: 2 },
    };
    if (presets[name]) setConfigForm({ ...presets[name], presetName: name });
  }, []);

  const histeresisGap = configForm.socHighLimit - configForm.socLowLimit;
  const histeresisValid = histeresisGap >= 5;

  // Chart data
  const chartData = useMemo(() => {
    if (!readings) return [];
    return readings.map((r: any) => ({
      time: new Date(r.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      soc: r.soc,
      pvPower: r.pvPower ?? 0,
      batteryPower: r.batteryPower ?? 0,
      temperature: r.batteryTemperature ?? 0,
    }));
  }, [readings]);

  const displayedEvents = useMemo(() => {
    if (!events) return [];
    return showAllEvents ? events : events.slice(0, 8);
  }, [events, showAllEvents]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-6xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Site não encontrado.</p>
        <Button variant="outline" onClick={() => setLocation("/")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
        </Button>
      </div>
    );
  }

  const { site, state, config, activeAlarms } = detail;
  const soc = state?.currentSoc ?? 0;
  const socColor = soc > 50 ? "#22c55e" : soc > 25 ? "#f59e0b" : "#ef4444";
  const isActive = state?.loadStatus === "on";
  const isAuto = state?.mode === "auto";
  const cooldownSec = Math.ceil((state?.cooldownRemaining ?? 0) / 1000);
  const SiteIcon = slug === "piscinao" ? Droplets : Mountain;

  const healthColors: Record<string, string> = {
    healthy: "#22c55e", attention: "#f59e0b", degraded: "#f97316", critical: "#ef4444",
  };
  const healthLabels: Record<string, string> = {
    healthy: "Saudável", attention: "Atenção", degraded: "Degradado", critical: "Crítico",
  };
  const healthColor = healthColors[state?.healthStatus ?? "healthy"] ?? "#22c55e";

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${healthColor}15` }}>
            <SiteIcon className="w-5 h-5" style={{ color: healthColor }} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">{site.name}</h1>
            <p className="text-xs text-muted-foreground">
              {site.bessCount}x {site.bessModel} ({site.bessCapacityKwh} kWh) — {site.pumpCount}x Bomba {site.pumpPowerCv}cv
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode Toggle */}
          <Button
            variant="outline" size="sm"
            className="text-xs gap-1.5"
            style={{
              color: isAuto ? "#3b82f6" : "#f59e0b",
              borderColor: isAuto ? "rgba(59,130,246,0.3)" : "rgba(245,158,11,0.3)",
            }}
            onClick={() => toggleModeMutation.mutate({ slug })}
            disabled={toggleModeMutation.isPending}
          >
            {isAuto ? <Zap className="w-3.5 h-3.5" /> : <Settings className="w-3.5 h-3.5" />}
            {isAuto ? "AUTOMÁTICO" : "MANUAL"}
          </Button>
          {/* Simulate button */}
          <Button variant="outline" size="sm" className="text-xs gap-1.5 text-muted-foreground"
            onClick={() => simulateMutation.mutate({ slug })}
            disabled={simulateMutation.isPending}>
            <Activity className="w-3.5 h-3.5" />
            Simular
          </Button>
        </div>
      </div>

      {/* ── Health Banner ── */}
      <div className="flex items-center gap-3 p-3 rounded-xl border"
        style={{
          borderColor: `${healthColor}30`,
          backgroundColor: `${healthColor}08`,
        }}>
        <div className={`w-3 h-3 rounded-full ${state?.healthStatus === "critical" ? "animate-pulse-glow" : ""}`}
          style={{ backgroundColor: healthColor }} />
        <span className="text-sm font-medium" style={{ color: healthColor }}>
          {healthLabels[state?.healthStatus ?? "healthy"]}
        </span>
        {state?.lastDecision && (
          <span className="text-xs text-muted-foreground flex-1 truncate ml-2">
            {state.lastDecision}
          </span>
        )}
        {site.controlMode === "auto_mqtt" && (
          <div className="flex items-center gap-1.5 ml-auto">
            {state?.mqttConnected ? (
              <Badge variant="outline" className="text-[10px] gap-1 text-primary border-primary/30 bg-primary/10">
                <Wifi className="w-2.5 h-2.5" /> MQTT
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] gap-1 text-destructive border-destructive/30 bg-destructive/10">
                <WifiOff className="w-2.5 h-2.5" /> MQTT
              </Badge>
            )}
            {/* Real Sonoff power state */}
            {state?.sonoffPower && state.sonoffPower !== "UNKNOWN" ? (
              <Badge variant="outline" className={`text-[10px] gap-1 ${
                state.sonoffPower === "ON"
                  ? "text-green-500 border-green-500/30 bg-green-500/10"
                  : "text-red-500 border-red-500/30 bg-red-500/10"
              }`}>
                <Power className="w-2.5 h-2.5" /> Sonoff: {state.sonoffPower}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground border-muted-foreground/30 bg-muted-foreground/10">
                <Power className="w-2.5 h-2.5" /> Sonoff: ?
              </Badge>
            )}
          </div>
        )}
        {site.controlMode === "manual" && (
          <Badge variant="outline" className="text-[10px] gap-1 text-yellow-500 border-yellow-500/30 bg-yellow-500/10 ml-auto">
            <Settings className="w-2.5 h-2.5" /> Controle Local
          </Badge>
        )}
      </div>

      {/* ── Control Buttons ── */}
      <div className="flex items-center gap-3 justify-center">
        <Button size="lg" className="gap-2 px-8 font-bold text-sm"
          style={{
            backgroundColor: isActive ? "rgba(34,197,94,0.15)" : "#22c55e",
            color: isActive ? "#22c55e" : "#0f172a",
            borderColor: "#22c55e",
          }}
          variant={isActive ? "outline" : "default"}
          disabled={commandMutation.isPending}
          onClick={() => commandMutation.mutate({ slug, action: "on" })}>
          <Power size={18} /> LIGAR
        </Button>
        <Button size="lg" className="gap-2 px-8 font-bold text-sm"
          style={{
            backgroundColor: !isActive ? "rgba(239,68,68,0.15)" : "#ef4444",
            color: !isActive ? "#ef4444" : "white",
            borderColor: "#ef4444",
          }}
          variant={!isActive ? "outline" : "default"}
          disabled={commandMutation.isPending}
          onClick={() => commandMutation.mutate({ slug, action: "off" })}>
          <PowerOff size={18} /> DESLIGAR
        </Button>
        {cooldownSec > 0 && (
          <Badge variant="outline" className="text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/10 gap-1">
            <Clock size={12} /> Cooldown: {cooldownSec}s
          </Badge>
        )}
      </div>

      {/* ── Divergence Warning ── */}
      {state?.sonoffPower && state.sonoffPower !== "UNKNOWN" && (() => {
        const systemSays = state.loadStatus === "on" ? "ON" : "OFF";
        const sonoffReal = state.sonoffPower;
        if (systemSays !== sonoffReal) {
          return (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-red-500/40 bg-red-500/10 animate-pulse">
              <AlertOctagon className="w-5 h-5 text-red-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-400">
                  Divergência de Estado Detectada
                </p>
                <p className="text-xs text-red-400/80">
                  Sistema diz carga <strong>{systemSays === "ON" ? "LIGADA" : "DESLIGADA"}</strong>, mas o Sonoff reporta <strong>{sonoffReal}</strong>.
                  {sonoffReal === "OFF" && systemSays === "ON" && " O dispositivo pode ter sido desligado manualmente ou perdeu conexão."}
                  {sonoffReal === "ON" && systemSays === "OFF" && " O dispositivo pode ter sido ligado manualmente fora do sistema."}
                </p>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* ── Energy Flow Diagram ── */}
      <EnergyFlowDiagram
        pvPower={state?.currentPvPower ?? 0}
        batteryPower={state?.currentBatteryPower ?? 0}
        loadPower={state?.currentLoadPower ?? 0}
        soc={soc}
        soh={state?.currentSoh ?? 0}
        bessModel={site.bessModel}
        bessCapacityKwh={site.bessCapacityKwh}
        pumpDescription={`${site.pumpCount}x Bomba ${site.pumpPowerCv}cv`}
        isLoadOn={isActive}
      />

      {/* ── Energy Trend Chart (daily, like FusionSolar) ── */}
      <EnergyTrendChart slug={slug} />

      {/* ── Status Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="relative">
          <StatusCard title="SOC Bateria" value={`${soc.toFixed(1)}%`}
            subtitle={
              (state as any)?.socSource === "fusionsolar" 
                ? (state as any)?.lastTelemetryAt 
                  ? `FusionSolar • ${new Date((state as any).lastTelemetryAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                  : "FusionSolar"
                : (state as any)?.socSource === "manual" 
                  ? `Manual • ${(state as any)?.lastTelemetryAt ? new Date((state as any).lastTelemetryAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}`
                  : "⚠️ Dado não real"
            }
            icon={<Battery size={16} />} color={(state as any)?.socSource === "fusionsolar" || (state as any)?.socSource === "manual" ? socColor : "#9ca3af"} />
          {/* Manual SOC button */}
          {(state as any)?.socSource !== "fusionsolar" && (
            <button
              onClick={() => { setShowSocInput(!showSocInput); setManualSocValue(soc.toFixed(0)); }}
              className="absolute top-1 right-1 text-[9px] text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded px-1.5 py-0.5 transition-colors"
            >
              Editar
            </button>
          )}
          {showSocInput && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-card border border-white/10 rounded-lg p-2 shadow-xl">
              <div className="flex gap-1">
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={manualSocValue}
                  onChange={(e) => setManualSocValue(e.target.value)}
                  className="flex-1 bg-background border border-white/10 rounded px-2 py-1 text-xs text-foreground w-16"
                  placeholder="SOC %"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = parseFloat(manualSocValue);
                      if (!isNaN(val) && val >= 0 && val <= 100) {
                        updateSocMutation.mutate({ slug, soc: val });
                      }
                    }
                    if (e.key === "Escape") setShowSocInput(false);
                  }}
                />
                <Button
                  size="sm" variant="default"
                  className="text-xs h-7 px-2"
                  disabled={updateSocMutation.isPending}
                  onClick={() => {
                    const val = parseFloat(manualSocValue);
                    if (!isNaN(val) && val >= 0 && val <= 100) {
                      updateSocMutation.mutate({ slug, soc: val });
                    } else {
                      toast.error("SOC deve ser entre 0 e 100");
                    }
                  }}
                >
                  {updateSocMutation.isPending ? "..." : "OK"}
                </Button>
              </div>
            </div>
          )}
        </div>
        <StatusCard title="Potência Bat." value={`${(state?.currentBatteryPower ?? 0).toFixed(1)} kW`}
          subtitle={(state?.currentBatteryPower ?? 0) > 0 ? "Carregando" : "Descarregando"}
          icon={<BatteryCharging size={16} />} color="#3b82f6" />
        <StatusCard title="Geração FV" value={`${(state?.currentPvPower ?? 0).toFixed(1)} kW`}
          subtitle="Usina fotovoltaica"
          icon={<Sun size={16} />} color="#f59e0b" />
        <StatusCard title="Temperatura" value={`${(state?.currentTemperature ?? 0).toFixed(1)}°C`}
          subtitle={(state?.currentTemperature ?? 0) > 35 ? "Elevada" : "Normal"}
          icon={<Thermometer size={16} />}
          color={(state?.currentTemperature ?? 0) > 35 ? "#ef4444" : "#06b6d4"} />
        <StatusCard title="Saúde (SOH)" value={`${(state?.currentSoh ?? 0).toFixed(1)}%`}
          subtitle="State of Health"
          icon={<Heart size={16} />} color="#8b5cf6" />
        <StatusCard title="Consumo" value={`${(state?.currentLoadPower ?? 0).toFixed(1)} kW`}
          subtitle={`${site.pumpCount}x Bomba ${site.pumpPowerCv}cv`}
          icon={<Zap size={16} />} color="#f97316" />
      </div>

      {/* ── SOC Chart ── */}
      <Card className="border-white/5 bg-card">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <Activity size={14} className="text-blue-500" />
            Histórico SOC — Últimas 4 Horas
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="socGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={{ stroke: "rgba(255,255,255,0.05)" }} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={{ stroke: "rgba(255,255,255,0.05)" }} tickLine={false}
                tickFormatter={(v) => `${v}%`} />
              <RechartsTooltip contentStyle={{
                backgroundColor: "#1e293b", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px", fontSize: "12px", color: "#e2e8f0",
              }} formatter={(value: number) => [`${value.toFixed(1)}%`, "SOC"]} />
              <ReferenceLine y={configForm.socLowLimit} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5}
                label={{ value: `${configForm.socLowLimit}%`, fill: "#ef4444", fontSize: 10, position: "right" }} />
              <ReferenceLine y={configForm.socHighLimit} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1.5}
                label={{ value: `${configForm.socHighLimit}%`, fill: "#22c55e", fontSize: 10, position: "right" }} />
              <Area type="monotone" dataKey="soc" stroke="#3b82f6" strokeWidth={2}
                fill="url(#socGrad)" dot={false} animationDuration={500} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Power Chart ── */}
      <Card className="border-white/5 bg-card">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <Zap size={14} className="text-yellow-500" />
            Potência — Geração FV vs Bateria
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData.filter((_: any, i: number) => i % 5 === 0)} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={{ stroke: "rgba(255,255,255,0.05)" }} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={{ stroke: "rgba(255,255,255,0.05)" }} tickLine={false}
                tickFormatter={(v) => `${v}kW`} />
              <RechartsTooltip contentStyle={{
                backgroundColor: "#1e293b", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px", fontSize: "12px", color: "#e2e8f0",
              }} />
              <Legend wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
              <Bar dataKey="pvPower" name="Geração FV" fill="#f59e0b" radius={[2, 2, 0, 0]} />
              <Bar dataKey="batteryPower" name="Potência Bat." fill="#3b82f6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Alarms + Events ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Alarms */}
        <Card className={`border-white/5 bg-card ${activeAlarms.length > 0 ? "border-destructive/20" : ""}`}>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <AlertTriangle size={14} className={activeAlarms.length > 0 ? "text-destructive" : "text-primary"} />
              Alarmes ({activeAlarms.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {activeAlarms.length === 0 ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <Shield className="w-4 h-4 text-primary" />
                <span className="text-xs text-primary">Nenhum alarme ativo</span>
              </div>
            ) : (
              <div className="space-y-2">
                {activeAlarms.map((alarm: any) => (
                  <div key={alarm.id} className="flex items-center gap-2 p-2 rounded bg-muted/30 border border-white/5">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 shrink-0"
                      style={{
                        color: alarm.severity === "CRITICAL" ? "#ef4444" : alarm.severity === "WARNING" ? "#f59e0b" : "#3b82f6",
                        borderColor: alarm.severity === "CRITICAL" ? "rgba(239,68,68,0.3)" : alarm.severity === "WARNING" ? "rgba(245,158,11,0.3)" : "rgba(59,130,246,0.3)",
                        backgroundColor: alarm.severity === "CRITICAL" ? "rgba(239,68,68,0.1)" : alarm.severity === "WARNING" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)",
                      }}>
                      {alarm.severity}
                    </Badge>
                    <span className="text-xs text-foreground/70 flex-1 truncate">{alarm.description}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Events */}
        <Card className="lg:col-span-2 border-white/5 bg-card">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock size={14} className="text-yellow-500" />
              Últimos Eventos
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
              {displayedEvents.map((evt: any) => (
                <div key={evt.id} className="flex items-start gap-2 p-1.5 rounded hover:bg-muted/30 transition-colors">
                  <EventBadge type={evt.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-foreground/80 truncate">{evt.description}</p>
                    <p className="text-[10px] text-muted-foreground">{timeAgo(evt.createdAt)}</p>
                  </div>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground border-white/5 shrink-0">
                    {evt.type}
                  </Badge>
                </div>
              ))}
            </div>
            {events && events.length > 8 && (
              <Button variant="ghost" size="sm"
                className="w-full mt-2 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowAllEvents(!showAllEvents)}>
                {showAllEvents ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {showAllEvents ? "Mostrar menos" : `Ver todos (${events.length})`}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Configuration ── */}
      <Card className="border-white/5 bg-card">
        <CardHeader className="pb-2 pt-3 px-4 cursor-pointer" onClick={() => setShowConfig(!showConfig)}>
          <CardTitle className="text-sm text-muted-foreground flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings size={14} className="text-muted-foreground" />
              Configuração de Limites SOC
            </div>
            {showConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </CardTitle>
        </CardHeader>
        {showConfig && (
          <CardContent className="px-4 pb-4 space-y-4">
            {/* Presets */}
            <div className="flex gap-2">
              {["conservador", "padrao", "agressivo"].map((p) => (
                <Button key={p} variant={configForm.presetName === p ? "default" : "outline"}
                  size="sm" className="text-xs capitalize flex-1"
                  onClick={() => applyPreset(p)}>
                  {p === "padrao" ? "Padrão" : p.charAt(0).toUpperCase() + p.slice(1)}
                </Button>
              ))}
            </div>

            {/* Sliders */}
            <div className="space-y-3">
              <ConfigSlider label="SOC Desligamento" value={configForm.socLowLimit}
                min={5} max={50} step={1} unit="%" color="#ef4444"
                onChange={(v) => updateFormField("socLowLimit", v)}
                description="Desliga a carga quando SOC cair abaixo deste valor" />
              <ConfigSlider label="SOC Religação" value={configForm.socHighLimit}
                min={10} max={60} step={1} unit="%" color="#22c55e"
                onChange={(v) => updateFormField("socHighLimit", v)}
                description="Religa a carga quando SOC subir acima deste valor" />
              <ConfigSlider label="Cooldown" value={configForm.cooldownMinutes}
                min={1} max={30} step={1} unit=" min" color="#f59e0b"
                onChange={(v) => updateFormField("cooldownMinutes", v)}
                description="Tempo mínimo entre acionamentos para proteger o contator" />
            </div>

            {!histeresisValid && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg border border-destructive/30 bg-destructive/5">
                <AlertTriangle size={14} className="text-destructive shrink-0" />
                <p className="text-xs text-destructive">
                  A diferença entre os limites deve ser de pelo menos <strong>5 pontos percentuais</strong>.
                  Atual: {histeresisGap} p.p.
                </p>
              </div>
            )}

            {/* SOC Zone Bar */}
            <div className="h-6 rounded-full overflow-hidden flex">
              <div className="h-full flex items-center justify-center text-[9px] font-bold text-white"
                style={{ width: `${configForm.socLowLimit}%`, backgroundColor: "#ef4444" }}>
                {configForm.socLowLimit > 10 ? `≤${configForm.socLowLimit}%` : ""}
              </div>
              <div className="h-full flex items-center justify-center text-[9px] font-bold text-white"
                style={{ width: `${configForm.socHighLimit - configForm.socLowLimit}%`, backgroundColor: "#f59e0b" }}>
                {histeresisGap > 8 ? "Zona morta" : ""}
              </div>
              <div className="h-full flex items-center justify-center text-[9px] font-bold text-white"
                style={{ width: `${100 - configForm.socHighLimit}%`, backgroundColor: "#22c55e" }}>
                {100 - configForm.socHighLimit > 15 ? `≥${configForm.socHighLimit}%` : ""}
              </div>
            </div>

            <Button className="w-full" disabled={!histeresisValid || updateConfigMutation.isPending}
              onClick={() => updateConfigMutation.mutate({ slug, ...configForm })}>
              {updateConfigMutation.isPending ? "Salvando..." : "Salvar Configuração"}
            </Button>
          </CardContent>
        )}
      </Card>

      {/* ── Statistics Footer ── */}
      {stats && (
        <Card className="border-white/5 bg-card">
          <CardContent className="p-3">
            <div className="flex items-center justify-between text-xs flex-wrap gap-2">
              <div className="flex items-center gap-4 md:gap-6">
                <span className="text-muted-foreground">
                  Leituras: <span className="text-foreground font-mono">{stats.count}</span>
                </span>
                <span className="text-muted-foreground">
                  Média: <span className="text-blue-500 font-mono">{stats.avg}%</span>
                </span>
                <span className="text-muted-foreground">
                  Mín: <span className="text-destructive font-mono">{stats.min}%</span>
                </span>
                <span className="text-muted-foreground">
                  Máx: <span className="text-primary font-mono">{stats.max}%</span>
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Atualização automática a cada 30s
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
