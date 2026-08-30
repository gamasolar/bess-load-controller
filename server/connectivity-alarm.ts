/**
 * Alarmes de conectividade da automação (broker MQTT + controlador da carga).
 *
 * Motivação (2026-08-30): a automação da Barragem ficou 16h fora do ar
 * (queda em 29/08 23:54) e nenhum alarme foi aberto — a falha só apareceu
 * quando alguém foi olhar o log. Ver pendência §7.5 do CLAUDE.md.
 *
 * DISCIPLINA (CLAUDE.md §14): este módulo é PURAMENTE observabilidade.
 * Não toca em `decideAction`, `pickPollInterval` nem `pollSite`, não altera
 * a faixa configurada e não liga/desliga nada. Só abre e fecha registros
 * em `bess_alarms`.
 *
 * Distinção importante: se o broker está fora do ar, NÃO dá pra afirmar
 * nada sobre o dispositivo — o alarme correto é MQTT_BROKER_OFFLINE.
 * Alarmar "automação offline" nesse caso mandaria alguém para a planta
 * quando o problema está no servidor.
 */

/** Controlador mudo por mais que isso (broker OK) → alarme. */
export const AUTOMACAO_OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

/** Broker inalcançável por mais que isso → alarme. Menor porque é falha nossa. */
export const BROKER_OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

export const ALARM_TYPE_AUTOMACAO_OFFLINE = "AUTOMACAO_OFFLINE";
export const ALARM_TYPE_BROKER_OFFLINE = "MQTT_BROKER_OFFLINE";

export type AutomacaoAlarmInput = {
  /** Dashboard está conectado ao broker MQTT neste instante. */
  brokerConnected: boolean;
  /** Último estado conhecido do LWT do dispositivo. */
  automacaoOnline: boolean;
  /** `bess_state.sonoffOfflineSince` — null enquanto online. */
  offlineSince: Date | null;
  now: number;
  thresholdMs?: number;
};

export type AutomacaoAlarmAction =
  | { kind: "NONE" }
  /** Primeira varredura vendo o dispositivo mudo: grava o marcador temporal. */
  | { kind: "MARK_OFFLINE"; since: Date }
  /** Passou do limite: abre o alarme (idempotente a jusante). */
  | { kind: "OPEN_ALARM"; offlineMinutes: number }
  /** Voltou: fecha o alarme e limpa o marcador. */
  | { kind: "CLEAR" };

export function decideAutomacaoAlarm(input: AutomacaoAlarmInput): AutomacaoAlarmAction {
  const threshold = input.thresholdMs ?? AUTOMACAO_OFFLINE_THRESHOLD_MS;

  // Sem broker não há informação sobre o dispositivo: o silêncio pode ser
  // nosso, não dele. Congela o marcador e deixa o alarme de broker falar.
  if (!input.brokerConnected) return { kind: "NONE" };

  if (input.automacaoOnline) {
    return input.offlineSince ? { kind: "CLEAR" } : { kind: "NONE" };
  }

  if (!input.offlineSince) {
    return { kind: "MARK_OFFLINE", since: new Date(input.now) };
  }

  const elapsedMs = input.now - input.offlineSince.getTime();
  if (elapsedMs >= threshold) {
    return { kind: "OPEN_ALARM", offlineMinutes: Math.floor(elapsedMs / 60_000) };
  }
  return { kind: "NONE" };
}

export type BrokerAlarmInput = {
  brokerConnected: boolean;
  /** Epoch ms de quando a queda foi notada; null enquanto conectado. */
  disconnectedSince: number | null;
  now: number;
  thresholdMs?: number;
};

export type BrokerAlarmAction =
  | { kind: "NONE" }
  | { kind: "MARK_DISCONNECTED"; since: number }
  | { kind: "OPEN_ALARM"; offlineMinutes: number }
  | { kind: "CLEAR" };

export function decideBrokerAlarm(input: BrokerAlarmInput): BrokerAlarmAction {
  const threshold = input.thresholdMs ?? BROKER_OFFLINE_THRESHOLD_MS;

  if (input.brokerConnected) {
    return input.disconnectedSince !== null ? { kind: "CLEAR" } : { kind: "NONE" };
  }

  if (input.disconnectedSince === null) {
    return { kind: "MARK_DISCONNECTED", since: input.now };
  }

  const elapsedMs = input.now - input.disconnectedSince;
  if (elapsedMs >= threshold) {
    return { kind: "OPEN_ALARM", offlineMinutes: Math.floor(elapsedMs / 60_000) };
  }
  return { kind: "NONE" };
}

/** Texto humano para o alarme — o operador lê isto na UI e no Telegram. */
export function describeAutomacaoOffline(siteName: string, offlineMinutes: number): string {
  const horas = Math.floor(offlineMinutes / 60);
  const mins = offlineMinutes % 60;
  const duracao = horas > 0 ? `${horas}h${String(mins).padStart(2, "0")}` : `${mins}min`;
  return `Automação de ${siteName} sem comunicação há ${duracao}. ` +
    `O broker MQTT está acessível, então a falha é do dispositivo ou da rede da planta — ` +
    `o controle automático da bomba está sem efeito até ele voltar.`;
}

export function describeBrokerOffline(offlineMinutes: number): string {
  return `Dashboard sem conexão com o broker MQTT há ${offlineMinutes}min. ` +
    `Nenhum comando chega aos dispositivos e o estado real das cargas está desconhecido.`;
}
