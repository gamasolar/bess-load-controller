/**
 * Supervisão SCADA: o visual do pacote "gama-scada" ligado aos dados reais.
 *
 * Nada aqui é demonstrativo: todo número vem de bess.getSiteStatus,
 * telemetry.site, bess.readings, bess.alarms, bess.weather e telemetry.cycles.
 * Valor ausente aparece como "--" / "Sem leitura", nunca como zero.
 *
 * O estado da bomba vem de derived.loadHealth (confirmação por detecção de
 * carga, regra do backend). Clicar em "Ligar" não muda nenhuma animação.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ConfigModalV2 } from "@/components/v2/ConfigModalV2";
import { HistoryModal } from "@/components/v2/HistoryModal";
import { PumpStatsModal } from "@/components/v2/PumpStatsModal";
import { AllReadings, History, Inverter, ago, deviceTitle, num, pointValue, sentence, type Device } from "./Plant";
import "./plant.css";
import "./scada-base.css";
import "./scada.css";

type View = "Visão Geral" | "Tendências" | "Equipamentos" | "Alarmes";
const VIEWS: View[] = ["Visão Geral", "Tendências", "Equipamentos", "Alarmes"];
const W = 1672;
const H = 941;
const FLOW_MIN = 0.3;
const STALE_SECONDS = 45 * 60;

const HEALTH_TEXT: Record<string, { text: string; short: string; tone: "ok" | "warn" | "bad" | "idle" }> = {
  RUNNING_OK: { text: "Operando · confirmada pela carga", short: "Operando", tone: "ok" },
  OFF_OK: { text: "Parada", short: "Parada", tone: "idle" },
  VERIFYING: { text: "Comando enviado · aguardando confirmação", short: "Aguardando", tone: "warn" },
  FAILED: { text: "Comando ligado · bomba não confirmada", short: "Não confirmada", tone: "bad" },
  RESIDUAL: { text: "Carga residual · bomba não confirmada", short: "Residual", tone: "warn" },
  UNKNOWN: { text: "Estado não confirmado", short: "Não confirmado", tone: "idle" },
};

function weatherLabel(code: number): string {
  if (code === 0) return "Céu limpo";
  if (code <= 2) return "Poucas nuvens";
  if (code === 3) return "Nublado";
  if (code <= 48) return "Neblina";
  if (code <= 57) return "Garoa";
  if (code <= 67) return "Chuva";
  if (code <= 82) return "Pancadas de chuva";
  return "Trovoada";
}

function shortName(name: string): string {
  return /\((.+)\)/.exec(name)?.[1] ?? name;
}

/** Valor com unidade; ausência vira "--", nunca zero. */
function reading(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? "--" : num(v, digits);
}

function Spark({ values, color, zero }: { values: (number | null)[]; color: string; zero?: boolean }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <p className="sc-empty">Sem histórico nas últimas 24 h</p>;
  const lo = Math.min(...pts.map((p) => p.v), zero ? 0 : Infinity);
  const hi = Math.max(...pts.map((p) => p.v), zero ? 0 : -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => 34 + (i / (values.length - 1)) * 262;
  const y = (v: number) => 8 + (1 - (v - lo) / span) * 62;
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 300 92" preserveAspectRatio="none" aria-hidden="true">
      {[0, 0.5, 1].map((f) => <line key={f} className="gridline" x1="34" x2="296" y1={8 + f * 62} y2={8 + f * 62} />)}
      <text x="30" y="12" textAnchor="end">{num(hi, 0)}</text>
      <text x="30" y="74" textAnchor="end">{num(lo, 0)}</text>
      <path className="area" d={`${d} L${x(pts[pts.length - 1].i)} 70 L${x(pts[0].i)} 70Z`} fill={color} />
      <path className="line" d={d} stroke={color} />
      <text x="34" y="88">24 h atrás</text>
      <text x="296" y="88" textAnchor="end">agora</text>
    </svg>
  );
}

export default function Scada() {
  const [, params] = useRoute("/scada/:slug");
  const [, navigate] = useLocation();
  const slug = params?.slug ?? "barragem";
  const { isAdmin } = useAuth();
  const utils = trpc.useUtils();

  const sites = trpc.bess.sites.useQuery(undefined, { staleTime: 5 * 60_000 }).data ?? [];
  const status = trpc.bess.getSiteStatus.useQuery({ slug }, { refetchInterval: 30_000 });
  const telemetry = trpc.telemetry.site.useQuery({ slug }, { refetchInterval: 30_000, retry: false });
  const alarms = (trpc.bess.alarms.useQuery({ slug }, { refetchInterval: 60_000 }).data ?? []).filter((a) => a.active);
  const readings = trpc.bess.readings.useQuery({ slug, hours: 24 }, { refetchInterval: 5 * 60_000 }).data ?? [];
  const weather = trpc.bess.weather.useQuery({ slug }, { refetchInterval: 10 * 60_000, staleTime: 5 * 60_000 }).data;
  const cycles = trpc.telemetry.cycles.useQuery({ slug }, { staleTime: 10 * 60_000 }).data;
  // A água do Piscinão depende da bomba da BARRAGEM estar confirmadamente operando.
  const barragem = trpc.bess.getSiteStatus.useQuery({ slug: "barragem" }, { enabled: slug === "piscinao", refetchInterval: 30_000 }).data;

  const [view, setView] = useState<View>("Visão Geral");
  const [pumpOpen, setPumpOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "ON" | "OFF">(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [inverterId, setInverterId] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [fit, setFit] = useState({ mobile: false, scale: 1, scene: 0.3 });
  const lastRound = useRef<{ slug: string; battery: number; pv: number; load: number } | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const apply = () => {
      const mobile = window.innerWidth < 900;
      setFit({
        mobile,
        scale: Math.min(window.innerWidth / W, window.innerHeight / H),
        scene: Math.max(240, window.innerWidth - 24) / 1180,
      });
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  useEffect(() => { setView("Visão Geral"); setPumpOpen(false); }, [slug]);

  const command = trpc.bess.command.useMutation({
    onSuccess: (res) => { (res.success ? toast.success : toast.error)(res.message); utils.bess.getSiteStatus.invalidate({ slug }); },
    onError: (e) => toast.error(e.message),
  });
  const setMode = trpc.bess.setControlMode.useMutation({
    onSuccess: (res) => { (res.success ? toast.success : toast.error)(res.message); utils.bess.getSiteStatus.invalidate({ slug }); },
    onError: (e) => toast.error(e.message),
  });

  const s = status.data;
  const devices = telemetry.data?.devices ?? [];
  const batteries = devices.filter((d) => d.kind === "ess");
  const inverters = devices.filter((d) => d.kind === "inverter");
  const titles = useMemo(() => {
    const t = new Map<number, string>();
    batteries.forEach((d, i) => t.set(d.id, deviceTitle(d, i)));
    inverters.forEach((d, i) => t.set(d.id, deviceTitle(d, i)));
    devices.filter((d) => !t.has(d.id)).forEach((d, i) => t.set(d.id, deviceTitle(d, i)));
    return t;
  }, [telemetry.data]);

  // Só potências de uma rodada completa de leitura (inversores lidos depois da bateria).
  if (batteries.length > 0 && inverters.length > 0) {
    const at = (d: Device) => (d.lastSampleAt ? new Date(d.lastSampleAt).getTime() : 0);
    if (Math.min(...inverters.map(at)) >= Math.max(...batteries.map(at))) {
      const bat = batteries.reduce((a, d) => a + (pointValue(d, "ch_discharge_power") ?? 0), 0);
      const sun = inverters.reduce((a, d) => a + (pointValue(d, "active_power") ?? 0), 0);
      lastRound.current = { slug, battery: bat, pv: sun, load: Math.max(0, sun - bat) };
    }
  }
  const held = lastRound.current?.slug === slug ? lastRound.current : null;

  const age = s?.derived.socAgeSeconds ?? null;
  const stale = age != null && age > STALE_SECONDS;
  const noData = !s || s.state.lastTelemetryAt == null || age == null || s.derived.soc == null;
  const live = !noData && !stale;
  const soc = s?.derived.soc ?? null;
  const battery = live ? held?.battery ?? s?.state.currentBatteryPower ?? null : null;
  const pv = live ? held?.pv ?? s?.state.currentPvPower ?? null : null;
  const load = live ? held?.load ?? s?.state.currentLoadPower ?? null : null;
  const freshness = status.isLoading ? "Carregando…" : status.error ? "Erro ao consultar o servidor" : noData ? "Sem leitura" : stale ? `Sem atualização ${ago(age)}` : `Atualizado ${ago(age)}`;

  const health = HEALTH_TEXT[(s?.derived as { loadHealth?: string } | undefined)?.loadHealth ?? "UNKNOWN"] ?? HEALTH_TEXT.UNKNOWN;
  const automationOnline = !!s?.state.sonoffOnline && !!s?.state.mqttConnected;
  const hasAutomation = !!s?.site.mqttTopic;

  const critical = alarms.filter((a) => a.severity === "CRITICAL").length;
  const level = critical > 0 ? "critical" : alarms.length > 0 || stale || noData ? "warning" : "normal";
  const levelText = level === "critical" ? "CRÍTICO" : level === "warning" ? "ATENÇÃO" : "NORMAL";

  const charging = battery != null && battery > FLOW_MIN;
  const discharging = battery != null && battery < -FLOW_MIN;
  const sunOn = (pv ?? 0) > FLOW_MIN;
  const loadOn = (load ?? 0) > FLOW_MIN;
  const flowCaption = !live ? "Sem telemetria válida · fluxos parados"
    : sunOn && charging && loadOn ? "Solar alimentando a carga e carregando o BESS"
    : sunOn && charging ? "Solar carregando o BESS"
    : sunOn && discharging ? "Solar e BESS alimentando a carga"
    : sunOn ? "Solar alimentando a carga · BESS em espera"
    : discharging ? "BESS alimentando a carga"
    : "Sem fluxo de energia relevante";

  const ordered = useMemo(() => [...readings].sort((a, b) => a.timestamp - b.timestamp), [readings]);
  const usableKwh = (sites.find((x) => x.slug === slug)?.bessCount ?? 1) * 200;

  const barragemHealth = (barragem?.derived as { loadHealth?: string } | undefined)?.loadHealth;
  const barragemFresh = barragem?.derived.socAgeSeconds != null && barragem.derived.socAgeSeconds <= STALE_SECONDS;
  const waterRunning = slug === "piscinao" && barragemHealth === "RUNNING_OK";
  const waterText = !barragem ? "Consultando a bomba da Barragem…"
    : barragemHealth === "RUNNING_OK" ? `Bomba da Barragem: operando${barragemFresh && barragem.state.currentLoadPower != null ? ` · ${num(barragem.state.currentLoadPower)} kW` : ""}`
    : barragemHealth === "VERIFYING" ? "Bomba da Barragem: aguardando confirmação"
    : barragemHealth === "FAILED" ? "Comando enviado · bomba não confirmada"
    : barragemHealth === "OFF_OK" ? "Bomba da Barragem: parada"
    : "Bomba da Barragem: estado não confirmado";

  const invKw = live && inverters.length > 0 ? pv : null;
  const invBad = inverters.find((d) => /falha|parado|desligado/i.test(d.summary.status ?? ""));
  const invStatus = inverters.length === 0 ? "Sem leitura" : invBad ? (invBad.summary.status ?? "") : (inverters[0].summary.status ?? "Sem estado");
  const shownInverter = inverters.find((d) => d.id === inverterId) ?? inverters[0];
  const cur = weather && "available" in weather && weather.available ? weather.current : null;

  const body = (
    <>
      <header>
        <a className="brand" href="/" aria-label="Gama Solar: voltar à operação" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
          <img src="/scada/logo.webp" alt="Gama Solar — Energia Fotovoltaica" />
        </a>
        <div className="plants">
          {sites.map((x) => (
            <button key={x.slug} type="button" className={x.slug === slug ? "selected" : undefined} aria-pressed={x.slug === slug} onClick={() => navigate(`/scada/${x.slug}`)}>
              {shortName(x.name)}
            </button>
          ))}
        </div>
        <nav>
          {VIEWS.map((v) => <button key={v} type="button" className={view === v ? "active" : undefined} onClick={() => setView(v)}>{v}</button>)}
          <button type="button" onClick={() => setHistoryOpen(true)}>Eventos</button>
        </nav>
        <div className="topcard weather">
          <span className="moon">{cur ? (cur.isDay ? "☀" : "☾") : "–"}</span>
          <span><strong>{cur ? `${Math.round(cur.tempC)}°C` : "--"}</strong><small>{cur ? weatherLabel(cur.weatherCode) : "Clima indisponível"}</small></span>
        </div>
        <div className="topcard">
          <span className="clockicon">◷</span>
          <span>
            <small>{now.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</small>
            <strong>{now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
          </span>
        </div>
        <div className="topcard refresh" data-live={live}>
          <i /><span>{freshness}</span>
        </div>
      </header>

      <section className="intro">
        <span>BESS</span>
        <h1>{s ? shortName(s.site.name) : " "}</h1>
        <div className="critical" data-level={level}>{levelText}</div>
        <p className="summary">{s ? (live ? sentence(soc, battery, pv, load) : `${freshness}. ${soc != null ? `Último SOC ${num(soc, 0)}%.` : ""}`) : "Lendo a planta…"}</p>
        <button type="button" className="outline" onClick={() => setView("Alarmes")}>Ver diagnóstico <span>→</span></button>
      </section>

      <div className="scene-stage" role="img" aria-label={slug === "piscinao" ? "Piscinão: reservatórios, campo solar, inversor, BESS, bomba e torre distribuidora de água." : "Barragem: reservatório, campo solar, inversor, BESS e bomba com tubulação."}>
        <div className="scene-layer" style={fit.mobile ? { transform: `scale(${fit.scene}) translate(-100px,-240px)` } : undefined}>
          <svg className="connections energy-network" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            <defs>
              <path id="route-solar" d="M550 463 C580 463 579 510 610 510 H639 Q660 510 660 490" />
              <path id="route-input" d="M695 492 C695 524 738 534 778 534 H888" />
              <path id="route-storage" d="M900 524 V503" />
              <path id="route-output" d="M912 534 H1056 C1102 534 1140 523 1140 499" />
            </defs>
            {([["solar", sunOn, false], ["input", sunOn, false], ["storage", charging || discharging, discharging], ["output", loadOn, false]] as const).map(([id, on, reverse]) => (
              <g key={id} className={`energy-route${on ? " energized" : ""}${reverse ? " reverse" : ""}`} data-route={id}>
                <use className="route-base" href={`#route-${id}`} />
                <use className="route-glow" href={`#route-${id}`} />
                <use className="route-light" href={`#route-${id}`} />
              </g>
            ))}
            <g className="energy-hub"><circle className="hub-halo" cx="900" cy="534" r="17" /><circle className="hub-core" cx="900" cy="534" r="10" /><path d="M895 534H905M900 529V539" /></g>
            <g className="route-labels">
              <text x="781" y="522" textAnchor="middle">ENTRADA SOLAR</text>
              <text x="1023" y="522" textAnchor="middle">SAÍDA PARA CARGA</text>
              <text className="hub-label" x="900" y="567" textAnchor="middle">GESTÃO BESS · AC</text>
            </g>
          </svg>

          {slug === "piscinao" && (
            <svg className={`water-circuit${waterRunning ? " water-running" : ""}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
              <defs>
                <linearGradient id="fall-water" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#eefbfc" stopOpacity=".66" /><stop offset=".38" stopColor="#b4dfe5" stopOpacity=".48" /><stop offset="1" stopColor="#759fa7" stopOpacity=".22" /></linearGradient>
                <linearGradient id="runoff-water" x1="0" x2="1"><stop stopColor="#8cbcc4" stopOpacity=".32" /><stop offset=".52" stopColor="#b4dce1" stopOpacity=".46" /><stop offset="1" stopColor="#d7e8e8" stopOpacity=".2" /></linearGradient>
                <filter id="water-soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation=".75" /></filter>
              </defs>
              <g transform="translate(-20 18)">
                <g className="falling-water">
                  <path className="fall-shadow" d="M1235 129 C1232 148 1234 174 1237 193 M1242 129 C1240 151 1241 174 1242 194 M1248 131 C1250 151 1248 176 1246 193" />
                  <path className="central-fall" d="M1235 129 C1232 148 1234 174 1237 193 M1242 129 C1240 151 1241 174 1242 194 M1248 131 C1250 151 1248 176 1246 193" />
                  <path className="fall-highlight highlight-a" d="M1237 130 C1235 151 1236 175 1238 192" />
                  <path className="fall-highlight highlight-b" d="M1245 130 C1243 151 1245 175 1244 193" />
                </g>
                <image className="divider-tower" href="/scada/torre.webp" x="1218" y="110" width="47" height="83" preserveAspectRatio="xMidYMid meet" />
                <g className="falling-water">
                  <ellipse className="ground-wet" cx="1242" cy="194" rx="16" ry="2.7" />
                  <ellipse className="ground-foam" cx="1242" cy="193.5" rx="10" ry="1.6" />
                  <path className="runoff-shadow" d="M1255 192 C1274 198 1291 207 1310 216 C1321 221 1329 224 1338 224" />
                  <path className="edge-overflow" d="M1255 192 C1274 198 1291 207 1310 216 C1321 221 1329 224 1338 224" />
                  <path className="runoff-thread thread-one" d="M1258 191 C1274 199 1291 205 1309 215 C1320 221 1328 223 1336 223" />
                  <path className="runoff-thread thread-two" d="M1261 194 C1277 200 1292 210 1308 217 C1320 222 1327 225 1335 224" />
                  <ellipse className="water-foam" cx="1336" cy="224" rx="7" ry="1.6" />
                  <ellipse className="water-ripple ripple-one" cx="1336" cy="225" rx="10" ry="2.5" />
                  <ellipse className="water-ripple ripple-two" cx="1336" cy="225" rx="10" ry="2.5" />
                </g>
              </g>
            </svg>
          )}
        </div>
      </div>

      <div className="glass flow-controls">
        <div className="flow-selector"><label>FLUXO DE ENERGIA</label><span className="sc-fresh" data-live={live}>{freshness}</span></div>
        <div className="flow-state-line">
          <span>BESS · {!live ? "sem leitura" : charging ? `carregando ${num(battery)} kW` : discharging ? `descarregando ${num(-battery!)} kW` : "em espera"}</span>
          <span>Carga · {!live || load == null ? "sem leitura" : `${num(load)} kW`}</span>
        </div>
        <small id="flow-caption" aria-live="polite">{flowCaption}</small>
      </div>

      <div className="equipment-readouts">
        <button type="button" className="equipment-tag solar-tag" onClick={() => setView("Equipamentos")}>
          <span className="tag-title">CAMPO SOLAR <span className="tag-arrow">↗</span></span>
          <span className="tag-reading"><strong>{reading(pv)} <span>kW</span></strong><small>{!live ? "Sem leitura" : sunOn ? "Gerando" : cur && !cur.isDay ? "Noite" : "Sem geração"}</small></span>
        </button>
        <button type="button" className="equipment-tag inverter-tag" onClick={() => setView("Equipamentos")}>
          <span className="tag-title">INVERSORES <span className="tag-arrow">↗</span></span>
          <span className="tag-reading"><strong>{reading(invKw)} <span>kW</span></strong><small>{inverters.length ? `${inverters.length} un.` : "Sem leitura"}</small></span>
          <span className="tag-status" data-bad={!!invBad}>● {invStatus}</span>
        </button>
        <button type="button" className="equipment-tag bess-tag" onClick={() => setView("Equipamentos")}>
          <span className="tag-title">BESS <span className="tag-soc" data-low={soc != null && s != null && soc <= s.config.socMinDesliga}>SOC {soc == null ? "--" : `${num(soc, 0)}%`}</span><span className="tag-arrow">↗</span></span>
          <span className="tag-reading"><strong>{reading(battery == null ? null : Math.abs(battery))} <span>kW</span></strong><small>{!live ? "Sem leitura" : charging ? "Carregando" : discharging ? "Descarregando" : "Em espera"}</small></span>
        </button>
        <button type="button" className="equipment-tag pump-tag" onClick={() => setPumpOpen(true)}>
          <span className="tag-title">BOMBA <span className="tag-arrow">↗</span></span>
          <span className="tag-reading"><strong>{reading(load)} <span>kW</span></strong><small>{hasAutomation ? health.short : "Manual"}</small></span>
        </button>
      </div>

      <button type="button" className="glass bottom-node grid" onClick={() => setView("Equipamentos")}>
        <span className="equipment-icon">☁</span>
        <span><span>Leitura FusionSolar</span><strong className={live ? "sc-green" : "red"}>{live ? "● ONLINE" : "⊗ SEM LEITURA"}</strong><small>{freshness}</small></span>
      </button>
      <button type="button" className="glass bottom-node logger" onClick={() => setPumpOpen(true)}>
        <span className="cabinet">▥</span>
        <span><span>Automação da bomba</span>
          <strong className={!hasAutomation ? undefined : automationOnline ? "sc-green" : "red"}>{!hasAutomation ? "NÃO INSTALADA" : automationOnline ? "● ONLINE" : "⊗ OFFLINE"}</strong>
          <small>{!hasAutomation ? "Bomba operada no local" : automationOnline ? `Modo ${s?.config.controlMode === "AUTO" ? "automático" : "manual"}` : "Sem comunicação"}</small></span>
      </button>

      {slug === "piscinao" && (
        <div className="water-control glass">
          <span>DISTRIBUIÇÃO DE ÁGUA</span>
          <strong>{waterText}</strong>
          <small>{waterRunning ? "Queda central · escoando para o reservatório" : "Distribuidor sem vazão"}</small>
        </div>
      )}

      <aside className="alarm-area">
        <section className="glass alarms">
          <div className="section-title"><h2>Alarmes Ativos</h2><button type="button" className="tiny" onClick={() => setView("Alarmes")}>Ver todos ({alarms.length}) →</button></div>
          {alarms.length === 0 ? <p className="sc-empty">Nenhum alarme ativo.</p> : alarms.slice(0, 3).map((a) => (
            <button type="button" key={a.id} className={`compact-alarm${a.severity === "CRITICAL" ? " urgent" : ""}`} onClick={() => setView("Alarmes")}>
              <span className="alarm-heading"><strong>{a.description.split(/(?<=\.)\s/)[0].slice(0, 62)}</strong><span className="severity">{a.severity === "CRITICAL" ? "Crítico" : a.severity === "WARNING" ? "Alarme" : "Aviso"}</span></span>
              <small>Aberto {ago(Math.round((now.getTime() - new Date(a.openedAt).getTime()) / 1000))}</small>
            </button>
          ))}
        </section>
        <section className="glass environment">
          <h2>Condições Ambientais</h2>
          {cur ? (
            <div className="env-items">
              <span><b className="moon">{cur.isDay ? "☀" : "☾"}</b><span><strong>{Math.round(cur.tempC)}°C</strong><small>{weatherLabel(cur.weatherCode)}</small></span></span>
              <span><b className="blue">◈</b><span>{num(cur.humidity, 0)}%<small>Umidade</small></span></span>
              <span><b className="blue">≋</b><span>{num(cur.windKmh, 0)} km/h<small>Vento</small></span></span>
              <span><b className="yellow">☁</b><span>{num(cur.cloudCoverPct, 0)}%<small>Nuvens</small></span></span>
            </div>
          ) : <p className="sc-empty">Clima indisponível.</p>}
        </section>
      </aside>

      <section className="metrics">
        <article className="glass soc">
          <h2>Estado de Carga (SOC)</h2>
          <div className="soc-content">
            <div className="gauge">
              <svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="64" fill="none" stroke="#102633" strokeWidth="14" />
                {soc != null && <circle cx="80" cy="80" r="64" fill="none" stroke={s && soc <= s.config.socMinDesliga ? "#ff4f58" : "#5cc6c0"} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(Math.max(1, soc) / 100) * 402.12} 402.12`} transform="rotate(-90 80 80)" />}
              </svg>
              <div><strong>{soc == null ? "--" : `${num(soc, 0)}%`}</strong><span className={s && soc != null && soc <= s.config.socMinDesliga ? "red" : undefined}>{soc == null ? "Sem leitura" : s && soc <= s.config.socMinDesliga ? "Baixo" : stale ? "Desatualizado" : "Normal"}</span></div>
            </div>
            <dl>
              <div><dt>Energia disponível (est.)</dt><dd>{soc == null ? "-- kWh" : `${num((soc / 100) * usableKwh, 0)} kWh`}</dd></div>
              <div><dt>Desliga / religa a bomba</dt><dd>{s ? `${s.config.socMinDesliga}% / ${s.config.socMinReliga}%` : "--"}</dd></div>
              <div><dt>Ciclos da bateria (est.)</dt><dd>{cycles?.since ? `${num(cycles.cycles, 0)} / ${num(cycles.warrantyCycles, 0)}` : "--"}</dd></div>
            </dl>
          </div>
        </article>
        <article className="glass metric"><h2><span className="yellow">☀</span> Geração Solar</h2><strong>{reading(pv)} kW</strong><small>{live ? (sunOn ? "Gerando" : "Sem geração") : "Sem leitura"}</small><div className="chart"><Spark values={ordered.map((r) => r.pvPower)} color="#f3bc52" zero /></div></article>
        <article className="glass metric"><h2><span className="yellow">ϟ</span> Potência da Bateria</h2><strong>{reading(battery)} kW</strong><small>{live ? (charging ? "Carregando" : discharging ? "Descarregando" : "Em espera") : "Sem leitura"}</small><div className="chart"><Spark values={ordered.map((r) => r.batteryPower)} color="#56d4ea" zero /></div></article>
        <article className="glass metric"><h2><span>◆</span> Consumo / Cargas</h2><strong>{reading(load)} kW</strong><small>{live ? "Calculado: solar menos bateria" : "Sem leitura"}</small><div className="chart"><Spark values={ordered.map((r) => r.loadPower)} color="#7f9cff" zero /></div></article>
      </section>

      <footer>
        <div className="status-title"><i data-level={level} />Status dos Equipamentos</div>
        <div className="glass device-strip">
          {batteries.map((d) => <div key={d.id} className="device"><span>▥</span><div><small>{titles.get(d.id)}</small><strong>{reading(pointValue(d, "battery_soc"), 0)}%</strong><small>{ago(d.ageSeconds)}</small></div></div>)}
          {inverters.map((d) => <div key={d.id} className="device"><span>▥</span><div><small>{titles.get(d.id)}</small><strong className={/falha|parado/i.test(d.summary.status ?? "") ? "red" : undefined}>{reading(pointValue(d, "active_power"))} kW</strong><small>{(d.summary.status ?? "sem estado").slice(0, 26)}</small></div></div>)}
          <div className="device"><span>☁</span><div><small>FusionSolar</small><strong className={live ? "sc-green" : "red"}>{live ? "Online" : "Sem leitura"}</strong><small>{ago(age)}</small></div></div>
          <div className="device"><span>▥</span><div><small>Automação</small><strong className={!hasAutomation ? undefined : automationOnline ? "sc-green" : "red"}>{!hasAutomation ? "Não instalada" : automationOnline ? "Online" : "Offline"}</strong><small>{hasAutomation ? (s?.config.controlMode === "AUTO" ? "Automático" : "Manual") : "—"}</small></div></div>
        </div>
        <div className="glass cycles">
          <small>Ciclos (estimativa)</small>
          <strong>{cycles?.since ? `${num(cycles.cycles, 0)} de ${num(cycles.warrantyCycles, 0)}` : "--"}</strong>
          <div><progress value={cycles?.cycles ?? 0} max={cycles?.warrantyCycles ?? 7300} /><small>{cycles?.since ? `${num((cycles.cycles / cycles.warrantyCycles) * 100)}%` : ""}</small></div>
        </div>
        <button type="button" className="outline all-devices" onClick={() => setView("Equipamentos")}>Ver todos os equipamentos →</button>
      </footer>

      {view !== "Visão Geral" && (
        <section id="workspace" className="glass">
          <div className="section-title">
            <div><small>GAMA SOLAR / {s ? shortName(s.site.name) : ""}</small><h1>{view}</h1></div>
            <button type="button" className="outline" onClick={() => setView("Visão Geral")}>← Visão geral</button>
          </div>
          <div id="workspace-body" className="plant plant--embed">
            {view === "Tendências" && (devices.length ? <History devices={devices} titles={titles} /> : <p className="sc-empty">Sem equipamentos com histórico.</p>)}
            {view === "Equipamentos" && (
              <>
                {inverters.length > 1 && (
                  <div className="plant-picks">
                    {inverters.map((d) => <button key={d.id} type="button" aria-pressed={d.id === shownInverter?.id} onClick={() => setInverterId(d.id)}>{titles.get(d.id)}</button>)}
                  </div>
                )}
                {shownInverter && <Inverter key={shownInverter.id} device={shownInverter} title={titles.get(shownInverter.id) ?? "Inversor"} />}
                <h2 className="sc-sub">Todas as leituras</h2>
                {devices.length ? <AllReadings devices={devices} titles={titles} /> : <p className="sc-empty">Nenhum equipamento enviou leitura ainda.</p>}
              </>
            )}
            {view === "Alarmes" && (alarms.length === 0 ? <p className="sc-empty">Nenhum alarme ativo nesta planta.</p> : alarms.map((a) => (
              <div key={a.id} className={`alarm-row${a.severity === "CRITICAL" ? " urgent" : ""}`}>
                <span className="alert-icon">!</span>
                <span className="alarm-text"><span className="badge">{a.severity === "CRITICAL" ? "Crítico" : a.severity === "WARNING" ? "Alarme" : "Aviso"}</span>{a.description}
                  <small>Aberto {ago(Math.round((now.getTime() - new Date(a.openedAt).getTime()) / 1000))} · {new Date(a.openedAt).toLocaleString("pt-BR")}</small></span>
              </div>
            )))}
          </div>
        </section>
      )}
    </>
  );

  return (
    <div className={`scada${fit.mobile ? " mobile-layout" : ""}${view !== "Visão Geral" ? " internal-view" : ""}`}>
      <main className="scada-viewport" style={fit.mobile ? undefined : { width: W * fit.scale, height: H * fit.scale }}>
        <div className="scada-dash" data-plant={slug === "piscinao" ? "piscinao" : "barragem"} style={fit.mobile ? undefined : { transform: `scale(${fit.scale})` }}>
          {body}
        </div>
      </main>

      {pumpOpen && s && (
        <div className="sc-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPumpOpen(false); }}>
          <div className="sc-dialog" role="dialog" aria-label="Bomba e automação">
            <div className="section-title"><h2>Bomba · {shortName(s.site.name)}</h2><button type="button" className="sc-close" onClick={() => setPumpOpen(false)} aria-label="Fechar">×</button></div>
            <dl className="sc-rows">
              <div><dt>Estado real</dt><dd data-tone={hasAutomation ? health.tone : "idle"}>{hasAutomation ? health.text : "Bomba operada no local, sem automação"}</dd></div>
              <div><dt>Consumo medido</dt><dd>{reading(load)} kW</dd></div>
              <div><dt>Último comando</dt><dd>{s.state.loadStatus === "on" ? "Ligar" : "Desligar"}</dd></div>
              <div><dt>Automação</dt><dd data-tone={automationOnline ? "ok" : "bad"}>{!hasAutomation ? "Não instalada" : automationOnline ? "Online" : "Sem comunicação"}</dd></div>
              <div><dt>Modo</dt><dd>{s.config.controlMode === "AUTO" ? "Automático" : "Manual"}</dd></div>
              <div><dt>Faixa configurada</dt><dd>desliga em {s.config.socMinDesliga}% · religa em {s.config.socMinReliga}%</dd></div>
            </dl>
            {hasAutomation && !automationOnline && <p className="sc-warn">Automação sem comunicação: um comando enviado agora não chega à bomba.</p>}
            {isAdmin ? (
              <div className="sc-actions">
                <button type="button" className="outline" disabled={!hasAutomation || !automationOnline || command.isPending} onClick={() => setConfirm("ON")}>Ligar bomba</button>
                <button type="button" className="outline" disabled={!hasAutomation || !automationOnline || command.isPending} onClick={() => setConfirm("OFF")}>Desligar bomba</button>
                <button type="button" className="outline" disabled={setMode.isPending} onClick={() => setMode.mutate({ slug, mode: s.config.controlMode === "AUTO" ? "MANUAL" : "AUTO" })}>Mudar para {s.config.controlMode === "AUTO" ? "manual" : "automático"}</button>
                <button type="button" className="outline" onClick={() => setConfigOpen(true)}>Configurar limites</button>
              </div>
            ) : <p className="sc-note">Comandos e configuração exigem um usuário administrador.</p>}
            <div className="sc-actions">
              <button type="button" className="outline" onClick={() => setStatsOpen(true)}>Operação da bomba</button>
              <button type="button" className="outline" onClick={() => setHistoryOpen(true)}>Histórico de ações</button>
            </div>
          </div>
        </div>
      )}

      {s && (
        <>
          <AlertDialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirm === "ON" ? "Ligar bomba?" : "Desligar bomba?"}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div>
                    <p>{s.site.name} · SOC atual: <strong>{soc != null ? soc.toFixed(0) : "—"}%</strong></p>
                    {soc != null && soc <= s.config.socMinDesliga && confirm === "ON" && <p className="mt-2 text-yellow-500">⚠ SOC abaixo do mínimo ({s.config.socMinDesliga}%) — sistema vai desligar de novo automaticamente.</p>}
                    {s.config.controlMode === "AUTO" && <p className="mt-2 text-muted-foreground text-xs">Modo AUTO ativo: ação manual pode ser revertida na próxima avaliação.</p>}
                    <p className="mt-2 text-muted-foreground text-xs">O estado na tela só muda quando a bomba for confirmada pela carga.</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => { if (confirm) { command.mutate({ slug, action: confirm.toLowerCase() as "on" | "off" }); setConfirm(null); } }}>Confirmar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <ConfigModalV2 open={configOpen} onOpenChange={setConfigOpen} slug={slug} initial={s.config} />
          <HistoryModal open={historyOpen} onOpenChange={setHistoryOpen} slug={slug} siteName={s.site.name} />
          <PumpStatsModal open={statsOpen} onOpenChange={setStatsOpen} slug={slug} siteName={s.site.name} />
        </>
      )}
    </div>
  );
}
