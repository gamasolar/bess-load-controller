/**
 * Cliente ONVIF mínimo (SOAP 1.2 sobre HTTP, WS-UsernameToken com digest).
 *
 * Cobre o que a aba de câmeras usa: identificação, perfis de mídia, PTZ
 * (movimento contínuo, presets, home, comandos auxiliares como limpador e
 * lâmpada), foco e ajustes de imagem. Sem dependências: o XML é montado em
 * texto e lido com expressões regulares tolerantes a prefixo de namespace.
 *
 * Tudo aqui fala com a câmera; nada decide por conta própria.
 */

import { createHash, randomBytes } from "node:crypto";

export interface OnvifTarget {
  /** Base HTTP da câmera, ex.: http://192.168.88.253:80 */
  baseUrl: string;
  username: string;
  password: string;
  /** Tempo máximo por chamada (ms). */
  timeoutMs?: number;
  /** Troca o fetch (testes). */
  fetchImpl?: typeof fetch;
  /** Folga mínima entre uma resposta e a próxima conexão (ms). Ver `acquire`. */
  gapMs?: number;
}

export interface DeviceInfo { manufacturer: string; model: string; firmware: string; serial: string; hardwareId: string }
export interface MediaProfile {
  token: string; name: string; encoding: string | null; width: number | null; height: number | null;
  fps: number | null; ptzConfig: string | null; videoSource: string | null; hasAudio: boolean;
}
export interface PtzNode {
  token: string; maxPresets: number | null; homeSupported: boolean; aux: string[];
  continuousPanTilt: boolean; continuousZoom: boolean; absolutePanTilt: boolean; absoluteZoom: boolean;
}
export interface PtzStatus { pan: number | null; tilt: number | null; zoom: number | null; moving: boolean | null; error: string | null }
export interface OnvifPreset { token: string; name: string }
export type OnOffAuto = "ON" | "OFF" | "AUTO";
export interface ImagingSettings {
  brightness: number | null; contrast: number | null; saturation: number | null; sharpness: number | null;
  irCut: OnOffAuto | null;
  focusMode: "AUTO" | "MANUAL" | null; focusSpeed: number | null;
  defog: OnOffAuto | null;
  wdr: { mode: "ON" | "OFF"; level: number | null } | null;
  blc: { mode: "ON" | "OFF"; level: number | null } | null;
  /** XML original de <ImagingSettings> (para reenviar o que não editamos). */
  raw: string;
}
export interface Range { min: number; max: number }
export interface ImagingOptions {
  brightness: Range | null; contrast: Range | null; saturation: Range | null; sharpness: Range | null;
  irCutModes: string[]; focusModes: string[]; defogModes: string[]; focusSpeed: Range | null;
  wdrModes: string[]; blcModes: string[];
}
export type ImagingPatch = Partial<Omit<ImagingSettings, "raw">>;

export class OnvifError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = "OnvifError"; }
}

const NS = {
  dev: "http://www.onvif.org/ver10/device/wsdl",
  media: "http://www.onvif.org/ver10/media/wsdl",
  ptz: "http://www.onvif.org/ver20/ptz/wsdl",
  img: "http://www.onvif.org/ver20/imaging/wsdl",
  tt: "http://www.onvif.org/ver10/schema",
};

/** Caminhos padrão; a câmera pode informar outros em GetCapabilities. */
const DEFAULT_PATHS = {
  dev: "/onvif/device_service",
  media: "/onvif/media_service",
  ptz: "/onvif/ptz_service",
  img: "/onvif/imaging_service",
};

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}
function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
}

/** Conteúdo do primeiro elemento `name` (qualquer prefixo), ou null. */
export function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? m[1] : null;
}
/** Todos os elementos `name`, com atributos e conteúdo. */
export function tags(xml: string, name: string): { attrs: Record<string, string>; inner: string }[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}((?:\\s[^>]*?)?)(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, "g");
  const out: { attrs: Record<string, string>; inner: string }[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const attrs: Record<string, string> = {};
    for (const a of Array.from((m[1] ?? "").matchAll(/([\w:.-]+)="([^"]*)"/g))) attrs[a[1]] = unescapeXml(a[2]);
    out.push({ attrs, inner: m[2] ?? "" });
  }
  return out;
}
function text(xml: string, name: string): string | null { const t = tag(xml, name); return t == null ? null : unescapeXml(t.trim()); }
function numTag(xml: string, name: string): number | null { const t = text(xml, name); if (t == null || t === "") return null; const n = Number(t); return Number.isFinite(n) ? n : null; }
function attr(xml: string, name: string): number | null { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(xml); if (!m) return null; const n = Number(m[1]); return Number.isFinite(n) ? n : null; }
function range(xml: string | null): Range | null {
  if (!xml) return null;
  const min = numTag(xml, "Min"); const max = numTag(xml, "Max");
  return min == null || max == null ? null : { min, max };
}
function faultText(xml: string): string | null {
  if (!/<(?:[\w-]+:)?Fault[\s>]/.test(xml)) return null;
  return text(xml, "Text") ?? text(xml, "faultstring") ?? text(xml, "Value") ?? "falha SOAP sem descrição";
}

export class OnvifClient {
  private paths = { ...DEFAULT_PATHS };
  private discovered = false;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly gapMs: number;

  constructor(private readonly target: OnvifTarget) {
    this.fetchImpl = target.fetchImpl ?? fetch;
    this.timeoutMs = target.timeoutMs ?? 8000;
    this.gapMs = target.gapMs ?? 80;
  }

  // ── fila: um comando por vez, com folga; movimento e parada passam na frente ──
  // A câmera (gSOAP, `Connection: close`) fecha a conexão a cada resposta e, se a
  // próxima conexão chega antes de ~50 ms, descarta o SYN: o cliente só repete 1 s
  // depois. Medido em 18/10/2026 na Barragem: sem folga 5 de 8 conexões levaram
  // ~1 s; com 50 ms de folga, 0 de 8. Chamadas paralelas (leitura de estado)
  // caíam no mesmo buraco. Daí a fila por câmera: `prio` 1 = PTZ/foco, 0 = resto.
  private waiting: { prio: number; seq: number; start: () => void }[] = [];
  private seq = 0;
  private active = false;
  private lastEnd = 0;
  private drainTimer?: ReturnType<typeof setTimeout>;
  private acquire(prio: number): Promise<void> {
    return new Promise((resolve) => {
      this.waiting.push({ prio, seq: this.seq++, start: resolve });
      this.waiting.sort((a, b) => b.prio - a.prio || a.seq - b.seq);
      this.drain();
    });
  }
  private drain(): void {
    if (this.active || this.drainTimer || !this.waiting.length) return;
    const wait = this.lastEnd + this.gapMs - Date.now();
    if (wait > 0) {
      this.drainTimer = setTimeout(() => { this.drainTimer = undefined; this.drain(); }, wait);
      return;
    }
    this.active = true;
    this.waiting.shift()!.start();
  }
  private release(): void {
    this.active = false;
    this.lastEnd = Date.now();
    this.drain();
  }

  // ── transporte ──
  private securityHeader(): string {
    const nonce = randomBytes(16);
    const created = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const digest = createHash("sha1").update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(this.target.password)])).digest("base64");
    return `<s:Header><Security xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">` +
      `<UsernameToken><Username>${escapeXml(this.target.username)}</Username>` +
      `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>` +
      `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</Nonce>` +
      `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>` +
      `</UsernameToken></Security></s:Header>`;
  }

  private async soap(service: keyof typeof DEFAULT_PATHS, body: string, auth = true, prio = 0): Promise<string> {
    if (!this.discovered && service !== "dev") await this.discover();
    await this.acquire(prio);
    try {
      return await this.post(service, body, auth);
    } finally {
      this.release();
    }
  }

  private async post(service: keyof typeof DEFAULT_PATHS, body: string, auth: boolean): Promise<string> {
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">${auth ? this.securityHeader() : ""}<s:Body>${body}</s:Body></s:Envelope>`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.target.baseUrl.replace(/\/+$/, "") + this.paths[service], {
        method: "POST",
        headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
        body: envelope,
        signal: controller.signal,
      });
    } catch (e) {
      throw new OnvifError(`câmera não respondeu (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      clearTimeout(timer);
    }
    const xml = await res.text();
    const fault = faultText(xml);
    if (fault) throw new OnvifError(`câmera recusou: ${fault}`, res.status);
    if (!res.ok) throw new OnvifError(`HTTP ${res.status} na chamada ONVIF`, res.status);
    return xml;
  }

  /** Lê os XAddr de GetCapabilities uma vez; falha silenciosa mantém os padrões. */
  async discover(): Promise<void> {
    this.discovered = true;
    try {
      const xml = await this.soap("dev", `<GetCapabilities xmlns="${NS.dev}"><Category>All</Category></GetCapabilities>`, false);
      const pick = (section: string) => {
        const block = tag(xml, section);
        const x = block ? text(block, "XAddr") : null;
        if (!x) return;
        try { const u = new URL(x); this.paths[section === "Device" ? "dev" : section === "Media" ? "media" : section === "PTZ" ? "ptz" : "img"] = u.pathname; } catch { /* mantém padrão */ }
      };
      pick("Device"); pick("Media"); pick("PTZ"); pick("Imaging");
    } catch { /* câmeras que não respondem GetCapabilities ficam com os caminhos padrão */ }
  }

  // ── dispositivo ──
  async getDeviceInformation(): Promise<DeviceInfo> {
    const xml = await this.soap("dev", `<GetDeviceInformation xmlns="${NS.dev}"/>`);
    return {
      manufacturer: text(xml, "Manufacturer") ?? "", model: text(xml, "Model") ?? "",
      firmware: text(xml, "FirmwareVersion") ?? "", serial: text(xml, "SerialNumber") ?? "", hardwareId: text(xml, "HardwareId") ?? "",
    };
  }

  /** Hora UTC da câmera (null se não informar). */
  async getDeviceTime(): Promise<Date | null> {
    const xml = await this.soap("dev", `<GetSystemDateAndTime xmlns="${NS.dev}"/>`, false);
    const utc = tag(xml, "UTCDateTime");
    if (!utc) return null;
    const d = tag(utc, "Date"); const t = tag(utc, "Time");
    if (!d || !t) return null;
    const n = (x: string, k: string) => numTag(x, k) ?? 0;
    return new Date(Date.UTC(n(d, "Year"), n(d, "Month") - 1, n(d, "Day"), n(t, "Hour"), n(t, "Minute"), n(t, "Second")));
  }

  // ── mídia ──
  async getProfiles(): Promise<MediaProfile[]> {
    const xml = await this.soap("media", `<GetProfiles xmlns="${NS.media}"/>`);
    return tags(xml, "Profiles").map(({ attrs, inner }) => {
      const enc = tag(inner, "VideoEncoderConfiguration");
      const res = enc ? tag(enc, "Resolution") : null;
      const vsc = tag(inner, "VideoSourceConfiguration");
      return {
        token: attrs.token ?? "", name: text(inner, "Name") ?? attrs.token ?? "",
        encoding: enc ? text(enc, "Encoding") : null,
        width: res ? numTag(res, "Width") : null, height: res ? numTag(res, "Height") : null,
        fps: enc ? numTag(enc, "FrameRateLimit") : null,
        ptzConfig: (/<(?:[\w-]+:)?PTZConfiguration[^>]*token="([^"]+)"/.exec(inner) ?? [])[1] ?? null,
        videoSource: vsc ? text(vsc, "SourceToken") : null,
        hasAudio: /<(?:[\w-]+:)?AudioEncoderConfiguration/.test(inner),
      };
    });
  }

  async getStreamUri(profile: string): Promise<string | null> {
    const xml = await this.soap("media", `<GetStreamUri xmlns="${NS.media}"><StreamSetup><Stream xmlns="${NS.tt}">RTP-Unicast</Stream><Transport xmlns="${NS.tt}"><Protocol>RTSP</Protocol></Transport></StreamSetup><ProfileToken>${escapeXml(profile)}</ProfileToken></GetStreamUri>`);
    return text(xml, "Uri");
  }

  // ── PTZ ──
  async getPtzNodes(): Promise<PtzNode[]> {
    const xml = await this.soap("ptz", `<GetNodes xmlns="${NS.ptz}"/>`);
    return tags(xml, "PTZNode").map(({ attrs, inner }) => ({
      token: attrs.token ?? "",
      maxPresets: numTag(inner, "MaximumNumberOfPresets"),
      homeSupported: text(inner, "HomeSupported") === "true",
      aux: tags(inner, "AuxiliaryCommands").map((a) => unescapeXml(a.inner.trim())).filter(Boolean),
      continuousPanTilt: /ContinuousPanTiltVelocitySpace/.test(inner),
      continuousZoom: /ContinuousZoomVelocitySpace/.test(inner),
      absolutePanTilt: /AbsolutePanTiltPositionSpace/.test(inner),
      absoluteZoom: /AbsoluteZoomPositionSpace/.test(inner),
    }));
  }

  /** Movimento contínuo; valores −1..1 (0 = parado naquele eixo). */
  async continuousMove(profile: string, v: { pan?: number; tilt?: number; zoom?: number }, timeoutSeconds = 5): Promise<void> {
    const clamp = (n: number | undefined) => Math.max(-1, Math.min(1, Number.isFinite(n as number) ? (n as number) : 0));
    const pan = clamp(v.pan), tilt = clamp(v.tilt), zoom = clamp(v.zoom);
    const parts = [
      pan || tilt ? `<PanTilt x="${pan}" y="${tilt}" xmlns="${NS.tt}"/>` : "",
      zoom ? `<Zoom x="${zoom}" xmlns="${NS.tt}"/>` : "",
    ].join("");
    if (!parts) return this.stop(profile);
    await this.soap("ptz", `<ContinuousMove xmlns="${NS.ptz}"><ProfileToken>${escapeXml(profile)}</ProfileToken><Velocity>${parts}</Velocity><Timeout>PT${Math.max(1, Math.round(timeoutSeconds))}S</Timeout></ContinuousMove>`, true, 1);
  }

  async stop(profile: string): Promise<void> {
    await this.soap("ptz", `<Stop xmlns="${NS.ptz}"><ProfileToken>${escapeXml(profile)}</ProfileToken><PanTilt>true</PanTilt><Zoom>true</Zoom></Stop>`, true, 1);
  }

  async getStatus(profile: string): Promise<PtzStatus> {
    const xml = await this.soap("ptz", `<GetStatus xmlns="${NS.ptz}"><ProfileToken>${escapeXml(profile)}</ProfileToken></GetStatus>`);
    const pos = tag(xml, "Position");
    const pt = pos ? (/<(?:[\w-]+:)?PanTilt[^>]*>/.exec(pos) ?? [""])[0] : "";
    const z = pos ? (/<(?:[\w-]+:)?Zoom[^>]*>/.exec(pos) ?? [""])[0] : "";
    const ms = tag(xml, "MoveStatus");
    const moving = ms ? /MOVING/.test(ms) ? true : /IDLE/.test(ms) ? false : null : null;
    return { pan: attr(pt, "x"), tilt: attr(pt, "y"), zoom: attr(z, "x"), moving, error: text(xml, "Error") };
  }

  async getPresets(profile: string): Promise<OnvifPreset[]> {
    const xml = await this.soap("ptz", `<GetPresets xmlns="${NS.ptz}"><ProfileToken>${escapeXml(profile)}</ProfileToken></GetPresets>`);
    return tags(xml, "Preset").map(({ attrs, inner }) => ({ token: attrs.token ?? "", name: text(inner, "Name") ?? "" })).filter((p) => p.token);
  }

  async gotoPreset(profile: string, token: string): Promise<void> {
    await this.soap("ptz", `<GotoPreset xmlns="${NS.ptz}"><ProfileToken>${escapeXml(profile)}</ProfileToken><PresetToken>${escapeXml(token)}</PresetToken></GotoPreset>`);
  }

  /** Grava a posição atual; devolve o token (novo ou o informado). */
  async setPreset(profile: string, name: string, token?: string): Promise<string> {
    const xml = await this.soap("ptz", `<SetPreset xmlns="${NS.ptz}"><ProfileToken>${escapeXml(profile)}</ProfileToken><PresetName>${escapeXml(name)}</PresetName>${token ? `<PresetToken>${escapeXml(token)}</PresetToken>` : ""}</SetPreset>`);
    return text(xml, "PresetToken") ?? token ?? "";
  }

  async removePreset(profile: string, token: string): Promise<void> {
    await this.soap("ptz", `<RemovePreset xmlns="${NS.ptz}"><ProfileToken>${escapeXml(profile)}</ProfileToken><PresetToken>${escapeXml(token)}</PresetToken></RemovePreset>`);
  }

  async gotoHome(profile: string): Promise<void> {
    await this.soap("ptz", `<GotoHomePosition xmlns="${NS.ptz}"><ProfileToken>${escapeXml(profile)}</ProfileToken></GotoHomePosition>`);
  }

  async setHome(profile: string): Promise<void> {
    await this.soap("ptz", `<SetHomePosition xmlns="${NS.ptz}"><ProfileToken>${escapeXml(profile)}</ProfileToken></SetHomePosition>`);
  }

  /** Comando auxiliar como a câmera anuncia em GetNodes (ex.: "tt:Wiper|On"). */
  async sendAuxiliary(profile: string, command: string): Promise<string | null> {
    const xml = await this.soap("ptz", `<SendAuxiliaryCommand xmlns="${NS.ptz}"><ProfileToken>${escapeXml(profile)}</ProfileToken><AuxiliaryData>${escapeXml(command)}</AuxiliaryData></SendAuxiliaryCommand>`);
    return text(xml, "AuxiliaryResponse");
  }

  // ── imagem ──
  async getImagingOptions(videoSource: string): Promise<ImagingOptions> {
    const xml = await this.soap("img", `<GetOptions xmlns="${NS.img}"><VideoSourceToken>${escapeXml(videoSource)}</VideoSourceToken></GetOptions>`);
    const opts = tag(xml, "ImagingOptions") ?? xml;
    const focus = tag(opts, "Focus");
    const modes = (block: string | null, name: string) => (block ? tags(block, name).map((m) => m.inner.trim()).filter(Boolean) : []);
    return {
      brightness: range(tag(opts, "Brightness")), contrast: range(tag(opts, "Contrast")),
      saturation: range(tag(opts, "ColorSaturation")), sharpness: range(tag(opts, "Sharpness")),
      irCutModes: modes(opts, "IrCutFilterModes"),
      focusModes: focus ? modes(focus, "AutoFocusModes") : [],
      focusSpeed: focus ? range(tag(focus, "DefaultSpeed")) : null,
      defogModes: modes(tag(opts, "Defogging"), "Mode"),
      wdrModes: modes(tag(opts, "WideDynamicRange"), "Mode"),
      blcModes: modes(tag(opts, "BacklightCompensation"), "Mode"),
    };
  }

  async getImagingSettings(videoSource: string): Promise<ImagingSettings> {
    const xml = await this.soap("img", `<GetImagingSettings xmlns="${NS.img}"><VideoSourceToken>${escapeXml(videoSource)}</VideoSourceToken></GetImagingSettings>`);
    return parseImagingSettings(tag(xml, "ImagingSettings") ?? "");
  }

  /** Lê, aplica o `patch` por cima e reenvia tudo (muitas câmeras exigem o bloco inteiro). */
  async setImagingSettings(videoSource: string, patch: ImagingPatch): Promise<ImagingSettings> {
    const current = await this.getImagingSettings(videoSource);
    const merged = buildImagingSettingsXml(current, patch);
    // xmlns:tt declarado aqui: o bloco reinjeta Exposure/WhiteBalance crus da câmera, que vêm com
    // prefixo tt: (ex.: <tt:Mode>). Sem declarar o prefixo, a câmera recusa com "syntax error in element 'tt:Mode'".
    await this.soap("img", `<SetImagingSettings xmlns="${NS.img}"><VideoSourceToken>${escapeXml(videoSource)}</VideoSourceToken><ImagingSettings xmlns:tt="${NS.tt}">${merged}</ImagingSettings><ForcePersistence>true</ForcePersistence></SetImagingSettings>`);
    return this.getImagingSettings(videoSource);
  }

  /** Foco contínuo: speed −1..1 (negativo = perto). */
  async focusMove(videoSource: string, speed: number): Promise<void> {
    const s = Math.max(-1, Math.min(1, speed));
    await this.soap("img", `<Move xmlns="${NS.img}"><VideoSourceToken>${escapeXml(videoSource)}</VideoSourceToken><Focus><Continuous xmlns="${NS.tt}"><Speed>${s}</Speed></Continuous></Focus></Move>`, true, 1);
  }

  async focusStop(videoSource: string): Promise<void> {
    await this.soap("img", `<Stop xmlns="${NS.img}"><VideoSourceToken>${escapeXml(videoSource)}</VideoSourceToken></Stop>`, true, 1);
  }

  /** Reconfigura um VideoEncoder (H.264) — usado para alternar o fluxo principal entre HD e 4K. */
  async setVideoEncoder(token: string, cfg: { width: number; height: number; fps: number; kbps: number; gop: number }): Promise<void> {
    const body =
      `<SetVideoEncoderConfiguration xmlns="${NS.media}"><Configuration token="${escapeXml(token)}" xmlns:tt="${NS.tt}">` +
      `<tt:Name>${escapeXml(token)}</tt:Name><tt:UseCount>2</tt:UseCount><tt:Encoding>H264</tt:Encoding>` +
      `<tt:Resolution><tt:Width>${cfg.width}</tt:Width><tt:Height>${cfg.height}</tt:Height></tt:Resolution><tt:Quality>50</tt:Quality>` +
      `<tt:RateControl><tt:FrameRateLimit>${cfg.fps}</tt:FrameRateLimit><tt:EncodingInterval>1</tt:EncodingInterval><tt:BitrateLimit>${cfg.kbps}</tt:BitrateLimit></tt:RateControl>` +
      `<tt:H264><tt:GovLength>${cfg.gop}</tt:GovLength><tt:H264Profile>High</tt:H264Profile></tt:H264>` +
      `<tt:Multicast><tt:Address><tt:Type>IPv4</tt:Type><tt:IPv4Address>0.0.0.0</tt:IPv4Address></tt:Address><tt:Port>0</tt:Port><tt:TTL>0</tt:TTL><tt:AutoStart>false</tt:AutoStart></tt:Multicast>` +
      `<tt:SessionTimeout>PT00H12M00S</tt:SessionTimeout></Configuration><ForcePersistence>true</ForcePersistence></SetVideoEncoderConfiguration>`;
    await this.soap("media", body);
  }
}

/** Interpreta o bloco <ImagingSettings>. */
export function parseImagingSettings(raw: string): ImagingSettings {
  const focus = tag(raw, "Focus");
  const wdr = tag(raw, "WideDynamicRange"); const blc = tag(raw, "BacklightCompensation");
  const defog = tag(raw, "Defogging");
  const onOffAuto = (v: string | null): OnOffAuto | null => (v === "ON" || v === "OFF" || v === "AUTO" ? v : null);
  const onOff = (v: string | null): "ON" | "OFF" | null => (v === "ON" || v === "OFF" ? v : null);
  const fm = focus ? text(focus, "AutoFocusMode") : null;
  return {
    brightness: numTag(raw, "Brightness"), contrast: numTag(raw, "Contrast"),
    saturation: numTag(raw, "ColorSaturation"), sharpness: numTag(raw, "Sharpness"),
    irCut: onOffAuto(text(raw, "IrCutFilter")),
    focusMode: fm === "AUTO" || fm === "MANUAL" ? fm : null,
    focusSpeed: focus ? numTag(focus, "DefaultSpeed") : null,
    defog: defog ? onOffAuto(text(defog, "Mode")) : null,
    wdr: wdr && onOff(text(wdr, "Mode")) ? { mode: onOff(text(wdr, "Mode")) as "ON" | "OFF", level: numTag(wdr, "Level") } : null,
    blc: blc && onOff(text(blc, "Mode")) ? { mode: onOff(text(blc, "Mode")) as "ON" | "OFF", level: numTag(blc, "Level") } : null,
    raw,
  };
}

/**
 * Monta o conteúdo de <ImagingSettings> na ordem do esquema ONVIF, a partir do
 * estado atual mais o patch. Campos que a câmera não informou e o patch não
 * pediu ficam de fora (não inventa valores).
 */
export function buildImagingSettingsXml(_current: ImagingSettings, patch: ImagingPatch): string {
  const tt = ` xmlns="${NS.tt}"`;
  const parts: string[] = [];
  // Só os campos que o operador está mudando (o `patch`), na ordem do esquema ONVIF. Antes a gente
  // reenviava o bloco inteiro lido da câmera (current), mas esta XMeye recusa os próprios elementos de
  // volta — Exposure/WhiteBalance vêm com prefixo tt: e o Defogging tem valor que ela não revalida
  // ("invalid value in element 'Defogging'"). O ONVIF aceita ajuste parcial com ForcePersistence, então
  // mandar só o que mudou evita a recusa e não mexe no resto.
  if (patch.blc) parts.push(`<BacklightCompensation${tt}><Mode>${patch.blc.mode}</Mode>${patch.blc.level != null ? `<Level>${patch.blc.level}</Level>` : ""}</BacklightCompensation>`);
  if (patch.brightness != null) parts.push(`<Brightness${tt}>${patch.brightness}</Brightness>`);
  if (patch.saturation != null) parts.push(`<ColorSaturation${tt}>${patch.saturation}</ColorSaturation>`);
  if (patch.contrast != null) parts.push(`<Contrast${tt}>${patch.contrast}</Contrast>`);
  if (patch.focusMode || patch.focusSpeed != null) parts.push(`<Focus${tt}>${patch.focusMode ? `<AutoFocusMode>${patch.focusMode}</AutoFocusMode>` : ""}${patch.focusSpeed != null ? `<DefaultSpeed>${patch.focusSpeed}</DefaultSpeed>` : ""}</Focus>`);
  if (patch.irCut) parts.push(`<IrCutFilter${tt}>${patch.irCut}</IrCutFilter>`);
  if (patch.sharpness != null) parts.push(`<Sharpness${tt}>${patch.sharpness}</Sharpness>`);
  if (patch.wdr) parts.push(`<WideDynamicRange${tt}><Mode>${patch.wdr.mode}</Mode>${patch.wdr.level != null ? `<Level>${patch.wdr.level}</Level>` : ""}</WideDynamicRange>`);
  if (patch.defog) parts.push(`<Extension${tt}><Defogging><Mode>${patch.defog}</Mode></Defogging></Extension>`);
  return parts.join("");
}
