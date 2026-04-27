import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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

export function HistoryModal({
  open, onOpenChange, slug, siteName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slug: string;
  siteName: string;
}) {
  const { data, isLoading } = trpc.bess.getActions.useQuery(
    { slug, limit: 50 },
    { enabled: open, refetchInterval: open ? 10_000 : false },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico — {siteName}</DialogTitle>
          <DialogDescription>Últimas 50 ações registradas em bess_actions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {!isLoading && (data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma ação registrada ainda.</p>
          )}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
