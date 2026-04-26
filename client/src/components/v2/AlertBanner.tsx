import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";

export function AlertBanner() {
  const { data: alarms } = trpc.bess.alarms.useQuery({}, { refetchInterval: 60_000 });
  const active = (alarms ?? []).filter((a: any) => a.active);
  if (active.length === 0) return null;

  const critical = active.filter((a: any) => a.severity === "CRITICAL");
  const tone = critical.length > 0 ? "bg-red-500/10 border-red-500/40 text-red-300" : "bg-yellow-500/10 border-yellow-500/40 text-yellow-300";

  return (
    <div className={`rounded-md border ${tone} px-4 py-3 flex items-start gap-3`}>
      <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
      <div className="text-sm space-y-1">
        <p className="font-semibold">
          {active.length} alarme{active.length > 1 ? "s" : ""} ativo{active.length > 1 ? "s" : ""}
          {critical.length > 0 && ` · ${critical.length} crítico${critical.length > 1 ? "s" : ""}`}
        </p>
        <ul className="text-xs space-y-0.5">
          {active.slice(0, 3).map((a: any) => (
            <li key={a.id}>· {a.type}: {a.description}</li>
          ))}
          {active.length > 3 && <li className="opacity-60">… e mais {active.length - 3}</li>}
        </ul>
      </div>
    </div>
  );
}
