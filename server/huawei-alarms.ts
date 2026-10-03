/**
 * Alarmes do fabricante (FusionSolar `getAlarmList`) → `bess_alarms`.
 *
 * Pendência §7.4 do CLAUDE.md: sobretemperatura, falha de inversor e avisos
 * do BMS não chegavam ao painel.
 *
 * DISCIPLINA (CLAUDE.md §14): PURAMENTE observabilidade. Não toca em
 * `decideAction`, `pickPollInterval` nem `pollSite`, e não liga/desliga nada.
 *
 * Cuidado com o ritmo: o limitador de chamadas da FusionSolar é GLOBAL
 * (70 s entre chamadas; um 407 pausa tudo). Por isso esta coleta é rara
 * (30 min), faz UMA chamada para todas as plantas e cede a vez quando
 * alguma planta está em zona crítica — no máximo duas rodadas seguidas.
 */

import type { FusionSolarAlarm } from "./fusionsolar";

export const HUAWEI_ALARM_PREFIX = "HUAWEI_";
export const HUAWEI_ALARM_INTERVAL_MS = 30 * 60 * 1000;
export const HUAWEI_ALARM_FIRST_DELAY_MS = 5 * 60 * 1000;
/** Janela de busca: alarmes ativos levantados nos últimos 90 dias. */
export const HUAWEI_ALARM_WINDOW_MS = 90 * 24 * 3600 * 1000;

/**
 * Em zona crítica a coleta cede a vez ao SOC, mas no máximo este número de
 * rodadas seguidas (decisão do operador, 2026-10-03). Sem o teto, uma planta
 * que passa a noite com bateria baixa nunca teria os alarmes consultados.
 * Custo: uma leitura de SOC atrasada em até 70 s, uma vez por hora.
 */
export const HUAWEI_ALARM_MAX_YIELDS = 2;

export type AlarmSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface SiteRef { id: number; name: string; plantCode: string }
export interface OpenAlarmRef { siteId: number; type: string }
export interface AlarmToOpen { siteId: number; siteName: string; severity: AlarmSeverity; type: string; description: string }

/** 1 = crítico, 2 = importante, 3 = secundário, 4 = aviso (doc. Northbound). */
export function mapSeverity(level: unknown): AlarmSeverity {
  const n = Number(level);
  if (n === 1) return "CRITICAL";
  if (n === 2) return "WARNING";
  return "INFO";
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** A API pode devolver também alarmes já encerrados; `status` 1 = ativo. */
export function isActive(a: FusionSolarAlarm): boolean {
  return a.status === undefined || a.status === null || Number(a.status) === 1;
}

/**
 * Compara o que a FusionSolar informa com o que está aberto em `bess_alarms`.
 * Um registro por planta + código de alarme; equipamentos afetados vão na
 * descrição. Só mexe em tipos com o prefixo HUAWEI_.
 */
export function reconcileHuaweiAlarms(
  apiAlarms: FusionSolarAlarm[],
  open: OpenAlarmRef[],
  sites: SiteRef[],
): { toOpen: AlarmToOpen[]; toClose: OpenAlarmRef[] } {
  const siteByCode = new Map(sites.map((s) => [s.plantCode, s]));
  const wanted = new Map<string, AlarmToOpen & { devices: string[] }>();

  for (const a of apiAlarms) {
    if (!isActive(a)) continue;
    const site = siteByCode.get(text(a.stationCode));
    if (!site) continue;
    const code = String(a.alarmId ?? "").trim();
    if (!code) continue;
    const type = `${HUAWEI_ALARM_PREFIX}${code}`.slice(0, 64);
    const key = `${site.id}|${type}`;
    const severity = mapSeverity(a.lev ?? a.severity);
    const device = text(a.devName);
    const existing = wanted.get(key);
    if (existing) {
      if (device && !existing.devices.includes(device)) existing.devices.push(device);
      if (severity === "CRITICAL" || (severity === "WARNING" && existing.severity === "INFO")) existing.severity = severity;
      continue;
    }
    const parts = [text(a.alarmName) || `Alarme ${code}`];
    const cause = text(a.alarmCause);
    const fix = text(a.repairSuggestion);
    if (cause) parts.push(`Causa: ${cause}`);
    if (fix) parts.push(`O que fazer: ${fix}`);
    wanted.set(key, { siteId: site.id, siteName: site.name, severity, type, description: parts.join(". "), devices: device ? [device] : [] });
  }

  const openKeys = new Set(open.filter((o) => o.type.startsWith(HUAWEI_ALARM_PREFIX)).map((o) => `${o.siteId}|${o.type}`));
  const toOpen: AlarmToOpen[] = [];
  wanted.forEach((w, key) => {
    if (openKeys.has(key)) return;
    const { devices, ...rest } = w;
    toOpen.push({ ...rest, description: (devices.length ? `${devices.join(", ")}: ` : "") + w.description });
  });
  const toClose = open.filter((o) => o.type.startsWith(HUAWEI_ALARM_PREFIX) && !wanted.has(`${o.siteId}|${o.type}`));
  return { toOpen, toClose };
}

export interface HuaweiAlarmDeps {
  listSites(): Promise<SiteRef[]>;
  anySiteCritical(): Promise<boolean>;
  /** null = a chamada falhou (não confundir com "sem alarmes"). */
  fetchAlarms(stationCodes: string, begin: number, end: number): Promise<FusionSolarAlarm[] | null>;
  listOpen(): Promise<OpenAlarmRef[]>;
  open(a: AlarmToOpen): Promise<void>;
  close(a: OpenAlarmRef): Promise<void>;
  notify(siteName: string, message: string): Promise<void>;
  now?: () => number;
  /** Contador de rodadas cedidas em sequência; quem chama guarda entre rodadas. */
  yields?: { count: number };
}

export type SweepResult =
  | { status: "skipped"; reason: string }
  | { status: "failed" }
  | { status: "ok"; opened: number; closed: number; active: number };

export async function sweepHuaweiAlarms(deps: HuaweiAlarmDeps): Promise<SweepResult> {
  const sites = await deps.listSites();
  if (sites.length === 0) return { status: "skipped", reason: "nenhuma planta com código FusionSolar" };
  const yields = deps.yields ?? { count: 0 };
  if (await deps.anySiteCritical() && yields.count < HUAWEI_ALARM_MAX_YIELDS) {
    yields.count += 1;
    return { status: "skipped", reason: `planta em zona crítica (cedeu ${yields.count} de ${HUAWEI_ALARM_MAX_YIELDS})` };
  }
  yields.count = 0;

  const now = (deps.now ?? Date.now)();
  const alarms = await deps.fetchAlarms(sites.map((s) => s.plantCode).join(","), now - HUAWEI_ALARM_WINDOW_MS, now);
  // Falha na consulta: não abre nem fecha nada. Fechar aqui apagaria alarme real.
  if (alarms === null) return { status: "failed" };

  const { toOpen, toClose } = reconcileHuaweiAlarms(alarms, await deps.listOpen(), sites);
  for (const a of toOpen) {
    await deps.open(a);
    if (a.severity === "CRITICAL") await deps.notify(a.siteName, a.description);
  }
  for (const a of toClose) await deps.close(a);
  return { status: "ok", opened: toOpen.length, closed: toClose.length, active: alarms.filter(isActive).length };
}

export function isHuaweiAlarmPollingEnabled(): boolean {
  return (process.env.HUAWEI_ALARMS ?? "").toLowerCase() !== "off";
}
