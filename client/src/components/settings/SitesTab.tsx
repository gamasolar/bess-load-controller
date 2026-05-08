import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Battery, Power, AlertTriangle, MapPin } from "lucide-react";
import { GoogleMapPicker } from "./GoogleMapPicker";
import { toast } from "sonner";

type Site = {
  id: number; slug: string; name: string; description: string | null;
  bessCount: number; bessCapacityKwh: number; bessModel: string;
  pumpCount: number; pumpPowerCv: number; pumpDescription: string | null;
  controlMode: string; mqttTopic: string;
  fusionsolarPlantCode: string;
  fusionsolarDeviceIds: string;
  fusionsolarInverterIds: string;
  backgroundUrl: string | null;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
};

export function SitesTab() {
  const utils = trpc.useUtils();
  const { data: sites, isLoading } = trpc.sites.list.useQuery(undefined, { refetchInterval: 30_000 });
  const [editing, setEditing] = useState<Site | null>(null);

  const setActive = trpc.sites.setActive.useMutation({
    onSuccess: (res) => {
      toast.success(res.isActive ? "Site reativado — voltará ao dashboard" : "Site desativado — sumiu do dashboard e API");
      utils.sites.list.invalidate();
      utils.bess.sites.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando sites…</p>;
  }
  if (!sites?.length) {
    return <p className="text-sm text-muted-foreground">Nenhum site cadastrado.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Gerenciamento de sites BESS. Desativar um site oculta o card do dashboard e
        pausa todas as chamadas FusionSolar/MQTT/control. Reativar é instantâneo.
      </p>

      <div className="space-y-2">
        {sites.map((s) => (
          <Card key={s.id} className={s.isActive ? "border-white/10" : "border-zinc-800/60 bg-zinc-900/30"}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Battery className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-semibold truncate">{s.name}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">{s.slug}</Badge>
                    {s.isActive ? (
                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">ATIVO</Badge>
                    ) : (
                      <Badge variant="outline" className="text-zinc-500 text-[10px]">DESATIVADO</Badge>
                    )}
                  </div>
                  {s.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                    <span>BESS: {s.bessCount}× {s.bessModel} ({s.bessCapacityKwh} kWh ea.)</span>
                    <span>Bomba: {s.pumpCount}× {s.pumpPowerCv} CV</span>
                    <span>FusionSolar: {s.fusionsolarPlantCode ? `✓ ${s.fusionsolarPlantCode}` : "—"}</span>
                    <span>MQTT: {s.mqttTopic || "—"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost" size="sm" onClick={() => setEditing(s)}
                    className="gap-1.5 h-8"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </Button>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/5 bg-black/20">
                    <Power className={`w-3.5 h-3.5 ${s.isActive ? "text-emerald-400" : "text-zinc-500"}`} />
                    <Switch
                      checked={s.isActive}
                      onCheckedChange={(checked) => setActive.mutate({ id: s.id, isActive: checked })}
                      disabled={setActive.isPending}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing && <EditSiteDialog site={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditSiteDialog({ site, onClose }: { site: Site; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: site.name,
    description: site.description ?? "",
    bessCount: site.bessCount,
    bessCapacityKwh: site.bessCapacityKwh,
    bessModel: site.bessModel,
    pumpCount: site.pumpCount,
    pumpPowerCv: site.pumpPowerCv,
    pumpDescription: site.pumpDescription ?? "",
    mqttTopic: site.mqttTopic,
    fusionsolarPlantCode: site.fusionsolarPlantCode,
    fusionsolarDeviceIds: site.fusionsolarDeviceIds,
    fusionsolarInverterIds: site.fusionsolarInverterIds,
    lat: site.lat,
    lng: site.lng,
  });

  const update = trpc.sites.update.useMutation({
    onSuccess: () => {
      toast.success("Site atualizado");
      utils.sites.list.invalidate();
      utils.bess.sites.invalidate();
      utils.bess.getSiteStatus.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar {site.name}</DialogTitle>
          <DialogDescription>
            Slug <code className="text-xs bg-zinc-800 px-1 rounded">{site.slug}</code> não pode ser alterado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea id="description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" />
            </div>
          </div>

          <div className="border-t border-white/5 pt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">BESS</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="bessCount">Quant.</Label>
                <Input id="bessCount" type="number" min={1} max={64} value={form.bessCount} onChange={(e) => setForm({ ...form, bessCount: Number(e.target.value) })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="bessCapacityKwh">Capacidade (kWh ea.)</Label>
                <Input id="bessCapacityKwh" type="number" step="0.1" value={form.bessCapacityKwh} onChange={(e) => setForm({ ...form, bessCapacityKwh: Number(e.target.value) })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="bessModel">Modelo</Label>
                <Input id="bessModel" value={form.bessModel} onChange={(e) => setForm({ ...form, bessModel: e.target.value })} className="mt-1" />
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Bomba</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pumpCount">Quant.</Label>
                <Input id="pumpCount" type="number" min={0} max={32} value={form.pumpCount} onChange={(e) => setForm({ ...form, pumpCount: Number(e.target.value) })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="pumpPowerCv">Potência (CV)</Label>
                <Input id="pumpPowerCv" type="number" step="0.1" value={form.pumpPowerCv} onChange={(e) => setForm({ ...form, pumpPowerCv: Number(e.target.value) })} className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="pumpDescription">Descrição</Label>
                <Input id="pumpDescription" value={form.pumpDescription} onChange={(e) => setForm({ ...form, pumpDescription: e.target.value })} className="mt-1" />
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Integrações</p>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label htmlFor="mqttTopic">MQTT Topic (Automação)</Label>
                <Input id="mqttTopic" value={form.mqttTopic} placeholder="bess/barragem/pump" onChange={(e) => setForm({ ...form, mqttTopic: e.target.value })} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label htmlFor="fusionsolarPlantCode">FusionSolar Plant Code</Label>
                <Input id="fusionsolarPlantCode" value={form.fusionsolarPlantCode} onChange={(e) => setForm({ ...form, fusionsolarPlantCode: e.target.value })} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label htmlFor="fusionsolarDeviceIds">Device IDs (CSV)</Label>
                <Input id="fusionsolarDeviceIds" value={form.fusionsolarDeviceIds} onChange={(e) => setForm({ ...form, fusionsolarDeviceIds: e.target.value })} className="mt-1 font-mono text-xs" placeholder="2070XXXXX,2070YYYYY" />
              </div>
              <div>
                <Label htmlFor="fusionsolarInverterIds">Inverter IDs (CSV)</Label>
                <Input id="fusionsolarInverterIds" value={form.fusionsolarInverterIds} onChange={(e) => setForm({ ...form, fusionsolarInverterIds: e.target.value })} className="mt-1 font-mono text-xs" />
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" /> Localização da unidade
            </p>
            <GoogleMapPicker
              lat={form.lat}
              lng={form.lng}
              onChange={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))}
            />
          </div>

          <div className="rounded-md border border-zinc-700 bg-zinc-800/40 p-2.5 text-[11px] text-muted-foreground">
            Imagem/vídeo de fundo e visual do motor agora ficam na aba <strong>Personalização</strong>.
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200/80">
              Mudanças em integrações (MQTT/FusionSolar) afetam o controle em produção.
              Validar conexões antes de salvar em sites ativos.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => update.mutate({ id: site.id, ...form })} disabled={update.isPending}>
            {update.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

