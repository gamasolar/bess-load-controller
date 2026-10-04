/**
 * Cena ilustrada da planta: o caminho da energia desenhado como paisagem.
 * Sol (ou lua) → painéis → inversores → baterias → casa de bomba → represa.
 * Tudo o que se move aqui responde a um dado real; cada equipamento é
 * clicável e abre a sua ficha resumida.
 *
 * Não inferimos nuvens nem nível da represa: não há dado para isso (em
 * planta isolada, geração baixa com sol alto pode ser só bateria cheia).
 */

import { useEffect, useState } from "react";

export interface SceneBattery { id: number; title: string; soc: number | null; power: number | null }
export interface SceneInverter { id: number; title: string; kw: number | null; tone: "ok" | "idle" | "bad" }
export interface SceneDetail { title: string; rows: [string, string][]; tab?: string; tabLabel?: string }

export interface SceneProps {
  hour: number;
  pv: number | null;
  load: number | null;
  batteries: SceneBattery[];
  inverters: SceneInverter[];
  marks: { kind: "off" | "on" | "blackout"; at: number }[];
  pumpNote: string;
  fmt: (v: number | null | undefined, digits?: number) => string;
  /** Fichas por elemento: "solar", "load", "bat:<id>", "inv:<id>". */
  details?: Record<string, SceneDetail>;
  onGo?: (tab: string) => void;
}

const FLOW_MIN = 0.3;
const GROUND = 470;
const CABLE = 512;
const CENTER = 572;
const PUMP_X = 743;

type Phase = "night" | "dawn" | "day" | "dusk";
function phaseOf(hour: number): Phase {
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 17) return "day";
  if (hour >= 17 && hour < 19) return "dusk";
  return "night";
}

export function PlantScene({ hour, pv, load, batteries, inverters, marks, pumpNote, fmt, details, onGo }: SceneProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;

  // A ficha fecha ao clicar fora dela ou apertar Esc. Clicar em outro
  // equipamento troca a ficha (quem trata é o próprio equipamento).
  useEffect(() => {
    if (!picked) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest(".scene-card, .scene-hit, button.scene-tag")) return;
      setPicked(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPicked(null); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [picked]);

  const phase = phaseOf(hour);
  const sunUp = hour >= 5.5 && hour < 18.5;
  const t = Math.max(0, Math.min(1, (hour - 5.5) / 13));
  const sunX = 90 + 820 * t;
  const sunY = 330 - 150 * Math.sin(Math.PI * t);
  const lightX = sunUp ? sunX : 0; // a lua fica longe da represa: sem reflexo
  const generating = (pv ?? 0) > FLOW_MIN;
  const consuming = (load ?? 0) > FLOW_MIN;
  const pumping = (load ?? 0) > 10;
  const off = marks.find((m) => m.kind === "off")?.at;

  const shown = batteries.slice(0, 2);
  const boxW = 84;
  const gap = 26;
  const totalW = shown.length * boxW + (shown.length - 1) * gap;
  const firstX = CENTER - totalW / 2;
  const boxTop = 330;
  const boxH = GROUND - boxTop;
  const invs = inverters.slice(0, 3);
  const invX = (i: number) => firstX - 44 - (invs.length - 1 - i) * 38;

  const panels: { x: number; y: number }[] = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) panels.push({ x: 70 + col * 52 + row * 14, y: 392 + row * 26 });

  const pick = (key: string) => (details?.[key] ? { role: "button", tabIndex: 0, className: "scene-hit", "data-on": picked === key, onClick: () => setPicked(picked === key ? null : key), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicked(picked === key ? null : key); } } } as const : {});
  const detail = picked ? details?.[picked] : undefined;

  return (
    <div className="scene" data-phase={phase} data-day={phase !== "night"}>
      <svg
        viewBox={narrow ? "262 150 580 410" : "0 120 1000 440"}
        role="img"
        aria-label="Ilustração da planta com o caminho da energia"
        preserveAspectRatio="xMidYMax slice"
      >
        <defs>
          <linearGradient id="scene-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.2" stopColor="var(--sc-sky-top)" />
            <stop offset="0.62" stopColor="var(--sc-sky-low)" />
          </linearGradient>
          <radialGradient id="scene-glow">
            <stop offset="0" stopColor="var(--sc-sun)" stopOpacity="0.6" />
            <stop offset="1" stopColor="var(--sc-sun)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="scene-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sc-water-top)" />
            <stop offset="1" stopColor="var(--sc-water-low)" />
          </linearGradient>
          <linearGradient id="scene-mist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sc-mist)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--sc-mist)" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id="scene-earth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sc-earth)" />
            <stop offset="1" stopColor="var(--sc-earth-deep)" />
          </linearGradient>
          <linearGradient id="scene-shine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id="scene-water-clip">
            <path d={`M774 ${GROUND + 10} Q840 ${GROUND - 6} 1000 ${GROUND - 2} V560 H744 Q752 500 774 ${GROUND + 10}Z`} />
          </clipPath>
        </defs>

        <rect x="0" y="100" width="1000" height="460" fill="url(#scene-sky)" />

        {sunUp ? (
          <g>
            <circle cx={sunX} cy={sunY} r={generating ? 130 : 80} fill="url(#scene-glow)" className={generating ? "scene-pulse" : undefined} />
            <circle cx={sunX} cy={sunY} r="24" fill="var(--sc-sun)" />
          </g>
        ) : (
          <g>
            {[[90, 170], [210, 230], [330, 150], [470, 210], [610, 160], [700, 250], [930, 270], [150, 280], [560, 265], [400, 290], [760, 180]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.8 : 1.2} fill="#e4f0f1" opacity={0.35 + (i % 4) * 0.15} className={i % 4 === 0 ? "scene-twinkle" : undefined} style={{ animationDelay: `${i * 0.7}s` }} />
            ))}
            <circle cx="690" cy="196" r="60" fill="#e4f0f1" opacity="0.06" />
            <circle cx="690" cy="196" r="24" fill="#e4f0f1" opacity="0.92" />
            <circle cx="701" cy="188" r="21" fill="var(--sc-sky-mid)" />
          </g>
        )}

        {/* três planos de serra, com névoa entre eles */}
        <path d="M0 330 Q120 286 260 312 T520 296 T790 280 T1000 300 V560 H0Z" fill="var(--sc-hill-back)" />
        <rect x="0" y="286" width="1000" height="70" fill="url(#scene-mist)" />
        <path d="M0 350 Q140 300 290 326 T560 318 T820 302 T1000 322 V560 H0Z" fill="var(--sc-hill-far)" />
        {Array.from({ length: 26 }, (_, i) => {
          const x = 14 + i * 13;
          const base = 340 - Math.sin(i / 4) * 10;
          return <ellipse key={i} cx={x} cy={base - 22} rx="6" ry={24 + (i % 3) * 4} fill="var(--sc-tree)" className="scene-sway" style={{ animationDelay: `${(i % 5) * 0.5}s`, transformOrigin: `${x}px ${base}px` }} />;
        })}
        {Array.from({ length: 12 }, (_, i) => (
          <ellipse key={i} cx={850 + i * 13} cy={306 - (i % 2) * 5} rx="6" ry={22 + (i % 3) * 4} fill="var(--sc-tree)" className="scene-sway" style={{ animationDelay: `${(i % 4) * 0.6}s`, transformOrigin: `${850 + i * 13}px 330px` }} />
        ))}
        <rect x="0" y="340" width="1000" height="60" fill="url(#scene-mist)" opacity="0.7" />
        <path d="M0 396 Q200 362 420 380 T780 374 T1000 386 V560 H0Z" fill="var(--sc-hill-near)" />

        {/* terra de laterita, em corte */}
        <path d={`M0 ${GROUND} H724 Q764 ${GROUND} 784 ${GROUND + 14} V560 H0Z`} fill="url(#scene-earth)" />
        <path d="M0 498 Q180 488 360 500 T740 494" fill="none" stroke="var(--sc-earth-edge)" strokeOpacity="0.25" strokeWidth="2" />
        <path d="M0 534 Q220 524 430 536 T760 528" fill="none" stroke="var(--sc-earth-edge)" strokeOpacity="0.18" strokeWidth="2" />
        <path d={`M0 ${GROUND} H724 Q764 ${GROUND} 784 ${GROUND + 14}`} fill="none" stroke="var(--sc-earth-edge)" strokeWidth="3" />

        {/* represa, com o reflexo do sol ou da lua */}
        <path d={`M774 ${GROUND + 10} Q840 ${GROUND - 6} 1000 ${GROUND - 2} V560 H744 Q752 500 774 ${GROUND + 10}Z`} fill="url(#scene-water)" />
        <g clipPath="url(#scene-water-clip)">
          {/* reflexo: uma mancha de luz suave, sem barras */}
          {lightX > 790 && (
            <g className="scene-reflect">
              <ellipse cx={lightX} cy="520" rx="20" ry="46" fill="url(#scene-glow)" opacity="0.55" />
            </g>
          )}
          {/* ondas: linhas longas que deslizam devagar e sem emenda (período de 56) */}
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M${700 - i * 14} ${486 + i * 17} ${"q14 -4 28 0 t28 0 ".repeat(8)}`}
              fill="none"
              stroke="#e4f0f1"
              strokeOpacity={0.1 + i * 0.045}
              strokeWidth={1.5 + i * 0.3}
              strokeLinecap="round"
              className="scene-wave"
              style={{ animationDuration: `${(pumping ? 5 : 11) + i * 2.5}s`, animationDirection: i % 2 ? "reverse" : "normal" }}
            />
          ))}
        </g>

        {/* painéis */}
        <g {...pick("solar")} aria-label="Painéis solares">
          <ellipse cx="225" cy={GROUND + 2} rx="190" ry="7" fill="var(--sc-shadow)" />
          {panels.map((p, i) => (
            <g key={i}>
              <polygon points={`${p.x},${p.y + 20} ${p.x + 14},${p.y} ${p.x + 58},${p.y} ${p.x + 44},${p.y + 20}`} fill={generating ? "var(--sc-panel-on)" : "var(--sc-panel)"} stroke={generating ? "var(--sc-sun)" : "var(--sc-panel-edge)"} strokeWidth="1.5" />
              <line x1={p.x + 22} y1={p.y + 20} x2={p.x + 36} y2={p.y} stroke="var(--sc-panel-edge)" strokeWidth="1" />
              {generating && <polygon points={`${p.x + 4},${p.y + 18} ${p.x + 16},${p.y + 2} ${p.x + 30},${p.y + 2} ${p.x + 18},${p.y + 18}`} fill="url(#scene-shine)" className="scene-shine" style={{ animationDelay: `${(i % 5) * 0.25 + Math.floor(i / 5) * 0.15}s` }} />}
            </g>
          ))}
          <rect x="60" y="384" width="330" height="90" fill="transparent" />
        </g>

        {/* inversores */}
        {invs.map((inv, i) => (
          <g key={inv.id} transform={`translate(${invX(i)} ${GROUND - 44})`} {...pick(`inv:${inv.id}`)} aria-label={inv.title}>
            <ellipse cx="15" cy="45" rx="20" ry="4" fill="var(--sc-shadow)" />
            <rect width="30" height="44" rx="3" fill="var(--sc-box)" stroke="var(--sc-box-edge)" strokeWidth="1.5" />
            <rect x="5" y="20" width="20" height="2" fill="var(--sc-box-edge)" />
            <rect x="5" y="26" width="20" height="2" fill="var(--sc-box-edge)" />
            <rect x="5" y="32" width="20" height="2" fill="var(--sc-box-edge)" />
            <circle cx="15" cy="10" r="4" fill={inv.tone === "ok" ? "#5cc6c0" : inv.tone === "bad" ? "#d4603a" : "#9db8bd"} className={inv.tone === "ok" ? "scene-blink" : undefined} />
            <rect x="-4" y="-6" width="38" height="56" fill="transparent" />
          </g>
        ))}

        {/* baterias: o nível é o SOC */}
        {shown.map((b, i) => {
          const x = firstX + i * (boxW + gap);
          const level = Math.max(0, Math.min(100, b.soc ?? 0));
          const h = (boxH - 8) * (level / 100);
          const low = b.soc != null && off != null && b.soc <= off;
          const moving = b.power != null && Math.abs(b.power) > FLOW_MIN;
          return (
            <g key={b.id} {...pick(`bat:${b.id}`)} aria-label={b.title}>
              <ellipse cx={x + boxW / 2} cy={GROUND + 2} rx={boxW / 2 + 12} ry="6" fill="var(--sc-shadow)" />
              <rect x={x} y={boxTop} width={boxW} height={boxH} rx="5" fill="var(--sc-box)" stroke="var(--sc-box-edge)" strokeWidth="2" />
              <rect x={x + 4} y={boxTop + boxH - 4 - h} width={boxW - 8} height={h} rx="2" fill={low ? "#d4603a" : "#5cc6c0"} className="scene-level" />
              {h > 6 && <rect x={x + 4} y={boxTop + boxH - 4 - h} width={boxW - 8} height="4" rx="2" fill="#e4f0f1" opacity="0.5" className={moving ? "scene-surface" : undefined} />}
              <rect x={x + 9} y={boxTop + 8} width="5" height={boxH - 16} rx="2.5" fill="#fff" opacity="0.07" />
              {marks.map((m) => {
                const y = boxTop + boxH - 4 - (boxH - 8) * (m.at / 100);
                return <line key={m.kind} x1={x - 7} x2={x + 10} y1={y} y2={y} stroke={m.kind === "off" ? "#d4603a" : m.kind === "on" ? "#5cc6c0" : "#e4f0f1"} strokeWidth="2.5" strokeLinecap="round" />;
              })}
              <text x={x + boxW / 2} y={boxTop - 12} textAnchor="middle" className="scene-soc">{b.soc == null ? "—" : `${fmt(b.soc, 0)}%`}</text>
            </g>
          );
        })}

        {/* casa de bomba e adutora */}
        <g {...pick("load")} aria-label="Casa de bomba">
          <ellipse cx={PUMP_X} cy={GROUND + 2} rx="44" ry="5" fill="var(--sc-shadow)" />
          <path d={`M772 ${GROUND - 8} q26 6 40 30 q10 18 34 22`} fill="none" stroke="var(--sc-pipe)" strokeWidth="7" strokeLinecap="round" />
          {pumping && (
            <g>
              <path d={`M846 ${GROUND + 44} q14 2 20 16`} fill="none" stroke="#e4f0f1" strokeWidth="5" strokeLinecap="round" strokeDasharray="3 7" className="scene-flow" />
              {[0, 1, 2].map((i) => <circle key={i} cx={866 + i * 5} cy={GROUND + 62} r="3" fill="none" stroke="#e4f0f1" strokeWidth="1.5" className="scene-splash" style={{ animationDelay: `${i * 0.35}s`, transformOrigin: `${866 + i * 5}px ${GROUND + 62}px` }} />)}
            </g>
          )}
          <rect x="712" y={GROUND - 46} width="62" height="46" fill="var(--sc-box)" stroke="var(--sc-box-edge)" strokeWidth="2" />
          <polygon points={`704,${GROUND - 46} ${PUMP_X},${GROUND - 70} 782,${GROUND - 46}`} fill="var(--sc-roof)" />
          <circle cx={PUMP_X} cy={GROUND - 22} r="11" fill="none" stroke={pumping ? "#5cc6c0" : "var(--sc-box-edge)"} strokeWidth="3" strokeDasharray="6 5" className={pumping ? "scene-spin" : undefined} style={{ transformOrigin: `${PUMP_X}px ${GROUND - 22}px` }} />
        </g>

        {/* cabos enterrados: a energia correndo */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" pointerEvents="none">
          <path d={`M210 ${GROUND} V${CABLE} H${PUMP_X} V${GROUND}`} stroke="var(--sc-cable)" />
          {invs.map((inv, i) => <path key={inv.id} d={`M${invX(i) + 15} ${GROUND} V${CABLE}`} stroke="var(--sc-cable)" />)}
          {shown.map((b, i) => <path key={b.id} d={`M${firstX + i * (boxW + gap) + boxW / 2} ${GROUND} V${CABLE}`} stroke="var(--sc-cable)" />)}

          {generating && <path d={`M210 ${GROUND} V${CABLE} H${CENTER}`} stroke="#f4a636" className="scene-flow" />}
          {consuming && <path d={`M${CENTER} ${CABLE} H${PUMP_X} V${GROUND}`} stroke="#5cc6c0" className="scene-flow" />}
          {shown.map((b, i) => {
            const cx = firstX + i * (boxW + gap) + boxW / 2;
            if (b.power == null || Math.abs(b.power) <= FLOW_MIN) return null;
            // carregando: a energia sobe para a bateria; descarregando: desce para o cabo
            return b.power > 0
              ? <path key={b.id} d={`M${cx} ${CABLE} V${GROUND}`} stroke="#f4a636" className="scene-flow" />
              : <path key={b.id} d={`M${cx} ${GROUND} V${CABLE}`} stroke="#5cc6c0" className="scene-flow" />;
          })}
        </g>
      </svg>

      <button type="button" className="scene-tag scene-tag--sun" onClick={() => details?.solar && setPicked(picked === "solar" ? null : "solar")}>
        <span>Solar</span>
        <strong>{fmt(pv)}<small>kW</small></strong>
      </button>
      <button type="button" className="scene-tag scene-tag--load" onClick={() => details?.load && setPicked(picked === "load" ? null : "load")}>
        <span>Consumo</span>
        <strong>{fmt(load)}<small>kW</small></strong>
        {pumpNote && <em>{pumpNote}</em>}
      </button>
      <div className="scene-tag scene-tag--bat">
        {shown.map((b) => (
          <p key={b.id}>
            <span>{b.title}</span>{" "}
            {b.power == null ? "sem leitura" : b.power > FLOW_MIN ? `carregando ${fmt(b.power)} kW` : b.power < -FLOW_MIN ? `descarregando ${fmt(-b.power)} kW` : "em repouso"}
          </p>
        ))}
      </div>

      {detail ? (
        <aside className="scene-card" aria-live="polite">
          <header>
            <h3>{detail.title}</h3>
            <button type="button" onClick={() => setPicked(null)} aria-label="Fechar">×</button>
          </header>
          <dl>
            {detail.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {detail.tab && onGo && <button type="button" className="scene-card-go" onClick={() => onGo(detail.tab!)}>{detail.tabLabel ?? "Ver detalhes"}</button>}
        </aside>
      ) : details && (
        <p className="scene-hint">Toque em um equipamento para ver os detalhes.</p>
      )}
    </div>
  );
}
