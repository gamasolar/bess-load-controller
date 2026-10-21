import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Camera as CameraIcon, MapPin, VideoOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useBessCameraAdapter } from "@/components/camera/adapter";
import type { Camera } from "@/components/camera/types";
import "./cameras.css";

/** Lista de câmeras por usina. O quadro de cada cartão é renovado a cada 10 s. */
export default function Cameras() {
  const adapter = useBessCameraAdapter();
  const sites = trpc.camera.list.useQuery(undefined, { refetchInterval: 60_000 });
  const [items, setItems] = useState<Camera[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tick, setTick] = useState(() => Date.now());
  const load = () => {
    setStatus("loading");
    adapter
      .list()
      .then((data) => {
        setItems(data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(load, [adapter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) setTick(Date.now());
    }, 10_000);
    return () => window.clearInterval(t);
  }, []);
  const plants: { name: string; slug: string }[] = (sites.data ?? []).map((s) => ({ name: s.name, slug: s.slug }));
  for (const c of items) if (!plants.some((p) => p.name === c.plant)) plants.push({ name: c.plant, slug: c.plantSlug ?? c.plant });

  return (
    <div className="cams">
      <main className="camera-list">
        <div className="list-title">
          <div>
            <p className="eyebrow">SUPERVISÃO VISUAL</p>
            <h1>Um olhar sobre a operação.</h1>
            <p>Acesse as câmeras de cada usina.</p>
          </div>
          <span className="camera-count">
            <CameraIcon size={17} />
            {items.length} {items.length === 1 ? "câmera" : "câmeras"}
          </span>
        </div>
        {status === "loading" && <p role="status">Carregando câmeras…</p>}
        {status === "error" && (
          <div role="alert">
            <p>Não foi possível carregar as câmeras.</p>
            <button className="button" onClick={load}>
              Tentar novamente
            </button>
          </div>
        )}
        {status === "ready" &&
          plants.map((plant) => {
            const list = items.filter((c) => c.plant === plant.name);
            return (
              <section className="plant-section" key={plant.slug}>
                <header>
                  <h2>
                    <MapPin size={16} />
                    {plant.name}
                  </h2>
                  <span>{list.length === 1 ? "1 câmera" : `${list.length} câmeras`}</span>
                </header>
                <div className="camera-grid">
                  {list.map((camera, index) => (
                    <Link href={"/cameras/" + encodeURIComponent(camera.id)} className="camera-card" key={camera.id}>
                      <div className="card-photo">
                        <img src={`${camera.poster}?t=${tick}`} alt={"Quadro atual de " + camera.name} />
                        <span className="card-state">
                          <span className="status-dot" />
                          ABRIR TRANSMISSÃO
                        </span>
                        <span className="card-open">
                          <ArrowUpRight size={24} />
                        </span>
                      </div>
                      <div className="camera-card-title">
                        <div>
                          <h3>{camera.name}</h3>
                          <p>{camera.description}</p>
                        </div>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                      </div>
                    </Link>
                  ))}
                  {list.length === 0 && (
                    <div className="empty-plant">
                      <VideoOff size={22} />
                      <div>
                        <h3>Sem câmera por aqui</h3>
                        <p>A usina aparecerá com imagem quando uma câmera for cadastrada.</p>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        <p className="list-note">O estado da transmissão é confirmado ao abrir cada câmera.</p>
      </main>
    </div>
  );
}
