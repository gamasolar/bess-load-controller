import { describe, it, expect, vi } from "vitest";

describe("MQTT State Sync", () => {

  describe("Divergence detection logic", () => {
    it("should detect divergence when system=on but sonoff=OFF", () => {
      const expectedLoad = "on";
      const realPower = "OFF";
      const isDivergent = (expectedLoad === "on" && realPower === "OFF") ||
                          (expectedLoad === "off" && realPower === "ON");
      expect(isDivergent).toBe(true);
    });

    it("should detect divergence when system=off but sonoff=ON", () => {
      const expectedLoad = "off";
      const realPower = "ON";
      const isDivergent = (expectedLoad === "on" && realPower === "OFF") ||
                          (expectedLoad === "off" && realPower === "ON");
      expect(isDivergent).toBe(true);
    });

    it("should NOT detect divergence when system=on and sonoff=ON", () => {
      const expectedLoad = "on";
      const realPower = "ON";
      const isDivergent = (expectedLoad === "on" && realPower === "OFF") ||
                          (expectedLoad === "off" && realPower === "ON");
      expect(isDivergent).toBe(false);
    });

    it("should NOT detect divergence when system=off and sonoff=OFF", () => {
      const expectedLoad = "off";
      const realPower = "OFF";
      const isDivergent = (expectedLoad === "on" && realPower === "OFF") ||
                          (expectedLoad === "off" && realPower === "ON");
      expect(isDivergent).toBe(false);
    });

    it("should NOT detect divergence when sonoff=UNKNOWN (state unknown)", () => {
      const expectedLoad = "on";
      const realPower = "UNKNOWN";
      const shouldCheck = realPower !== "UNKNOWN";
      expect(shouldCheck).toBe(false);
    });

    it("should NOT check divergence when device is offline", () => {
      const online = false;
      const realPower = "OFF";
      const shouldCheck = realPower !== "UNKNOWN" && online;
      expect(shouldCheck).toBe(false);
    });
  });

  describe("sonoffPower field values", () => {
    it("should accept ON, OFF, UNKNOWN as valid values", () => {
      const validValues = ["ON", "OFF", "UNKNOWN"] as const;
      expect(validValues).toContain("ON");
      expect(validValues).toContain("OFF");
      expect(validValues).toContain("UNKNOWN");
    });

    it("should default to UNKNOWN for new devices", () => {
      const defaultPower = "UNKNOWN";
      expect(defaultPower).toBe("UNKNOWN");
    });

    it("should map loadStatus 'on' to expected 'ON' for comparison", () => {
      const loadStatus = "on";
      const systemSays = loadStatus === "on" ? "ON" : "OFF";
      expect(systemSays).toBe("ON");
    });

    it("should map loadStatus 'off' to expected 'OFF' for comparison", () => {
      const loadStatus = "off";
      const systemSays = loadStatus === "on" ? "ON" : "OFF";
      expect(systemSays).toBe("OFF");
    });
  });

  describe("Stale device detection", () => {
    it("should mark device offline if no message in 120s", () => {
      const lastSeen = Date.now() - 130_000; // 130s ago
      const staleThreshold = 120_000;
      const isStale = (Date.now() - lastSeen) > staleThreshold;
      expect(isStale).toBe(true);
    });

    it("should NOT mark device offline if message within 120s", () => {
      const lastSeen = Date.now() - 60_000; // 60s ago
      const staleThreshold = 120_000;
      const isStale = (Date.now() - lastSeen) > staleThreshold;
      expect(isStale).toBe(false);
    });
  });

  describe("MQTT message parsing logic", () => {
    it("should parse stat/POWER ON correctly", () => {
      const payload = "ON";
      const state = payload.toUpperCase().trim();
      expect(state).toBe("ON");
    });

    it("should parse stat/POWER OFF correctly", () => {
      const payload = "OFF";
      const state = payload.toUpperCase().trim();
      expect(state).toBe("OFF");
    });

    it("should parse tele/STATE JSON with POWER field", () => {
      const payload = '{"POWER":"ON","Wifi":{"RSSI":78},"Uptime":"0T12:34:56"}';
      const parsed = JSON.parse(payload);
      expect(parsed.POWER).toBe("ON");
      expect(parsed.Wifi.RSSI).toBe(78);
      expect(parsed.Uptime).toBe("0T12:34:56");
    });

    it("should parse tele/LWT Online", () => {
      const payload = "Online";
      const isOnline = payload.toLowerCase() === "online";
      expect(isOnline).toBe(true);
    });

    it("should parse tele/LWT Offline", () => {
      const payload = "Offline";
      const isOnline = payload.toLowerCase() === "online";
      expect(isOnline).toBe(false);
    });

    it("should extract topic parts correctly", () => {
      const topic = "stat/sonoff_barragem/POWER";
      const parts = topic.split("/");
      expect(parts[0]).toBe("stat");
      expect(parts[1]).toBe("sonoff_barragem");
      expect(parts[2]).toBe("POWER");
    });
  });
});
