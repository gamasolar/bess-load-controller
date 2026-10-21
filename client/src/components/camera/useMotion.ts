import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { MotionController } from "./motion";
import type { CameraAdapter, Motion } from "./types";

/** A câmera pára sozinha 5 s após o último comando; o keepalive vai a cada 3 s depois da resposta anterior. */
const KEEPALIVE_MS = 3000;
const RESPONSE_MS = 4000;

export function useMotion(adapter: CameraAdapter, id: string, enabled: boolean, speed: number) {
  const controller = useMemo(
    () =>
      new MotionController(
        { move: (m) => adapter.move(id, m), stop: (k) => adapter.stop(id, k) },
        KEEPALIVE_MS,
        RESPONSE_MS,
      ),
    [adapter, id],
  );
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const owner = useRef<number | "keyboard" | null>(null);
  const keys = useRef(new Set<string>());
  const stop = () => {
    owner.current = null;
    keys.current.clear();
    void controller.end();
  };
  useEffect(() => {
    const release = (e: PointerEvent) => {
      if (owner.current === e.pointerId) stop();
    };
    const interrupt = () => stop();
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", interrupt);
    window.addEventListener("pagehide", interrupt);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", interrupt);
      window.removeEventListener("pagehide", interrupt);
      document.removeEventListener("visibilitychange", visibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const movement = () => {
      const k = keys.current;
      return {
        kind: "ptz" as const,
        x: Number(k.has("ArrowRight")) - Number(k.has("ArrowLeft")),
        y: Number(k.has("ArrowUp")) - Number(k.has("ArrowDown")),
        zoom: Number(k.has("+") || k.has("=")) - Number(k.has("-")),
        speed,
      };
    };
    const editable = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      return !!element?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]');
    };
    const down = (event: KeyboardEvent) => {
      if (!enabled || editable(event) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "+", "=", "-"].includes(event.key)) return;
      event.preventDefault();
      if (owner.current !== null && owner.current !== "keyboard") return;
      keys.current.add(event.key);
      const m = movement();
      if (owner.current === "keyboard") controller.update(m);
      else if (controller.begin(m)) owner.current = "keyboard";
    };
    const up = (event: KeyboardEvent) => {
      if (!keys.current.has(event.key)) return;
      keys.current.delete(event.key);
      if (!keys.current.size) stop();
      else controller.update(movement());
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      stop();
    };
  }, [enabled, speed, controller]); // eslint-disable-line react-hooks/exhaustive-deps
  const hold = (motion: Motion) => ({
    onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
      if (!enabled || event.button !== 0 || owner.current !== null) return;
      event.preventDefault();
      if (controller.begin(motion)) {
        owner.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    onPointerUp() {
      stop();
    },
    onPointerCancel() {
      stop();
    },
    onLostPointerCapture() {
      stop();
    },
    onContextMenu(event: React.MouseEvent) {
      event.preventDefault();
    },
    onKeyDown(event: React.KeyboardEvent) {
      if ((event.key === " " || event.key === "Enter") && !event.repeat && enabled && owner.current === null) {
        event.preventDefault();
        if (controller.begin(motion)) owner.current = "keyboard";
      }
    },
    onKeyUp(event: React.KeyboardEvent) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        stop();
      }
    },
    onBlur() {
      stop();
    },
  });
  return { controller, view, hold, stop, owner };
}
