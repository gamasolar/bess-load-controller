import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Server, Wifi, Battery, Cpu, HardDrive, Clock, Shield, Info,
  CheckCircle2, XCircle, AlertTriangle, ExternalLink, Save, Pencil, X,
} from "lucide-react";

function StatusBadge({ status }: { status: "online" | "offline" | "warning" | "pending" }) {
  const config = {
    online: { label: "Online", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
    offline: { label: "Offline", className: "bg-red-500/10 text-red-400 border-red-500/30" },
    warning: { label: "Atenção", className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" },
    pending: { label: "Pendente", className: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  };
  const c = config[status];
  return <Badge variant="outline" className={c.className}>{c.label}</Badge>;
}

function InfoRow({ label, value, icon: Icon, status }: {
  label: string; value: string; icon?: any; status?: "online" | "offline" | "warning" | "pending";
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono">{value}</span>
        {status && <StatusBadge status={status} />}
      </div>
    </div>
  );
}

// ── Device ID Configuration Component ──
function DeviceIdConfig({ site, onSaved }: {
  site: {
    slug: string;
    name: string;
    fusionsolarPlantCode: string;
    fusionsolarDeviceIds: string;
    fusionsolarInverterIds: string;
    mqttTopic: string;
  };
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [batteryIds, setBatteryIds] = useState(site.fusionsolarDeviceIds || "");
  const [inverterIds, setInverterIds] = useState(site.fusionsolarInverterIds || "");
  const [plantCode, setPlantCode] = useState(site.fusionsolarPlantCode || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const configureSite = trpc.bess.configureSite.useMutation();

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await configureSite.mutateAsync({
        slug: site.slug,
        fusionsolarDeviceIds: batteryIds.trim() || undefined,
        fusionsolarInverterIds: inverterIds.trim() || undefined,
        fusionsolarPlantCode: plantCode.trim() || undefined,
      });
      if (result.success) {
        setMessage({ type: "success", text: "Configuração salva com sucesso!" });
        setEditing(false);
        onSaved();
      } else {
        setMessage({ type: "error", text: result.message });
      }
    } catch (e) {
      setMessage({ type: "error", text: "Erro ao salvar configuração." });
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setBatteryIds(site.fusionsolarDeviceIds || "");
    setInverterIds(site.fusionsolarInverterIds || "");
    setPlantCode(site.fusionsolarPlantCode || "");
    setEditing(false);
    setMessage(null);
  };

  // Parse JSON arrays for display
  const parsedBatteryIds = (() => {
    try { return JSON.parse(site.fusionsolarDeviceIds || "[]"); } catch { return []; }
  })();
  const parsedInverterIds = (() => {
    try { return JSON.parse(site.fusionsolarInverterIds || "[]"); } catch { return []; }
  })();

  return (
    <div className="p-3 rounded-lg bg-background/50 border border-border/30">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">{site.name}</span>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing(true)}
          >
            <Pencil className="w-3 h-3 mr-1" /> Editar
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Plant Code:</span>
            <span className="font-mono text-foreground">{site.fusionsolarPlantCode || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Battery Device IDs:</span>
            <span className="font-mono text-foreground">
              {parsedBatteryIds.length > 0 ? parsedBatteryIds.join(", ") : <span className="text-yellow-400">Não configurado</span>}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Inverter Device IDs:</span>
            <span className="font-mono text-foreground">
              {parsedInverterIds.length > 0 ? parsedInverterIds.join(", ") : <span className="text-yellow-400">Não configurado</span>}
            </span>
          </div>
          <div className="flex justify-between">
            <span>MQTT Topic:</span>
            <span className="font-mono text-foreground">{site.mqttTopic || "—"}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Plant Code</label>
            <Input
              value={plantCode}
              onChange={(e) => setPlantCode(e.target.value)}
              placeholder="Ex: NE=54174510"
              className="h-8 text-xs font-mono bg-background/80"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Battery Device IDs <span className="text-muted-foreground/60">(JSON array, ex: ["12345"])</span>
            </label>
            <Input
              value={batteryIds}
              onChange={(e) => setBatteryIds(e.target.value)}
              placeholder='["device_id_1", "device_id_2"]'
              className="h-8 text-xs font-mono bg-background/80"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Inverter Device IDs <span className="text-muted-foreground/60">(JSON array, ex: ["67890"])</span>
            </label>
            <Input
              value={inverterIds}
              onChange={(e) => setInverterIds(e.target.value)}
              placeholder='["device_id_1"]'
              className="h-8 text-xs font-mono bg-background/80"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="w-3 h-3 mr-1" />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleCancel}
              disabled={saving}
            >
              <X className="w-3 h-3 mr-1" /> Cancelar
            </Button>
          </div>
        </div>
      )}

      {message && (
        <div className={`mt-2 text-xs px-2 py-1 rounded ${
          message.type === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
        }`}>
          {message.text}
        </div>
      )}
    </div>
  );
}

export default function SystemInfo() {
  const { data: sites = [], refetch: refetchSites } = trpc.bess.sites.useQuery();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sistema</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Informações do sistema, conexões e documentação
        </p>
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Server className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Dashboard</p>
              <p className="text-sm font-medium">Operacional</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Banco de Dados</p>
              <p className="text-sm font-medium">Conectado</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <Wifi className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">MQTT Broker</p>
              <p className="text-sm font-medium">Configurado</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">FusionSolar API</p>
              <p className="text-sm font-medium">Integrado</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Connection Details */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Wifi className="w-4 h-4 text-primary" />
              Conexões
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow icon={Server} label="VPS Hostinger" value="92.112.179.225" status="online" />
            <InfoRow icon={Wifi} label="MQTT Broker" value="92.112.179.225:1883" status="online" />
            <InfoRow icon={Shield} label="MQTT Usuário" value="bess_user" />
            <InfoRow icon={Cpu} label="Protocolo MQTT" value="Mosquitto v2.x" />
            <InfoRow icon={Clock} label="Porta WebSocket" value="9001" />
            <InfoRow icon={HardDrive} label="FusionSolar API" value="Northbound API v6" status="online" />
          </CardContent>
        </Card>

        {/* FusionSolar Device IDs Configuration */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              FusionSolar — Device IDs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground mb-2 p-2 rounded bg-yellow-500/5 border border-yellow-500/20">
              <p className="font-medium text-yellow-400 mb-1">Como encontrar os Device IDs:</p>
              <p>1. Acesse o portal FusionSolar web</p>
              <p>2. Vá em <span className="font-mono text-foreground">Gestão da instalação</span> e clique na usina</p>
              <p>3. Clique no dispositivo (bateria ou inversor)</p>
              <p>4. Na URL do navegador, copie o parâmetro <span className="font-mono text-foreground">devId</span></p>
              <p>5. Cole aqui no formato JSON: <span className="font-mono text-foreground">["devId"]</span></p>
            </div>
            {sites.map(site => (
              <DeviceIdConfig
                key={site.id}
                site={{
                  slug: site.slug,
                  name: site.name,
                  fusionsolarPlantCode: site.fusionsolarPlantCode ?? "",
                  fusionsolarDeviceIds: site.fusionsolarDeviceIds ?? "",
                  fusionsolarInverterIds: site.fusionsolarInverterIds ?? "",
                  mqttTopic: site.mqttTopic ?? "",
                }}
                onSaved={() => refetchSites()}
              />
            ))}
          </CardContent>
        </Card>

        {/* Sites Configuration */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Battery className="w-4 h-4 text-primary" />
              Sites Configurados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sites.map(site => (
              <div key={site.id} className="p-3 rounded-lg bg-background/50 border border-border/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{site.name}</span>
                  <StatusBadge status={site.sonoffOnline ? "online" : "offline"} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>BESS: {site.bessCount}x LUNA2000-215KWH</div>
                  <div>Capacidade: {site.bessCapacityKwh} kWh</div>
                  <div>Bombas: {site.pumpCount}x {site.pumpPowerCv}cv</div>
                  <div>Modo: {site.controlMode === "auto_mqtt" ? "Automático (MQTT)" : site.controlMode === "auto_future" ? "Automático (Futuro)" : "Manual"}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Architecture */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="w-4 h-4 text-primary" />
              Arquitetura do Sistema
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                <p className="font-medium text-emerald-400 mb-1">Fluxo de Dados</p>
                <div className="space-y-1 text-xs text-muted-foreground font-mono">
                  <p>FusionSolar API → Dashboard (leitura SOC, potência, temperatura)</p>
                  <p>Dashboard → MQTT Broker → Sonoff Tasmota (comando ligar/desligar)</p>
                  <p>Sonoff Tasmota → MQTT Broker → Dashboard (confirmação estado)</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                <p className="font-medium text-blue-400 mb-1">Rede</p>
                <div className="space-y-1 text-xs text-muted-foreground font-mono">
                  <p>Usina (Starlink) → Internet → VPS Hostinger (MQTT)</p>
                  <p>Sonoff inicia conexão de saída (resolve CGNAT)</p>
                  <p>Dashboard acessa VPS via HTTPS</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                <p className="font-medium text-yellow-400 mb-1">Controle de Carga</p>
                <div className="space-y-1 text-xs text-muted-foreground font-mono">
                  <p>Piscinão: 1x bomba 100cv — controle MANUAL</p>
                  <p>Barragem: 2x bomba 30cv — controle AUTOMÁTICO via Sonoff</p>
                  <p>Limites: SOC mín. 20% (desliga) / SOC máx. 80% (liga)</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Reference */}
        <Card className="bg-card/50 border-border/50 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" />
              Referência Rápida
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                <p className="font-medium text-emerald-400 mb-2">Comandos MQTT (via SSH na VPS)</p>
                <div className="space-y-1.5 text-xs text-muted-foreground font-mono">
                  <p># Monitorar mensagens:</p>
                  <p className="text-foreground">mosquitto_sub -h localhost -u bess_user -P "***" -t "#" -v</p>
                  <p className="mt-2"># Ligar Sonoff:</p>
                  <p className="text-foreground">mosquitto_pub -h localhost -u bess_user -P "***" -t "cmnd/bess_sonoff/POWER" -m "ON"</p>
                  <p className="mt-2"># Desligar Sonoff:</p>
                  <p className="text-foreground">mosquitto_pub -h localhost -u bess_user -P "***" -t "cmnd/bess_sonoff/POWER" -m "OFF"</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                <p className="font-medium text-blue-400 mb-2">Tasmota — Tópicos MQTT</p>
                <div className="space-y-1 text-xs text-muted-foreground font-mono">
                  <p>Comando: <span className="text-foreground">cmnd/bess_sonoff/POWER</span></p>
                  <p>Estado: <span className="text-foreground">stat/bess_sonoff/POWER</span></p>
                  <p>Telemetria: <span className="text-foreground">tele/bess_sonoff/STATE</span></p>
                  <p>LWT: <span className="text-foreground">tele/bess_sonoff/LWT</span></p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                <p className="font-medium text-purple-400 mb-2">Links Úteis</p>
                <div className="space-y-1.5 text-xs">
                  <a href="https://github.com/gamasolar/bess-controller" target="_blank" rel="noopener" className="flex items-center gap-1 text-blue-400 hover:underline">
                    <ExternalLink className="w-3 h-3" /> Repositório bess-controller (GitHub)
                  </a>
                  <a href="https://github.com/gamasolar/SIGA-BESS" target="_blank" rel="noopener" className="flex items-center gap-1 text-blue-400 hover:underline">
                    <ExternalLink className="w-3 h-3" /> Repositório SIGA-BESS (GitHub)
                  </a>
                  <a href="https://tasmota.github.io/docs/" target="_blank" rel="noopener" className="flex items-center gap-1 text-blue-400 hover:underline">
                    <ExternalLink className="w-3 h-3" /> Documentação Tasmota
                  </a>
                  <a href="https://mosquitto.org/documentation/" target="_blank" rel="noopener" className="flex items-center gap-1 text-blue-400 hover:underline">
                    <ExternalLink className="w-3 h-3" /> Documentação Mosquitto MQTT
                  </a>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
