/**
 * Waveshare Modbus POE ETH Relay (B) — leitor SÓ DE LEITURA.
 *
 * É o braço atuador da bomba da Barragem (relé 1 → bobina do contator → inversores
 * de frequência → bombas). Esta camada NÃO escreve: só lê o estado do relé e o
 * retorno do contator para o dashboard supervisionar. A atuação (Flash ON por FC05)
 * é Fase 2, fica em outro módulo, atrás de autorização explícita (DECISION-CAMINHO-2 §4).
 *
 * Protocolo confirmado em campo (sonda 21/10): o relé da Barragem (192.168.88.20)
 * fala **Modbus TCP na 502** (MBAP), unit id 1 — NÃO é RTU-sobre-TCP. Modo das
 * entradas = Normal (0) nos 8 canais. Registrador 0x8000 devolveu 0x0064 (≠ 0x00C8
 * que o manual previa) — relevante só para o quadro de escrita da Fase 2.
 */
import { ModbusTcpReader, type ModbusTcpReaderOptions } from "./modbus-tcp";

/** Mapa (addr decimais Modbus do manual Waveshare (B), SKU 27876). Tudo só-leitura aqui. */
export const WAVESHARE_MAP = {
  /** FC01 — estado das bobinas (relés). 8 canais a partir de 0x0000. 1 = fechado (ON). */
  coils: { address: 0x0000, count: 8 },
  /** FC02 — entradas digitais (contato seco; DI1 = retorno do contator). 8 canais a partir de 0x0000. */
  inputs: { address: 0x0000, count: 8 },
  /** FC03 — modo de cada entrada (0 = Normal; exigido 0 nos canais usados). */
  inputModes: { address: 0x1000, count: 8 },
  /** FC03 — "versão de protocolo" (manual: V2 = 0x00C8). A unidade da Barragem devolve 0x0064. */
  protocol: { address: 0x8000, count: 1 },
  /** Canal do relé que aciona o contator da bomba (1-indexado para humanos → índice 0). */
  pumpRelayChannel: 1,
  /** Entrada digital do contato auxiliar do contator (DI1 → índice 0), quando estiver cabeada. */
  contactorAuxInput: 1,
} as const;

/** Decodifica um bitfield Modbus (LSB do primeiro byte = primeiro canal) em `count` booleanos. */
export function decodeBits(buf: Buffer, count: number): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < count; i++) {
    const byte = buf[Math.floor(i / 8)] ?? 0;
    out.push(((byte >> (i % 8)) & 1) === 1);
  }
  return out;
}

export interface RelaySnapshot {
  ok: boolean;
  err: string | null;
  readAt: Date;
  /** Estado das 8 bobinas; true = fechado (ON). */
  relays: boolean[];
  /** Estado das 8 entradas digitais; true = acionada. */
  inputs: boolean[];
  /** Modo de cada entrada (0 = Normal). */
  inputModes: number[];
  /** Relé da bomba (canal `pumpRelayChannel`) está fechado? */
  pumpRelayClosed: boolean;
  /** Contato auxiliar do contator confirma? `null` quando a DI não está cabeada (todas as DI em 0). */
  contactorConfirmed: boolean | null;
  /** Valor cru do registrador de versão (0x8000). */
  protocolVersion: number | null;
}

export interface ReadRelayOptions {
  unitId?: number;
  /**
   * O contato auxiliar do contator ESTÁ fisicamente cabeado numa entrada digital?
   * Precisa ser um fato de configuração, NÃO inferido do estado atual: inferir "cabeada"
   * de "alguma DI está em 1" esconderia a divergência exata que queremos pegar (relé
   * fechado + contator falhou = todas as DI em 0). Default false → contactorConfirmed = null.
   */
  auxWired?: boolean;
}

/**
 * Lê um retrato completo do relé. Nunca escreve. `reader` é um ModbusTcpReader já aberto
 * (ou será aberto na primeira troca). Erros viram `{ ok:false, err }` em vez de lançar,
 * para a supervisão nunca derrubar a tela por uma leitura falha.
 */
export async function readRelaySnapshot(
  reader: ModbusTcpReader,
  opts: ReadRelayOptions = {},
): Promise<RelaySnapshot> {
  const unitId = opts.unitId ?? 1;
  const readAt = new Date();
  const base: RelaySnapshot = {
    ok: false, err: null, readAt,
    relays: [], inputs: [], inputModes: [],
    pumpRelayClosed: false, contactorConfirmed: null, protocolVersion: null,
  };
  try {
    const coilsBuf = await reader.readCoils(unitId, WAVESHARE_MAP.coils.address, WAVESHARE_MAP.coils.count);
    const inputsBuf = await reader.readDiscreteInputs(unitId, WAVESHARE_MAP.inputs.address, WAVESHARE_MAP.inputs.count);
    const modesBuf = await reader.readHoldingRegisters(unitId, WAVESHARE_MAP.inputModes.address, WAVESHARE_MAP.inputModes.count);
    const protoBuf = await reader.readHoldingRegisters(unitId, WAVESHARE_MAP.protocol.address, WAVESHARE_MAP.protocol.count);

    const relays = decodeBits(coilsBuf, WAVESHARE_MAP.coils.count);
    const inputs = decodeBits(inputsBuf, WAVESHARE_MAP.inputs.count);
    const inputModes = Array.from({ length: WAVESHARE_MAP.inputModes.count }, (_, i) => modesBuf.readUInt16BE(i * 2));
    const protocolVersion = protoBuf.length >= 2 ? protoBuf.readUInt16BE(0) : null;

    const pumpRelayClosed = relays[WAVESHARE_MAP.pumpRelayChannel - 1] ?? false;
    // Só afirma confirma/não-confirma quando a DI está declaradamente cabeada;
    // senão null ("não cabeado") — ver nota em ReadRelayOptions.auxWired.
    const contactorConfirmed = opts.auxWired ? (inputs[WAVESHARE_MAP.contactorAuxInput - 1] ?? false) : null;

    return { ...base, ok: true, relays, inputs, inputModes, pumpRelayClosed, contactorConfirmed, protocolVersion };
  } catch (e) {
    return { ...base, err: e instanceof Error ? e.message : String(e) };
  }
}

/** Abre um reader dedicado ao relé (host da LAN da planta, Modbus TCP 502). O chamador fecha. */
export function openRelayReader(host: string, opts: Partial<ModbusTcpReaderOptions> = {}): ModbusTcpReader {
  return new ModbusTcpReader({ host, port: 502, ...opts });
}
