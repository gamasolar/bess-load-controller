import { trpc } from "@/lib/trpc";
import { PlantCardV2 } from "@/components/v2/PlantCardV2";
import { AlertBanner } from "@/components/v2/AlertBanner";

export default function Home() {
  const { data: sites, isLoading, error } = trpc.bess.sites.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const visibleSites = (sites ?? []).filter(
    (s) => s.fusionsolarConfigured || !!s.mqttTopic,
  );

  return (
    <div className="space-y-4 max-w-5xl mx-auto px-3 md:px-0 py-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">BESS Load Controller</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Monitoramento e controle das microrredes
        </p>
      </div>

      <AlertBanner />

      {isLoading && (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando sites…</div>
      )}
      {error && (
        <div className="text-sm text-red-500 py-8 text-center">
          Erro ao carregar sites: {error.message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleSites.map((site) => (
          <PlantCardV2 key={site.id} slug={site.slug} />
        ))}
      </div>
    </div>
  );
}
