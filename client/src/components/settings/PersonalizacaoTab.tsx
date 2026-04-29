import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Battery, Save, Check } from "lucide-react";
import { toast } from "sonner";
import { BackgroundUpload } from "./BackgroundUpload";
import {
  MotorPresetView,
  MOTOR_PRESET_OPTIONS,
  DEFAULT_MOTOR_PRESET,
  type MotorPreset,
} from "@/components/v2/motor-presets";

interface SiteRow {
  id: number;
  slug: string;
  name: string;
  isActive: boolean;
  backgroundUrl: string | null;
  cardCustomization: { motorPreset?: string } | null;
  pumpPowerCv?: number;
  pumpCount?: number;
}

export function PersonalizacaoTab() {
  const sitesQuery = trpc.sites.list.useQuery();
  if (sitesQuery.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!sitesQuery.data?.length) return <p className="text-sm text-muted-foreground">Nenhuma microrrede cadastrada.</p>;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          Personalização visual <strong>por microrrede</strong> — Piscinão e Barragem podem ter visuais diferentes.
        </p>
      </div>
      {sitesQuery.data.map((site: any) => (
        <SitePersonalization key={site.id} site={site} />
      ))}
    </div>
  );
}

function SitePersonalization({ site }: { site: SiteRow }) {
  const utils = trpc.useUtils();
  const update = trpc.sites.update.useMutation({
    onSuccess: () => {
      toast.success("Personalização salva");
      utils.sites.list.invalidate();
      utils.bess.getSiteStatus.invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao salvar"),
  });

  const initial = (site.cardCustomization?.motorPreset as MotorPreset) ?? DEFAULT_MOTOR_PRESET;
  const [preset, setPreset] = useState<MotorPreset>(
    initial === "C" || initial === "E" || initial === "G" || initial === "I" ? initial : DEFAULT_MOTOR_PRESET,
  );
  const dirty = preset !== initial;

  const handleSave = () => {
    const next = { ...(site.cardCustomization ?? {}), motorPreset: preset };
    update.mutate({ id: site.id, cardCustomization: next });
  };

  return (
    <Card className="border-zinc-800">
      <CardContent className="p-4 space-y-5">
        <div className="flex items-center gap-3">
          <Battery className="w-4 h-4 text-emerald-400" />
          <div className="flex-1">
            <h3 className="text-base font-semibold">{site.name}</h3>
            <p className="text-[11px] text-muted-foreground font-mono">{site.slug}{!site.isActive && " · INATIVO"}</p>
          </div>
        </div>

        {/* Motor preset picker */}
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Visual do motor</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {MOTOR_PRESET_OPTIONS.map((opt) => {
              const selected = preset === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setPreset(opt.key)}
                  className={`relative rounded-lg border-2 p-2 transition-all ${
                    selected
                      ? "border-emerald-500/70 bg-emerald-500/5"
                      : "border-zinc-800 hover:border-zinc-700 bg-zinc-900/40"
                  }`}
                >
                  {selected && (
                    <div className="absolute top-1.5 right-1.5 bg-emerald-500 rounded-full p-0.5">
                      <Check className="w-2.5 h-2.5 text-black" />
                    </div>
                  )}
                  <div className="flex justify-center mb-1.5 scale-75 origin-top">
                    <MotorPresetView
                      preset={opt.key}
                      loadHealth="RUNNING_OK"
                      loadPower={32.5}
                      loadFailureSince={null}
                      loadHistory={[24, 28, 30, 31, 29, 32, 33, 32, 31, 32, 33, 32.5]}
                      pumpPowerCv={site.pumpPowerCv ?? 30}
                      pumpCount={site.pumpCount ?? 1}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] font-semibold">{opt.label}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-2">{opt.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
          {dirty && (
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={handleSave} disabled={update.isPending} className="gap-1.5">
                <Save className="w-3.5 h-3.5" />
                {update.isPending ? "Salvando…" : "Salvar visual do motor"}
              </Button>
            </div>
          )}
        </div>

        {/* Background upload (movido da aba Sites) */}
        <div className="space-y-2 border-t border-white/5 pt-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Fundo do card (imagem ou vídeo)</p>
          <BackgroundUpload site={{ id: site.id, backgroundUrl: site.backgroundUrl }} />
        </div>
      </CardContent>
    </Card>
  );
}
