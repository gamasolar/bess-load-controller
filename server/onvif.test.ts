import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { OnvifClient, OnvifError, buildImagingSettingsXml, parseImagingSettings, tags } from "./onvif";

/** Câmera de mentira: responde por nome da operação e guarda o que recebeu. */
let server: Server;
let baseUrl = "";
const received: { path: string; body: string }[] = [];
const soapEnv = (inner: string) => `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:timg="http://www.onvif.org/ver20/imaging/wsdl"><SOAP-ENV:Body>${inner}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
const responses: Record<string, string> = {
  GetCapabilities: soapEnv(`<tds:GetCapabilitiesResponse><tds:Capabilities><tt:PTZ><tt:XAddr>http://ignored:80/onvif/ptz_custom</tt:XAddr></tt:PTZ><tt:Media><tt:XAddr>http://ignored/onvif/media_service</tt:XAddr></tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse>`),
  GetDeviceInformation: soapEnv(`<tds:GetDeviceInformationResponse><tds:Manufacturer>ONVIF_ICAMERA</tds:Manufacturer><tds:Model>JM800S5_AF</tds:Model><tds:FirmwareVersion>V3.4.2.2</tds:FirmwareVersion><tds:SerialNumber>EF0000</tds:SerialNumber><tds:HardwareId>x</tds:HardwareId></tds:GetDeviceInformationResponse>`),
  GetNodes: soapEnv(`<tptz:GetNodesResponse><tptz:PTZNode token="ptz0"><tt:Name>n</tt:Name><tt:SupportedPTZSpaces><tt:ContinuousPanTiltVelocitySpace/><tt:ContinuousZoomVelocitySpace/></tt:SupportedPTZSpaces><tt:MaximumNumberOfPresets>255</tt:MaximumNumberOfPresets><tt:HomeSupported>true</tt:HomeSupported><tt:AuxiliaryCommands>tt:Wiper|On</tt:AuxiliaryCommands><tt:AuxiliaryCommands>tt:Lamp|Off</tt:AuxiliaryCommands></tptz:PTZNode></tptz:GetNodesResponse>`),
  GetPresets: soapEnv(`<tptz:GetPresetsResponse><tptz:Preset token="1"><tt:Name>Bomba &amp; casa</tt:Name></tptz:Preset><tptz:Preset token="7"><tt:Name>Barragem</tt:Name></tptz:Preset></tptz:GetPresetsResponse>`),
  SetPreset: soapEnv(`<tptz:SetPresetResponse><tptz:PresetToken>9</tptz:PresetToken></tptz:SetPresetResponse>`),
  GetStatus: soapEnv(`<tptz:GetStatusResponse><tptz:PTZStatus><tt:Position><tt:PanTilt x="0.25" y="-0.5"/><tt:Zoom x="0.1"/></tt:Position><tt:MoveStatus><tt:PanTilt>MOVING</tt:PanTilt></tt:MoveStatus></tptz:PTZStatus></tptz:GetStatusResponse>`),
  ContinuousMove: soapEnv(`<tptz:ContinuousMoveResponse/>`),
  Stop: soapEnv(`<tptz:StopResponse/>`),
  GotoPreset: soapEnv(`<SOAP-ENV:Fault><SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:Sender</SOAP-ENV:Value></SOAP-ENV:Code><SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">No such preset</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>`),
  GetImagingSettings: soapEnv(`<timg:GetImagingSettingsResponse><timg:ImagingSettings><tt:BacklightCompensation><tt:Mode>OFF</tt:Mode><tt:Level>10</tt:Level></tt:BacklightCompensation><tt:Brightness>50</tt:Brightness><tt:ColorSaturation>60</tt:ColorSaturation><tt:Contrast>55</tt:Contrast><tt:Exposure><tt:Mode>AUTO</tt:Mode></tt:Exposure><tt:Focus><tt:AutoFocusMode>AUTO</tt:AutoFocusMode><tt:DefaultSpeed>5</tt:DefaultSpeed></tt:Focus><tt:IrCutFilter>AUTO</tt:IrCutFilter><tt:Sharpness>40</tt:Sharpness><tt:WideDynamicRange><tt:Mode>OFF</tt:Mode></tt:WideDynamicRange><tt:WhiteBalance><tt:Mode>AUTO</tt:Mode></tt:WhiteBalance><tt:Extension><tt:Defogging><tt:Mode>OFF</tt:Mode></tt:Defogging></tt:Extension></timg:ImagingSettings></timg:GetImagingSettingsResponse>`),
  SetImagingSettings: soapEnv(`<timg:SetImagingSettingsResponse/>`),
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", body });
      const op = /<s:Body><(\w+)/.exec(body)?.[1] ?? "";
      const xml = responses[op];
      if (!xml) { res.statusCode = 400; res.end(soapEnv(`<SOAP-ENV:Fault><SOAP-ENV:Reason><SOAP-ENV:Text>unknown ${op}</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>`)); return; }
      res.setHeader("Content-Type", "application/soap+xml");
      res.end(xml);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => server.close());

const client = () => new OnvifClient({ baseUrl, username: "admin", password: "segredo", timeoutMs: 2000 });
const last = () => received[received.length - 1];

describe("OnvifClient", () => {
  it("serializa as chamadas com folga e deixa parada/movimento passarem na frente", async () => {
    // A câmera real descarta a conexão que chega logo após a anterior fechar (SYN só repetido 1 s depois).
    const starts: { op: string; t: number }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const op = /<s:Body><(\w+)/.exec(String(init?.body))?.[1] ?? "?";
      starts.push({ op, t: Date.now() });
      return fetch(url, init);
    };
    const q = new OnvifClient({ baseUrl, username: "admin", password: "x", timeoutMs: 2000, gapMs: 60, fetchImpl });
    await q.getPtzNodes(); // descoberta dos endereços fora da medição
    await new Promise((r) => setTimeout(r, 100)); // folga vencida: a próxima chamada sai na hora
    starts.length = 0;
    const t0 = Date.now();
    const all = Promise.all([
      q.getPresets("p"), q.getStatus("p"), q.getStatus("p"),
      new Promise((r) => setTimeout(r, 5)).then(() => q.stop("p")),
    ]);
    await all;
    const ops = starts.map((s) => s.op);
    expect(ops[0]).toBe("GetPresets");           // a primeira já estava em voo
    expect(ops[1]).toBe("Stop");                 // a parada fura a fila das leituras
    expect(ops.slice(2)).toEqual(["GetStatus", "GetStatus"]);
    const gaps = starts.slice(1).map((s, i) => s.t - starts[i].t);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(55);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("assina com WS-UsernameToken e lê a identificação", async () => {
    const info = await client().getDeviceInformation();
    expect(info.model).toBe("JM800S5_AF");
    expect(last().body).toContain("<Username>admin</Username>");
    expect(last().body).toContain("PasswordDigest");
    expect(last().body).not.toContain("segredo");
  });

  it("usa o XAddr do PTZ informado em GetCapabilities", async () => {
    const nodes = await client().getPtzNodes();
    expect(last().path).toBe("/onvif/ptz_custom");
    expect(nodes[0]).toMatchObject({ token: "ptz0", maxPresets: 255, homeSupported: true, continuousPanTilt: true, continuousZoom: true, absolutePanTilt: false });
    expect(nodes[0].aux).toEqual(["tt:Wiper|On", "tt:Lamp|Off"]);
  });

  it("movimento contínuo limita a ±1 e omite o eixo parado", async () => {
    await client().continuousMove("MainStream", { pan: 3, tilt: -0.5 });
    expect(last().body).toContain('<PanTilt x="1" y="-0.5"');
    expect(last().body).not.toContain("<Zoom");
    expect(last().body).toContain("<ProfileToken>MainStream</ProfileToken>");
    expect(last().body).toContain("<Timeout>PT5S</Timeout>");
  });

  it("movimento todo zero vira Stop", async () => {
    await client().continuousMove("MainStream", { pan: 0, tilt: 0, zoom: 0 });
    expect(last().body).toContain("<Stop ");
  });

  it("lê presets com nome escapado e grava preset devolvendo o token", async () => {
    const c = client();
    expect(await c.getPresets("MainStream")).toEqual([{ token: "1", name: "Bomba & casa" }, { token: "7", name: "Barragem" }]);
    expect(await c.setPreset("MainStream", "Casa <nova>")).toBe("9");
    expect(last().body).toContain("<PresetName>Casa &lt;nova&gt;</PresetName>");
  });

  it("status com posição e movimento", async () => {
    expect(await client().getStatus("MainStream")).toEqual({ pan: 0.25, tilt: -0.5, zoom: 0.1, moving: true, error: null });
  });

  it("falha SOAP vira OnvifError com o motivo da câmera", async () => {
    await expect(client().gotoPreset("MainStream", "99")).rejects.toThrow(OnvifError);
    await expect(client().gotoPreset("MainStream", "99")).rejects.toThrow(/No such preset/);
  });

  it("ajuste de imagem relê, aplica o patch e reenvia o bloco inteiro na ordem do esquema", async () => {
    const after = await client().setImagingSettings("VideoSourceMain", { brightness: 70, irCut: "ON", focusMode: "MANUAL", defog: "ON" });
    const sent = received[received.length - 2].body; // SetImagingSettings (a última é o GET de confirmação)
    expect(sent).toContain("<SetImagingSettings");
    const block = /<ImagingSettings>([\s\S]*)<\/ImagingSettings>/.exec(sent)![1];
    const order = ["BacklightCompensation", "Brightness", "ColorSaturation", "Contrast", "Exposure", "Focus", "IrCutFilter", "Sharpness", "WideDynamicRange", "WhiteBalance", "Extension"];
    const positions = order.map((n) => block.indexOf(`<${n}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(block).toContain("<Brightness xmlns=\"http://www.onvif.org/ver10/schema\">70</Brightness>");
    expect(block).toContain("<AutoFocusMode>MANUAL</AutoFocusMode>");
    expect(block).toContain("<Defogging><Mode>ON</Mode></Defogging>");
    expect(block).toContain("<Exposure xmlns=\"http://www.onvif.org/ver10/schema\"><tt:Mode>AUTO</tt:Mode></Exposure>");
    expect(after.brightness).toBe(50); // a câmera de mentira não muda nada
  });
});

describe("parseImagingSettings / buildImagingSettingsXml", () => {
  it("interpreta e remonta sem inventar campos ausentes", () => {
    const s = parseImagingSettings(`<tt:Brightness>12</tt:Brightness><tt:IrCutFilter>OFF</tt:IrCutFilter>`);
    expect(s).toMatchObject({ brightness: 12, contrast: null, irCut: "OFF", focusMode: null, wdr: null });
    const xml = buildImagingSettingsXml(s, { contrast: 44 });
    expect(xml).toBe(`<Brightness xmlns="http://www.onvif.org/ver10/schema">12</Brightness><Contrast xmlns="http://www.onvif.org/ver10/schema">44</Contrast><IrCutFilter xmlns="http://www.onvif.org/ver10/schema">OFF</IrCutFilter>`);
  });

  it("tags lê atributos e elementos vazios", () => {
    expect(tags(`<a:X token="t1"/><a:X token="t2">v</a:X>`, "X")).toEqual([{ attrs: { token: "t1" }, inner: "" }, { attrs: { token: "t2" }, inner: "v" }]);
  });
});
