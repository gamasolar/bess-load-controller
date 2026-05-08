import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PlantCardV2 } from "@/components/v2/PlantCardV2";

export default function Tablet() {
  const { data: sites, isLoading } = trpc.bess.sites.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFs, setIsFs] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const idx = Math.round(el.scrollLeft / el.clientWidth);
        setCurrentIndex(idx);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [sites?.length]);

  useEffect(() => {
    const onFsChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const goTo = (i: number) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
        const lock = (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock;
        if (typeof lock === "function") {
          try { await lock.call(screen.orientation, "landscape"); } catch { /* unsupported */ }
        }
      }
    } catch { /* user gesture required or unsupported */ }
  };

  if (isLoading || !sites) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background overflow-hidden">
      <div
        ref={containerRef}
        className="h-full w-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory flex tablet-scroll"
      >
        {sites.map((site) => (
          <div
            key={site.id}
            className="snap-center shrink-0 w-screen h-screen overflow-y-auto p-2 md:p-3 flex justify-center items-start"
          >
            {/* Tablet: card preenche toda a largura (sem max-w-3xl que deixava
                bordas pretas em telas widescreen). CSS abaixo (.tablet-card-wrapper)
                força altura automática + compacta espaços pra caber no viewport
                do SM-T225 (1340×800) sem precisar rolar. */}
            <div className="w-full tablet-card-wrapper">
              {/* `hideExpandButton`: na rota /tablet o botão de expandir do card
                  some — a página tem fullscreen page-level próprio (ver botão
                  "Tela cheia" no canto superior direito) que mantém o swipe
                  entre cards funcionando. */}
              <PlantCardV2 slug={site.slug} hideExpandButton />
            </div>
          </div>
        ))}
      </div>

      {sites.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-20 bg-black/40 backdrop-blur px-3 py-1.5 rounded-full">
          {sites.map((s, i) => (
            <button
              key={s.id}
              onClick={() => goTo(i)}
              aria-label={`Ir para ${s.name}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === currentIndex ? "w-8 bg-white" : "w-2 bg-white/40"
              }`}
            />
          ))}
        </div>
      )}

      {/* Botão tela cheia — esconde só quando já em fullscreen.
          PWA standalone remove só a URL bar do Chrome; pra esconder também a
          barra de status do Android e a de navegação, precisa Fullscreen API.
          Tap entra em fullscreen e tenta lockar em landscape. */}
      {!isFs && (
        <button
          onClick={toggleFullscreen}
          aria-label="Tela cheia"
          className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-black/50 backdrop-blur hover:bg-black/70 text-white text-xs px-3 py-2 rounded-full border border-white/10 transition"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Tela cheia
        </button>
      )}
      {isFs && (
        <button
          onClick={toggleFullscreen}
          aria-label="Sair da tela cheia"
          className="absolute top-3 right-3 z-20 flex items-center justify-center bg-black/50 backdrop-blur hover:bg-black/70 text-white w-9 h-9 rounded-full border border-white/10 transition"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
      )}

      <style>{`
        .tablet-scroll::-webkit-scrollbar { display: none; }
        .tablet-scroll { -ms-overflow-style: none; scrollbar-width: none; }

        /* Card com altura natural do conteúdo (override do h-full que clipava
           o botão da bomba). Slide rola verticalmente se precisar.
           IMPORTANTE: exclui o modo expandido (fixed inset-0), que usa layout
           próprio e fica quebrado se sobrescrito. */
        .tablet-card-wrapper > div:not([class~="fixed"]) {
          height: auto !important;
          overflow: visible !important;
        }
      `}</style>
    </div>
  );
}
