import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";
import { computeFlowState } from "../../../shared/energy-flow-logic";

interface EnergyFlowProps {
  pvPower: number;       // kW — geração fotovoltaica
  batteryPower: number;  // kW — positivo = carregando, negativo = descarregando
  loadPower: number;     // kW — consumo da carga (bomba)
  soc: number;           // % — state of charge
  soh: number;           // % — state of health
  bessModel: string;     // ex: "LUNA2000-215KWH"
  bessCapacityKwh: number;
  pumpDescription: string; // ex: "2x Bomba 30cv"
  isLoadOn: boolean;
}

// ── Animated flow dots ──────────────────────────────────────
function FlowDots({ pathId, color, speed, reverse }: {
  pathId: string; color: string; speed: number; reverse?: boolean;
}) {
  const dots = [0, 0.25, 0.5, 0.75];
  return (
    <>
      {dots.map((offset, i) => (
        <circle key={i} r="4" fill={color} opacity="0.9">
          <animateMotion
            dur={`${speed}s`}
            repeatCount="indefinite"
            begin={`${offset * speed}s`}
            keyPoints={reverse ? "1;0" : "0;1"}
            keyTimes="0;1"
          >
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      ))}
    </>
  );
}

// ── Glow filter ─────────────────────────────────────────────
function GlowFilter({ id, color }: { id: string; color: string }) {
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
      <feFlood floodColor={color} floodOpacity="0.6" result="color" />
      <feComposite in="color" in2="blur" operator="in" result="glow" />
      <feMerge>
        <feMergeNode in="glow" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  );
}

export default function EnergyFlowDiagram({
  pvPower, batteryPower, loadPower, soc, soh,
  bessModel, bessCapacityKwh, pumpDescription, isLoadOn,
}: EnergyFlowProps) {
  const flows = useMemo(() => computeFlowState(pvPower, batteryPower, loadPower), [pvPower, batteryPower, loadPower]);

  const socColor = soc > 50 ? "#22c55e" : soc > 25 ? "#f59e0b" : "#ef4444";
  const batteryAbsPower = Math.abs(batteryPower);

  return (
    <Card className="border-white/5 bg-card overflow-hidden">
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-sm text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-yellow-500" />
            <span className="text-xs sm:text-sm">Fluxo de Energia — Dados ao Vivo</span>
          </div>
          <Badge variant="outline" className="text-[10px] gap-1 font-normal shrink-0"
            style={{ color: flows.sourceColor, borderColor: `${flows.sourceColor}40`, backgroundColor: `${flows.sourceColor}10` }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: flows.sourceColor }} />
            {flows.sourceLabel}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-1 sm:px-2 pb-3">
        {/* SVG uses viewBox for auto-scaling; preserveAspectRatio centers it */}
        <svg viewBox="0 0 700 340" className="w-full h-auto" preserveAspectRatio="xMidYMid meet"
          style={{ maxHeight: "340px", minHeight: "180px" }}>
          <defs>
            <GlowFilter id="glowYellow" color="#f59e0b" />
            <GlowFilter id="glowBlue" color="#3b82f6" />
            <GlowFilter id="glowGreen" color="#22c55e" />
            <GlowFilter id="glowOrange" color="#f97316" />

            {/* Flow paths — horizontal layout: BESS(left) → Load(center) ← PV(right) */}
            <path id="pvToLoad" d="M 560,140 C 480,140 440,155 380,155" fill="none" />
            <path id="bessToLoad" d="M 170,155 C 230,155 260,155 320,155" fill="none" />
            <path id="pvToBess" d="M 560,140 C 460,100 300,100 200,130 C 170,140 170,150 170,155" fill="none" />
          </defs>

          {/* ════════════ BESS / ESS (left) ════════════ */}
          <g transform="translate(50, 95)">
            {/* Battery housing */}
            <rect x="0" y="0" width="120" height="70" rx="8" fill="#0f172a" stroke={socColor} strokeWidth="2" />
            {/* SOC fill bar */}
            <rect x="5" y="5" width={`${Math.max(soc * 1.1, 3)}`} height="60" rx="5"
              fill={socColor} opacity="0.2" />
            <rect x="5" y="5" width={`${Math.max(soc * 1.1, 3)}`} height="60" rx="5"
              fill={socColor} opacity="0.15">
              <animate attributeName="opacity" values="0.1;0.25;0.1" dur="3s" repeatCount="indefinite" />
            </rect>
            {/* Battery terminal */}
            <rect x="120" y="22" width="8" height="26" rx="3" fill={socColor} opacity="0.5" />
            {/* SOC text */}
            <text x="60" y="32" textAnchor="middle" fill={socColor} fontSize="22" fontWeight="bold" fontFamily="monospace">
              {soc.toFixed(1)}%
            </text>
            <text x="60" y="50" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="sans-serif">SOC</text>
            {/* Charging/discharging indicator */}
            {flows.bessCharging && (
              <polygon points="105,12 115,28 105,28" fill="#22c55e" opacity="0.7">
                <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1s" repeatCount="indefinite" />
              </polygon>
            )}
            {flows.bessDischarging && (
              <polygon points="115,12 105,28 115,28" fill="#3b82f6" opacity="0.7">
                <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1s" repeatCount="indefinite" />
              </polygon>
            )}
            {/* Labels below */}
            <text x="60" y="86" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="sans-serif">Armazenamento</text>
            <text x="60" y="104" textAnchor="middle" fill={batteryAbsPower > 0.1 ? "#e2e8f0" : "#475569"} fontSize="16" fontWeight="bold" fontFamily="monospace">
              {batteryAbsPower.toFixed(1)} kW
            </text>
            <text x="60" y="118" textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="sans-serif">
              {flows.bessCharging ? "Carregando" : flows.bessDischarging ? "Descarregando" : "Standby"}
            </text>
            {/* ESS badge */}
            <rect x="30" y="124" width="60" height="22" rx="11" fill={`${socColor}15`} stroke={socColor} strokeWidth="0.5" />
            <text x="60" y="139" textAnchor="middle" fill={socColor} fontSize="11" fontWeight="bold">ESS</text>
          </g>

          {/* ════════════ LOAD / CARGA (center) ════════════ */}
          <g transform="translate(280, 100)">
            {/* Building icon */}
            <rect x="0" y="0" width="100" height="65" rx="5" fill="#0f172a" stroke={isLoadOn ? "#f97316" : "#334155"} strokeWidth="2" />
            {/* Windows */}
            {[0, 1, 2].map((col) => (
              <g key={col}>
                <rect x={10 + col * 28} y="10" width="20" height="14" rx="2"
                  fill={isLoadOn ? "rgba(249,115,22,0.2)" : "#1a2332"} stroke={isLoadOn ? "#f97316" : "#1e293b"} strokeWidth="0.5" />
                <rect x={10 + col * 28} y="30" width="20" height="14" rx="2"
                  fill={isLoadOn ? "rgba(249,115,22,0.15)" : "#1a2332"} stroke={isLoadOn ? "#f97316" : "#1e293b"} strokeWidth="0.5" />
              </g>
            ))}
            {/* Door */}
            <rect x="36" y="48" width="28" height="17" rx="3" fill={isLoadOn ? "rgba(249,115,22,0.3)" : "#1a2332"} stroke={isLoadOn ? "#f97316" : "#334155"} strokeWidth="0.5" />
            {/* Label */}
            <text x="50" y="84" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="sans-serif">Carga</text>
            {/* Power value */}
            <text x="50" y="102" textAnchor="middle" fill={isLoadOn ? "#f97316" : "#475569"} fontSize="16" fontWeight="bold" fontFamily="monospace">
              {loadPower.toFixed(1)} kW
            </text>
            <text x="50" y="116" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="sans-serif">
              Consumo ({pumpDescription})
            </text>
          </g>

          {/* ════════════ SOLAR PANELS (right) ════════════ */}
          <g transform="translate(500, 60)">
            {/* Panel array — 3 panels */}
            {[0, 1, 2].map((col) => (
              <g key={col} transform={`translate(${col * 44}, 0)`}>
                <rect x="0" y="0" width="40" height="58" rx="3" fill="#1e293b" stroke="#334155" strokeWidth="1" />
                {[0, 1, 2, 3].map((row) => (
                  <g key={row}>
                    <rect x="3" y={3 + row * 14} width="16" height="11" rx="1"
                      fill={pvPower > 0 ? "#1e3a5f" : "#1a2332"} stroke={pvPower > 0 ? "#2563eb" : "#1e293b"} strokeWidth="0.5" />
                    <rect x="21" y={3 + row * 14} width="16" height="11" rx="1"
                      fill={pvPower > 0 ? "#1e3a5f" : "#1a2332"} stroke={pvPower > 0 ? "#2563eb" : "#1e293b"} strokeWidth="0.5" />
                  </g>
                ))}
                {pvPower > 0 && (
                  <rect x="8" y="10" width="24" height="3" rx="1" fill="#f59e0b" opacity="0.3">
                    <animate attributeName="opacity" values="0.1;0.4;0.1" dur="2s" repeatCount="indefinite" />
                  </rect>
                )}
              </g>
            ))}
            {/* Label */}
            <text x="66" y="76" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="sans-serif">FV</text>
            {/* Power value */}
            <text x="66" y="96" textAnchor="middle" fill={pvPower > 0 ? "#f59e0b" : "#475569"} fontSize="16" fontWeight="bold" fontFamily="monospace">
              {pvPower.toFixed(1)} kW
            </text>
            <text x="66" y="110" textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="sans-serif">Potência de saída</text>
            {/* FV badge */}
            <rect x="40" y="116" width="52" height="22" rx="11" fill={pvPower > 0 ? "rgba(245,158,11,0.15)" : "rgba(71,85,105,0.15)"} stroke={pvPower > 0 ? "#f59e0b" : "#475569"} strokeWidth="0.5" />
            <text x="66" y="131" textAnchor="middle" fill={pvPower > 0 ? "#f59e0b" : "#475569"} fontSize="11" fontWeight="bold">FV</text>
          </g>

          {/* ════════════ FLOW LINES ════════════ */}
          {/* PV → Load */}
          <path d="M 560,140 C 480,140 440,155 380,155" fill="none"
            stroke={flows.pvToLoad ? "#f59e0b" : "rgba(71,85,105,0.2)"}
            strokeWidth={flows.pvToLoad ? 3 : 1}
            strokeDasharray={flows.pvToLoad ? "none" : "4 4"}
            filter={flows.pvToLoad ? "url(#glowYellow)" : "none"} />
          {flows.pvToLoad && <FlowDots pathId="pvToLoad" color="#f59e0b" speed={2} />}

          {/* BESS → Load */}
          <path d="M 170,155 C 230,155 260,155 320,155" fill="none"
            stroke={flows.bessToLoad ? "#3b82f6" : "rgba(71,85,105,0.2)"}
            strokeWidth={flows.bessToLoad ? 3 : 1}
            strokeDasharray={flows.bessToLoad ? "none" : "4 4"}
            filter={flows.bessToLoad ? "url(#glowBlue)" : "none"} />
          {flows.bessToLoad && <FlowDots pathId="bessToLoad" color="#3b82f6" speed={2} />}

          {/* PV → BESS (charging) */}
          <path d="M 560,140 C 460,100 300,100 200,130 C 170,140 170,150 170,155" fill="none"
            stroke={flows.pvToBess ? "#8b5cf6" : "rgba(71,85,105,0.1)"}
            strokeWidth={flows.pvToBess ? 2.5 : 0.5}
            strokeDasharray={flows.pvToBess ? "none" : "4 4"} />
          {flows.pvToBess && <FlowDots pathId="pvToBess" color="#8b5cf6" speed={3} />}

          {/* Power values on flow lines */}
          {flows.pvToLoad && (
            <g>
              <rect x="420" y="125" width="80" height="24" rx="5" fill="rgba(15,23,42,0.9)" stroke="rgba(245,158,11,0.3)" strokeWidth="0.5" />
              <text x="460" y="141" textAnchor="middle" fill="#f59e0b" fontSize="12" fontWeight="bold" fontFamily="monospace">
                {pvPower.toFixed(1)} kW
              </text>
            </g>
          )}
          {flows.bessToLoad && (
            <g>
              <rect x="205" y="135" width="80" height="24" rx="5" fill="rgba(15,23,42,0.9)" stroke="rgba(59,130,246,0.3)" strokeWidth="0.5" />
              <text x="245" y="151" textAnchor="middle" fill="#3b82f6" fontSize="12" fontWeight="bold" fontFamily="monospace">
                {batteryAbsPower.toFixed(1)} kW
              </text>
            </g>
          )}
          {flows.pvToBess && !flows.pvToLoad && (
            <g>
              <rect x="300" y="85" width="90" height="24" rx="5" fill="rgba(15,23,42,0.9)" stroke="rgba(139,92,246,0.3)" strokeWidth="0.5" />
              <text x="345" y="101" textAnchor="middle" fill="#8b5cf6" fontSize="12" fontWeight="bold" fontFamily="monospace">
                {batteryPower.toFixed(1)} kW
              </text>
            </g>
          )}

          {/* ════════════ LIVE INDICATOR ════════════ */}
          <g transform="translate(10, 315)">
            <circle cx="7" cy="7" r="5" fill="#22c55e" opacity="0.8">
              <animate attributeName="r" values="3;6;3" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
            </circle>
            <text x="18" y="11" fill="#94a3b8" fontSize="10" fontFamily="sans-serif">Dados ao vivo</text>
          </g>
        </svg>
      </CardContent>
    </Card>
  );
}
