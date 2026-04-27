import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink, Send, Wifi } from "lucide-react";
import { toast } from "sonner";

export function WhatsappTab() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.whatsapp.getConfig.useQuery();
  const [form, setForm] = useState({ url: "", instance: "", apiKey: "", defaultTo: "" });

  useEffect(() => {
    if (data) setForm({
      url: data.url ?? "",
      instance: data.instance ?? "",
      apiKey: data.apiKey ?? "",
      defaultTo: data.defaultTo ?? "",
    });
  }, [data]);

  const save = trpc.whatsapp.saveConfig.useMutation({
    onSuccess: () => { toast.success("Configuração salva"); utils.whatsapp.getConfig.invalidate(); utils.whatsapp.connectionState.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const stateQ = trpc.whatsapp.connectionState.useQuery(undefined, {
    enabled: !!data?.url && !!data?.instance,
    refetchInterval: 15_000,
  });

  const [testMsg, setTestMsg] = useState("");
  const sendTest = trpc.whatsapp.sendTest.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success(`Mensagem enviada (HTTP ${res.status})`);
      else toast.error(`Falha ao enviar (HTTP ${res.status})`);
    },
    onError: (e) => toast.error(e.message),
  });

  const stateLabel = (() => {
    if (!stateQ.data) return null;
    if (stateQ.data.state === "ok") {
      const body: any = stateQ.data.body;
      const inner = body?.instance?.state ?? body?.state ?? "ok";
      const tone = inner === "open" ? "bg-emerald-500/15 text-emerald-300" : "bg-yellow-500/15 text-yellow-300";
      return <Badge className={tone}>{String(inner).toUpperCase()}</Badge>;
    }
    if (stateQ.data.state === "not_configured") return <Badge variant="outline">SEM INSTÂNCIA</Badge>;
    return <Badge className="bg-red-500/15 text-red-300">ERRO</Badge>;
  })();

  return (
    <div className="space-y-4">
      <Card className="border-white/5">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Evolution API</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure a conexão. O QR code é escaneado no painel do Evolution.
              </p>
            </div>
            {data?.url && (
              <a
                href={`${data.url.replace(/\/+$/, "")}/manager/`}
                target="_blank" rel="noreferrer"
                className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                Painel Evolution <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="wa-url">URL base</Label>
              <Input
                id="wa-url"
                placeholder="https://whatsapp-evolution-api.example.com"
                value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="wa-instance">Instância</Label>
              <Input
                id="wa-instance"
                placeholder="bess"
                value={form.instance} onChange={(e) => setForm({ ...form, instance: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="wa-key">API Key</Label>
              <Input
                id="wa-key"
                type="password"
                placeholder="sua chave Evolution"
                value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="wa-to">Destinatário padrão (E.164)</Label>
              <Input
                id="wa-to"
                placeholder="5531999999999"
                value={form.defaultTo} onChange={(e) => setForm({ ...form, defaultTo: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wifi className="w-3.5 h-3.5" /> Status: {stateLabel ?? <span className="text-zinc-500">—</span>}
            </div>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/5">
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-semibold">Enviar mensagem de teste</h2>
          <p className="text-xs text-muted-foreground">
            Envia para o destinatário padrão (ou outro número se preencher abaixo).
          </p>
          <div className="grid md:grid-cols-3 gap-2">
            <Input
              placeholder={form.defaultTo || "Número (E.164)"}
              value={form.defaultTo} onChange={(e) => setForm({ ...form, defaultTo: e.target.value })}
              className="font-mono text-xs"
            />
            <Input
              className="md:col-span-2"
              placeholder="Mensagem"
              value={testMsg} onChange={(e) => setTestMsg(e.target.value)}
            />
          </div>
          <Button
            className="gap-1.5"
            disabled={sendTest.isPending || !form.defaultTo || !testMsg}
            onClick={() => sendTest.mutate({ to: form.defaultTo, text: testMsg })}
          >
            <Send className="w-3.5 h-3.5" /> {sendTest.isPending ? "Enviando…" : "Enviar"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
