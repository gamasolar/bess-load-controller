import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import {
  Battery,
  BatteryCharging,
  Sun,
  Droplets,
  Mountain,
  AlertTriangle,
  ArrowRight,
  Zap,
  Thermometer,
  Wifi,
  WifiOff,
  Power,
  PowerOff,
  Activity,
} from "lucide-react";

function SiteCard({ site }: { site: any }) {
  const [, setLocation] = useLocation();
  const soc = site.currentSoc ?? 0;
  const socColor = soc > 50 ? "#22c55e" : soc > 25 ? "#f59e0b" : "#ef4444";
  const isActive = site.loadStatus === "on";
  const SiteIcon = site.slug === "piscinao" ? Droplets : Mountain;

  const healthColors: Record<string, string> = {
    healthy: "#22c55e",
    attention: "#f59e0b",
    degraded: "#f97316",
    critical: "#ef4444",
  };
  const healthLabels: Record<string, string> = {
    healthy: "Saudável",
    attention: "Atenção",
    degraded: "Degradado",
    critical: "Crítico",
  };
  const healthColor = healthColors[site.healthStatus] ?? "#22c55e";

  return (
    <Card
      className="border-white/5 bg-card hover:bg-accent/30 transition-all cursor-pointer group"
      onClick={() => setLocation(`/site/${site.slug}`)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${healthColor}15` }}
            >
              <SiteIcon className="w-5 h-5" style={{ color: healthColor }} />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">{site.name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {site.bessCount}x {site.bessModel} ({site.bessCapacityKwh} kWh)
              </p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* SOC Bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Battery className="w-3.5 h-3.5" />
              Estado de Carga
            </span>
            <span className="text-sm font-bold font-mono" style={{ color: socColor }}>
              {soc.toFixed(1)}%
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.max(2, soc)}%`,
                background: `linear-gradient(90deg, ${socColor}cc, ${socColor})`,
              }}
            />
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
            <Sun className="w-3.5 h-3.5 text-yellow-500" />
            <div>
              <p className="text-[10px] text-muted-foreground">Geração FV</p>
              <p className="text-xs font-semibold font-mono">
                {(site.currentPvPower ?? 0).toFixed(1)} kW
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
            <BatteryCharging className="w-3.5 h-3.5 text-blue-500" />
            <div>
              <p className="text-[10px] text-muted-foreground">Potência Bat.</p>
              <p className="text-xs font-semibold font-mono">
                {(site.currentBatteryPower ?? 0).toFixed(1)} kW
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
            <Zap className="w-3.5 h-3.5 text-orange-500" />
            <div>
              <p className="text-[10px] text-muted-foreground">Consumo</p>
              <p className="text-xs font-semibold font-mono">
                {(site.currentLoadPower ?? 0).toFixed(1)} kW
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
            <Droplets className="w-3.5 h-3.5 text-cyan-500" />
            <div>
              <p className="text-[10px] text-muted-foreground">Bombas</p>
              <p className="text-xs font-semibold font-mono">
                {site.pumpCount}x {site.pumpPowerCv}cv
              </p>
            </div>
          </div>
        </div>

        {/* Status Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-[10px] gap-1 px-2 py-0.5"
              style={{
                color: isActive ? "#22c55e" : "#ef4444",
                borderColor: isActive ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
                backgroundColor: isActive ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              }}
            >
              {isActive ? <Power className="w-2.5 h-2.5" /> : <PowerOff className="w-2.5 h-2.5" />}
              {isActive ? "LIGADA" : "DESLIGADA"}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] gap-1 px-2 py-0.5"
              style={{
                color: healthColor,
                borderColor: `${healthColor}30`,
                backgroundColor: `${healthColor}10`,
              }}
            >
              <Activity className="w-2.5 h-2.5" />
              {healthLabels[site.healthStatus] ?? "—"}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            {site.controlMode === "auto_mqtt" && (
              site.mqttConnected ? (
                <Wifi className="w-3.5 h-3.5 text-primary" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-destructive" />
              )
            )}
            <Badge
              variant="outline"
              className="text-[10px] px-2 py-0.5"
              style={{
                color: site.mode === "auto" ? "#3b82f6" : "#f59e0b",
                borderColor: site.mode === "auto" ? "rgba(59,130,246,0.3)" : "rgba(245,158,11,0.3)",
                backgroundColor: site.mode === "auto" ? "rgba(59,130,246,0.1)" : "rgba(245,158,11,0.1)",
              }}
            >
              {site.mode === "auto" ? "AUTO" : "MANUAL"}
            </Badge>
          </div>
        </div>

        {/* Alarms */}
        {site.activeAlarms > 0 && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/5 border border-destructive/20">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
            <span className="text-xs text-destructive">
              {site.activeAlarms} alarme{site.activeAlarms > 1 ? "s" : ""} ativo{site.activeAlarms > 1 ? "s" : ""}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SiteCardSkeleton() {
  return (
    <Card className="border-white/5 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-2.5 w-full rounded-full" />
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </Card>
  );
}

export default function Overview() {
  const { data: sites, isLoading } = trpc.bess.sites.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: alarms } = trpc.bess.alarms.useQuery({}, {
    refetchInterval: 60_000,
  });

  // Calculate totals
  const totalCapacity = sites?.reduce((sum, s) => sum + s.bessCount * s.bessCapacityKwh, 0) ?? 0;
  const avgSoc = sites?.length
    ? Math.round((sites.reduce((sum, s) => sum + s.currentSoc, 0) / sites.length) * 10) / 10
    : 0;
  const totalPv = sites?.reduce((sum, s) => sum + (s.currentPvPower ?? 0), 0) ?? 0;
  const totalLoad = sites?.reduce((sum, s) => sum + (s.currentLoadPower ?? 0), 0) ?? 0;
  const totalAlarms = alarms?.length ?? 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Visão Geral</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitoramento em tempo real dos sistemas BESS
          </p>
        </div>
        <Badge variant="outline" className="text-xs gap-1.5 px-3 py-1.5 text-muted-foreground">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Atualização a cada 30s
        </Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-white/5 bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Battery className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Capacidade Total</p>
                <p className="text-lg font-bold font-mono">{totalCapacity} <span className="text-xs text-muted-foreground font-normal">kWh</span></p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-white/5 bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(59,130,246,0.1)" }}>
                <BatteryCharging className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">SOC Médio</p>
                <p className="text-lg font-bold font-mono">{avgSoc}<span className="text-xs text-muted-foreground font-normal">%</span></p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-white/5 bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(245,158,11,0.1)" }}>
                <Sun className="w-4 h-4 text-yellow-500" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Geração FV</p>
                <p className="text-lg font-bold font-mono">{totalPv.toFixed(1)} <span className="text-xs text-muted-foreground font-normal">kW</span></p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-white/5 bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: totalAlarms > 0 ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)" }}>
                <AlertTriangle className="w-4 h-4" style={{ color: totalAlarms > 0 ? "#ef4444" : "#22c55e" }} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Alarmes</p>
                <p className="text-lg font-bold font-mono" style={{ color: totalAlarms > 0 ? "#ef4444" : "#22c55e" }}>
                  {totalAlarms} <span className="text-xs text-muted-foreground font-normal">ativos</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Site Cards */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Sites Monitorados
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {isLoading ? (
            <>
              <SiteCardSkeleton />
              <SiteCardSkeleton />
            </>
          ) : (
            sites?.map((site) => <SiteCard key={site.id} site={site} />)
          )}
        </div>
      </div>

      {/* Global Alarms */}
      {alarms && alarms.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Alarmes Ativos
          </h2>
          <Card className="border-destructive/20 bg-card">
            <CardContent className="p-4 space-y-2">
              {alarms.map((alarm: any) => (
                <div
                  key={alarm.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 border border-white/5"
                >
                  <Badge
                    variant="outline"
                    className="text-[10px] px-2 py-0.5 shrink-0"
                    style={{
                      color: alarm.severity === "CRITICAL" ? "#ef4444" : alarm.severity === "WARNING" ? "#f59e0b" : "#3b82f6",
                      borderColor: alarm.severity === "CRITICAL" ? "rgba(239,68,68,0.3)" : alarm.severity === "WARNING" ? "rgba(245,158,11,0.3)" : "rgba(59,130,246,0.3)",
                      backgroundColor: alarm.severity === "CRITICAL" ? "rgba(239,68,68,0.1)" : alarm.severity === "WARNING" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)",
                    }}
                  >
                    {alarm.severity}
                  </Badge>
                  <span className="text-xs font-mono text-muted-foreground">{alarm.type}</span>
                  <span className="text-xs text-foreground/70 flex-1">{alarm.description}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* System Info */}
      <Card className="border-white/5 bg-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-6">
              <span>Sites: <span className="text-foreground font-mono">{sites?.length ?? 0}</span></span>
              <span>BESS Total: <span className="text-foreground font-mono">{sites?.reduce((s, site) => s + site.bessCount, 0) ?? 0}</span></span>
              <span>Capacidade: <span className="text-foreground font-mono">{totalCapacity} kWh</span></span>
            </div>
            <span className="text-[10px]">
              BESS Load Controller v2.0 — Gama Solar
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
