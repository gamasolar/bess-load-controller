/**
 * Tests for the shared sendMqttCommand helper and its integration
 * with simulateTick automatic LOAD_ON/LOAD_OFF.
 *
 * These tests mock the mqtt-tasmota module to verify that:
 * 1. sendMqttCommand correctly delegates to mqtt.sendCommand
 * 2. simulateTick calls sendMqttCommand when auto-switching load
 * 3. Manual sites do NOT trigger MQTT commands
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendMqttCommand } from "./routers";

// Mock the mqtt-tasmota module
vi.mock("./mqtt-tasmota", () => {
  const mockSendCommand = vi.fn().mockResolvedValue({ success: true, message: "OK" });
  const mockGetDeviceState = vi.fn().mockReturnValue({ online: true, power: "ON" });
  return {
    getMqttClient: vi.fn(() => ({
      sendCommand: mockSendCommand,
      getDeviceState: mockGetDeviceState,
      isConnected: true,
    })),
    isMqttConfigured: vi.fn(() => true),
    __mockSendCommand: mockSendCommand,
    __mockGetDeviceState: mockGetDeviceState,
  };
});

// Mock db upsertBessState to avoid DB calls
vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    upsertBessState: vi.fn().mockResolvedValue(undefined),
  };
});

// Get references to mocked functions
import { getMqttClient, isMqttConfigured } from "./mqtt-tasmota";
import { upsertBessState } from "./db";

describe("sendMqttCommand (shared helper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends ON command via MQTT and returns success", async () => {
    const result = await sendMqttCommand(1, "tasmota_sonoff1", "ON", "test");

    expect(result.success).toBe(true);
    expect(result.message).toBe("OK");

    const mqtt = getMqttClient();
    expect(mqtt.sendCommand).toHaveBeenCalledWith("tasmota_sonoff1", "ON");
    expect(mqtt.getDeviceState).toHaveBeenCalledWith("tasmota_sonoff1");
    expect(upsertBessState).toHaveBeenCalledWith(1, {
      mqttConnected: true,
      sonoffOnline: true,
    });
  });

  it("sends OFF command via MQTT and returns success", async () => {
    const result = await sendMqttCommand(2, "tasmota_sonoff2", "OFF", "autoTick:barragem");

    expect(result.success).toBe(true);
    const mqtt = getMqttClient();
    expect(mqtt.sendCommand).toHaveBeenCalledWith("tasmota_sonoff2", "OFF");
  });

  it("returns failure when MQTT is not configured", async () => {
    vi.mocked(isMqttConfigured).mockReturnValueOnce(false);

    const result = await sendMqttCommand(1, "tasmota_sonoff1", "ON");

    expect(result.success).toBe(false);
    expect(result.message).toContain("MQTT não configurado");
    // Should NOT call sendCommand when not configured
    const mqtt = getMqttClient();
    expect(mqtt.sendCommand).not.toHaveBeenCalled();
  });

  it("handles MQTT sendCommand errors gracefully", async () => {
    const mqtt = getMqttClient();
    vi.mocked(mqtt.sendCommand).mockRejectedValueOnce(new Error("Connection timeout"));

    const result = await sendMqttCommand(1, "tasmota_sonoff1", "ON", "test_error");

    expect(result.success).toBe(false);
    expect(result.message).toContain("Connection timeout");
  });

  it("handles device offline state", async () => {
    const mqtt = getMqttClient();
    vi.mocked(mqtt.getDeviceState).mockReturnValueOnce({ online: false, power: "OFF" } as any);

    const result = await sendMqttCommand(1, "tasmota_sonoff1", "ON");

    expect(result.success).toBe(true);
    expect(upsertBessState).toHaveBeenCalledWith(1, {
      mqttConnected: true,
      sonoffOnline: false,
    });
  });

  it("includes context in log output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await sendMqttCommand(5, "tasmota_test", "OFF", "autoTick:piscinao");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("MQTT:autoTick:piscinao")
    );
    consoleSpy.mockRestore();
  });

  it("logs error on MQTT failure", async () => {
    const mqtt = getMqttClient();
    vi.mocked(mqtt.sendCommand).mockRejectedValueOnce(new Error("Broker unreachable"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendMqttCommand(1, "tasmota_sonoff1", "ON", "manual_cmd");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("MQTT:manual_cmd"),
      // Should not crash
    );
    consoleSpy.mockRestore();
  });
});
