import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

const TZ = "America/Sao_Paulo";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export function useServerClock() {
  const { data } = trpc.system.serverTime.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const [delta, setDelta] = useState(0);
  useEffect(() => {
    if (data?.now) setDelta(data.now - Date.now());
  }, [data?.now]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = new Date(Date.now() + delta);
  void tick;
  return {
    date: dateFmt.format(now),
    time: timeFmt.format(now),
    synced: data !== undefined,
  };
}
