import { useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import { Move } from "lucide-react";
import type { MotionController, MotionView } from "./motion";

/** Abaixo disto o motor da câmera não sai do lugar (medido em 18/10/2026: 0,05 = parado, 0,15 = ~4°/s). */
const FLOOR = 0.15;
/** Zona morta no centro, em px. */
const DEAD = 10;

/**
 * Superfície analógica: o arrasto escolhe uma das oito direções e a distância
 * do centro escolhe a velocidade, de FLOOR (perto do centro) até a velocidade
 * selecionada (na borda), em curva quadrática para dar controle fino perto do
 * centro. Soltar pára.
 */
export function dialSpeed(distance: number, radius: number, max: number): number {
  const t = Math.min(1, Math.max(0, (distance - DEAD) / Math.max(1, radius - DEAD)));
  const v = FLOOR + (Math.max(FLOOR, max) - FLOOR) * t * t;
  return Math.round(v * 20) / 20; // passos de 0,05: menos comandos repetidos durante o arrasto
}

export default function PtzDial({
  controller,
  view,
  owner,
  disabled,
  speed,
}: {
  controller: MotionController;
  view: MotionView;
  owner: RefObject<number | "keyboard" | null>;
  disabled: boolean;
  speed: number;
}) {
  const pointer = useRef<number | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const active = view.active?.kind === "ptz" && !view.active.zoom;
  function update(event: PointerEvent<HTMLButtonElement>) {
    if (pointer.current !== event.pointerId) return;
    if (owner.current !== event.pointerId) {
      release();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const radius = rect.width / 2 - 28;
    const distance = Math.hypot(dx, dy);
    const ratio = Math.min(distance, radius) / (distance || 1);
    setOffset({ x: dx * ratio, y: dy * ratio });
    if (distance < DEAD) {
      if (controller.view.active) void controller.end();
      return;
    }
    const angle = Math.atan2(-dy, dx);
    const octant = Math.round(angle / (Math.PI / 4));
    const motion = {
      kind: "ptz" as const,
      x: Math.round(Math.cos((octant * Math.PI) / 4)),
      y: Math.round(Math.sin((octant * Math.PI) / 4)),
      zoom: 0,
      speed: dialSpeed(distance, radius, speed),
    };
    if (controller.view.active) controller.update(motion);
    else controller.begin(motion);
  }
  const release = () => {
    if (pointer.current === null) return;
    pointer.current = null;
    owner.current = null;
    setOffset({ x: 0, y: 0 });
    void controller.end();
  };
  const thumbX = active ? (owner.current === "keyboard" && view.active?.kind === "ptz" ? view.active.x * 28 : offset.x) : 0;
  const thumbY = active ? (owner.current === "keyboard" && view.active?.kind === "ptz" ? -view.active.y * 28 : offset.y) : 0;
  return (
    <button
      type="button"
      data-testid="joystick"
      className={"joystick " + (active ? "is-moving" : "")}
      disabled={disabled}
      aria-label="Joystick de movimento. Arraste e segure; solte para parar. No teclado, use as setas."
      aria-pressed={!!active}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || owner.current !== null) return;
        event.preventDefault();
        pointer.current = event.pointerId;
        owner.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={update}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onBlur={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="joystick-ring" />
      <span className="joystick-axis axis-x" />
      <span className="joystick-axis axis-y" />
      <span className="joystick-origin" />
      <span className="joystick-thumb" style={{ transform: `translate(${thumbX}px,${thumbY}px)` }}>
        <Move size={19} />
      </span>
    </button>
  );
}
