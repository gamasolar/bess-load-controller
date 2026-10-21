import type { Motion, MotionKind } from "./types";

export type MotionView = {
  phase: "idle" | "moving" | "stopping" | "error";
  active: Motion | null;
  message: string;
};

const label = (m: Motion) =>
  m.kind === "focus"
    ? "Ajustando foco…"
    : m.zoom
      ? m.zoom > 0
        ? "Aproximando…"
        : "Afastando…"
      : "Movendo" +
        (m.y ? (m.y > 0 ? " para cima" : " para baixo") : "") +
        (m.x ? (m.x > 0 ? " à direita" : " à esquerda") : "") +
        "…";

/**
 * Um dono, um comando em voo. Um gesto solto nunca agenda outro keepalive.
 * A parada é enviada na hora, e DE NOVO depois que um movimento atrasado
 * termina. A câmera ainda precisa do próprio timeout (5 s sem keepalive)
 * para o caso de a rede cair.
 *
 * Um gesto novo durante a parada anterior (toques seguidos) não é perdido:
 * fica como desejado e sai assim que a parada responder. Uma mudança de
 * velocidade/direção durante um comando em voo sai logo depois dele, sem
 * esperar o keepalive.
 */
export class MotionController {
  view: MotionView = {
    phase: "idle",
    active: null,
    message: "Pronta para comandar",
  };
  private listeners = new Set<() => void>();
  private desired: Motion | null = null;
  private generation = 0;
  private busy = false;
  private stopTask: Promise<void> | null = null;
  private lastKind: MotionKind = "ptz";
  private needsStop = false;
  /** O movimento do gesto atual já saiu? */
  private sent = false;
  /** Gesto soltou antes de o movimento sair (toque curto durante a parada anterior): vira pulso. */
  private tap = false;
  private timer?: ReturnType<typeof setTimeout>;
  private warning?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(
    private transport: {
      move: (m: Motion) => Promise<void>;
      stop: (kind: MotionKind) => Promise<void>;
    },
    private keepaliveMs = 3000,
    private responseMs = 4000,
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.view;
  private publish(view: MotionView) {
    this.view = view;
    this.listeners.forEach((fn) => fn());
  }
  private clearTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  begin(motion: Motion) {
    // Recusa só com parada falhada à espera de "tentar de novo"; parada em voo não bloqueia.
    if (this.disposed || this.desired || (this.needsStop && !this.stopTask)) return false;
    this.desired = motion;
    this.lastKind = motion.kind;
    this.generation++;
    this.sent = false;
    this.tap = false;
    this.publish({ phase: "moving", active: motion, message: label(motion) });
    void this.pump();
    return true;
  }
  update(motion: Motion) {
    if (!this.desired || this.desired.kind !== motion.kind) return;
    if (JSON.stringify(this.desired) === JSON.stringify(motion)) return;
    this.desired = motion;
    this.publish({ phase: "moving", active: motion, message: label(motion) });
    this.clearTimer();
    void this.pump();
  }
  end() {
    if (this.desired && !this.sent && this.stopTask) {
      // Toque curto enquanto a parada do gesto anterior ainda viaja: o movimento sai
      // depois dela e é parado logo em seguida (pulso), em vez de se perder.
      this.tap = true;
      return this.stopTask;
    }
    if (!this.desired && !this.busy && !this.needsStop) return this.stopTask ?? Promise.resolve();
    this.desired = null;
    this.generation++;
    this.clearTimer();
    this.publish({ phase: "stopping", active: null, message: "Enviando parada…" });
    return this.stopNow();
  }
  retryStop = () => {
    this.needsStop = true;
    return this.end();
  };
  private stopNow(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.needsStop = true;
    const kind = this.lastKind;
    let stopTimeout: ReturnType<typeof setTimeout>;
    const request = Promise.resolve().then(() => this.transport.stop(kind));
    const deadline = new Promise<never>((_, reject) => {
      stopTimeout = setTimeout(() => reject(new Error("Stop acknowledgement timeout")), this.responseMs);
    });
    this.stopTask = Promise.race([request, deadline])
      .then(() => {
        this.needsStop = false;
        if (!this.busy && !this.desired)
          this.publish({ phase: "idle", active: null, message: "Comando de parada confirmado" });
      })
      .catch(() => {
        this.publish({ phase: "error", active: null, message: "Parada sem confirmação. Tente parar novamente." });
      })
      .finally(() => {
        clearTimeout(stopTimeout);
        this.stopTask = null;
        if (this.desired && !this.needsStop) void this.pump();
      });
    return this.stopTask;
  }
  private async pump() {
    if (!this.desired || this.busy || this.stopTask || this.disposed) return;
    this.busy = true;
    const generation = this.generation;
    const motion = this.desired;
    this.warning = setTimeout(() => {
      if (this.busy) {
        void this.end();
        this.publish({ phase: "error", active: null, message: "Câmera sem confirmação. Enviando parada…" });
      }
    }, this.responseMs);
    let failed = false;
    this.sent = true;
    try {
      await this.transport.move(motion);
    } catch {
      failed = true;
      this.desired = null;
      this.generation++;
    } finally {
      this.busy = false;
      clearTimeout(this.warning);
    }
    if (this.tap && !failed) {
      // Pulso: o gesto já foi solto; pára agora que o movimento saiu.
      this.tap = false;
      this.desired = null;
      this.generation++;
    }
    if (failed || !this.desired || this.disposed) {
      // A primeira parada pode ter chegado ANTES do movimento atrasado: espera e manda outra.
      if (this.stopTask) await this.stopTask;
      await this.stopNow();
      if (failed && !this.needsStop)
        this.publish({ phase: "error", active: null, message: "Movimento não confirmado. Comando de parada enviado." });
      return;
    }
    if (this.desired !== motion || generation !== this.generation) {
      // Direção/velocidade mudou (ou gesto novo) enquanto este comando viajava: manda já.
      void this.pump();
      return;
    }
    this.timer = setTimeout(() => {
      void this.pump();
    }, this.keepaliveMs);
  }
  dispose() {
    this.disposed = true;
    this.clearTimer();
    clearTimeout(this.warning);
    void this.end();
  }
}
