import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AutomationConfigForm } from "@/components/v2/ConfigModalV2";

/**
 * Configurações → Automação: a mesma configuração do modal do cartão
 * (faixa de SOC, polling, cooldown, janela) e o modo automático/manual,
 * por planta. Usa as mesmas chamadas; nenhuma regra nova.
 */
export function AutomacaoTab() {
  const utils = trpc.useUtils();
  const { data: sites } = trpc.bess.sites.useQuery();
  const [picked, setPicked] = useState<string | null>(null);
  const slug = picked ?? sites?.[0]?.slug ?? "";
  const { data: s, isLoading } = trpc.bess.getSiteStatus.useQuery({ slug }, { enabled: !!slug, refetchInterval: 30_000 });

  const setMode = trpc.bess.setControlMode.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
      utils.bess.getSiteStatus.invalidate({ slug });
      utils.bess.getActions.invalidate({ slug });
    },
    onError: (e) => toast.error(e.message),
  });

  const hasAutomation = !!s?.site.mqttTopic;
  const online = !!s?.state.sonoffOnline && !!s?.state.mqttConnected;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(sites ?? []).map((x) => (
          <Button key={x.slug} size="sm" variant={x.slug === slug ? "default" : "outline"} onClick={() => setPicked(x.slug)}>
            {x.name}
          </Button>
        ))}
      </div>

      {isLoading || !s ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <Card>
            <CardContent className="p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">Modo de controle da bomba</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Agora em <strong>{s.config.controlMode === "AUTO" ? "automático" : "manual"}</strong>.{" "}
                  {!hasAutomation
                    ? "Esta planta não tem automação instalada: a bomba é operada no local."
                    : online ? "Automação com comunicação." : "Automação sem comunicação: comandos não chegam à bomba."}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  A proteção de blackout continua valendo mesmo em modo manual.
                </p>
              </div>
              <Button
                variant="outline"
                disabled={setMode.isPending}
                onClick={() => setMode.mutate({ slug, mode: s.config.controlMode === "AUTO" ? "MANUAL" : "AUTO" })}
              >
                {setMode.isPending ? "Alterando…" : `Mudar para ${s.config.controlMode === "AUTO" ? "manual" : "automático"}`}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 max-w-2xl">
              <h2 className="text-base font-semibold">Parâmetros da automação</h2>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                A bomba desliga quando o SOC chega ao limite de desliga e religa no limite de religa, dentro da janela.
                Histerese mínima: 3 p.p. entre desliga e religa.
              </p>
              <AutomationConfigForm slug={slug} initial={s.config} showGroupTitles />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
