import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type ConfigShape = {
  socMinDesliga: number;
  socMinReliga: number;
  socBlackout: number;
  horarioLiberacao: string;
  horarioCorte: string;
  margemZonaCritica: number;
  intervaloPadrao: number;
  intervaloCritico: number;
  intervaloNoturno: number;
  intervaloBombaSemSolar: number;
  cooldownAcao: number;
  maxSemTelemetria: number;
};

export function ConfigModalV2({
  open, onOpenChange, slug, initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slug: string;
  initial: ConfigShape;
}) {
  const [form, setForm] = useState<ConfigShape>(initial);
  const utils = trpc.useUtils();

  useEffect(() => { setForm(initial); }, [initial, open]);

  const update = trpc.bess.updateConfigV2.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success(res.message);
        utils.bess.getSiteStatus.invalidate({ slug });
        onOpenChange(false);
      } else {
        toast.error(res.message);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const setField = <K extends keyof ConfigShape>(k: K, v: ConfigShape[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const numberFields: { k: keyof ConfigShape; label: string; min: number; max: number; suffix?: string }[] = [
    { k: "socBlackout", label: "Blackout (SOC mínimo absoluto)", min: 5, max: 40, suffix: "%" },
    { k: "socMinDesliga", label: "Desliga abaixo de", min: 5, max: 60, suffix: "%" },
    { k: "socMinReliga", label: "Religa acima de", min: 10, max: 80, suffix: "%" },
    { k: "margemZonaCritica", label: "Margem zona crítica", min: 0, max: 20, suffix: "p.p." },
    { k: "intervaloPadrao", label: "Intervalo padrão de polling", min: 2, max: 60, suffix: "min" },
    { k: "intervaloCritico", label: "Intervalo crítico de polling", min: 1, max: 15, suffix: "min" },
    { k: "intervaloNoturno", label: "Intervalo fora do horário (bomba OFF)", min: 15, max: 240, suffix: "min" },
    { k: "intervaloBombaSemSolar", label: "Intervalo fora do horário (bomba ON, sem solar)", min: 1, max: 30, suffix: "min" },
    { k: "cooldownAcao", label: "Cooldown entre ações", min: 1, max: 30, suffix: "min" },
    { k: "maxSemTelemetria", label: "Máximo sem telemetria", min: 5, max: 120, suffix: "min" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configuração — {slug}</DialogTitle>
          <DialogDescription>
            Parâmetros do control-engine. Histerese mínima: 3 p.p. entre desliga e religa.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {numberFields.map(({ k, label, min, max, suffix }) => (
            <div key={k} className="grid grid-cols-2 items-center gap-3">
              <Label htmlFor={k}>{label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={k}
                  type="number"
                  min={min}
                  max={max}
                  value={form[k] as number}
                  onChange={(e) => setField(k, Number(e.target.value) as any)}
                  className="font-mono"
                />
                {suffix && <span className="text-xs text-muted-foreground w-10">{suffix}</span>}
              </div>
            </div>
          ))}

          <div className="grid grid-cols-2 items-center gap-3">
            <Label htmlFor="horarioLiberacao">Janela de operação</Label>
            <div className="flex items-center gap-2">
              <Input id="horarioLiberacao" type="time" value={form.horarioLiberacao}
                onChange={(e) => setField("horarioLiberacao", e.target.value)} className="font-mono" />
              <span className="text-xs">→</span>
              <Input type="time" value={form.horarioCorte}
                onChange={(e) => setField("horarioCorte", e.target.value)} className="font-mono" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>Cancelar</Button>
          <Button onClick={() => update.mutate({ slug, ...form })} disabled={update.isPending}>
            {update.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
