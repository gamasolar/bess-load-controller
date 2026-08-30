import { describe, it, expect } from "vitest";
import {
  decideAutomacaoAlarm, decideBrokerAlarm,
  describeAutomacaoOffline, describeBrokerOffline,
  AUTOMACAO_OFFLINE_THRESHOLD_MS, BROKER_OFFLINE_THRESHOLD_MS,
} from "./connectivity-alarm";

const NOW = new Date("2026-08-30T19:00:00Z").getTime();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

describe("decideAutomacaoAlarm", () => {
  it("marca o início da contagem na primeira varredura com dispositivo mudo", () => {
    const a = decideAutomacaoAlarm({ brokerConnected: true, automacaoOnline: false, offlineSince: null, now: NOW });
    expect(a.kind).toBe("MARK_OFFLINE");
    if (a.kind === "MARK_OFFLINE") expect(a.since.getTime()).toBe(NOW);
  });

  it("não alarma antes do limite de 15min", () => {
    const a = decideAutomacaoAlarm({ brokerConnected: true, automacaoOnline: false, offlineSince: minutesAgo(14), now: NOW });
    expect(a.kind).toBe("NONE");
  });

  it("alarma exatamente no limite de 15min", () => {
    const a = decideAutomacaoAlarm({
      brokerConnected: true, automacaoOnline: false,
      offlineSince: new Date(NOW - AUTOMACAO_OFFLINE_THRESHOLD_MS), now: NOW,
    });
    expect(a.kind).toBe("OPEN_ALARM");
    if (a.kind === "OPEN_ALARM") expect(a.offlineMinutes).toBe(15);
  });

  it("reporta a duração real em quedas longas (caso Barragem 29-30/08: 16h)", () => {
    const a = decideAutomacaoAlarm({ brokerConnected: true, automacaoOnline: false, offlineSince: minutesAgo(16 * 60 + 25), now: NOW });
    expect(a.kind).toBe("OPEN_ALARM");
    if (a.kind === "OPEN_ALARM") expect(a.offlineMinutes).toBe(985);
  });

  it("fecha o alarme quando o dispositivo volta", () => {
    const a = decideAutomacaoAlarm({ brokerConnected: true, automacaoOnline: true, offlineSince: minutesAgo(60), now: NOW });
    expect(a.kind).toBe("CLEAR");
  });

  it("não faz nada quando está online e nunca esteve offline", () => {
    const a = decideAutomacaoAlarm({ brokerConnected: true, automacaoOnline: true, offlineSince: null, now: NOW });
    expect(a.kind).toBe("NONE");
  });

  it("NÃO culpa o dispositivo quando o broker está fora do ar", () => {
    // Se o broker caiu, o silêncio pode ser nosso. Alarmar SONOFF_OFFLINE aqui
    // mandaria alguém dirigir até a planta para um problema do servidor.
    const a = decideAutomacaoAlarm({ brokerConnected: false, automacaoOnline: false, offlineSince: minutesAgo(120), now: NOW });
    expect(a.kind).toBe("NONE");
  });

  it("congela o marcador durante a queda do broker (não zera a contagem)", () => {
    const since = minutesAgo(10);
    const durante = decideAutomacaoAlarm({ brokerConnected: false, automacaoOnline: false, offlineSince: since, now: NOW });
    expect(durante.kind).toBe("NONE");
    // broker volta 20min depois e o dispositivo segue mudo: a contagem original vale
    const depois = decideAutomacaoAlarm({ brokerConnected: true, automacaoOnline: false, offlineSince: since, now: NOW + 20 * 60_000 });
    expect(depois.kind).toBe("OPEN_ALARM");
    if (depois.kind === "OPEN_ALARM") expect(depois.offlineMinutes).toBe(30);
  });

  it("respeita threshold customizado", () => {
    const a = decideAutomacaoAlarm({
      brokerConnected: true, automacaoOnline: false,
      offlineSince: minutesAgo(3), now: NOW, thresholdMs: 2 * 60_000,
    });
    expect(a.kind).toBe("OPEN_ALARM");
  });
});

describe("decideBrokerAlarm", () => {
  it("marca a queda na primeira varredura", () => {
    const a = decideBrokerAlarm({ brokerConnected: false, disconnectedSince: null, now: NOW });
    expect(a.kind).toBe("MARK_DISCONNECTED");
  });

  it("não alarma antes de 5min", () => {
    const a = decideBrokerAlarm({ brokerConnected: false, disconnectedSince: NOW - 4 * 60_000, now: NOW });
    expect(a.kind).toBe("NONE");
  });

  it("alarma no limite de 5min", () => {
    const a = decideBrokerAlarm({ brokerConnected: false, disconnectedSince: NOW - BROKER_OFFLINE_THRESHOLD_MS, now: NOW });
    expect(a.kind).toBe("OPEN_ALARM");
    if (a.kind === "OPEN_ALARM") expect(a.offlineMinutes).toBe(5);
  });

  it("fecha ao reconectar", () => {
    const a = decideBrokerAlarm({ brokerConnected: true, disconnectedSince: NOW - 60_000, now: NOW });
    expect(a.kind).toBe("CLEAR");
  });

  it("não faz nada em operação normal", () => {
    const a = decideBrokerAlarm({ brokerConnected: true, disconnectedSince: null, now: NOW });
    expect(a.kind).toBe("NONE");
  });
});

describe("mensagens", () => {
  it("formata minutos", () => {
    expect(describeAutomacaoOffline("Barragem", 22)).toContain("há 22min");
  });

  it("formata horas com minutos zero-padded", () => {
    const msg = describeAutomacaoOffline("Barragem", 985);
    expect(msg).toContain("há 16h25");
    expect(msg).toContain("Barragem");
  });

  it("aponta o dispositivo, não o servidor, quando o broker está OK", () => {
    expect(describeAutomacaoOffline("Barragem", 30)).toContain("broker MQTT está acessível");
  });

  it("mensagem do broker fala do servidor", () => {
    expect(describeBrokerOffline(7)).toContain("sem conexão com o broker MQTT há 7min");
  });
});
