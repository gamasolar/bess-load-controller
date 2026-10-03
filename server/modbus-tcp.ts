/**
 * Cliente Modbus TCP mínimo, sem dependências, SOMENTE LEITURA.
 *
 * Existe para falar com o SmartLogger3000 da Huawei (porta 502) conforme o
 * "SmartLogger ModBus Interface Definitions", Issue 47 (2024-09-19).
 *
 * LEITURA POR CONSTRUÇÃO: esta classe só implementa
 *   - 0x03  Read Holding Registers
 *   - 0x2B  Read Device Identification (MEI 0x0E)
 * Não há 0x06 nem 0x10. Isso é deliberado: o mapa do SmartLogger tem
 * registradores de escrita que desligam o ESS, resetam o array, apagam
 * inversores e disparam black start (ver WRITE_REGISTERS em
 * smartlogger-map.ts). Qualquer escrita futura deve nascer em outro módulo,
 * com autorização explícita do operador (CLAUDE.md §14).
 */

import net from "node:net";

/** Timeout de resposta definido pela Huawei (§4.2.4 do documento): 5 s. */
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_PORT = 502;
/** Limite do FC03 na norma e no documento (§4.3.3.1). */
export const MAX_REGISTERS_PER_READ = 125;

export const EXCEPTION_NAMES: Record<number, string> = {
  0x01: "ILLEGAL FUNCTION (função não suportada)",
  0x02: "ILLEGAL DATA ADDRESS (endereço inexistente)",
  0x03: "ILLEGAL DATA VALUE (valor/quantidade inválidos)",
  0x04: "SERVER DEVICE FAILURE (falha no dispositivo)",
  0x05: "ACKNOWLEDGE (em processamento)",
  0x06: "SERVER DEVICE BUSY (ocupado)",
  0x08: "MEMORY PARITY ERROR",
  0x0a: "GATEWAY PATH UNAVAILABLE (gateway sem caminho)",
  0x0b: "GATEWAY TARGET DEVICE FAILED TO RESPOND (dispositivo não respondeu)",
  0x80: "NO PERMISSION (sem permissão)",
};

export class ModbusExceptionError extends Error {
  constructor(public readonly functionCode: number, public readonly exceptionCode: number) {
    super(
      `Exceção Modbus 0x${exceptionCode.toString(16).padStart(2, "0")} ` +
      `(${EXCEPTION_NAMES[exceptionCode] ?? "desconhecida"}) na função 0x${functionCode.toString(16).padStart(2, "0")}`,
    );
    this.name = "ModbusExceptionError";
  }
}

export class ModbusTimeoutError extends Error {
  constructor(ms: number) {
    super(`Sem resposta Modbus em ${ms} ms`);
    this.name = "ModbusTimeoutError";
  }
}

export class ModbusProtocolError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ModbusProtocolError";
  }
}

/** Monta um quadro Modbus TCP: MBAP (7 bytes) + PDU. */
export function buildFrame(transactionId: number, unitId: number, pdu: Buffer): Buffer {
  const frame = Buffer.alloc(7 + pdu.length);
  frame.writeUInt16BE(transactionId & 0xffff, 0);
  frame.writeUInt16BE(0, 2); // protocolo Modbus
  frame.writeUInt16BE(pdu.length + 1, 4); // unit id + PDU
  frame.writeUInt8(unitId & 0xff, 6);
  pdu.copy(frame, 7);
  return frame;
}

/** PDU do FC03. Endereço é o decimal literal do documento Huawei (ex.: 40515). */
export function buildReadHoldingPdu(address: number, quantity: number): Buffer {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
    throw new RangeError(`Endereço fora de 0..65535: ${address}`);
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_REGISTERS_PER_READ) {
    throw new RangeError(`Quantidade fora de 1..${MAX_REGISTERS_PER_READ}: ${quantity}`);
  }
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(0x03, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(quantity, 3);
  return pdu;
}

export interface DeviceIdObject {
  id: number;
  value: Buffer;
}

export interface DeviceIdResponse {
  conformity: number;
  more: boolean;
  nextObjectId: number;
  objects: DeviceIdObject[];
}

/** Interpreta a resposta do FC 0x2B / MEI 0x0E (PDU completo, incluindo o código de função). */
export function parseDeviceIdPdu(pdu: Buffer): DeviceIdResponse {
  if (pdu.length < 7 || pdu[0] !== 0x2b || pdu[1] !== 0x0e) {
    throw new ModbusProtocolError(`Resposta 0x2B malformada: ${pdu.toString("hex")}`);
  }
  const conformity = pdu[3];
  const more = pdu[4] === 0xff;
  const nextObjectId = pdu[5];
  const count = pdu[6];
  const objects: DeviceIdObject[] = [];
  let off = 7;
  for (let i = 0; i < count; i++) {
    if (off + 2 > pdu.length) throw new ModbusProtocolError("Lista de objetos 0x2B truncada");
    const id = pdu[off];
    const len = pdu[off + 1];
    if (off + 2 + len > pdu.length) throw new ModbusProtocolError("Objeto 0x2B truncado");
    objects.push({ id, value: Buffer.from(pdu.subarray(off + 2, off + 2 + len)) });
    off += 2 + len;
  }
  return { conformity, more, nextObjectId, objects };
}

interface Pending {
  tid: number;
  resolve: (pdu: Buffer) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ModbusTcpReaderOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
}

export class ModbusTcpReader {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;

  private socket: net.Socket | null = null;
  private rx: Buffer = Buffer.alloc(0);
  private tid = 0;
  private pending: Pending | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  /** Contagem de requisições por código de função — auditoria de que só houve leitura. */
  readonly sentFunctionCodes = new Map<number, number>();

  constructor(opts: ModbusTcpReaderOptions) {
    this.host = opts.host;
    this.port = opts.port ?? DEFAULT_PORT;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /** Lê `quantity` holding registers. Devolve os bytes de dados (2 × quantity, big-endian). */
  readHoldingRegisters(unitId: number, address: number, quantity: number): Promise<Buffer> {
    const pdu = buildReadHoldingPdu(address, quantity);
    return this.enqueue(async () => {
      const res = await this.exchange(unitId, pdu);
      if (res[0] !== 0x03) throw new ModbusProtocolError(`Função inesperada na resposta: 0x${res[0].toString(16)}`);
      const byteCount = res[1];
      if (byteCount !== quantity * 2 || res.length < 2 + byteCount) {
        throw new ModbusProtocolError(`Esperava ${quantity * 2} bytes, vieram ${byteCount} (${res.length - 2} no quadro)`);
      }
      return Buffer.from(res.subarray(2, 2 + byteCount));
    });
  }

  /** FC 0x2B / MEI 0x0E. `readCode` 1 = identificação básica; 3 = lista de dispositivos (objeto 0x87+). */
  readDeviceIdentification(unitId: number, readCode: number, objectId: number): Promise<DeviceIdResponse> {
    const pdu = Buffer.from([0x2b, 0x0e, readCode & 0xff, objectId & 0xff]);
    return this.enqueue(async () => parseDeviceIdPdu(await this.exchange(unitId, pdu)));
  }

  close(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new ModbusProtocolError("Conexão fechada pelo cliente"));
      this.pending = null;
    }
    this.socket?.destroy();
    this.socket = null;
    this.rx = Buffer.alloc(0);
  }

  // ── internos ──────────────────────────────────────────────────────────

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private ensureConnected(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new ModbusTimeoutError(this.timeoutMs));
      }, this.timeoutMs);
      sock.once("connect", () => {
        clearTimeout(timer);
        sock.setNoDelay(true);
        this.socket = sock;
        this.rx = Buffer.alloc(0);
        // Os eventos de um socket já descartado (após timeout) chegam atrasados; só o
        // socket corrente pode mexer no estado, senão ele derruba a requisição seguinte.
        sock.on("data", (chunk) => { if (this.socket === sock) this.onData(chunk); });
        sock.on("close", () => { if (this.socket === sock) this.onClose(new ModbusProtocolError("Conexão encerrada pelo servidor")); });
        sock.on("error", (e) => { if (this.socket === sock) this.onClose(e); });
        resolve(sock);
      });
      sock.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  private onClose(err: Error): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(err);
      this.pending = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  private onData(chunk: Buffer): void {
    this.rx = this.rx.length ? Buffer.concat([this.rx, chunk]) : chunk;
    while (this.rx.length >= 7) {
      const len = this.rx.readUInt16BE(4);
      if (len < 2) {
        this.onClose(new ModbusProtocolError("Cabeçalho MBAP inválido"));
        return;
      }
      if (this.rx.length < 6 + len) break;
      const frame = this.rx.subarray(0, 6 + len);
      this.rx = this.rx.subarray(6 + len);
      const tid = frame.readUInt16BE(0);
      const pdu = Buffer.from(frame.subarray(7));
      const p = this.pending;
      if (p && p.tid === tid) {
        clearTimeout(p.timer);
        this.pending = null;
        p.resolve(pdu);
      }
      // quadro com tid que não esperamos: descartado (resposta atrasada de requisição expirada)
    }
  }

  private async exchange(unitId: number, pdu: Buffer): Promise<Buffer> {
    if (!Number.isInteger(unitId) || unitId < 0 || unitId > 247) {
      throw new RangeError(`Unit ID fora de 0..247: ${unitId}`);
    }
    const sock = await this.ensureConnected();
    const tid = (this.tid = (this.tid + 1) & 0xffff);
    const fc = pdu[0];
    this.sentFunctionCodes.set(fc, (this.sentFunctionCodes.get(fc) ?? 0) + 1);

    const res = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        // socket em estado desconhecido após timeout: descarta para a próxima requisição reconectar
        this.socket?.destroy();
        this.socket = null;
        reject(new ModbusTimeoutError(this.timeoutMs));
      }, this.timeoutMs);
      this.pending = { tid, resolve, reject, timer };
      sock.write(buildFrame(tid, unitId, pdu));
    });

    if (res.length < 2) throw new ModbusProtocolError(`PDU curto demais: ${res.toString("hex")}`);
    // Exceção: bit alto do código de função. O documento Huawei cita 0xC1 para o 0x2B
    // (a norma diz 0xAB); tratamos qualquer código com bit alto que não seja o esperado.
    if (res[0] !== fc && (res[0] & 0x80) !== 0) {
      throw new ModbusExceptionError(fc, res[1]);
    }
    return res;
  }
}
