/**
 * Checagem automática do painel beta — roda por cron a cada 3h.
 *
 * SÓ LEITURA + alerta. Pergunta AO PRÓPRIO SERVIÇO como ele está vendo a planta
 * (endpoints públicos liveWaveshare/liveSmartlogger) em vez de abrir conexão nova
 * no relé — o relé Waveshare é sensível a conexão nova e uma piscada dava falso
 * alarme (visto em 21/10 18:00). O leitor persistente do serviço é o sinal certo.
 * Confere também que as páginas /scada respondem 200.
 *
 * Manda UMA mensagem no WhatsApp (rotulada como diagnóstico) só quando acha
 * anomalia; fica SILENCIOSO quando tudo está bem. Não toca em controle (§14).
 * Rodar à mão:  set -a; . ./.env; set +a; pnpm tsx server/tools/beta-healthcheck.ts
 */
import { notifyOwner } from "../_core/notification";

const BASE = (process.env.BETA_HEALTH_BASE ?? "https://bess.gamasolar.com.br").replace(/\/+$/, "");
/** Leitura ao vivo mais velha que isto = leitor travado (ele lê a cada ~10s; 90s ≈ 9 ciclos perdidos). */
const STALE_MS = 90_000;

async function fetchJson<T>(path: string, timeoutMs = 12_000): Promise<{ ok: boolean; status: number; json?: T }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + path, { signal: ctrl.signal, redirect: "manual" });
    if (!r.ok) return { ok: false, status: r.status };
    const body = await r.json().catch(() => undefined);
    return { ok: true, status: r.status, json: body as T };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(t);
  }
}

/** Desempacota o envelope tRPC-batch-superjson e devolve o payload (ou null). */
function trpcData<T>(body: unknown): T | null {
  try {
    // [{ result: { data: { json: ... } } }]
    const j = (body as Array<{ result?: { data?: { json?: unknown } } }>)?.[0]?.result?.data?.json;
    return (j ?? null) as T | null;
  } catch {
    return null;
  }
}

async function liveFeed(proc: string, slug: string): Promise<{ ok: boolean; ageMs: number } | null> {
  const input = encodeURIComponent(JSON.stringify({ "0": { json: { slug } } }));
  const r = await fetchJson(`/api/trpc/bess.${proc}?batch=1&input=${input}`);
  if (!r.ok) return null; // serviço não respondeu
  return trpcData<{ ok: boolean; ageMs: number }>(r.json);
}

async function main(): Promise<void> {
  const problems: string[] = [];

  // 1) Páginas do beta respondem?
  for (const slug of ["barragem", "piscinao"]) {
    const r = await fetchJson(`/scada/${slug}`);
    if (r.status !== 200) problems.push(`Página /scada/${slug} respondeu ${r.status || "sem resposta"}.`);
  }

  // 2) Relé Waveshare — pela visão do serviço (não abre conexão nova no relé)
  const wave = await liveFeed("liveWaveshare", "barragem");
  if (wave === null) {
    problems.push("Relé Waveshare: o serviço não está supervisionando (sem leitura).");
  } else if (!wave.ok) {
    problems.push("Relé Waveshare: última leitura do serviço com erro.");
  } else if (wave.ageMs > STALE_MS) {
    problems.push(`Relé Waveshare: leitura parada há ${Math.round(wave.ageMs / 60_000)}min (o leitor pode ter travado).`);
  }

  // 3) SmartLogger ao vivo (só a Barragem tem o caminho direto)
  const sl = await liveFeed("liveSmartlogger", "barragem");
  if (sl === null) {
    problems.push("SmartLogger ao vivo (Barragem): o serviço não está lendo.");
  } else if (!sl.ok) {
    problems.push("SmartLogger ao vivo (Barragem): última leitura com erro.");
  } else if (sl.ageMs > STALE_MS) {
    problems.push(`SmartLogger ao vivo (Barragem): leitura parada há ${Math.round(sl.ageMs / 60_000)}min.`);
  }

  const stamp = new Date().toISOString();
  if (problems.length === 0) {
    console.log(`[beta-healthcheck] OK — ${stamp}`);
    return;
  }

  const content = problems.map((p, i) => `${i + 1}. ${p}`).join("\n") +
    `\n\n(Verificação automática do painel a cada 3h. Se for queda da Starlink da planta, costuma voltar sozinho.)`;
  console.warn(`[beta-healthcheck] ANOMALIA ${stamp}: ${problems.join(" | ")}`);
  const sent = await notifyOwner({ title: "🔧 BESS — diagnóstico do painel (beta)", content });
  console.log(`[beta-healthcheck] alerta enviado=${sent}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("[beta-healthcheck] erro:", e instanceof Error ? e.message : e);
  process.exit(1);
});
