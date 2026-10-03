import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { PlantScene } from "./PlantScene";
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

/** Hora local da planta (as duas ficam no fuso de Brasília). */
function plantHour(): number {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") + get("minute") / 60;
}

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
            <span style={{ color: "var(--pl-tide)" }}>■</span> {leftName} ({leftUnit}), escala à esquerda{"  "}
            <span style={{ color: "var(--pl-sun)", marginLeft: "1rem" }}>■</span> {rightName} ({rightUnit}), escala à direita
            {keys.right === "ch_discharge_power" ? ", positivo quando carrega" : ""}
          </p>
          <div className="plant-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="#1f5262" strokeOpacity={0.5} vertical={false} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={fmtT} stroke="#9db8bd" tick={{ fontSize: 12 }} tickLine={false} minTickGap={48} />
                <YAxis yAxisId="left" stroke="#5cc6c0" tick={{ fontSize: 12, fill: "#5cc6c0" }} unit={leftUnit === "%" ? "%" : undefined} tickLine={false} axisLine={false} domain={keys.left === "battery_soc" ? [0, 100] : ["auto", "auto"]} />
                <YAxis yAxisId="right" orientation="right" stroke="#f4a636" tick={{ fontSize: 12, fill: "#f4a636" }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ stroke: "#9db8bd", strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const r = payload[0].payload as { t: number; left: number | null; right: number | null };
                    return (
                      <div className="plant-tip">
                        <p>{new Date(r.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                        <p className="plant-tip-row"><i style={{ background: "var(--pl-tide)" }} />{leftName}<b>{num(r.left, 2)} {leftUnit}</b></p>
                        <p className="plant-tip-row"><i style={{ background: "var(--pl-sun)" }} />{rightName}<b>{num(r.right, 2)} {rightUnit}</b></p>
                      </div>
                    );
                  }}
                />
                <Line yAxisId="left" dataKey="left" stroke="#5cc6c0" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: "#5cc6c0", stroke: "#071f27", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                <Line yAxisId="right" dataKey="right" stroke="#f4a636" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: "#f4a636", stroke: "#071f27", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </>
  );
}

function AllReadings({ devices, titles }: { devices: Device[]; titles: Map<number, string> }) {
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const device = devices.find((d) => d.id === deviceId) ?? devices[0];
  const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;

  const groups = useMemo(() => {
    const g = new Map<string, Point[]>();
    for (const p of device?.points ?? []) g.set(p.group, [...(g.get(p.group) ?? []), p]);
    return Array.from(g.entries());
  }, [device]);

  if (!device) return null;
  return (
    <div className="all">
      <div className="plant-picks">
        {devices.map((d) => (
          <button key={d.id} type="button" aria-pressed={d.id === device.id} onClick={() => setDeviceId(d.id)}>
            {titles.get(d.id)}
          </button>
        ))}
        <span className="plant-gap plant-note" style={{ alignSelf: "center" }}>
          {device.points.length} leituras, {ago(device.ageSeconds)}
        </span>
      </div>
      {/* Ficha única: todos os grupos lado a lado. No celular, os grupos longos começam fechados. */}
      <div className="sheet" key={device.id}>
        {groups.map(([group, points]) => {
          const strings = group === "strings" ? stringPairs(points) : [];
          return (
            <details key={group} open={!narrow || points.length <= 6}>
              <summary>{GROUP_TITLES[group] ?? group}<small>{strings.length || points.length}</small></summary>
              {strings.length > 0 ? (
                <div className="sheet-strings">
                  {strings.map((r) => (
                    <div key={r.n}><span>PV{r.n}</span><span>{num(r.v)} V</span><span>{num(r.i, 2)} A</span></div>
                  ))}
                </div>
              ) : group === "rede" && points.some((p) => p.rawKey === "a_u") ? (
                <>
                  <div className="sheet-phases">
                    <div><span>Fase</span><span>Tensão</span><span>Corrente</span><span>Entre fases</span></div>
                    {([["A", "a", "ab_u"], ["B", "b", "bc_u"], ["C", "c", "ca_u"]] as const).map(([name, k, line]) => (
                      <div key={name}>
                        <span>{name}</span>
                        <span>{num(pointValue(device, `${k}_u`))} V</span>
                        <span>{num(pointValue(device, `${k}_i`), 2)} A</span>
                        <span>{num(pointValue(device, line))} V</span>
                      </div>
                    ))}
                  </div>
                  <dl>
                    {points.filter((p) => !/^(a|b|c|ab|bc|ca)_(u|i)$/.test(p.rawKey)).map((p) => (
                      <div key={p.rawKey}><dt>{p.label}</dt><dd>{showPoint(p)}</dd></div>
                    ))}
                  </dl>
                </>
              ) : (
                <dl>
                  {points.map((p) => (
                    <div key={p.rawKey}><dt>{shortLabel(p.label, group)}</dt><dd>{showPoint(p)}</dd></div>
                  ))}
                </dl>
              )}
            </details>
          );
        })}
      </div>
    </div>
  );
}

/** Uma linha por string, com tensão e corrente lado a lado. */
function stringPairs(points: Point[]): { n: number; v: number | null; i: number | null }[] {
  const rows = new Map<number, { n: number; v: number | null; i: number | null }>();
  for (const p of points) {
    const m = /^pv(\d+)_(u|i)$/.exec(p.rawKey);
    if (!m || typeof p.value !== "number") continue;
    const r = rows.get(Number(m[1])) ?? { n: Number(m[1]), v: null, i: null };
    if (m[2] === "u") r.v = p.value; else r.i = p.value;
    rows.set(r.n, r);
  }
  return Array.from(rows.values()).sort((a, b) => a.n - b.n);
}

/** Dentro do grupo, o rótulo não precisa repetir o que o título já diz. */
function shortLabel(label: string, group: string): string {
  if (group === "energia") return label.replace(/^Energia CC acumulada do /, "").replace(/^Energia /, "").replace(/^./, (c) => c.toUpperCase());
  return label;
}

export default function Plant() {
  const [, params] = useRoute("/planta/:slug");
  const slug = params?.slug ?? "";
  const { data: sites } = trpc.bess.sites.useQuery(undefined, { staleTime: 5 * 60_000 });
  const status = trpc.bess.getSiteStatus.useQuery({ slug }, { enabled: !!slug, refetchInterval: 30_000 });
  const telemetry = trpc.telemetry.site.useQuery({ slug }, { enabled: !!slug, refetchInterval: 60_000, retry: false });

  const [tab, setTab] = useState<TabId>("agora");
  const [inverterId, setInverterId] = useState<number | null>(null);

  const cycles = trpc.telemetry.cycles.useQuery({ slug }, { enabled: !!slug, staleTime: 10 * 60_000 }).data;
  const alarmsQuery = trpc.bess.alarms.useQuery({ slug }, { enabled: !!slug, refetchInterval: 60_000 });
  const alarms = (alarmsQuery.data ?? []).filter((a) => a.active);

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
        {tab === "agora" && alarms.length > 0 && (
          <section className="plant-alarms" aria-label="Alarmes ativos">
            <h2>{alarms.length === 1 ? "1 alarme ativo" : `${alarms.length} alarmes ativos`}</h2>
            <ul>
              {alarms.map((a) => (
                <li key={a.id} data-severity={a.severity}>
                  <p>{a.description.split(/(?<=\.)\s/)[0]}</p>
                  <span>
                    {a.severity === "CRITICAL" ? "Crítico" : a.severity === "WARNING" ? "Importante" : "Aviso"}, aberto{" "}
                    {ago(Math.round((Date.now() - new Date(a.openedAt).getTime()) / 1000))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "agora" && (
        <section className="plant-section" aria-labelledby="pl-now">
          <h2 id="pl-now">Energia agora</h2>
          <PlantScene
            hour={plantHour()}
            pv={pv}
            load={load}
            batteries={batteries.length > 0
              ? batteries.map((b) => ({ id: b.id, title: titles.get(b.id) ?? "Bateria", soc: pointValue(b, "battery_soc"), power: pointValue(b, "ch_discharge_power") }))
              : [{ id: 0, title: "Bateria", soc, power: battery }]}
            inverters={inverters.map((d) => {
              const st = d.summary.status ?? "";
              return {
                id: d.id, title: titles.get(d.id) ?? "Inversor", kw: pointValue(d, "active_power"),
                tone: /falha|parado|desligado/i.test(st) ? "bad" as const : /rede|off-grid|gerando|operando/i.test(st) ? "ok" as const : "idle" as const,
              };
            })}
            marks={marks}
            pumpNote={!s ? "" : !s.state.sonoffOnline ? "automação sem comunicação" : s.derived.pumpState === "ON" ? "bomba ligada" : s.derived.pumpState === "OFF" ? "bomba desligada" : ""}
            fmt={num}
          />
          {spread >= 10 && (
            <p className="plant-note plant-warn" style={{ marginTop: "1.5rem" }}>
              Baterias com {num(spread, 0)} pontos de diferença de carga.
            </p>
          )}
          {cycles && cycles.since && cycles.cycles > 0 && (() => {
            const left = Math.max(0, cycles.warrantyCycles - cycles.cycles);
            const years = cycles.cyclesPerDay > 0 ? left / cycles.cyclesPerDay / 365 : null;
            return (
              <div className="cycles">
                <h3>Ciclos da bateria</h3>
                <p className="cycles-figure">
                  cerca de {num(cycles.cycles, 0)} <small>de {num(cycles.warrantyCycles, 0)} ciclos da garantia</small>
                </p>
                <div className="cycles-bar" role="img" aria-label={`${num((cycles.cycles / cycles.warrantyCycles) * 100)}% dos ciclos da garantia usados`}>
                  <i style={{ ["--w" as string]: `${Math.max(0.5, Math.min(100, (cycles.cycles / cycles.warrantyCycles) * 100))}%` }} />
                </div>
                <details className="cycles-how">
                  <summary>Estimativa desde {new Date(cycles.since).toLocaleDateString("pt-BR")}, {num(cycles.cyclesPerDay, 2)} ciclo por dia</summary>
                  <p className="plant-note">
                    {num(cycles.dischargedKwh, 0)} kWh descarregados divididos por {num(cycles.usableKwh, 0)} kWh úteis.
                    O que a bateria ciclou antes dessa data não está contado.
                    {years != null && (years > cycles.warrantyYears
                      ? ` Nesse ritmo os ciclos levariam cerca de ${num(years, 0)} anos; o prazo de ${cycles.warrantyYears} anos da garantia vence antes.`
                      : ` Nesse ritmo os ciclos se completam em cerca de ${num(years, 1)} anos.`)}
                  </p>
                </details>
              </div>
            );
          })()}
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
