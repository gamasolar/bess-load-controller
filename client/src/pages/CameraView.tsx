import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useRoute } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera as CameraIcon,
  Check,
  ChevronRight,
  CircleHelp,
  Expand,
  Focus,
  Gauge,
  Home,
  Image,
  Lightbulb,
  LoaderCircle,
  Maximize,
  Minimize,
  Mic,
  Minus,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
  VideoOff,
  Volume2,
  VolumeX,
  Waves,
  X,
} from "lucide-react";
import { useBessCameraAdapter, usePlayerPrefs } from "@/components/camera/adapter";
import type { Camera, CameraState, Imaging, IrMode, Preset, StreamMode, StreamStats, StreamStatus } from "@/components/camera/types";
import { useMotion } from "@/components/camera/useMotion";
import { useTalk } from "@/components/camera/useTalk";
import PtzDial from "@/components/camera/PtzDial";
import { Sheet } from "@/components/camera/Sheet";
import "./cameras.css";

type Panel = "settings" | "presets" | "save" | "edit" | "delete" | "help" | null;
const imagingNames: Record<"brightness" | "contrast" | "saturation" | "sharpness", string> = {
  brightness: "Brilho",
  contrast: "Contraste",
  saturation: "Saturação",
  sharpness: "Nitidez",
};
const irLabel: Record<IrMode, string> = { auto: "Automático", day: "Dia", night: "Noite" };
const STATE_POLL_MS = 20_000; // cada leitura faz 4–5 chamadas ONVIF pelo túnel; não vale ler a cada segundo

function FloatingButton({
  label,
  children,
  active,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      className={"float-button " + (active ? "active " : "") + className}
      aria-label={label}
      title={label}
      {...(active === undefined ? {} : { "aria-pressed": active })}
      {...props}
    >
      {children}
    </button>
  );
}

export default function CameraView() {
  const [, params] = useRoute("/cameras/:id");
  const id = params?.id ?? "";
  const adapter = useBessCameraAdapter();
  const prefs = usePlayerPrefs();
  const [camera, setCamera] = useState<Camera | null>(null);
  const [state, setState] = useState<CameraState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [speed, setSpeed] = useState(0.6);
  const [fullscreen, setFullscreen] = useState(false);
  const [strongContrast, setStrongContrast] = useState(false);
  const [presetsVisible, setPresetsVisible] = useState(true);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Preset | null>(null);
  const [stream, setStream] = useState<StreamStatus>("connecting");
  const [streamMode, setStreamMode] = useState<StreamMode>("—");
  const [streamStats, setStreamStats] = useState<StreamStats>({ loss: null, fellBack: false, stalling: false, reduced: false });
  const onStreamStatus = useCallback((s: StreamStatus, m: StreamMode, st: StreamStats) => {
    setStream(s);
    setStreamMode(m);
    setStreamStats((prev) => (prev.loss === st.loss && prev.fellBack === st.fellBack && prev.stalling === st.stalling && prev.reduced === st.reduced ? prev : st));
  }, []);
  const reducedRef = useRef(false);
  useEffect(() => {
    if (streamStats.reduced && !reducedRef.current) {
      reducedRef.current = true;
      toast("Conexão instável: qualidade reduzida para SD automaticamente. Em Ajustes dá para voltar a HD.");
    }
    if (!streamStats.reduced) reducedRef.current = false;
  }, [streamStats.reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const [reloadKey, setReloadKey] = useState(0);
  const [imageDraft, setImageDraft] = useState<Imaging | null>(null);
  const [imageDirty, setImageDirty] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [stateError, setStateError] = useState(false);
  const viewer = useRef<HTMLDivElement>(null);
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wipeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const muted = prefs.muted;
  // Comandos liberados sempre que a câmera responde, mesmo com o vídeo ainda conectando.
  const enabled = !!camera && camera.enabled && !panel && !pending;
  const { controller, view, hold, stop, owner } = useMotion(adapter, id, enabled, speed);
  const talkSrc = camera ? `/api/camera/g/ws?src=${camera.streams.sub.replace(/_sub$/, "_talk")}` : "";
  const talk = useTalk(talkSrc, !!camera && camera.capabilities.talk);

  const toast = useCallback((text: string) => {
    if (!mounted.current) return;
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => {
      if (mounted.current) setNotice("");
    }, 5500);
  }, []);
  useEffect(() => {
    if (talk.error) { toast(talk.error); talk.clearError(); }
  }, [talk.error, toast, talk]);
  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [c, s] = await Promise.all([adapter.get(id), adapter.state(id)]);
      if (mounted.current) {
        setCamera(c);
        setState(s);
        setImageDraft(s.imaging);
      }
    } catch {
      if (mounted.current) setLoadError("Não foi possível carregar esta câmera.");
    }
  }, [adapter, id]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      clearTimeout(noticeTimer.current);
      clearTimeout(wipeTimer.current);
    };
  }, [load]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!document.hidden && !controller.view.active) {
        try {
          const next = await adapter.state(id);
          if (alive) {
            setState(next);
            setStateError(false);
          }
        } catch {
          if (alive) setStateError(true);
        }
      }
      if (alive) timer = setTimeout(poll, STATE_POLL_MS);
    }
    timer = setTimeout(poll, STATE_POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [adapter, id, controller]);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stop();
        setFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", changed);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      window.removeEventListener("keydown", escape);
    };
  }, [controller]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, task: () => Promise<void>, refresh = true) => {
    if (actionLock.current || view.active || view.phase === "stopping") return false;
    if (view.phase === "error") {
      toast("Confirme a parada antes de continuar.");
      return false;
    }
    actionLock.current = true;
    setPending(label);
    try {
      await task();
      if (refresh) {
        const next = await adapter.state(id);
        if (mounted.current) {
          setState(next);
          setStateError(false);
        }
      }
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "A câmera não respondeu. Tente novamente.");
      return false;
    } finally {
      actionLock.current = false;
      if (mounted.current) setPending("");
    }
  };

  // Qualidade: SD (sub), HD (main 1080p) ou 4K (main 4K). 4K/HD reconfiguram o fluxo principal
  // da câmera (reinicia o vídeo por alguns segundos) só quando a resolução precisa mudar.
  const changeQuality = async (target: "sub" | "hd" | "uhd") => {
    if (!camera) return;
    if (target === "sub") {
      void adapter.setQuality(id, "sub");
      return;
    }
    const need = (target === "uhd" ? "uhd" : "hd") !== camera.info.mainQuality;
    if (need) {
      const ok = await run(target === "uhd" ? "Mudando para 4K, alguns segundos…" : "Mudando para HD, alguns segundos…", async () => {
        await adapter.setMainQuality(id, target);
        await load();
      });
      if (!ok) return;
      setReloadKey((k) => k + 1);
    }
    void adapter.setQuality(id, "main");
  };
  const goHome = () =>
    void run("Voltando à posição inicial…", async () => {
      await adapter.home(id);
      toast("Posição inicial solicitada. Aguarde a imagem.");
    });
  useEffect(() => {
    const home = (e: KeyboardEvent) => {
      if (
        !enabled ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      if (e.key.toLowerCase() === "h") {
        e.preventDefault();
        goHome();
      }
    };
    window.addEventListener("keydown", home);
    return () => window.removeEventListener("keydown", home);
  });
  const openPanel = (next: Panel) => {
    stop();
    setPanel(next);
    if (next === "settings" && state) {
      setImageDraft(state.imaging);
      setImageDirty(false);
    }
  };
  const goPreset = (preset: Preset) =>
    void run("Indo para " + preset.name + "…", async () => {
      await adapter.gotoPreset(id, preset.id);
      toast("Posição solicitada. Aguarde a atualização da imagem.");
    }, false);
  const toggleFullscreen = async () => {
    stop();
    if (fullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      setFullscreen(false);
      return;
    }
    // Tela cheia do contêiner para manter os controles; no iPhone cai no modo imersivo por CSS.
    try {
      if (viewer.current?.requestFullscreen) await viewer.current.requestFullscreen();
    } catch {
      /* fallback imersivo por CSS */
    }
    setFullscreen(true);
  };
  const takePhoto = () =>
    void run("Preparando foto…", async () => {
      if (!camera) return;
      const result = await adapter.snapshot(id, camera.name);
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.filename;
      link.rel = "noopener";
      link.click();
      toast("Foto em 4K solicitada à câmera.");
    }, false);
  const audio = () =>
    void run("Ajustando som…", async () => {
      await adapter.setMuted(id, !muted);
    }, false);
  const wipe = () =>
    void run("Acionando limpador…", async () => {
      await adapter.aux(id, "wiper");
      setWiping(true);
      wipeTimer.current = setTimeout(() => {
        if (mounted.current) setWiping(false);
      }, 8000);
      toast("Limpador acionado por alguns segundos.");
    }, false);
  const night = () => {
    if (!state) return;
    const order = state.irModes;
    const next = order[(order.indexOf(state.ir) + 1) % order.length] ?? "auto";
    void run("Alterando modo noturno…", () => adapter.aux(id, "ir", next));
  };

  if (!id)
    return (
      <div className="cams">
        <main className="not-found" role="alert">
          <VideoOff size={36} />
          <h1>Câmera não informada.</h1>
          <Link href="/cameras">Ver câmeras</Link>
        </main>
      </div>
    );
  if (loadError)
    return (
      <div className="cams">
        <main className="not-found" role="alert">
          <VideoOff size={36} />
          <h1>{loadError}</h1>
          <button className="button" onClick={() => void load()}>
            Tentar novamente
          </button>
          <Link href="/cameras">Ver câmeras</Link>
        </main>
      </div>
    );
  if (!camera || !state)
    return (
      <div className="cams">
        <main className="loading-screen" role="status">
          <LoaderCircle className="spin" />
          <p>Preparando a câmera…</p>
        </main>
      </div>
    );

  const locked = !!pending || view.phase === "moving" || view.phase === "stopping" || view.phase === "error";
  const canAct = !locked;
  const titles: Record<NonNullable<Panel>, string> = {
    settings: "Ajustes da câmera",
    presets: "Posições gravadas",
    save: "Gravar esta vista",
    edit: "Renomear posição",
    delete: "Apagar posição",
    help: "Ao alcance da mão",
  };
  const descriptions: Record<NonNullable<Panel>, string> = {
    settings: "Imagem, lente, qualidade e informações.",
    presets: "Um toque para ir. Organize suas vistas frequentes.",
    save: "A posição e a miniatura atuais serão salvas.",
    edit: "Altere o nome; a miniatura é refeita com a vista atual.",
    delete: "A câmera continuará na posição atual.",
    help: "Comandos rápidos para acompanhar a operação.",
  };
  const positionText = state.position
    ? `pan ${state.position.pan?.toFixed(2) ?? "—"} · tilt ${state.position.tilt?.toFixed(2) ?? "—"} · zoom ${state.position.zoom?.toFixed(2) ?? "—"}`
    : "sem leitura";

  return (
    <div className="cams">
      <main className="camera-page">
        <div className="page-breadcrumb">
          <Link href="/cameras">
            <ArrowLeft size={14} />
            Câmeras
          </Link>
          <ChevronRight size={13} />
          <span>{camera.plant}</span>
          <span className="page-kicker">VISÃO DA OPERAÇÃO</span>
        </div>
        <div
          ref={viewer}
          className={
            "viewer " + (fullscreen ? "is-fullscreen " : "") + (strongContrast ? "contrast-strong " : "") + (wiping ? "is-wiping" : "")
          }
          data-testid="viewer"
        >
          <div className="video-layer">{adapter.renderStream(camera, onStreamStatus, reloadKey)}</div>
          <div className="viewer-top">
            <div className="camera-heading">
              <p>
                {camera.plant.toUpperCase()}
                <span className="heading-separator">/</span>
                {prefs.quality === "sub" ? (streamStats.reduced ? "SD · auto" : "SD") : camera.info.mainQuality === "uhd" ? "4K" : "HD"}
              </p>
              <h1>{camera.name}</h1>
              <span className="stream-state">
                <span className={"status-dot " + (stream === "offline" ? "offline" : stream === "connecting" ? "waiting" : "")} />
                {stream === "live" ? "AO VIVO" : stream === "offline" ? "SEM VÍDEO" : "CONECTANDO"}
                <span className="latency">
                  {streamMode === "webrtc"
                    ? "WebRTC · atraso ~1 s" + (streamStats.loss != null && streamStats.loss >= 2 ? ` · perda ${streamStats.loss}%` : "")
                    : streamMode === "mse"
                      ? (streamStats.fellBack ? "MSE (WebRTC sem imagem) · atraso 1,5–3 s" : prefs.transport === "stable" ? "MSE estável · atraso 1,5–3 s" : "MSE · atraso 1,5–3 s")
                      : streamMode === "hls" ? "HLS · atraso maior" : streamMode === "mjpeg" ? "quadros JPEG" : "conectando"}
                </span>
              </span>
            </div>
            <div className="viewer-top-actions">
              <FloatingButton label={fullscreen ? "Sair da tela cheia" : "Tela cheia"} onClick={() => void toggleFullscreen()}>
                {fullscreen ? <Minimize /> : <Expand />}
              </FloatingButton>
              <FloatingButton label="Ajuda e atalhos" className="help-button" onClick={() => openPanel("help")}>
                <CircleHelp />
              </FloatingButton>
            </div>
          </div>
          {stream === "offline" && (
            <div className="video-error" role="alert">
              <VideoOff />
              <p>Imagem indisponível</p>
              <span>A câmera pode levar até 2 minutos para liberar o vídeo após um reinício.</span>
              <button
                className="button"
                onClick={() => {
                  setStream("connecting");
                  setReloadKey((k) => k + 1);
                  void load();
                }}
              >
                Reconectar
              </button>
            </div>
          )}
          {stream === "connecting" && (
            <div className="connecting" role="status">
              <LoaderCircle className="spin" />
              Aguardando imagem…
            </div>
          )}
          <div className={"preset-overlay " + (!presetsVisible ? "is-collapsed" : "")}>
            <div className="preset-label">
              <button onClick={() => setPresetsVisible(!presetsVisible)} aria-expanded={presetsVisible}>
                POSIÇÕES
                <span>{state.presets.length.toString().padStart(2, "0")}</span>
              </button>
              <button className="preset-more" aria-label="Gerenciar posições" onClick={() => openPanel("presets")}>
                <MoreHorizontal size={19} />
              </button>
            </div>
            {presetsVisible && (
              <div className="preset-strip">
                {state.presets.slice(0, 3).map((preset) => (
                  <button
                    type="button"
                    className="preset-thumb"
                    key={preset.id}
                    disabled={!canAct}
                    onClick={() => goPreset(preset)}
                    aria-label={"Ir para " + preset.name}
                  >
                    <span className="preset-photo">
                      {preset.thumbnail ? <img src={preset.thumbnail} alt="" /> : <Image size={20} />}
                    </span>
                    <span>{preset.name}</span>
                  </button>
                ))}
                {state.presets.length === 0 && (
                  <button
                    className="empty-preset"
                    onClick={() => {
                      setName("");
                      openPanel("save");
                    }}
                  >
                    <Plus size={22} />
                    <span>Gravar vista</span>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="command-feedback" aria-live="polite" aria-atomic="true">
            {(pending || view.phase !== "idle") && (
              <span className={view.phase === "error" ? "feedback-error" : "feedback-active"}>
                {pending ? (
                  <LoaderCircle size={14} className="spin" />
                ) : view.phase === "error" ? (
                  <AlertTriangle size={14} />
                ) : (
                  <ArrowRight size={14} />
                )}
                <span>{pending || view.message}</span>
              </span>
            )}
            {view.phase === "error" && (
              <button className="stop-retry" onClick={() => void controller.retryStop()}>
                Confirmar parada
              </button>
            )}
          </div>
          <div className="axis-controls">
            <div className="axis-pair">
              <span>ZOOM</span>
              <FloatingButton
                label="Aproximar: pressione e segure"
                disabled={!enabled || !camera.capabilities.ptz || view.phase === "error"}
                active={view.active?.kind === "ptz" && view.active.zoom === 1}
                {...hold({ kind: "ptz", x: 0, y: 0, zoom: 1, speed })}
              >
                <Plus />
              </FloatingButton>
              <FloatingButton
                label="Afastar: pressione e segure"
                disabled={!enabled || !camera.capabilities.ptz || view.phase === "error"}
                active={view.active?.kind === "ptz" && view.active.zoom === -1}
                {...hold({ kind: "ptz", x: 0, y: 0, zoom: -1, speed })}
              >
                <Minus />
              </FloatingButton>
            </div>
            <div className="axis-pair">
              <span>FOCO</span>
              <FloatingButton
                label="Foco perto: pressione e segure"
                disabled={!enabled || !camera.capabilities.focus || view.phase === "error"}
                active={view.active?.kind === "focus" && view.active.direction === -1}
                {...hold({ kind: "focus", direction: -1 })}
              >
                <Focus size={23} />
                <span className="focus-symbol">−</span>
              </FloatingButton>
              <FloatingButton
                label="Foco longe: pressione e segure"
                disabled={!enabled || !camera.capabilities.focus || view.phase === "error"}
                active={view.active?.kind === "focus" && view.active.direction === 1}
                {...hold({ kind: "focus", direction: 1 })}
              >
                <Focus size={23} />
                <span className="focus-symbol">+</span>
              </FloatingButton>
            </div>
          </div>
          <div className="joystick-group">
            <div className="joystick-caption">
              <span>PTZ</span>
              <FloatingButton label="Voltar à posição inicial (H)" disabled={!canAct || !camera.capabilities.ptz} onClick={goHome}>
                <Home size={21} />
              </FloatingButton>
            </div>
            <PtzDial
              controller={controller}
              view={view}
              owner={owner}
              speed={speed}
              disabled={!enabled || !camera.capabilities.ptz || view.phase === "error"}
            />
            <button
              className="speed-button"
              disabled={locked}
              aria-label={"Velocidade: " + (speed === 0.3 ? "lenta" : speed === 0.6 ? "normal" : "rápida") + ". Alterar velocidade."}
              onClick={() => setSpeed(speed === 0.3 ? 0.6 : speed === 0.6 ? 1 : 0.3)}
            >
              <Gauge size={13} />
              {speed === 0.3 ? "Lenta" : speed === 0.6 ? "Normal" : "Rápida"}
            </button>
          </div>
          <div className="utility-dock">
            <div className="utility">
              <FloatingButton
                label={muted ? "Ativar som" : "Silenciar som"}
                disabled={!canAct || !camera.capabilities.audio}
                active={!muted}
                onClick={audio}
              >
                {muted ? <VolumeX /> : <Volume2 />}
              </FloatingButton>
              <span>Som</span>
            </div>
            {camera.capabilities.talk && (
              <div className="utility">
                <FloatingButton
                  label={talk.talking ? "Falando — toque para parar" : "Falar na câmera: toque para começar (PC ou Wi-Fi)"}
                  disabled={!canAct}
                  active={talk.talking}
                  onClick={talk.toggle}
                >
                  <Mic />
                </FloatingButton>
                <span>{talk.talking ? (talk.connected ? "Falando" : "Conectando…") : "Falar"}</span>
              </div>
            )}
            <div className="utility">
              <FloatingButton label="Baixar foto em 4K" disabled={!canAct || !camera.capabilities.snapshot} onClick={takePhoto}>
                <CameraIcon />
              </FloatingButton>
              <span>Foto 4K</span>
            </div>
            <div className="utility">
              <FloatingButton label="Acionar limpador da lente" disabled={!canAct || !camera.capabilities.wiper || wiping} onClick={wipe} active={wiping}>
                <Waves />
              </FloatingButton>
              <span>Lente</span>
            </div>
            <div className="utility">
              <FloatingButton
                label={state.light ? "Desligar holofote" : "Ligar holofote"}
                disabled={!canAct || !camera.capabilities.light}
                active={state.light}
                onClick={() => void run("Alterando holofote…", () => adapter.aux(id, "light", !state.light))}
              >
                <Lightbulb />
              </FloatingButton>
              <span>Luz</span>
            </div>
            <div className="utility">
              <FloatingButton
                label={"Modo noturno: " + irLabel[state.ir].toLowerCase() + ". Alterar."}
                disabled={!canAct || !camera.capabilities.ir}
                active={state.ir === "night"}
                onClick={night}
              >
                {state.ir === "day" ? <Sun /> : <Moon />}
              </FloatingButton>
              <span>{state.ir === "auto" ? "IR auto" : irLabel[state.ir]}</span>
            </div>
            <div className="utility">
              <FloatingButton label="Abrir ajustes" onClick={() => openPanel("settings")}>
                <Settings2 />
              </FloatingButton>
              <span>Ajustes</span>
            </div>
          </div>
          {notice && (
            <div className="toast" role="status">
              <span>{notice}</span>
              <button aria-label="Dispensar aviso" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
        </div>
        <footer className="viewer-footer">
          <span>
            <ShieldCheck size={14} />
            Solte o controle para enviar a parada
          </span>
          <button
            onClick={() => {
              setName("");
              openPanel("save");
            }}
            disabled={!canAct}
          >
            <Plus size={15} />
            Gravar vista
          </button>
          <button className="keyboard-help" onClick={() => openPanel("help")}>
            Setas · + / − · H
          </button>
        </footer>
        {stateError && (
          <p className="state-warning" role="status">
            Sem confirmação do estado da câmera. As informações podem estar desatualizadas.
          </p>
        )}
        <Sheet
          open={panel !== null}
          onOpenChange={(open) => {
            if (!open) setPanel(null);
          }}
          portalContainer={fullscreen ? viewer.current : undefined}
          title={panel ? titles[panel] : ""}
          description={panel ? descriptions[panel] : ""}
          compact={panel === "save" || panel === "edit" || panel === "delete"}
        >
          {(panel === "save" || panel === "edit") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                void run("Salvando posição…", async () => {
                  await adapter.savePreset(id, name, panel === "edit" ? selected?.id : undefined);
                  setPanel(null);
                  toast("Posição salva.");
                });
              }}
            >
              <label className="field-label" htmlFor="preset-name">
                Nome da posição
              </label>
              <input
                id="preset-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="Ex.: entrada da casa de bombas"
                required
              />
              <p className="field-hint">{name.length}/40 caracteres</p>
              <button className="button primary" type="submit" disabled={!name.trim() || !!pending}>
                {pending || "Salvar posição"}
              </button>
            </form>
          )}
          {panel === "delete" && (
            <div>
              <p>
                Apagar a posição <strong>{selected?.name}</strong>?
              </p>
              <p className="muted">Esta ação remove a vista gravada.</p>
              <div className="action-row">
                <button className="button" onClick={() => setPanel("presets")}>
                  Cancelar
                </button>
                <button
                  className="button danger"
                  disabled={!!pending}
                  onClick={() => {
                    if (!selected) return;
                    void run("Apagando…", async () => {
                      await adapter.removePreset(id, selected.id);
                      setPanel((current) => (current === "delete" ? "presets" : current));
                      toast("Posição apagada.");
                    });
                  }}
                >
                  {pending || "Apagar posição"}
                </button>
              </div>
            </div>
          )}
          {panel === "presets" && (
            <>
              <button
                className="button primary full-width"
                onClick={() => {
                  setName("");
                  setPanel("save");
                }}
              >
                <Plus size={18} />
                Gravar esta vista
              </button>
              <div className="preset-manager">
                {state.presets.map((preset) => (
                  <div key={preset.id} className="preset-manager-row">
                    <button
                      className="preset-go"
                      onClick={() => {
                        setPanel(null);
                        goPreset(preset);
                      }}
                      disabled={locked}
                    >
                      {preset.thumbnail ? <img src={preset.thumbnail} alt="" /> : <span className="preset-blank" />}
                      <span>{preset.name}</span>
                      <ArrowRight size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={"Renomear " + preset.name}
                      onClick={() => {
                        setSelected(preset);
                        setName(preset.name);
                        setPanel("edit");
                      }}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={"Apagar " + preset.name}
                      onClick={() => {
                        setSelected(preset);
                        setPanel("delete");
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
                {!state.presets.length && (
                  <p className="muted">Nenhuma posição gravada. Aponte a câmera e salve sua primeira vista.</p>
                )}
              </div>
            </>
          )}
          {panel === "settings" && (
            <>
              <section className="setting-section">
                <h3>
                  <Maximize size={17} />
                  Qualidade do vídeo
                </h3>
                <div className="segmented">
                  {([["sub", "SD"], ["hd", "HD"], ["uhd", "4K"]] as const).map(([q, label]) => (
                    <button
                      key={q}
                      className="button"
                      aria-pressed={(prefs.quality === "sub" ? "sub" : camera.info.mainQuality === "uhd" ? "uhd" : "hd") === q}
                      disabled={!!pending}
                      onClick={() => void changeQuality(q)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="muted">Padrão em HD (1080p), nítido em qualquer tela. O 4K é mais pesado e serve para telas grandes; muda o fluxo para todos e leva alguns segundos. Se a conexão ficar ruim e travar, o sistema baixa sozinho para SD; é só voltar aqui para subir.</p>
                <h3 style={{ marginTop: 14 }}>
                  <Gauge size={17} />
                  Transmissão
                </h3>
                <div className="segmented">
                  {(["auto", "stable"] as const).map((t) => (
                    <button key={t} className="button" aria-pressed={prefs.transport === t} onClick={() => adapter.setTransport(id, t)}>
                      {t === "auto" ? "Rápida · WebRTC" : "Estável · MSE"}
                    </button>
                  ))}
                </div>
                <p className="muted">
                  Rápida (padrão): ~1 s de atraso pelo WebRTC. Estável: 1,5–3 s, imagem íntegra em qualquer rede; use se a Rápida vier travando ou sem imagem (ex.: 4G que bloqueia o caminho direto).
                </p>
                <label className="switch-row">
                  <span>
                    Reforçar contraste dos botões
                    <small>Mantém o vídeo visível sob cada controle.</small>
                  </span>
                  <input type="checkbox" checked={strongContrast} onChange={(e) => setStrongContrast(e.target.checked)} />
                </label>
              </section>
              <section className="setting-section">
                <h3>
                  <Moon size={17} />
                  Modo noturno
                </h3>
                <div className="segmented">
                  {state.irModes.map((value) => (
                    <button
                      key={value}
                      className="button"
                      aria-pressed={state.ir === value}
                      disabled={!!pending || !camera.capabilities.ir}
                      onClick={() => void run("Alterando modo…", () => adapter.aux(id, "ir", value))}
                    >
                      {irLabel[value]}
                    </button>
                  ))}
                </div>
              </section>
              <section className="setting-section">
                <h3>
                  <Image size={17} />
                  Ajustes de imagem
                </h3>
                {imageDraft &&
                  (Object.keys(imagingNames) as (keyof typeof imagingNames)[]).map((key) => (
                    <label className="range-field" key={key} htmlFor={"image-" + key}>
                      <span>
                        {imagingNames[key]}
                        <output>{imageDraft[key]}%</output>
                      </span>
                      <input
                        id={"image-" + key}
                        aria-label={imagingNames[key]}
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={imageDraft[key]}
                        disabled={!camera.capabilities.imaging || !!pending}
                        onChange={(e) => {
                          setImageDraft({ ...imageDraft, [key]: Number(e.target.value) });
                          setImageDirty(true);
                        }}
                      />
                    </label>
                  ))}
                {imageDraft && imageDraft.wdr !== null && (
                  <label className="switch-row">
                    <span>
                      Faixa dinâmica ampla (WDR)
                      <small>Equilibra áreas muito claras e muito escuras.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={!!imageDraft.wdr}
                      onChange={(e) => {
                        setImageDraft({ ...imageDraft, wdr: e.target.checked });
                        setImageDirty(true);
                      }}
                    />
                  </label>
                )}
                {imageDraft && imageDraft.blc !== null && (
                  <label className="switch-row">
                    <span>
                      Compensação de contraluz (BLC)
                      <small>Realça o que está à frente de um fundo claro.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={!!imageDraft.blc}
                      onChange={(e) => {
                        setImageDraft({ ...imageDraft, blc: e.target.checked });
                        setImageDirty(true);
                      }}
                    />
                  </label>
                )}
                <button
                  className="button primary full-width"
                  disabled={!imageDirty || !!pending || !camera.capabilities.imaging}
                  onClick={() => {
                    if (imageDraft)
                      void run("Aplicando ajustes…", async () => {
                        await adapter.setImaging(id, imageDraft);
                        setImageDirty(false);
                        toast("Ajustes de imagem aplicados.");
                      });
                  }}
                >
                  <Check size={17} />
                  Aplicar ajustes
                </button>
              </section>
              <section className="setting-section">
                <h3>
                  <CameraIcon size={17} />
                  Sobre esta câmera
                </h3>
                <dl>
                  <div>
                    <dt>Usina</dt>
                    <dd>{camera.plant}</dd>
                  </div>
                  <div>
                    <dt>Modelo</dt>
                    <dd>{[camera.info.manufacturer, camera.info.model].filter(Boolean).join(" ") || "—"}</dd>
                  </div>
                  <div>
                    <dt>Firmware</dt>
                    <dd>{camera.info.firmware ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Resolução</dt>
                    <dd>
                      {camera.info.resolutionMain ?? "—"}
                      {camera.info.resolutionSub ? ` · leve ${camera.info.resolutionSub}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Posição atual</dt>
                    <dd>{positionText}</dd>
                  </div>
                  <div>
                    <dt>Relógio da câmera</dt>
                    <dd>
                      {state.clockOffsetSeconds === null
                        ? "—"
                        : Math.abs(state.clockOffsetSeconds) < 60
                          ? "em dia"
                          : `${state.clockOffsetSeconds > 0 ? "+" : "−"}${Math.round(Math.abs(state.clockOffsetSeconds) / 60)} min`}
                    </dd>
                  </div>
                  <div>
                    <dt>Caminho</dt>
                    <dd>{camera.info.hasTunnel ? "túnel provisório" : "rede da usina"}</dd>
                  </div>
                </dl>
                <div className="action-row start">
                  <button
                    className="button"
                    disabled={!!pending || !camera.capabilities.ptz}
                    onClick={() =>
                      void run("Definindo posição inicial…", async () => {
                        await adapter.setHome(id);
                        toast("A vista atual passou a ser a posição inicial.");
                      }, false)
                    }
                  >
                    <Home size={16} />
                    Usar vista atual como inicial
                  </button>
                  <button
                    className="button"
                    disabled={!!pending}
                    onClick={() =>
                      void run("Relendo recursos…", async () => {
                        await adapter.probe(id);
                        const c = await adapter.get(id);
                        setCamera(c);
                        toast("Recursos relidos da câmera.");
                      })
                    }
                  >
                    <RefreshCw size={16} />
                    Reler recursos
                  </button>
                </div>
              </section>
            </>
          )}
          {panel === "help" && (
            <>
              <div className="help-intro">
                <Maximize size={30} />
                <h3>Vídeo em primeiro plano.</h3>
                <p>
                  Arraste o joystick na direção desejada e mantenha o dedo. Soltar envia a parada. Zoom e foco também funcionam ao
                  pressionar e segurar.
                </p>
              </div>
              <div className="help-shortcuts">
                <p>
                  <kbd>↑ ↓ ← →</kbd> Mover a câmera
                </p>
                <p>
                  <kbd>+ / −</kbd> Aproximar / afastar
                </p>
                <p>
                  <kbd>H</kbd> Posição inicial
                </p>
                <p>
                  <kbd>Esc</kbd> Sair da tela cheia / fechar janela
                </p>
              </div>
              <p className="muted">
                A indicação de movimento aparece imediatamente. A imagem leva de 1 a 1,5 segundo para acompanhar o comando: é o
                tempo do codificador da câmera mais o enlace da usina.
              </p>
              <p className="muted">Toque em “Normal”, abaixo do joystick, para alternar a velocidade. Use as posições para voltar a uma vista com um toque.</p>
            </>
          )}
        </Sheet>
      </main>
    </div>
  );
}
