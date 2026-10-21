import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

const sourceColor: Record<string, string> = {
  AUTO: "bg-blue-500/15 text-blue-300",
  MANUAL: "bg-amber-500/15 text-amber-300",
  BLACKOUT: "bg-red-500/15 text-red-300",
  SYSTEM: "bg-zinc-500/15 text-zinc-300",
};
const actionColor: Record<string, string> = {
  TURN_ON: "bg-emerald-500/15 text-emerald-300",
  TURN_OFF: "bg-red-500/15 text-red-300",
  MODE_CHANGE: "bg-purple-500/15 text-purple-300",
  CONFIG_CHANGE: "bg-cyan-500/15 text-cyan-300",
  ALERT: "bg-yellow-500/15 text-yellow-300",
};

function formatTs(t: Date | string | null | undefined): string {
  if (!t) return "—";
  const d = new Date(t);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

const PERIODS = [
  { id: "24h", label: "24 horas", ms: 24 * 3600_000 },
  { id: "7d", label: "7 dias", ms: 7 * 24 * 3600_000 },
  { id: "30d", label: "30 dias", ms: 30 * 24 * 3600_000 },
  { id: "12m", label: "12 meses", ms: 365 * 24 * 3600_000 },
  { id: "all", label: "Tudo", ms: null },
  { id: "custom", label: "Datas", ms: null },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

const KINDS = [
  { id: "all", label: "Todas as ações", sources: undefined, actions: undefined },
  { id: "manual", label: "Comandos de pessoas", sources: ["MANUAL"] as const, actions: undefined },
  { id: "pump", label: "Liga e desliga", sources: undefined, actions: ["TURN_ON", "TURN_OFF"] as const },
  { id: "setup", label: "Modo e configuração", sources: undefined, actions: ["MODE_CHANGE", "CONFIG_CHANGE"] as const },
  { id: "blackout", label: "Blackout", sources: ["BLACKOUT"] as const, actions: undefined },
] as const;
type KindId = (typeof KINDS)[number]["id"];

const PAGE = 200;
const MAX = 1000;

function dayStart(v: string): number | undefined {
  return v ? new Date(`${v}T00:00:00`).getTime() : undefined;
}

/** Conteúdo do histórico (filtros + lista), reutilizável dentro do modal ou embutido numa aba (ex.: SCADA). */
export function HistoryPanel({ slug, active = true }: { slug: string; active?: boolean }) {
  const [period, setPeriod] = useState<PeriodId>("7d");
  const [kind, setKind] = useState<KindId>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [limit, setLimit] = useState(PAGE);
  // "agora" fixo enquanto o modal está aberto, para a consulta não mudar a cada render
  const [anchor, setAnchor] = useState(() => Date.now());
  useEffect(() => { if (active) { setAnchor(Date.now()); setLimit(PAGE); } }, [active, period, kind, dateFrom, dateTo]);

  const range = useMemo(() => {
    if (period === "custom") {
      const to = dayStart(dateTo);
      return { from: dayStart(dateFrom), to: to != null ? to + 24 * 3600_000 : undefined };
    }
    const ms = PERIODS.find((p) => p.id === period)?.ms;
    return { from: ms ? anchor - ms : undefined, to: undefined };
  }, [period, dateFrom, dateTo, anchor]);
  const k = KINDS.find((x) => x.id === kind)!;

  const { data, isLoading, isFetching } = trpc.bess.getActions.useQuery(
    {
      slug, limit, from: range.from, to: range.to,
      sources: k.sources ? [...k.sources] : undefined,
      actions: k.actions ? [...k.actions] : undefined,
    },
    { enabled: active, refetchInterval: active && period === "24h" ? 30_000 : false, placeholderData: (prev) => prev },
  );
  const count = data?.length ?? 0;
  const truncated = count >= limit;

  return (
    <>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {PERIODS.map((p) => (
              <Button key={p.id} size="sm" variant={period === p.id ? "default" : "outline"} onClick={() => setPeriod(p.id)}>{p.label}</Button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="hist-de">De</label>
              <Input id="hist-de" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
              <label htmlFor="hist-ate">até</label>
              <Input id="hist-ate" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((x) => (
              <Button key={x.id} size="sm" variant={kind === x.id ? "secondary" : "ghost"} onClick={() => setKind(x.id)}>{x.label}</Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Carregando…"
              : count === 0 ? "Nenhuma ação neste período."
              : truncated ? `Mostrando as ${count} mais recentes do período; há mais.`
              : `${count} ${count === 1 ? "ação" : "ações"} no período.`}
            {isFetching && !isLoading ? " Atualizando…" : ""}
          </p>
        </div>

        <div className="space-y-2">
          {data?.map((a: any) => (
            <div key={a.id} className="flex items-start gap-3 border border-white/5 rounded-md p-3 text-sm">
              <div className="font-mono text-xs text-muted-foreground w-32 shrink-0">{formatTs(a.timestamp)}</div>
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <Badge className={sourceColor[a.source] ?? ""}>{a.source}</Badge>
                <Badge className={actionColor[a.action] ?? ""}>{a.action}</Badge>
                {a.socAtTime !== null && a.socAtTime !== undefined && (
                  <span className="font-mono text-xs">SOC {a.socAtTime}% ({a.socSource ?? "?"})</span>
                )}
                {a.pumpStateBefore && a.pumpStateAfter && (
                  <span className="text-xs text-muted-foreground">{a.pumpStateBefore}→{a.pumpStateAfter}</span>
                )}
                {(a.userName || a.userEmail) && (
                  <span className="text-[11px] font-mono text-blue-300/80 bg-blue-500/10 border border-blue-500/20 rounded px-1.5">
                    👤 {a.userName ?? a.userEmail}
                  </span>
                )}
                {a.source === "AUTO" && !a.userId && (
                  <span className="text-[10px] font-mono text-zinc-500">🤖 sistema</span>
                )}
                {a.reason && (
                  <p className="w-full text-xs text-muted-foreground mt-1">{a.reason}</p>
                )}
              </div>
            </div>
          ))}
          {truncated && limit < MAX && (
            <Button variant="outline" className="w-full" onClick={() => setLimit(Math.min(MAX, limit + PAGE))}>Carregar mais antigas</Button>
          )}
          {truncated && limit >= MAX && (
            <p className="text-xs text-muted-foreground text-center">Limite de {MAX} ações por consulta. Reduza o período ou filtre o tipo para ver as mais antigas.</p>
          )}
        </div>
    </>
  );
}

export function HistoryModal({
  open, onOpenChange, slug, siteName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slug: string;
  siteName: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico de ações — {siteName}</DialogTitle>
          <DialogDescription>Comandos, mudanças de modo e de configuração registrados para esta planta.</DialogDescription>
        </DialogHeader>
        <HistoryPanel slug={slug} active={open} />
      </DialogContent>
    </Dialog>
  );
}
