/**
 * Checagem automática do painel beta — roda por cron a cada 3h.
 *
 * SÓ LEITURA + alerta. Confere o que os alarmes operacionais 24/7 NÃO cobrem:
 *   1. as páginas /scada respondem 200;
 *   2. o leitor AO VIVO do SmartLogger está gravando (não travou);
 *   3. o relé Waveshare está alcançável por Modbus (só leitura).
 * Manda UMA mensagem no WhatsApp (rotulada como diagnóstico) só quando acha
 * anomalia; fica SILENCIOSO quando tudo está bem (não spamma a cada 3h).
 *
 * Não toca em nada do controle (CLAUDE.md §14). Rodar à mão:
 *   set -a; . ./.env; set +a; pnpm tsx server/tools/beta-healthcheck.ts
 */
import mysql from "mysql2/promise";
import { openRelayReader, readRelaySnapshot } from "../waveshare";
import { notifyOwner } from "../_core/notification";

const BASE = (process.env.BETA_HEALTH_BASE ?? "https://bess.gamasolar.com.br").replace(/\/+$/, "");
const SL_STALE_MS = 5 * 60_000; // smartlogger_live sem gravar há mais que isso = leitor travado

async function httpStatus(path: string): Promise<number> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(BASE + path, { signal: ctrl.signal, redirect: "manual" });
    return r.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(t);
  }
}

async function main(): Promise<void> {
  const problems: string[] = [];

  // 1) Páginas do beta
  for (const slug of ["barragem", "piscinao"]) {
    const code = await httpStatus(`/scada/${slug}`);
    if (code !== 200) problems.push(`Página /scada/${slug} respondeu ${code || "sem resposta"}.`);
  }

  // 2) Leitor AO VIVO do SmartLogger gravando? (só a Barragem tem o caminho direto)
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    const c = await mysql.createConnection({
      host: u.hostname, port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: u.pathname.slice(1),
    });
    try {
      const [rows] = await c.query(
        "SELECT readAt, ok FROM smartlogger_live WHERE siteId=2 ORDER BY readAt DESC LIMIT 1",
      ) as [Array<{ readAt: Date; ok: number }>, unknown];
      const last = rows[0];
      if (!last) {
        problems.push("SmartLogger ao vivo: nenhuma leitura gravada.");
      } else {
        const age = Date.now() - new Date(last.readAt).getTime();
        if (age > SL_STALE_MS) problems.push(`SmartLogger ao vivo parado há ${Math.round(age / 60_000)}min (o leitor pode ter travado).`);
      }
    } finally {
      await c.end();
    }
  }

  // 3) Relé Waveshare alcançável? (read-only, Modbus TCP pela WireGuard)
  const host = (process.env.WAVESHARE_HOSTS ?? "")
    .split(",").map((s) => s.trim())
    .find((s) => s.startsWith("barragem="))?.split("=")[1];
  if (host) {
    const reader = openRelayReader(host, { timeoutMs: 6000 });
    try {
      const snap = await readRelaySnapshot(reader, { unitId: 1 });
      if (!snap.ok) problems.push(`Relé Waveshare sem resposta (${snap.err ?? "?"}).`);
    } finally {
      reader.close();
    }
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
