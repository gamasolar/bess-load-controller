/**
 * Leitura AO VIVO do relé Waveshare (braço atuador da bomba), direto da usina
 * por Modbus TCP sobre WireGuard. Fase 1 do DECISION-CAMINHO-2 §4.2: o dashboard
 * passa a SUPERVISIONAR o controlador real (relé + retorno do contator) em vez
 * do Sonoff morto. Independe do Pi: lê o estado do relé mesmo que o Pi caia.
 *
 * SOMENTE LEITURA (FC01/FC02/FC03). A atuação (Flash ON por FC05) é Fase 2, fica
 * em outro módulo atrás de autorização explícita. NÃO toca em decideAction,
 * pickPollInterval, pollSite nem na faixa configurada (CLAUDE.md §14).
 *
 * Config (no .env):
 *   WAVESHARE_HOSTS=barragem=192.168.88.20       (slug=host[:porta], vírgula separa)
 *   WAVESHARE_LIVE=off                           (desliga tudo; padrão ligado se há hosts)
 *   WAVESHARE_LIVE_INTERVAL_MS=10000             (ritmo da leitura/tela)
 */

import { getAllSites } from "./db";
import { ModbusTcpReader } from "./modbus-tcp";
import { readRelaySnapshot, type RelaySnapshot } from "./waveshare";
import { parseHosts } from "./smartlogger-live";

export const ALARM_TYPE_RELE_OFFLINE = "RELE_OFFLINE";
export const ALARM_TYPE_DIVERGENCIA_RETORNO = "DIVERGENCIA_RETORNO";

/** Relé inalcançável por mais que isso → alarme crítico (o controlador sumiu). */
export const RELE_OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;
/** Leitura mais velha que isso conta como "não fresca" (não dá pra confiar no estado). */
const STALE_MS = 45_000;

export function isWaveshareLiveEnabled(): boolean {
  if ((process.env.WAVESHARE_LIVE ?? "on").trim().toLowerCase() === "off") return false;
  return parseHosts(process.env.WAVESHARE_HOSTS).length > 0;
}

/** Este slug tem um relé Waveshare configurado como controlador? (usado para aposentar o Sonoff) */
export function hasWaveshareController(slug: string): boolean {
  return parseHosts(process.env.WAVESHARE_HOSTS).some((t) => t.slug === slug);
}

/**
 * Slugs onde o contato auxiliar do contator ESTÁ cabeado numa entrada digital.
 * `WAVESHARE_CONTACTOR_AUX=barragem,piscinao` (vírgula separa). Fato de fiação,
 * declarado à mão — só com ele o retorno vira confirma/não-confirma e habilita
 * o alarme DIVERGENCIA_RETORNO. Sem ele, o retorno fica "não cabeado" (null).
 */
export function isContactorAuxWired(slug: string): boolean {
  return (process.env.WAVESHARE_CONTACTOR_AUX ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean).includes(slug);
}

/** Retrato em memória da leitura mais recente de um relé (o que a tela consome). */
export interface RelayLive {
  slug: string;
  siteId: number;
  host: string;
  readAt: Date;
  ok: boolean;
  err: string | null;
  relays: boolean[];
  pumpRelayClosed: boolean;
  contactorConfirmed: boolean | null;
  inputModes: number[];
  protocolVersion: number | null;
}

interface RelayRunner {
  slug: string;
  siteId: number;
  host: string;
  port: number;
  reader: ModbusTcpReader;
  auxWired: boolean;
  latest: RelayLive | null;
  inFlight: boolean;
  timer: ReturnType<typeof setInterval> | null;
  lastErrLoggedAt: number;
  /** Desde quando está inalcançável (memória; reseta em restart). null = alcançável. */
  offlineSince: number | null;
}

const _runners = new Map<string, RelayRunner>();
let _started = false;

export function getRelayLive(slug: string): RelayLive | null {
  return _runners.get(slug)?.latest ?? null;
}

const READ_MS = () => Math.max(2000, Number(process.env.WAVESHARE_LIVE_INTERVAL_MS) || 10_000);

function toLive(r: RelayRunner, snap: RelaySnapshot): RelayLive {
  return {
    slug: r.slug, siteId: r.siteId, host: r.host,
    readAt: snap.readAt, ok: snap.ok, err: snap.err,
    relays: snap.relays, pumpRelayClosed: snap.pumpRelayClosed,
    contactorConfirmed: snap.contactorConfirmed, inputModes: snap.inputModes,
    protocolVersion: snap.protocolVersion,
  };
}

async function readOnce(r: RelayRunner): Promise<void> {
  if (r.inFlight) return;
  r.inFlight = true;
  try {
    const snap = await readRelaySnapshot(r.reader, { unitId: 1, auxWired: r.auxWired });
    r.latest = toLive(r, snap);
    if (!snap.ok) throw new Error(snap.err ?? "leitura falhou");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const now = Date.now();
    if (now - r.lastErrLoggedAt > 60_000) {
      r.lastErrLoggedAt = now;
      console.warn(`[WaveshareLive] ${r.slug}: leitura falhou — ${msg.slice(0, 120)}`);
    }
  } finally {
    r.inFlight = false;
  }
}

export async function startWaveshareLive(): Promise<void> {
  if (_started) return;
  if (!isWaveshareLiveEnabled()) {
    console.log("[WaveshareLive] desativado (sem WAVESHARE_HOSTS ou WAVESHARE_LIVE=off)");
    return;
  }
  const sites = await getAllSites();
  const bySlug = new Map(sites.map((s) => [s.slug, s]));
  const readMs = READ_MS();

  for (const t of parseHosts(process.env.WAVESHARE_HOSTS)) {
    const site = bySlug.get(t.slug);
    if (!site) { console.warn(`[WaveshareLive] slug "${t.slug}" não existe em bess_sites — ignorado`); continue; }
    const reader = new ModbusTcpReader({ host: t.host, port: t.port });
    const auxWired = isContactorAuxWired(t.slug);
    const r: RelayRunner = {
      slug: t.slug, siteId: site.id, host: t.host, port: t.port, reader, auxWired,
      latest: null, inFlight: false, timer: null, lastErrLoggedAt: 0, offlineSince: null,
    };
    _runners.set(t.slug, r);
    void readOnce(r);
    r.timer = setInterval(() => void readOnce(r), readMs);
    console.log(`[WaveshareLive] ${t.slug}: lendo relé ${t.host}:${t.port} a cada ${readMs / 1000}s (só leitura, retorno do contator ${auxWired ? "cabeado" : "não cabeado"})`);
  }
  _started = _runners.size > 0;
}

export function stopWaveshareLive(): void {
  for (const r of Array.from(_runners.values())) {
    if (r.timer) clearInterval(r.timer);
    r.reader.close();
  }
  _runners.clear();
  _started = false;
}

/** Texto visível ao operador. "relé/controlador" é genérico; Waveshare é equipamento de planta (pode citar). */
function describeReleOffline(siteName: string, offlineMinutes: number): string {
  const h = Math.floor(offlineMinutes / 60), m = offlineMinutes % 60;
  const dur = h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
  return `Controlador da bomba de ${siteName} (relé Waveshare) sem resposta há ${dur}. ` +
    `O dashboard não enxerga nem comanda a bomba por aqui até o relé ou a rede da planta voltarem.`;
}
function describeDivergencia(siteName: string): string {
  return `Em ${siteName}, o relé está fechado (bomba comandada), mas o retorno do contator não confirma. ` +
    `Verificar o contator, o disjuntor de comando ou a fiação do retorno.`;
}

export interface WaveshareAlarmCallbacks {
  listSites: () => Promise<Array<{ id: number; slug: string; name: string }>>;
  listOpen: (siteId: number) => Promise<string[]>;
  open: (siteId: number, a: { severity: "CRITICAL" | "WARNING"; type: string; description: string }) => Promise<unknown>;
  close: (siteId: number, type: string) => Promise<unknown>;
  event: (siteId: number, type: string, description: string) => Promise<unknown>;
  notify: (siteName: string, a: { severity: "CRITICAL" | "WARNING"; description: string }) => Promise<unknown>;
  now?: number;
}

/**
 * Varre os relés supervisionados e abre/fecha `RELE_OFFLINE` e `DIVERGENCIA_RETORNO`.
 * Observabilidade pura: nunca escreve no relé nem decide manobra.
 */
export async function sweepWaveshareAlarms(cb: WaveshareAlarmCallbacks): Promise<{ opened: number; closed: number }> {
  const now = cb.now ?? Date.now();
  let opened = 0, closed = 0;
  const sites = await cb.listSites();
  const bySlug = new Map(sites.map((s) => [s.slug, s]));

  for (const r of Array.from(_runners.values())) {
    const site = bySlug.get(r.slug);
    if (!site) continue;
    const snap = r.latest;
    const fresh = !!snap && snap.ok && now - snap.readAt.getTime() < STALE_MS;

    // ── Controlador offline (relé inalcançável) ──
    if (fresh) {
      if (r.offlineSince !== null) {
        r.offlineSince = null;
        await cb.close(site.id, ALARM_TYPE_RELE_OFFLINE);
        await cb.event(site.id, "RELE_ONLINE", "Controlador da bomba (relé Waveshare) voltou a responder.");
        closed++;
      }
    } else {
      if (r.offlineSince === null) {
        r.offlineSince = now;
      } else if (now - r.offlineSince >= RELE_OFFLINE_THRESHOLD_MS) {
        const open = await cb.listOpen(site.id);
        if (!open.includes(ALARM_TYPE_RELE_OFFLINE)) {
          const mins = Math.floor((now - r.offlineSince) / 60_000);
          const desc = describeReleOffline(site.name, mins);
          await cb.open(site.id, { severity: "CRITICAL", type: ALARM_TYPE_RELE_OFFLINE, description: desc });
          await cb.event(site.id, ALARM_TYPE_RELE_OFFLINE, desc);
          await cb.notify(site.name, { severity: "CRITICAL", description: desc });
          opened++;
        }
      }
    }

    // ── Divergência de retorno (só quando a DI está cabeada → contactorConfirmed !== null) ──
    const open = await cb.listOpen(site.id);
    const divergent = fresh && snap!.pumpRelayClosed && snap!.contactorConfirmed === false;
    if (divergent) {
      if (!open.includes(ALARM_TYPE_DIVERGENCIA_RETORNO)) {
        const desc = describeDivergencia(site.name);
        await cb.open(site.id, { severity: "WARNING", type: ALARM_TYPE_DIVERGENCIA_RETORNO, description: desc });
        await cb.event(site.id, ALARM_TYPE_DIVERGENCIA_RETORNO, desc);
        opened++;
      }
    } else if (open.includes(ALARM_TYPE_DIVERGENCIA_RETORNO)) {
      await cb.close(site.id, ALARM_TYPE_DIVERGENCIA_RETORNO);
      closed++;
    }
  }
  return { opened, closed };
}
