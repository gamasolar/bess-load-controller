import { trpc } from "@/lib/trpc";
import { PlantCardV2 } from "@/components/v2/PlantCardV2";
import { AlertBanner } from "@/components/v2/AlertBanner";

export default function Home() {
  const { data: sites, isLoading, error } = trpc.bess.sites.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const visibleSites = sites ?? [];

  return (
    <div className="space-y-4 max-w-5xl mx-auto px-3 md:px-0 py-4">
      {/* Header — esquerda: contagem · direita: título alinhado */}
      <div className="flex items-end justify-between gap-4 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono">
            {visibleSites.length} {visibleSites.length === 1 ? "usina" : "usinas"} em operação
          </span>
        </div>
        <div className="text-right">
          <h1 className="text-lg md:text-xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            BESS Load Controller
          </h1>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mt-0.5">
            Monitoramento e controle das microrredes
          </p>
        </div>
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
