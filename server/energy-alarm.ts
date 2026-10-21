/**
 * Alertas de energia (SOC e carga fora de hora) — observabilidade pura.
 *
 * Motivação (2026-10-17): com a automação sem atuador (dispositivo morto desde
 * 17/09) e o poço rodando a noite toda, a Barragem chegou a 10 % de SOC e o
 * BESS cortou a saída por 2 h na manhã de 16/10, sem ninguém saber. As bombas
 * de 30 cv passaram a ser ligadas à mão; ligadas depois do pôr do sol, tiram
 * ~20 pontos de SOC por hora. Este módulo só avisa; não liga nem desliga.
 *
 * DISCIPLINA (CLAUDE.md §14): não toca em `decideAction`, `pickPollInterval`
 * nem `pollSite`. Abre/fecha registros em `bess_alarms` e manda a mensagem
 * pelo canal de notificação. Desliga com ENERGY_ALERTS=off.
 */

export const ALARM_SOC_CRITICO = "SOC_CRITICO";
export const ALARM_SOC_BAIXO_NOITE = "SOC_BAIXO_NOITE";
export const ALARM_BOMBA_SEM_SOL = "BOMBA_LIGADA_SEM_SOL";
export const ALARM_CARGA_NOTURNA = "CARGA_NOTURNA_ALTA";

export type EnergyAlarmConfig = {
  /** SOC (%) abaixo do qual é crítico a qualquer hora. */
  socCritico: number;
  /** SOC (%) abaixo do qual avisa à noite (não há sol para recuperar). */
  socNoite: number;
  /** Carga (kW) a partir da qual se considera que as bombas grandes estão ligadas. */
  bombaKw: number;
  /** Carga noturna (kW) acima do normal do poço — avisa sem ser crítico. */
  cargaNoiteKw: number;
  /** Hora local (0–23) em que começa a "noite" (sem sol útil). */
  noiteInicio: number;
  /** Hora local (0–23) em que termina a "noite". */
  noiteFim: number;
  /** Leituras mais velhas que isso não geram decisão. */
  maxIdadeMin: number;
};

export const DEFAULT_ENERGY_ALARM_CONFIG: EnergyAlarmConfig = {
  socCritico: 25,
  socNoite: 40,
  bombaKw: 15,
  cargaNoiteKw: 8,
  noiteInicio: 17,
  noiteFim: 6,
  maxIdadeMin: 45,
};

export function energyAlarmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EnergyAlarmConfig {
  const num = (k: string, d: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) ? v : d;
  };
  const d = DEFAULT_ENERGY_ALARM_CONFIG;
  return {
    socCritico: num("ALERTA_SOC_CRITICO", d.socCritico),
    socNoite: num("ALERTA_SOC_NOITE", d.socNoite),
    bombaKw: num("ALERTA_BOMBA_KW", d.bombaKw),
    cargaNoiteKw: num("ALERTA_CARGA_NOITE_KW", d.cargaNoiteKw),
    noiteInicio: num("ALERTA_NOITE_INICIO", d.noiteInicio),
    noiteFim: num("ALERTA_NOITE_FIM", d.noiteFim),
    maxIdadeMin: num("ALERTA_MAX_IDADE_MIN", d.maxIdadeMin),
  };
}

export function isEnergyAlertsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ENERGY_ALERTS ?? "on").trim().toLowerCase() !== "off";
}

export type EnergyAlarmInput = {
  soc: number | null;
  loadKw: number | null;
  batteryKw: number | null;
  /** Idade da leitura em minutos. */
  readingAgeMin: number;
  /** Hora local com fração (ex.: 17.5 = 17:30). */
  localHour: number;
  config?: Partial<EnergyAlarmConfig>;
};

export type AlarmToOpen = { type: string; severity: "CRITICAL" | "WARNING"; description: string };

export type EnergyAlarmDecision = {
  open: AlarmToOpen[];
  /** Tipos cuja condição deixou de valer (fechar se estiverem abertos). */
  close: string[];
};

export function isNight(localHour: number, cfg: EnergyAlarmConfig): boolean {
  return cfg.noiteInicio > cfg.noiteFim
    ? localHour >= cfg.noiteInicio || localHour < cfg.noiteFim
    : localHour >= cfg.noiteInicio && localHour < cfg.noiteFim;
}

function fmtHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Regras determinísticas: a mesma entrada dá sempre a mesma saída (testável). */
export function decideEnergyAlarms(input: EnergyAlarmInput): EnergyAlarmDecision {
  const cfg = { ...DEFAULT_ENERGY_ALARM_CONFIG, ...(input.config ?? {}) };
  const open: AlarmToOpen[] = [];
  const close: string[] = [];

  // Sem leitura fresca não se afirma nada (nem fecha: pode estar tudo cego).
  if (input.readingAgeMin > cfg.maxIdadeMin) return { open, close };

  const night = isNight(input.localHour, cfg);
  const soc = input.soc;
  const load = input.loadKw;
  const bat = input.batteryKw ?? 0;
  const hora = fmtHour(input.localHour);
  // Queda de SOC em pontos/hora a partir da descarga atual (1 pp ≈ 2 kWh na Barragem;
  // é só orientação na mensagem, não regra).
  const quedaPph = bat < 0 ? Math.round((-bat / 2) * 10) / 10 : 0;

  if (soc !== null) {
    if (soc <= cfg.socCritico) {
      open.push({
        type: ALARM_SOC_CRITICO, severity: "CRITICAL",
        description: `SOC em ${soc}% às ${hora} (limite ${cfg.socCritico}%). Carga ${load ?? "?"} kW${quedaPph ? `, caindo ~${quedaPph} pontos/h` : ""}. Risco de proteção do BESS e Black Start presencial.`,
      });
    } else if (soc >= cfg.socCritico + 5) {
      close.push(ALARM_SOC_CRITICO);
    }

    if (night && soc <= cfg.socNoite) {
      open.push({
        type: ALARM_SOC_BAIXO_NOITE, severity: "WARNING",
        description: `SOC em ${soc}% às ${hora}, sem sol para recuperar (aviso em ${cfg.socNoite}%). Carga ${load ?? "?"} kW${quedaPph ? `, caindo ~${quedaPph} pontos/h` : ""}. Reduzir carga ou preparar para a madrugada.`,
      });
    } else if (!night || soc >= cfg.socNoite + 5) {
      close.push(ALARM_SOC_BAIXO_NOITE);
    }
  }

  if (load !== null) {
    if (night && load >= cfg.bombaKw) {
      open.push({
        type: ALARM_BOMBA_SEM_SOL, severity: "CRITICAL",
        description: `Bombas ligadas às ${hora} com ${load} kW de carga e sem sol. SOC ${soc ?? "?"}%${quedaPph ? `, caindo ~${quedaPph} pontos/h` : ""}. Desligar as bombas de 30 cv para a bateria atravessar a noite.`,
      });
    } else if (!night || load < cfg.bombaKw * 0.7) {
      close.push(ALARM_BOMBA_SEM_SOL);
    }

    if (night && load >= cfg.cargaNoiteKw && load < cfg.bombaKw) {
      open.push({
        type: ALARM_CARGA_NOTURNA, severity: "WARNING",
        description: `Carga noturna de ${load} kW às ${hora}, acima dos 5–6 kW normais do poço. SOC ${soc ?? "?"}%. Conferir o que mais está ligado.`,
      });
    } else if (!night || load < cfg.cargaNoiteKw * 0.8) {
      close.push(ALARM_CARGA_NOTURNA);
    }
  }

  return { open, close };
}

export function localHourNow(now: Date = new Date(), timeZone = "America/Sao_Paulo"): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

// ── Varredura (efeitos ficam nas dependências) ──

export type EnergySweepDeps = {
  listSites: () => Promise<Array<{ id: number; slug: string; name: string }>>;
  latestReading: (siteId: number) => Promise<{ soc: number | null; loadKw: number | null; batteryKw: number | null; at: Date } | null>;
  listOpen: (siteId: number) => Promise<string[]>;
  open: (siteId: number, a: AlarmToOpen) => Promise<void>;
  close: (siteId: number, type: string) => Promise<void>;
  event: (siteId: number, type: string, description: string) => Promise<void>;
  notify: (siteName: string, a: AlarmToOpen) => Promise<void>;
  now?: () => Date;
  config?: EnergyAlarmConfig;
  /** Slugs vigiados; vazio = todos. */
  sites?: string[];
};

export async function sweepEnergyAlarms(deps: EnergySweepDeps): Promise<{ opened: number; closed: number; skipped: number }> {
  const now = deps.now?.() ?? new Date();
  const cfg = deps.config ?? DEFAULT_ENERGY_ALARM_CONFIG;
  const watched = (deps.sites ?? []).filter(Boolean);
  let opened = 0, closed = 0, skipped = 0;

  for (const site of await deps.listSites()) {
    if (watched.length && !watched.includes(site.slug)) continue;
    const r = await deps.latestReading(site.id);
    if (!r) { skipped++; continue; }
    const decision = decideEnergyAlarms({
      soc: r.soc, loadKw: r.loadKw, batteryKw: r.batteryKw,
      readingAgeMin: (now.getTime() - r.at.getTime()) / 60_000,
      localHour: localHourNow(now),
      config: cfg,
    });
    const openTypes = new Set(await deps.listOpen(site.id));
    for (const a of decision.open) {
      if (openTypes.has(a.type)) continue;
      await deps.open(site.id, a);
      await deps.event(site.id, a.type, a.description);
      await deps.notify(site.name, a);
      opened++;
    }
    for (const t of decision.close) {
      if (!openTypes.has(t)) continue;
      await deps.close(site.id, t);
      closed++;
    }
  }
  return { opened, closed, skipped };
}
