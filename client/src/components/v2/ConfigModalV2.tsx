import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export type ConfigShape = {
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
  overshootFactor: number;
};

/** Campos da automação, agrupados. Usado pelo modal e pela aba Configurações → Automação. */
const FIELD_GROUPS: {
  title: string;
  fields: { k: keyof ConfigShape; label: string; min: number; max: number; step?: number; suffix?: string; helpText?: string }[];
}[] = [
  {
    title: "Faixa de carga da bateria",
    fields: [
      { k: "socMinDesliga", label: "Desliga abaixo de", min: 5, max: 60, suffix: "%" },
      { k: "socMinReliga", label: "Religa acima de", min: 10, max: 80, suffix: "%" },
      { k: "socBlackout", label: "Blackout (SOC mínimo absoluto)", min: 5, max: 40, suffix: "%" },
      { k: "margemZonaCritica", label: "Margem zona crítica", min: 0, max: 20, suffix: "p.p." },
      {
        k: "overshootFactor",
        label: "Compensação de overshoot",
        min: 0, max: 0.2, step: 0.005, suffix: "pp/kW",
        helpText: "Antecipa o desligamento da bomba durante descarga alta pra absorver o overshoot do BMS. 0 = desligado. Valor sugerido: 0.050.",
      },
    ],
  },
  {
    title: "Leitura (polling)",
    fields: [
      { k: "intervaloPadrao", label: "Intervalo padrão de polling", min: 2, max: 60, suffix: "min" },
      { k: "intervaloCritico", label: "Intervalo crítico de polling", min: 1, max: 15, suffix: "min" },
      { k: "intervaloNoturno", label: "Intervalo fora do horário (bomba OFF)", min: 15, max: 240, suffix: "min" },
      { k: "intervaloBombaSemSolar", label: "Intervalo fora do horário (bomba ON, sem solar)", min: 1, max: 30, suffix: "min" },
    ],
  },
  {
    title: "Proteções",
    fields: [
      { k: "cooldownAcao", label: "Cooldown entre ações", min: 0, max: 30, suffix: "min" },
      { k: "maxSemTelemetria", label: "Máximo sem telemetria", min: 5, max: 120, suffix: "min" },
    ],
  },
];

export function AutomationConfigForm({
  slug, initial, resetKey, onSaved, onCancel, showGroupTitles = false,
}: {
  slug: string;
  initial: ConfigShape;
  /** Muda quando o formulário deve voltar aos valores salvos (ex.: reabrir o modal). */
  resetKey?: unknown;
  onSaved?: () => void;
  onCancel?: () => void;
  showGroupTitles?: boolean;
}) {
  const [form, setForm] = useState<ConfigShape>(initial);
  const utils = trpc.useUtils();

  // Volta aos valores salvos só quando eles mudam de fato (a consulta de estado
  // se repete a cada 30 s e não pode apagar o que o operador está digitando).
  const saved = JSON.stringify(initial);
  useEffect(() => { setForm(initial); }, [saved, resetKey, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = trpc.bess.updateConfigV2.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success(res.message);
        utils.bess.getSiteStatus.invalidate({ slug });
        onSaved?.();
      } else {
        toast.error(res.message);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const setField = <K extends keyof ConfigShape>(k: K, v: ConfigShape[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const dirty = (Object.keys(form) as (keyof ConfigShape)[]).some((k) => form[k] !== initial[k]);

  return (
    <>
      <div className="space-y-4">
        {FIELD_GROUPS.map((group) => (
          <div key={group.title} className="space-y-4">
            {showGroupTitles && <h3 className="text-sm font-semibold pt-2 border-t border-white/10 first:border-0">{group.title}</h3>}
            {group.fields.map(({ k, label, min, max, step, suffix, helpText }) => (
              <div key={k} className="grid grid-cols-2 items-start gap-3">
                <Label htmlFor={`${slug}-${k}`} className="pt-2">{label}</Label>
                <div>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${slug}-${k}`}
                      type="number"
                      min={min}
                      max={max}
                      step={step ?? 1}
                      value={form[k] as number}
                      onChange={(e) => setField(k, Number(e.target.value) as any)}
                      className="font-mono"
                    />
                    {suffix && <span className="text-xs text-muted-foreground w-12">{suffix}</span>}
                  </div>
                  {helpText && <p className="text-xs text-muted-foreground mt-1.5">{helpText}</p>}
                </div>
              </div>
            ))}
          </div>
        ))}

        {showGroupTitles && <h3 className="text-sm font-semibold pt-2 border-t border-white/10">Janela de operação</h3>}
        <div className="grid grid-cols-2 items-center gap-3">
          <Label htmlFor={`${slug}-horarioLiberacao`}>Janela de operação</Label>
          <div className="flex items-center gap-2">
            <Input id={`${slug}-horarioLiberacao`} type="time" value={form.horarioLiberacao}
              onChange={(e) => setField("horarioLiberacao", e.target.value)} className="font-mono" />
            <span className="text-xs">→</span>
            <Input type="time" value={form.horarioCorte}
              onChange={(e) => setField("horarioCorte", e.target.value)} className="font-mono" />
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        {onCancel
          ? <Button variant="outline" onClick={onCancel} disabled={update.isPending}>Cancelar</Button>
          : <Button variant="outline" onClick={() => setForm(initial)} disabled={update.isPending || !dirty}>Desfazer alterações</Button>}
        <Button onClick={() => update.mutate({ slug, ...form })} disabled={update.isPending || (!onCancel && !dirty)}>
          {update.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </>
  );
}

export function ConfigModalV2({
  open, onOpenChange, slug, initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slug: string;
  initial: ConfigShape;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configuração — {slug}</DialogTitle>
          <DialogDescription>
            Parâmetros do control-engine. Histerese mínima: 3 p.p. entre desliga e religa.
          </DialogDescription>
        </DialogHeader>
        <AutomationConfigForm slug={slug} initial={initial} resetKey={open} onSaved={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
