import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import "./plant.css";

type Outputs = inferRouterOutputs<AppRouter>;
type Device = Outputs["telemetry"]["site"]["devices"][number];
type Point = Device["points"][number];

type TabId = "agora" | "inversores" | "historico" | "leituras";

/** Conexão lenta ou economia de dados: mostra só a imagem, sem vídeo. */
const slowLink = (() => {
  const c = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduce || !!c?.saveData || /(^|-)2g$|^3g$/.test(c?.effectiveType ?? "");
})();

const STALE_SECONDS = 45 * 60;
const FLOW_MIN_KW = 0.3;

const GROUP_TITLES: Record<string, string> = {
  estado: "Estado",
  "potência": "Potência",
  bateria: "Bateria",
  temperatura: "Temperatura",
  rede: "Saída CA",
  strings: "Strings",
  energia: "Energia",
  limites: "Limites",
  alarmes: "Alarmes",
  "identificação": "Identificação",
  outros: "Outros campos recebidos",
};

function num(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function ago(seconds: number | null | undefined): string {
  if (seconds == null) return "sem leitura";
  if (seconds < 90) return "agora há pouco";
  const min = Math.round(seconds / 60);
  if (min < 90) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

function pointValue(d: Device, key: string): number | null {
  const p = d.points.find((x) => x.rawKey === key);
  return p && typeof p.value === "number" ? p.value : null;
}

function showPoint(p: Point): string {
  if (p.text) return p.text;
  if (p.value == null) return "—";
  if (p.unit === "epoch ms" && typeof p.value === "number") {
    return new Date(p.value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  if (typeof p.value === "number") return `${num(p.value, 2)}${p.unit ? ` ${p.unit}` : ""}`;
  return String(p.value);
}

function deviceTitle(d: Device, index: number): string {
  if (d.name) return d.name;
  if (d.kind === "ess") return `Bateria ${index + 1}`;
  if (d.kind === "inverter") return `Inversor ${index + 1}`;
  return `Equipamento ${index + 1}`;
}

/** Frase única que diz, em português comum, o que a planta está fazendo. */
function sentence(soc: number | null, battery: number | null, pv: number | null, load: number | null): string {
  if (soc == null) return "Ainda sem leitura da bateria.";
  const parts: string[] = [];
  let first = `Bateria em ${num(soc, 0)}%`;
  if (battery != null && battery > FLOW_MIN_KW) first += `, carregando a ${num(battery)} kW`;
  else if (battery != null && battery < -FLOW_MIN_KW) first += `, descarregando a ${num(-battery)} kW`;
  else first += ", em repouso";
  parts.push(`${first}.`);
  if (pv != null) parts.push(pv > FLOW_MIN_KW ? `O sol entrega ${num(pv)} kW.` : "Sem geração solar agora.");
  if (load != null && load > FLOW_MIN_KW) parts.push(`A planta consome ${num(load)} kW.`);
  return parts.join(" ");
}

function Tank({ title, serial, soc, power, soh, marks }: {
  title: string;
  serial: string | null;
  soc: number | null;
  power: number | null;
  soh: number | null;
  marks: { kind: "off" | "on" | "blackout"; at: number; label: string }[];
}) {
  const level = Math.max(0, Math.min(100, soc ?? 0));
  const off = marks.find((m) => m.kind === "off")?.at;
  const moving = power != null && Math.abs(power) > FLOW_MIN_KW;
  const doing = power == null ? "sem leitura de potência"
    : power > FLOW_MIN_KW ? `carregando ${num(power)} kW`
    : power < -FLOW_MIN_KW ? `descarregando ${num(-power)} kW`
    : "em repouso";
  return (
    <figure
      className="tank"
      style={{ ["--level" as string]: `${level}%`, margin: 0 }}
      data-low={soc != null && off != null && soc <= off}
      data-shallow={level < 22}
      data-moving={moving}
    >
      <div className="tank-well" role="img" aria-label={`${title}: ${num(soc, 0)}% de carga, ${doing}`}>
        <div className="tank-water" />
        <div className="tank-read">{soc == null ? "—" : `${num(soc, 0)}%`}</div>
      </div>
      <div className="tank-ruler" aria-hidden="true">
        {marks.map((m) => (
          <span key={m.kind} className="tank-mark" data-kind={m.kind} style={{ ["--at" as string]: `${m.at}%` }}>
            {m.label} {m.at}%
          </span>
        ))}
      </div>
      <figcaption className="tank-caption">
        <strong>{title}</strong>
        <span>{doing}{soh != null ? `, saúde ${num(soh, 0)}%` : ""}</span>
        {serial && <span style={{ display: "block" }}>Nº de série {serial}</span>}
      </figcaption>
    </figure>
  );
}

function Inverter({ device, title }: { device: Device; title: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const state = device.summary.status ?? "sem informação de estado";
  const tone = /falha|parado|desligado/i.test(state) ? "bad" : /rede|off-grid|gerando|operando/i.test(state) ? "ok" : "idle";

  const strings = useMemo(() => {
    const map = new Map<number, { n: number; v: number | null; i: number | null }>();
    for (const p of device.points) {
      const m = /^pv(\d+)_(u|i)$/.exec(p.rawKey);
      if (!m) continue;
      const n = Number(m[1]);
      const s = map.get(n) ?? { n, v: null, i: null };
      if (typeof p.value === "number") {
        if (m[2] === "u") s.v = p.value;
        else s.i = p.value;
      }
      map.set(n, s);
    }
    return Array.from(map.values()).sort((a, b) => a.n - b.n);
  }, [device.points]);
  const maxI = Math.max(0.01, ...strings.map((s) => s.i ?? 0));
  const anyCurrent = strings.some((s) => (s.i ?? 0) > 0.05);

  const mppts = useMemo(() => device.points
    .map((p) => ({ m: /^mppt_(\d+)_cap$/.exec(p.rawKey), p }))
    .filter((x): x is { m: RegExpExecArray; p: Point } => !!x.m && typeof x.p.value === "number")
    .map((x) => ({ n: Number(x.m[1]), kwh: x.p.value as number }))
    .sort((a, b) => a.n - b.n), [device.points]);
  const maxKwh = Math.max(1, ...mppts.map((m) => m.kwh));
  const emptyMppts = mppts.filter((m) => m.kwh < maxKwh * 0.01);

  const sel = picked != null ? strings.find((s) => s.n === picked) : null;
  const [part, setPart] = useState<"resumo" | "strings" | "saida">("resumo");

  return (
    <article className="inv" data-part={part}>
      <div>
        <h3>{title}</h3>
        <p className="inv-serial">
          {device.serial ? `Nº de série ${device.serial}` : "Sem número de série"}<br />Leitura {ago(device.ageSeconds)}
        </p>
        <p className="inv-state" data-tone={tone}>{state.charAt(0).toUpperCase() + state.slice(1)}</p>
        <div className="plant-picks inv-parts">
          {([["resumo", "Resumo"], ["strings", "Strings"], ["saida", "Saída"]] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={part === id} onClick={() => setPart(id)}>{label}</button>
          ))}
        </div>
        <dl className="facts" data-sec="resumo">
          <div><dt>Potência</dt><dd>{num(pointValue(device, "active_power"))}<small>kW</small></dd></div>
          <div><dt>Temperatura interna</dt><dd>{num(pointValue(device, "temperature"))}<small>°C</small></dd></div>
          <div><dt>Gerado hoje</dt><dd>{num(pointValue(device, "day_cap"))}<small>kWh</small></dd></div>
          <div><dt>Gerado no total</dt><dd>{num((pointValue(device, "total_cap") ?? NaN) / 1000)}<small>MWh</small></dd></div>
          <div><dt>Eficiência</dt><dd>{num(pointValue(device, "efficiency"))}<small>%</small></dd></div>
          <div><dt>Frequência</dt><dd>{num(pointValue(device, "elec_freq"), 2)}<small>Hz</small></dd></div>
        </dl>
      </div>

      <div className="inv-detail">
        <div data-sec="strings">
        {strings.length > 0 && (
          <>
            <h4>Corrente em cada string</h4>
            <div className="strings">
              {strings.map((s) => (
                <button
                  key={s.n}
                  type="button"
                  data-idle={(s.i ?? 0) <= 0.05}
                  style={{ ["--h" as string]: `${((s.i ?? 0) / maxI) * 100}%` }}
                  aria-label={`String ${s.n}: ${num(s.i, 2)} A, ${num(s.v)} V`}
                  onMouseEnter={() => setPicked(s.n)}
                  onFocus={() => setPicked(s.n)}
                >
                  <i />
                </button>
              ))}
            </div>
            <div className="strings-axis" aria-hidden="true">
              {strings.map((s) => <span key={s.n}>{s.n}</span>)}
            </div>
            <p className="strings-pick">
              {sel
                ? `String ${sel.n}: ${num(sel.i, 2)} A e ${num(sel.v)} V`
                : anyCurrent
                  ? "Passe o cursor sobre uma coluna para ver corrente e tensão."
                  : "Sem corrente nas strings agora. O desenho se preenche quando houver sol."}
            </p>
          </>
        )}

        {mppts.length > 0 && (
          <>
            <h4>Energia acumulada por entrada (MPPT)</h4>
            <ul className="mppt">
              {mppts.map((m) => (
                <li key={m.n} data-empty={m.kwh < maxKwh * 0.01}>
                  <span>MPPT {m.n}</span>
                  <span className="mppt-bar"><i style={{ ["--w" as string]: `${(m.kwh / maxKwh) * 100}%` }} /></span>
                  <span>{num(m.kwh / 1000, 2)} MWh</span>
                </li>
              ))}
            </ul>
            {emptyMppts.length > 0 && (
              <p className="plant-note" style={{ marginTop: "0.6rem" }}>
                {emptyMppts.length === 1 ? "A entrada" : "As entradas"} {emptyMppts.map((m) => m.n).join(", ")}{" "}
                quase não {emptyMppts.length === 1 ? "acumulou" : "acumularam"} energia. Pode ser entrada sem strings ligadas; vale conferir no local.
              </p>
            )}
          </>
        )}

        </div>

        <div data-sec="saida">
        <h4>Saída em corrente alternada</h4>
        <table className="phases">
          <thead>
            <tr><th scope="col">Fase</th><th scope="col">Tensão</th><th scope="col">Corrente</th><th scope="col">Entre fases</th></tr>
          </thead>
          <tbody>
            {([["A", "a", "ab_u", "A–B"], ["B", "b", "bc_u", "B–C"], ["C", "c", "ca_u", "C–A"]] as const).map(([name, k, line, pair]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{num(pointValue(device, `${k}_u`))} V</td>
                <td>{num(pointValue(device, `${k}_i`), 2)} A</td>
                <td>{pair} {num(pointValue(device, line))} V</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </article>
  );
}

const HISTORY_KEYS: Record<string, { left: string; right: string }> = {
  ess: { left: "battery_soc", right: "ch_discharge_power" },
  inverter: { left: "active_power", right: "temperature" },
};

function History({ devices, titles }: { devices: Device[]; titles: Map<number, string> }) {
  const usable = devices.filter((d) => HISTORY_KEYS[d.kind]);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [hours, setHours] = useState(24);
  const device = usable.find((d) => d.id === deviceId) ?? usable[0];
  const keys = device ? HISTORY_KEYS[device.kind] : null;
  const { data, isLoading } = trpc.telemetry.history.useQuery(
    { deviceId: device?.id ?? 0, hours, keys: keys ? [keys.left, keys.right] : ["-"] },
    { enabled: !!device, refetchInterval: 5 * 60_000 },
  );
  if (!device || !keys) return null;

  const rows = (data?.series ?? []).map((s) => ({ t: s.t, left: s.values[keys.left], right: s.values[keys.right] }));
  const meta = (k: string) => data?.keys.find((x) => x.rawKey === k);
  const leftName = keys.left === "battery_soc" ? "Carga" : meta(keys.left)?.label ?? "";
  const rightName = keys.right === "ch_discharge_power" ? "Potência" : meta(keys.right)?.label ?? "";
  const leftUnit = meta(keys.left)?.unit ?? "";
  const rightUnit = meta(keys.right)?.unit ?? "";
  const fmtT = (t: number) => new Date(t).toLocaleString("pt-BR", hours > 24
    ? { day: "2-digit", month: "2-digit", hour: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="plant-picks">
        {usable.map((d) => (
          <button key={d.id} type="button" aria-pressed={d.id === device.id} onClick={() => setDeviceId(d.id)}>
            {titles.get(d.id)}
          </button>
        ))}
        <button type="button" className="plant-gap" aria-pressed={hours === 24} onClick={() => setHours(24)}>24 horas</button>
        <button type="button" aria-pressed={hours === 168} onClick={() => setHours(168)}>7 dias</button>
      </div>
      {rows.length < 2 ? (
        <p className="plant-note">
          {isLoading ? "Carregando o histórico…" : "Ainda há poucas leituras guardadas deste equipamento. O gráfico aparece conforme elas chegam."}
        </p>
      ) : (
        <>
          <p className="plant-note" style={{ marginBottom: "0.75rem" }}>
            <span style={{ color: "var(--pl-tide)" }}>■</span> {leftName} ({leftUnit}){"  "}
            <span style={{ color: "var(--pl-sun)", marginLeft: "1rem" }}>■</span> {rightName} ({rightUnit})
            {keys.right === "ch_discharge_power" ? ", positivo quando carrega" : ""}
          </p>
          <div className="plant-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="#1f5262" strokeOpacity={0.5} vertical={false} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={fmtT} stroke="#9db8bd" tick={{ fontSize: 12 }} tickLine={false} minTickGap={48} />
                <YAxis yAxisId="left" stroke="#9db8bd" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} domain={keys.left === "battery_soc" ? [0, 100] : ["auto", "auto"]} />
                <YAxis yAxisId="right" orientation="right" stroke="#9db8bd" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ stroke: "#9db8bd", strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const r = payload[0].payload as { t: number; left: number | null; right: number | null };
                    return (
                      <div className="plant-tip">
                        <p>{new Date(r.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                        <p>{leftName}: {num(r.left, 2)} {leftUnit}</p>
                        <p>{rightName}: {num(r.right, 2)} {rightUnit}</p>
                      </div>
                    );
                  }}
                />
                <Line yAxisId="left" dataKey="left" stroke="#5cc6c0" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line yAxisId="right" dataKey="right" stroke="#f4a636" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </>
  );
}

function AllReadings({ devices, titles }: { devices: Device[]; titles: Map<number, string> }) {
  return (
    <div className="all">
      {devices.map((d) => {
        const groups = new Map<string, Point[]>();
        for (const p of d.points) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
        return (
          <details key={d.id}>
            <summary>
              {titles.get(d.id)}
              <span>{d.points.length} leituras, {ago(d.ageSeconds)}</span>
            </summary>
            <div className="all-groups">
              {Array.from(groups.entries()).map(([group, points]) => (
                <section key={group}>
                  <h4>{GROUP_TITLES[group] ?? group}</h4>
                  <dl>
                    {points.map((p) => (
                      <div key={p.rawKey}><dt>{p.label}</dt><dd>{showPoint(p)}</dd></div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export default function Plant() {
  const [, params] = useRoute("/planta/:slug");
  const slug = params?.slug ?? "";
  const { data: sites } = trpc.bess.sites.useQuery(undefined, { staleTime: 5 * 60_000 });
  const status = trpc.bess.getSiteStatus.useQuery({ slug }, { enabled: !!slug, refetchInterval: 30_000 });
  const telemetry = trpc.telemetry.site.useQuery({ slug }, { enabled: !!slug, refetchInterval: 60_000, retry: false });

  const [tab, setTab] = useState<TabId>("agora");
  const [inverterId, setInverterId] = useState<number | null>(null);

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

  const nav = (
    <nav className="plant-nav" aria-label="Plantas">
      <Link href="/" className="plant-back">Voltar à operação</Link>
      {(sites ?? []).map((s) => (
        <Link key={s.slug} href={`/planta/${s.slug}`} aria-current={s.slug === slug ? "page" : undefined}>{s.name}</Link>
      ))}
    </nav>
  );

  if (telemetry.error || status.data === null) {
    return (
      <div className="plant">
        <div style={{ position: "relative", minHeight: "4rem" }}>{nav}</div>
        <p className="plant-empty">Não encontramos esta planta. Escolha uma das plantas acima ou volte à operação.</p>
      </div>
    );
  }

  const s = status.data;
  const soc = s?.derived.soc ?? s?.state.currentSoc ?? null;
  const battery = s?.state.currentBatteryPower ?? null;
  const pv = s?.state.currentPvPower ?? null;
  const load = s?.state.currentLoadPower ?? null;
  const age = s?.derived.socAgeSeconds ?? null;
  const media = s?.site.backgroundUrl ?? null;
  const isVideo = !!media && /\.(mp4|webm)$/i.test(media);
  const lightVideo = isVideo ? media!.replace(/\.(mp4|webm)$/i, ".hero.mp4") : null;
  const poster = isVideo ? media!.replace(/\.(mp4|webm)$/i, ".hero.jpg") : null;
  const marks = s ? [
    { kind: "on" as const, at: s.config.socMinReliga, label: "religa" },
    { kind: "off" as const, at: s.config.socMinDesliga, label: "desliga" },
    ...(s.config.socBlackout != null && s.config.socMinDesliga - s.config.socBlackout >= 6
      ? [{ kind: "blackout" as const, at: s.config.socBlackout, label: "limite" }] : []),
  ] : [];

  const socs = batteries.map((b) => pointValue(b, "battery_soc")).filter((v): v is number => v != null);
  const spread = socs.length > 1 ? Math.max(...socs) - Math.min(...socs) : 0;
  const hottest = inverters
    .map((d) => ({ t: pointValue(d, "temperature"), name: titles.get(d.id) }))
    .filter((x): x is { t: number; name: string } => x.t != null)
    .sort((a, b) => b.t - a.t)[0];

  const shownInverter = inverters.find((d) => d.id === inverterId) ?? inverters[0];

  return (
    <div className="plant">
      <header className="plant-hero">
        {media && (isVideo
          ? (slowLink
              ? <img className="plant-hero-media" src={poster!} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              : <video
                  className="plant-hero-media"
                  src={lightVideo!}
                  poster={poster!}
                  autoPlay muted loop playsInline preload="metadata" aria-hidden="true"
                  onError={(e) => { if (!e.currentTarget.src.endsWith(media)) e.currentTarget.src = media; }}
                />)
          : <img className="plant-hero-media" src={media} alt="" />)}
        {nav}
        <div className="plant-hero-inner">
          <p className="plant-name">{s?.site.name ?? telemetry.data?.name ?? " "}</p>
          <h1 className="plant-sentence">{s ? sentence(soc, battery, pv, load) : "Lendo a planta…"}</h1>
          {s && (
            <p className="plant-fresh" data-stale={age != null && age > STALE_SECONDS}>
              Leitura {ago(age)}{age != null && age > STALE_SECONDS ? ". Os números abaixo podem estar desatualizados." : ""}
            </p>
          )}
        </div>
      </header>

      <div className="plant-tabs" role="tablist" aria-label="Seções da planta">
        {([
          ["agora", "Agora"],
          ["inversores", `Inversores${inverters.length ? ` (${inverters.length})` : ""}`],
          ["historico", "Histórico"],
          ["leituras", "Todas as leituras"],
        ] as [TabId, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div className="plant-body">
        {tab === "agora" && (
        <section className="plant-section" aria-labelledby="pl-now">
          <h2 id="pl-now">Energia agora</h2>
          <p className="plant-lead">
            Do sol ao consumo, passando pela bateria. As marcas ao lado de cada bateria são a faixa configurada para a bomba.
          </p>
          <div className="plant-now">
            <div className="plant-end plant-end--sun">
              <h3>Geração solar</h3>
              <div className="plant-figure">{num(pv)}<small>kW</small></div>
              <p>{inverters.length > 0 ? `${inverters.length} ${inverters.length === 1 ? "inversor" : "inversores"}` : "Sem inversores lidos"}</p>
            </div>
            <div className="plant-flow" data-on={(pv ?? 0) > FLOW_MIN_KW} aria-hidden="true" />
            <div className="plant-tanks">
              {batteries.length > 0 ? batteries.map((b) => (
                <Tank
                  key={b.id}
                  title={titles.get(b.id) ?? "Bateria"}
                  serial={b.serial}
                  soc={pointValue(b, "battery_soc")}
                  power={pointValue(b, "ch_discharge_power")}
                  soh={pointValue(b, "battery_soh")}
                  marks={marks}
                />
              )) : (
                <Tank title="Bateria" serial={null} soc={soc} power={battery} soh={null} marks={marks} />
              )}
            </div>
            <div className="plant-flow" style={{ ["--flow" as string]: "var(--pl-tide)" }} data-on={(load ?? 0) > FLOW_MIN_KW} aria-hidden="true" />
            <div className="plant-end plant-end--load">
              <h3>Consumo</h3>
              <div className="plant-figure">{num(load)}<small>kW</small></div>
              <p>
                {!s ? "" : !s.state.sonoffOnline
                  ? "Automação da bomba sem comunicação"
                  : s.derived.pumpState === "ON" ? "Bomba ligada" : s.derived.pumpState === "OFF" ? "Bomba desligada" : "Estado da bomba desconhecido"}
              </p>
            </div>
          </div>
          {spread >= 10 && (
            <p className="plant-note plant-warn" style={{ marginTop: "1.5rem" }}>
              As baterias estão {num(spread, 0)} pontos de carga distantes uma da outra. A média de {num(soc, 0)}% esconde essa diferença.
            </p>
          )}
          {batteries.length > 0 && (
            <p className="plant-note" style={{ marginTop: "1rem" }}>
              A nuvem do fabricante não informa temperatura nem tensão das baterias. Essas leituras passam a aparecer aqui com a leitura direta no local.
            </p>
          )}
        </section>
        )}

        {tab === "inversores" && (inverters.length === 0
          ? <p className="plant-note plant-section">Nenhum inversor enviou leitura ainda.</p>
          : (
          <section className="plant-section" aria-labelledby="pl-inv">
            <h2 id="pl-inv">Inversores</h2>
            <p className="plant-lead">
              {hottest ? `O mais quente agora é o ${hottest.name}, a ${num(hottest.t)} °C.` : "Estado, saída e strings de cada inversor."}
            </p>
            {inverters.length > 1 && (
              <div className="plant-picks">
                {inverters.map((d) => (
                  <button key={d.id} type="button" aria-pressed={d.id === shownInverter?.id} onClick={() => setInverterId(d.id)}>
                    {titles.get(d.id)}
                  </button>
                ))}
              </div>
            )}
            {shownInverter && <Inverter key={shownInverter.id} device={shownInverter} title={titles.get(shownInverter.id) ?? "Inversor"} />}
          </section>
        ))}

        {tab === "historico" && (
          <section className="plant-section" aria-labelledby="pl-hist">
            <h2 id="pl-hist">Histórico</h2>
            <p className="plant-lead">Escolha o equipamento e o período.</p>
            <History devices={devices} titles={titles} />
          </section>
        )}

        {tab === "leituras" && (
        <section className="plant-section" aria-labelledby="pl-all">
          <h2 id="pl-all">Todas as leituras</h2>
          <p className="plant-lead">Tudo o que cada equipamento informou na última leitura, sem filtro.</p>
          {devices.length > 0
            ? <AllReadings devices={devices} titles={titles} />
            : <p className="plant-note">{telemetry.isLoading ? "Carregando os equipamentos…" : "Nenhum equipamento enviou leitura ainda. A primeira chega em até 15 minutos."}</p>}
        </section>
        )}
      </div>
    </div>
  );
}
