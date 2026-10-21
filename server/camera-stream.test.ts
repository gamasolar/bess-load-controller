import { describe, expect, it } from "vitest";
import { go2rtcConfig } from "./camera-stream";
import { endpoints, publicCamera, streamNames } from "./camera-store";
import type { BessCamera } from "../drizzle/schema";

const base: BessCamera = {
  id: 7, siteId: 2, name: "Casa de bombas", model: "JM800S5_AF",
  host: "192.168.88.253", httpPort: 80, rtspPort: 554,
  viaHost: null, viaHttpPort: null, viaRtspPort: null,
  username: "admin", password: "s3nh@:x",
  streamMain: "/stream0", streamSub: "stream1", snapshotPath: "/cgi-bin/snapshot.cgi?channel=1",
  onvifProfile: null, onvifVideoSource: null, features: { ptz: true }, isActive: true,
  createdAt: new Date(), updatedAt: new Date(),
};

describe("endpoints", () => {
  it("fala direto com a câmera quando não há túnel, com a credencial escapada na URL", () => {
    const e = endpoints(base);
    expect(e.httpBase).toBe("http://192.168.88.253:80");
    expect(e.rtspSub).toBe("rtsp://admin:s3nh%40%3Ax@192.168.88.253:554/stream1");
    expect(e.snapshotUrl).toBe("http://192.168.88.253:80/cgi-bin/snapshot.cgi?channel=1");
  });

  it("usa o túnel quando cadastrado", () => {
    const e = endpoints({ ...base, viaHost: "127.0.0.1", viaHttpPort: 18080, viaRtspPort: 18554 });
    expect(e.httpBase).toBe("http://127.0.0.1:18080");
    expect(e.rtspMain).toBe("rtsp://admin:s3nh%40%3Ax@127.0.0.1:18554/stream0");
  });
});

describe("publicCamera", () => {
  it("nunca expõe credencial nem portas internas", () => {
    const p = publicCamera({ ...base, viaHost: "127.0.0.1" });
    const json = JSON.stringify(p);
    expect(json).not.toContain("s3nh");
    expect(json).not.toContain("192.168");
    expect(p.streams).toEqual(streamNames(7));
    expect(p.hasTunnel).toBe(true);
  });
});

describe("go2rtcConfig", () => {
  it("gera um fluxo leve e um principal por câmera ativa, com conversões ffmpeg sob demanda", () => {
    const yaml = go2rtcConfig([base, { ...base, id: 8, isActive: false }], 1984, "/x/ffmpeg");
    expect(yaml).toContain('api: { listen: "127.0.0.1:1984"');
    expect(yaml).toContain('rtsp: { listen: "127.0.0.1:8554" }');
    expect(yaml).toContain('ffmpeg: { bin: "/x/ffmpeg" }');
    expect(yaml).toContain("  cam7_sub:\n    - \"rtsp://admin:s3nh%40%3Ax@192.168.88.253:554/stream1#backchannel=0#timeout=30\"\n    - \"ffmpeg:cam7_sub#audio=aac/16000\"\n    - \"ffmpeg:cam7_sub#audio=opus\"\n    - \"ffmpeg:cam7_sub#video=h264#audio=aac/16000\"\n    - \"ffmpeg:cam7_sub#video=mjpeg\"");
    expect(yaml).toContain("  cam7_main:\n    - \"rtsp://admin:s3nh%40%3Ax@192.168.88.253:554/stream0#backchannel=0#timeout=30\"");
    expect(yaml).not.toContain("cam8_");
  });
});
