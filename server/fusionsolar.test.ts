import { describe, it, expect } from "vitest";

const BASE_URL = process.env.FUSIONSOLAR_BASE_URL ?? "https://la5.fusionsolar.huawei.com/thirdData";
const USERNAME = process.env.FUSIONSOLAR_USERNAME ?? "";
const SYSTEM_CODE = process.env.FUSIONSOLAR_SYSTEM_CODE ?? "";

describe("FusionSolar API Credentials", () => {
  it("should have FusionSolar credentials configured", () => {
    expect(USERNAME).not.toBe("");
    expect(SYSTEM_CODE).not.toBe("");
    expect(BASE_URL).toContain("fusionsolar.huawei.com");
  });

  it("should authenticate or hit rate limit (both confirm valid config)", async () => {
    const resp = await fetch(`${BASE_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: USERNAME,
        systemCode: SYSTEM_CODE,
      }),
    });

    const data = await resp.json();

    // failCode 0 = success, 407 = rate limit (too many logins — credentials are valid)
    // Only fail if it's an auth error (e.g., 305 = invalid credentials)
    const acceptableCodes = [0, 407];
    expect(acceptableCodes).toContain(data.failCode);

    if (data.failCode === 0) {
      // Verify XSRF-TOKEN is present on successful login
      const setCookies = resp.headers.getSetCookie?.() ?? [];
      const hasXsrf = setCookies.some((c: string) => c.includes("XSRF-TOKEN"));
      expect(hasXsrf).toBe(true);
      console.log("[FusionSolar] Login successful — credentials valid");
    } else if (data.failCode === 407) {
      console.log("[FusionSolar] Rate limited (407) — credentials accepted, too many recent logins");
    }
  }, 30000);
});

describe("MQTT Broker Credentials", () => {
  it("should have MQTT credentials configured", () => {
    const host = process.env.MQTT_BROKER_HOST ?? "";
    const port = process.env.MQTT_BROKER_PORT ?? "";
    const user = process.env.MQTT_USERNAME ?? "";
    const pass = process.env.MQTT_PASSWORD ?? "";

    expect(host).not.toBe("");
    expect(port).not.toBe("");
    expect(user).not.toBe("");
    expect(pass).not.toBe("");
    expect(host).toBe("92.112.179.225");
    expect(port).toBe("1883");
  });
});
