/**
 * Cena ilustrada da planta: o caminho da energia desenhado como paisagem.
 * Sol (ou lua) → painéis → inversores → baterias → casa de bomba → represa.
 * Tudo o que se move aqui responde a um dado real.
 */

export interface SceneBattery { id: number; title: string; soc: number | null; power: number | null }
export interface SceneInverter { id: number; title: string; kw: number | null; tone: "ok" | "idle" | "bad" }

interface Props {
  hour: number;
  pv: number | null;
  load: number | null;
  batteries: SceneBattery[];
  inverters: SceneInverter[];
  marks: { kind: "off" | "on" | "blackout"; at: number }[];
  pumpNote: string;
  fmt: (v: number | null | undefined, digits?: number) => string;
}

const FLOW_MIN = 0.3;
const GROUND = 470;
const CABLE = 512;

export function PlantScene({ hour, pv, load, batteries, inverters, marks, pumpNote, fmt }: Props) {
  const day = hour >= 6 && hour < 18;
  const t = Math.max(0, Math.min(1, (hour - 6) / 12));
  const sunX = 110 + 780 * t;
  const sunY = 320 - 140 * Math.sin(Math.PI * t);
  const generating = (pv ?? 0) > FLOW_MIN;
  const consuming = (load ?? 0) > FLOW_MIN;
  const pumping = (load ?? 0) > 10;
  const off = marks.find((m) => m.kind === "off")?.at;

  const shown = batteries.slice(0, 2);
  const boxW = 84;
  const gap = 26;
  const totalW = shown.length * boxW + (shown.length - 1) * gap;
  const firstX = 572 - totalW / 2;
  const boxTop = 330;
  const boxH = GROUND - boxTop;
  const junction = 572;

  const panels: { x: number; y: number }[] = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) panels.push({ x: 70 + col * 52 + row * 14, y: 392 + row * 26 });

  return (
    <div className="scene" data-day={day}>
      <svg viewBox="0 120 1000 440" role="img" aria-label="Ilustração da planta com o caminho da energia" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="scene-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sc-sky-top)" />
            <stop offset="1" stopColor="var(--sc-sky-low)" />
          </linearGradient>
          <radialGradient id="scene-glow">
            <stop offset="0" stopColor="#f4a636" stopOpacity="0.55" />
            <stop offset="1" stopColor="#f4a636" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="scene-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sc-water-top)" />
            <stop offset="1" stopColor="var(--sc-water-low)" />
          </linearGradient>
        </defs>

        <rect width="1000" height="560" fill="url(#scene-sky)" />

        {day ? (
          <g>
            <circle cx={sunX} cy={sunY} r={generating ? 120 : 70} fill="url(#scene-glow)" className={generating ? "scene-pulse" : undefined} />
            <circle cx={sunX} cy={sunY} r="26" fill="#f4a636" />
          </g>
        ) : (
          <g>
            {[[90, 170], [210, 230], [330, 150], [470, 210], [610, 160], [700, 250], [930, 270], [150, 280], [560, 265]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.8 : 1.2} fill="#e4f0f1" opacity={0.35 + (i % 4) * 0.15} />
            ))}
            <circle cx="840" cy="186" r="24" fill="#e4f0f1" opacity="0.9" />
            <circle cx="851" cy="178" r="21" fill="var(--sc-sky-mid)" />
          </g>
        )}

        {/* serra ao fundo e o eucaliptal */}
        <path d="M0 350 Q140 285 290 322 T560 312 T820 296 T1000 318 V560 H0Z" fill="var(--sc-hill-far)" />
        {Array.from({ length: 26 }, (_, i) => {
          const x = 14 + i * 13;
          const base = 338 - Math.sin(i / 4) * 10;
          return <ellipse key={i} cx={x} cy={base - 22} rx="6" ry={24 + (i % 3) * 4} fill="var(--sc-tree)" />;
        })}
        {Array.from({ length: 12 }, (_, i) => (
          <ellipse key={i} cx={850 + i * 13} cy={304 - (i % 2) * 5} rx="6" ry={22 + (i % 3) * 4} fill="var(--sc-tree)" />
        ))}
        <path d="M0 392 Q200 360 420 378 T780 372 T1000 384 V560 H0Z" fill="var(--sc-hill-near)" />

        {/* terra de laterita */}
        <path d={`M0 ${GROUND} H724 Q764 ${GROUND} 784 ${GROUND + 14} V560 H0Z`} fill="var(--sc-earth)" />
        <path d={`M0 ${GROUND} H724 Q764 ${GROUND} 784 ${GROUND + 14}`} fill="none" stroke="var(--sc-earth-edge)" strokeWidth="3" />

        {/* represa */}
        <path d={`M774 ${GROUND + 10} Q840 ${GROUND - 6} 1000 ${GROUND - 2} V560 H744 Q752 500 774 ${GROUND + 10}Z`} fill="url(#scene-water)" />
        {[0, 1, 2, 3].map((i) => (
          <path
            key={i}
            d={`M${830 + i * 22} ${492 + i * 14} q14 -5 28 0 t28 0`}
            fill="none"
            stroke="#e4f0f1"
            strokeOpacity={pumping ? 0.5 : 0.18}
            strokeWidth="2"
            strokeLinecap="round"
            className={pumping ? "scene-ripple" : undefined}
            style={{ animationDelay: `${i * 0.4}s` }}
          />
        ))}

        {/* painéis */}
        {panels.map((p, i) => (
          <g key={i}>
            <polygon
              points={`${p.x},${p.y + 20} ${p.x + 14},${p.y} ${p.x + 58},${p.y} ${p.x + 44},${p.y + 20}`}
              fill={generating ? "#1d6f86" : "var(--sc-panel)"}
              stroke={generating ? "#f4a636" : "var(--sc-panel-edge)"}
              strokeWidth="1.5"
            />
            <line x1={p.x + 22} y1={p.y + 20} x2={p.x + 36} y2={p.y} stroke="var(--sc-panel-edge)" strokeWidth="1" />
          </g>
        ))}

        {/* inversores */}
        {inverters.slice(0, 3).map((inv, i) => (
          <g key={inv.id} transform={`translate(${374 + i * 38} ${GROUND - 44})`}>
            <rect width="30" height="44" rx="3" fill="var(--sc-box)" stroke="var(--sc-box-edge)" strokeWidth="1.5" />
            <rect x="5" y="20" width="20" height="2" fill="var(--sc-box-edge)" />
            <rect x="5" y="26" width="20" height="2" fill="var(--sc-box-edge)" />
            <rect x="5" y="32" width="20" height="2" fill="var(--sc-box-edge)" />
            <circle cx="15" cy="10" r="4" fill={inv.tone === "ok" ? "#5cc6c0" : inv.tone === "bad" ? "#d4603a" : "#9db8bd"} className={inv.tone === "ok" ? "scene-blink" : undefined} />
          </g>
        ))}

        {/* baterias: o nível é o SOC */}
        {shown.map((b, i) => {
          const x = firstX + i * (boxW + gap);
          const level = Math.max(0, Math.min(100, b.soc ?? 0));
          const h = (boxH - 8) * (level / 100);
          const low = b.soc != null && off != null && b.soc <= off;
          return (
            <g key={b.id}>
              <rect x={x} y={boxTop} width={boxW} height={boxH} rx="5" fill="var(--sc-box)" stroke="var(--sc-box-edge)" strokeWidth="2" />
              <rect x={x + 4} y={boxTop + boxH - 4 - h} width={boxW - 8} height={h} rx="2" fill={low ? "#d4603a" : "#5cc6c0"} className="scene-level" />
              {marks.map((m) => {
                const y = boxTop + boxH - 4 - (boxH - 8) * (m.at / 100);
                return <line key={m.kind} x1={x - 6} x2={x + 10} y1={y} y2={y} stroke={m.kind === "off" ? "#d4603a" : m.kind === "on" ? "#5cc6c0" : "#e4f0f1"} strokeWidth="2.5" />;
              })}
              <text x={x + boxW / 2} y={boxTop - 12} textAnchor="middle" className="scene-soc">{b.soc == null ? "—" : `${fmt(b.soc, 0)}%`}</text>
            </g>
          );
        })}

        {/* casa de bomba e adutora */}
        <g>
          <path d={`M772 ${GROUND - 8} q26 6 40 30 q10 18 34 22`} fill="none" stroke="var(--sc-box-edge)" strokeWidth="7" strokeLinecap="round" />
          <rect x="712" y={GROUND - 46} width="62" height="46" fill="var(--sc-box)" stroke="var(--sc-box-edge)" strokeWidth="2" />
          <polygon points={`704,${GROUND - 46} 743,${GROUND - 70} 782,${GROUND - 46}`} fill="var(--sc-roof)" />
          <circle cx="743" cy={GROUND - 22} r="11" fill="none" stroke={pumping ? "#5cc6c0" : "var(--sc-box-edge)"} strokeWidth="3" strokeDasharray="6 5" className={pumping ? "scene-spin" : undefined} style={{ transformOrigin: `743px ${GROUND - 22}px` }} />
        </g>

        {/* cabos enterrados: a energia correndo */}
        <g fill="none" strokeLinecap="round" strokeWidth="4">
          <path d={`M210 ${GROUND} V${CABLE} H${junction}`} stroke="var(--sc-cable)" />
          <path d={`M${junction} ${CABLE} H743 V${GROUND}`} stroke="var(--sc-cable)" />
          {inverters.slice(0, 3).map((inv, i) => <path key={inv.id} d={`M${389 + i * 38} ${GROUND} V${CABLE}`} stroke="var(--sc-cable)" />)}
          {shown.map((b, i) => <path key={b.id} d={`M${firstX + i * (boxW + gap) + boxW / 2} ${GROUND} V${CABLE}`} stroke="var(--sc-cable)" />)}

          {generating && <path d={`M210 ${GROUND} V${CABLE} H${junction}`} stroke="#f4a636" className="scene-flow" />}
          {consuming && <path d={`M${junction} ${CABLE} H743 V${GROUND}`} stroke="#5cc6c0" className="scene-flow" />}
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

      <div className="scene-tag scene-tag--sun">
        <span>Solar</span>
        <strong>{fmt(pv)}<small>kW</small></strong>
      </div>
      <div className="scene-tag scene-tag--load">
        <span>Consumo</span>
        <strong>{fmt(load)}<small>kW</small></strong>
        <em>{pumpNote}</em>
      </div>
      <div className="scene-tag scene-tag--bat">
        {shown.map((b) => (
          <p key={b.id}>
            <span>{b.title}</span>{" "}
            {b.power == null ? "sem leitura" : b.power > FLOW_MIN ? `carregando ${fmt(b.power)} kW` : b.power < -FLOW_MIN ? `descarregando ${fmt(-b.power)} kW` : "em repouso"}
          </p>
        ))}
      </div>
    </div>
  );
}
