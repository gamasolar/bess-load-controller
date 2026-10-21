/**
 * Apertar e falar: manda o microfone do navegador para o alto-falante da câmera
 * (canal de retorno ONVIF). Reusa o WebRTC do player go2rtc (video-rtc.js), só
 * que com `media="microphone"`: o navegador envia uma trilha de áudio e não
 * recebe nada. Só funciona pelo WebRTC — PC ou Wi-Fi; no 4G o WebRTC não conecta
 * com o servidor (sem IPv6) e o gancho marca "sem conexão".
 *
 * Isolado do vídeo: abre um fluxo próprio (camN_talk) que só liga o canal de
 * retorno enquanto o operador segura o botão; ao soltar, fecha tudo e desliga o
 * microfone (o indicador do navegador apaga).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import "@/lib/vendor/video-rtc.js"; // registra o elemento customizado (video-stream-bess)

type TalkEl = HTMLElement & {
  media: string;
  mode: string;
  background: boolean;
  src: string;
  pc: RTCPeerConnection | null;
  pcState: number;
  ondisconnect: () => void;
};

/** Até este tempo sem conectar o WebRTC: considera que não vai e avisa (dá folga pra permissão do microfone). */
const CONNECT_TIMEOUT_MS = 12000;

export function useTalk(src: string, enabled: boolean) {
  const [talking, setTalking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const node = useRef<TalkEl | null>(null);
  const timers = useRef<number[]>([]);

  const cleanup = useCallback(() => {
    timers.current.forEach((t) => window.clearInterval(t) || window.clearTimeout(t));
    timers.current = [];
    const n = node.current;
    node.current = null;
    if (n) {
      try { n.pc?.getSenders().forEach((s) => s.track?.stop()); } catch { /* ignora */ }
      try { n.ondisconnect(); } catch { /* ignora */ }
      n.remove();
    }
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setTalking(false);
    setConnected(false);
  }, [cleanup]);

  const start = useCallback(() => {
    if (!enabled || node.current) return;
    setError(null);
    setConnected(false);
    const n = document.createElement("video-stream-bess") as TalkEl;
    // "audio,microphone": recebe o áudio da câmera E envia o microfone, na MESMA conexão WebRTC.
    // Espelha o caminho do vídeo (que já conecta); uma conexão WebRTC só-enviar (sem receber nada)
    // o go2rtc não fechava direito. Bônus: dá pra ouvir a câmera enquanto fala.
    n.media = "audio,microphone";
    n.mode = "webrtc"; // o canal de retorno só anda pelo WebRTC
    n.background = true; // sem <video> visível
    n.style.display = "none";
    document.body.appendChild(n);
    node.current = n;
    n.src = src; // dispara a conexão: ws -> oferta WebRTC -> pede o microfone
    setTalking(true);

    // Acompanha a conexão pelo estado REAL do WebRTC (pc.connectionState). O atalho pcState do player
    // só vira "aberto" quando ele RECEBE vídeo/áudio — e aqui a gente só ENVIA o microfone, então
    // pcState ficaria eternamente "conectando". connectionState === "connected" = voz já indo à câmera.
    const poll = window.setInterval(() => {
      if (node.current !== n) return;
      if (n.pc?.connectionState === "connected") {
        // Conectou. Mas só é "falando" se o microfone está de fato sendo enviado — se o navegador
        // bloqueou o microfone, a conexão sobe (recebe o áudio da câmera) mas nada sai.
        const micLive = (n.pc.getSenders?.() ?? []).some((s) => s.track && s.track.kind === "audio" && s.track.readyState === "live");
        if (micLive) { setConnected(true); setError(null); }
        else { setError("o navegador bloqueou o microfone — permita o microfone para este site e tente de novo"); stop(); }
      }
    }, 300);
    const fail = window.setTimeout(() => {
      if (node.current === n && n.pc?.connectionState !== "connected") {
        setError("não conectou — tente de novo; o falar precisa da conexão rápida (WebRTC)");
        stop();
      }
    }, CONNECT_TIMEOUT_MS);
    timers.current.push(poll, fail);
  }, [enabled, src, stop]);

  // Liga/desliga num toque (modo "segura e solta pra continuar falando").
  const toggle = useCallback(() => { if (node.current) stop(); else start(); }, [start, stop]);

  // Desmontou a tela: garante que o microfone desliga.
  useEffect(() => cleanup, [cleanup]);

  // Trocou de aba/janela segurando o botão: para de falar (microfone não fica ligado por engano).
  useEffect(() => {
    if (!talking) return;
    const onHide = () => { if (document.hidden) stop(); };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [talking, stop]);

  return { talking, connected, error, start, stop, toggle, clearError: () => setError(null) };
}
