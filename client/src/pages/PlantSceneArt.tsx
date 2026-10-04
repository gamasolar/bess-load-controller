/**
 * Cena da planta sobre arte ilustrada (gerada no Higgsfield, ilustrativa:
 * não é foto da planta). O fundo é um vídeo em laço; por cima, em SVG, só o
 * que é dado real: baterias (nível = SOC), inversores, cabos com fluxo.
 *
 * Coordenadas no espaço da arte: 1344 × 576, linha do chão em y = 336.
 * A versão toda em vetor continua em PlantScene.tsx (?cena=vetor).
 */

import type { SceneProps } from "./PlantScene";

type Props = SceneProps;

const FLOW_MIN = 0.3;
const GROUND = 336;
const CABLE = 418;
const PANELS_X = 222;
const PUMP_X = 940;
const CENTER = 672;

export function PlantSceneArt({ hour, pv, load, batteries, inverters, marks, pumpNote, fmt }: Props) {
  const day = hour >= 6 && hour < 18;
  const generating = (pv ?? 0) > FLOW_MIN;
  const consuming = (load ?? 0) > FLOW_MIN;
  const off = marks.find((m) => m.kind === "off")?.at;

  const shown = batteries.slice(0, 2);
  const boxW = 92;
  const boxH = 158;
  const gap = 30;
  const totalW = shown.length * boxW + (shown.length - 1) * gap;
  const firstX = CENTER - totalW / 2;
  const top = GROUND - boxH;
  const invs = inverters.slice(0, 3);
  const invX = (i: number) => firstX - 46 - (invs.length - 1 - i) * 42;

  return (
    <div className="scene scene-art" data-day={day}>
      <video className="scene-art-bg" src="/plant-art/cena.mp4" poster="/plant-art/cena.jpg" autoPlay muted loop playsInline preload="metadata" aria-hidden="true" />
      <div className="scene-art-night" aria-hidden="true" />
      <svg viewBox="0 0 1344 576" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Ilustração da planta com o caminho da energia">
        {!day && [[150, 60], [330, 110], [520, 40], [700, 95], [860, 50], [1010, 120], [1240, 70], [420, 170], [1130, 30]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2.2 : 1.5} fill="#e4f0f1" opacity={0.5 + (i % 4) * 0.12} />
        ))}

        {/* cabos enterrados */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g stroke="rgb(7 31 39 / 0.45)" strokeWidth="7">
            <path d={`M${PANELS_X} ${GROUND + 6} V${CABLE} H${PUMP_X} V${GROUND + 6}`} />
            {invs.map((inv, i) => <path key={inv.id} d={`M${invX(i) + 16} ${GROUND} V${CABLE}`} />)}
            {shown.map((b, i) => <path key={b.id} d={`M${firstX + i * (boxW + gap) + boxW / 2} ${GROUND} V${CABLE}`} />)}
          </g>
          <g strokeWidth="7" className="scene-art-flows">
            {generating && <path d={`M${PANELS_X} ${GROUND + 6} V${CABLE} H${CENTER}`} stroke="#f4a636" className="scene-flow" />}
            {consuming && <path d={`M${CENTER} ${CABLE} H${PUMP_X} V${GROUND + 6}`} stroke="#8be9e2" className="scene-flow" />}
            {shown.map((b, i) => {
              const cx = firstX + i * (boxW + gap) + boxW / 2;
              if (b.power == null || Math.abs(b.power) <= FLOW_MIN) return null;
              return b.power > 0
                ? <path key={b.id} d={`M${cx} ${CABLE} V${GROUND}`} stroke="#f4a636" className="scene-flow" />
                : <path key={b.id} d={`M${cx} ${GROUND} V${CABLE}`} stroke="#8be9e2" className="scene-flow" />;
            })}
          </g>
        </g>

        {/* inversores */}
        {invs.map((inv, i) => (
          <g key={inv.id} transform={`translate(${invX(i)} ${GROUND - 50})`}>
            <ellipse cx="16" cy="51" rx="22" ry="4" fill="rgb(7 31 39 / 0.3)" />
            <rect width="32" height="50" rx="3" fill="#f3efe6" stroke="#0e3340" strokeWidth="2" />
            <rect x="6" y="24" width="20" height="2.5" fill="#0e3340" opacity="0.5" />
            <rect x="6" y="31" width="20" height="2.5" fill="#0e3340" opacity="0.5" />
            <rect x="6" y="38" width="20" height="2.5" fill="#0e3340" opacity="0.5" />
            <circle cx="16" cy="12" r="5" fill={inv.tone === "ok" ? "#1fae9f" : inv.tone === "bad" ? "#d4603a" : "#8aa3a8"} className={inv.tone === "ok" ? "scene-blink" : undefined} />
          </g>
        ))}

        {/* baterias: o nível é o SOC */}
        {shown.map((b, i) => {
          const x = firstX + i * (boxW + gap);
          const level = Math.max(0, Math.min(100, b.soc ?? 0));
          const inner = boxH - 16;
          const h = inner * (level / 100);
          const low = b.soc != null && off != null && b.soc <= off;
          return (
            <g key={b.id}>
              <ellipse cx={x + boxW / 2} cy={GROUND + 2} rx={boxW / 2 + 12} ry="6" fill="rgb(7 31 39 / 0.3)" />
              <rect x={x} y={top} width={boxW} height={boxH} rx="6" fill="#f3efe6" stroke="#0e3340" strokeWidth="2.5" />
              <rect x={x + 8} y={top + 8} width={boxW - 16} height={inner} rx="3" fill="#0e3340" />
              <rect x={x + 8} y={top + 8 + inner - h} width={boxW - 16} height={h} rx="3" fill={low ? "#d4603a" : "#5cc6c0"} className="scene-level" />
              {marks.map((m) => {
                const y = top + 8 + inner - inner * (m.at / 100);
                return <line key={m.kind} x1={x - 9} x2={x + 8} y1={y} y2={y} stroke={m.kind === "off" ? "#d4603a" : m.kind === "on" ? "#0e3340" : "#f3efe6"} strokeWidth="3.5" strokeLinecap="round" />;
              })}
              <text x={x + boxW / 2} y={top - 14} textAnchor="middle" className="scene-soc scene-art-soc">{b.soc == null ? "—" : `${fmt(b.soc, 0)}%`}</text>
            </g>
          );
        })}
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
