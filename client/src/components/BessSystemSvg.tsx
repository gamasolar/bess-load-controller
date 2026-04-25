import { useMemo } from "react";

interface BessSystemSvgProps {
  soc: number;
  isActive: boolean;
}

export default function BessSystemSvg({ soc, isActive }: BessSystemSvgProps) {
  const socColor = useMemo(() => {
    if (soc >= 50) return "#22c55e";
    if (soc >= 20) return "#f59e0b";
    return "#ef4444";
  }, [soc]);

  /* Battery fill: 70px max height, from y=96 upward */
  const batteryMaxH = 70;
  const batteryFillH = useMemo(() => Math.max(2, (soc / 100) * batteryMaxH), [soc]);
  const batteryFillY = useMemo(() => 96 - batteryFillH, [batteryFillH]);

  return (
    <svg viewBox="0 0 720 210" className="w-full max-w-[720px] mx-auto" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="battFill" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={socColor} stopOpacity="0.95" />
          <stop offset="100%" stopColor={socColor} stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#1e40af" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="pipeWater" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.6" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glowBlue">
          <feGaussianBlur stdDeviation="1.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Clip for battery fill */}
        <clipPath id="battClip">
          <rect x="6" y="26" width="88" height="70" rx="2" />
        </clipPath>
        {/* Clip for reservoir water */}
        <clipPath id="tankClip">
          <rect x="4" y="20" width="122" height="86" rx="3" />
        </clipPath>
      </defs>

      {/* ═══ BESS BATTERY ═══ */}
      <g transform="translate(40, 15)">
        {/* Battery shell */}
        <rect x="0" y="20" width="100" height="80" rx="6" fill="#0f172a" stroke="#334155" strokeWidth="2" />
        {/* Terminal */}
        <rect x="35" y="12" width="30" height="10" rx="4" fill="#334155" />
        {/* Inner area */}
        <rect x="4" y="24" width="92" height="72" rx="3" fill="#070e1a" stroke="#1e293b" strokeWidth="0.5" />
        {/* SOC fill bar — proportional to real SOC */}
        <rect
          x="6" y={batteryFillY} width="88" height={batteryFillH}
          rx="2" fill="url(#battFill)" clipPath="url(#battClip)"
          style={{ transition: "all 1s ease" }}
        />
        {/* Charge shimmer at top of fill */}
        <line x1="8" y1={batteryFillY + 1} x2="92" y2={batteryFillY + 1}
          stroke={socColor} strokeWidth="1" opacity="0.4"
          style={{ transition: "all 1s ease" }}
        >
          <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite" />
        </line>
        {/* Grid lines */}
        {[25, 50, 75].map(pct => (
          <line key={pct} x1="6" y1={96 - (pct / 100) * 70} x2="94" y2={96 - (pct / 100) * 70}
            stroke="#0f172a" strokeWidth="0.8" opacity="0.5" />
        ))}
        {/* SOC text */}
        <text x="50" y="68" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold"
          fontFamily="'Courier New', monospace" filter="url(#glow)">
          {soc.toFixed(1)}%
        </text>
        {/* Label */}
        <text x="50" y="118" textAnchor="middle" fill="#64748b" fontSize="9"
          fontFamily="system-ui, sans-serif" letterSpacing="1">
          BESS LUNA2000
        </text>
      </g>

      {/* ═══ CABLE: Battery → Pump ═══ */}
      <g>
        <line x1="145" y1="75" x2="260" y2="75" stroke="#1e293b" strokeWidth="5" strokeLinecap="round" />
        <line x1="145" y1="75" x2="260" y2="75"
          stroke={isActive ? "#334155" : "#1e293b"} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={isActive ? "8,6" : "none"}
        />
        {/* Energy particles */}
        {isActive && [0, 0.3, 0.6].map((delay, i) => (
          <circle key={i} r="4" fill="#facc15" opacity="0.9" filter="url(#glow)">
            <animateMotion dur="0.9s" repeatCount="indefinite" begin={`${delay}s`}>
              <mpath xlinkHref="#cable1" />
            </animateMotion>
          </circle>
        ))}
        <path id="cable1" d="M148,75 L257,75" fill="none" stroke="none" />
        <circle cx="145" cy="75" r="4" fill={isActive ? "#facc15" : "#475569"} />
        <circle cx="260" cy="75" r="4" fill={isActive ? "#facc15" : "#475569"} />
      </g>

      {/* ═══ PUMP ═══ */}
      <g transform="translate(295, 38)">
        {/* Outer ring */}
        <circle cx="37" cy="37" r="38" fill="none"
          stroke={isActive ? "#22c55e" : "#334155"} strokeWidth="2.5"
          style={{ transition: "stroke 0.5s ease" }} />
        {/* Body */}
        <circle cx="37" cy="37" r="34" fill="#0f172a" stroke="#1e293b" strokeWidth="1.5" />
        {/* Impeller — 6 blades */}
        <g style={{ transformOrigin: "332px 75px" }} className={isActive ? "animate-spin-pump" : ""}>
          {[0, 60, 120, 180, 240, 300].map(angle => (
            <rect key={angle} x="35" y="10" width="4" height="20" rx="2"
              fill={isActive ? "#22c55e" : "#475569"}
              transform={`rotate(${angle}, 37, 37)`}
              style={{ transition: "fill 0.5s ease" }}
            />
          ))}
        </g>
        {/* Hub */}
        <circle cx="37" cy="37" r="7" fill={isActive ? "#22c55e" : "#475569"}
          style={{ transition: "fill 0.5s ease" }} />
        <circle cx="37" cy="37" r="3.5" fill="#0f172a" />
        {/* NO pulse ring — removed to fix mobile asterisk bug */}
        {/* Labels */}
        <text x="37" y="92" textAnchor="middle" fill="#64748b" fontSize="9"
          fontFamily="system-ui, sans-serif" letterSpacing="1">
          BOMBA
        </text>
        <text x="37" y="104" textAnchor="middle"
          fill={isActive ? "#22c55e" : "#ef4444"} fontSize="8" fontWeight="bold"
          fontFamily="system-ui, sans-serif" letterSpacing="1.5">
          {isActive ? "ATIVA" : "INATIVA"}
        </text>
      </g>

      {/* ═══ PIPE: Pump → Reservoir ═══ */}
      <g>
        {/* Pipe outer shell */}
        <rect x="372" y="67" width="160" height="16" rx="8" fill="#0c1a30" stroke="#1e293b" strokeWidth="1.5" />
        {/* Pipe inner */}
        <rect x="375" y="70" width="154" height="10" rx="5" fill="#070e1a" />
        {/* Water fill inside pipe when active */}
        {isActive && (
          <rect x="375" y="70" width="154" height="10" rx="5" fill="url(#pipeWater)" opacity="0.5">
            <animate attributeName="opacity" values="0.3;0.6;0.3" dur="1.5s" repeatCount="indefinite" />
          </rect>
        )}
        {/* Water flow particles — larger and more visible */}
        {isActive && [0, 0.25, 0.5, 0.75].map((delay, i) => (
          <circle key={i} r="4" fill="#60a5fa" opacity="0.9" filter="url(#glowBlue)">
            <animateMotion dur="1s" repeatCount="indefinite" begin={`${delay}s`}>
              <mpath xlinkHref="#pipe1" />
            </animateMotion>
          </circle>
        ))}
        <path id="pipe1" d="M380,75 L525,75" fill="none" stroke="none" />
        {/* Pipe flanges */}
        <rect x="369" y="65" width="8" height="20" rx="2" fill="#334155" />
        <rect x="529" y="65" width="8" height="20" rx="2" fill="#334155" />
      </g>

      {/* ═══ RESERVOIR ═══ */}
      <g transform="translate(545, 10)">
        {/* Tank body */}
        <rect x="0" y="16" width="130" height="100" rx="5" fill="#0c1a30" stroke="#334155" strokeWidth="2" />
        {/* Tank inner */}
        <rect x="3" y="19" width="124" height="94" rx="3" fill="#070e1a" />

        {/* Water level — rises when active */}
        <rect
          x="4" y={isActive ? 35 : 75} width="122"
          height={isActive ? 77 : 37}
          rx="2" fill="url(#waterGrad)" clipPath="url(#tankClip)"
          style={{ transition: "all 3s ease" }}
        />

        {/* Water surface wave animation */}
        <g clipPath="url(#tankClip)">
          <path
            d={`M4,${isActive ? 35 : 75} Q35,${isActive ? 32 : 72} 65,${isActive ? 35 : 75} T126,${isActive ? 35 : 75}`}
            fill="none" stroke="#60a5fa" strokeWidth="1.5" opacity="0.5"
            style={{ transition: "all 3s ease" }}
          >
            <animate attributeName="d"
              values={isActive
                ? "M4,35 Q35,32 65,35 T126,35;M4,35 Q35,38 65,35 T126,35;M4,35 Q35,32 65,35 T126,35"
                : "M4,75 Q35,73 65,75 T126,75;M4,75 Q35,77 65,75 T126,75;M4,75 Q35,73 65,75 T126,75"
              }
              dur="2.5s" repeatCount="indefinite" />
          </path>
        </g>

        {/* Water drops falling from pipe into reservoir — more visible */}
        {isActive && (
          <>
            {/* Drop stream 1 — left */}
            <circle cx="25" r="2.5" fill="#60a5fa" opacity="0">
              <animate attributeName="cy" values="16;34" dur="0.5s" repeatCount="indefinite" begin="0s" />
              <animate attributeName="opacity" values="0.9;0.1" dur="0.5s" repeatCount="indefinite" begin="0s" />
            </circle>
            {/* Drop stream 2 — center-left */}
            <circle cx="45" r="2" fill="#93c5fd" opacity="0">
              <animate attributeName="cy" values="16;34" dur="0.6s" repeatCount="indefinite" begin="0.15s" />
              <animate attributeName="opacity" values="0.8;0.1" dur="0.6s" repeatCount="indefinite" begin="0.15s" />
            </circle>
            {/* Drop stream 3 — center */}
            <circle cx="65" r="3" fill="#60a5fa" opacity="0">
              <animate attributeName="cy" values="16;34" dur="0.45s" repeatCount="indefinite" begin="0.3s" />
              <animate attributeName="opacity" values="0.9;0" dur="0.45s" repeatCount="indefinite" begin="0.3s" />
            </circle>
            {/* Drop stream 4 — center-right */}
            <circle cx="85" r="2" fill="#93c5fd" opacity="0">
              <animate attributeName="cy" values="16;34" dur="0.55s" repeatCount="indefinite" begin="0.1s" />
              <animate attributeName="opacity" values="0.8;0.1" dur="0.55s" repeatCount="indefinite" begin="0.1s" />
            </circle>
            {/* Drop stream 5 — right */}
            <circle cx="105" r="2.5" fill="#60a5fa" opacity="0">
              <animate attributeName="cy" values="16;34" dur="0.5s" repeatCount="indefinite" begin="0.25s" />
              <animate attributeName="opacity" values="0.9;0.1" dur="0.5s" repeatCount="indefinite" begin="0.25s" />
            </circle>
            {/* Splash ripples at water surface */}
            <circle cx="45" cy="36" r="0" fill="none" stroke="#93c5fd" strokeWidth="0.5" opacity="0">
              <animate attributeName="r" values="0;8" dur="0.8s" repeatCount="indefinite" begin="0.15s" />
              <animate attributeName="opacity" values="0.5;0" dur="0.8s" repeatCount="indefinite" begin="0.15s" />
            </circle>
            <circle cx="85" cy="36" r="0" fill="none" stroke="#93c5fd" strokeWidth="0.5" opacity="0">
              <animate attributeName="r" values="0;8" dur="0.8s" repeatCount="indefinite" begin="0.4s" />
              <animate attributeName="opacity" values="0.5;0" dur="0.8s" repeatCount="indefinite" begin="0.4s" />
            </circle>
          </>
        )}

        {/* Tank level markers */}
        {[25, 50, 75].map(pct => (
          <g key={pct}>
            <line x1="126" y1={110 - (pct / 100) * 88} x2="131" y2={110 - (pct / 100) * 88}
              stroke="#475569" strokeWidth="1" />
            <text x="134" y={110 - (pct / 100) * 88 + 3} fill="#475569" fontSize="6"
              fontFamily="system-ui, sans-serif">{pct}%</text>
          </g>
        ))}
        {/* Label */}
        <text x="65" y="132" textAnchor="middle" fill="#64748b" fontSize="9"
          fontFamily="system-ui, sans-serif" letterSpacing="1">
          RESERVATÓRIO
        </text>
      </g>
    </svg>
  );
}
