/**
 * MQTT Tasmota Integration
 * 
 * Connects to the Mosquitto broker on the VPS (92.112.179.225:1883)
 * to send commands and receive status from Sonoff devices with Tasmota firmware.
 * 
 * Tasmota MQTT topic structure:
 *   cmnd/<topic>/POWER  → send ON/OFF commands
 *   stat/<topic>/POWER  → receive power state confirmations
 *   stat/<topic>/RESULT → receive command results
 *   tele/<topic>/STATE  → periodic telemetry (every 300s by default)
 *   tele/<topic>/LWT    → Last Will & Testament (Online/Offline)
 * 
 * This module maintains a persistent connection, tracks device state,
 * polls devices periodically, and syncs real state to the database.
 */

import mqtt from "mqtt";
import { ENV } from "./_core/env";

// ─── Types ──────────────────────────────────────────────────

export interface TasmotaDeviceState {
  online: boolean;
  power: "ON" | "OFF" | "UNKNOWN";
  lastSeen: number;       // epoch ms
  lastCommand: string;
  lastCommandTime: number; // epoch ms
  rssi?: number;
  uptime?: string;
}

interface PendingCommand {
  resolve: (result: { success: boolean; message: string }) => void;
  timeout: ReturnType<typeof setTimeout>;
  action: "ON" | "OFF";
}

/**
 * Callback invoked whenever the real Sonoff state changes (power ON/OFF, online/offline).
 * Used to sync the real device state to the database.
 */
export type OnDeviceStateChangeCallback = (
  deviceTopic: string,
  state: { online: boolean; power: "ON" | "OFF" | "UNKNOWN" },
) => void;

// ─── MQTT Tasmota Client ────────────────────────────────────

class MqttTasmotaClient {
  private client: mqtt.MqttClient | null = null;
  private connected: boolean = false;
  private devices: Map<string, TasmotaDeviceState> = new Map();
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private trackedTopics: Set<string> = new Set();
  private onStateChange: OnDeviceStateChangeCallback | null = null;

  get isConfigured(): boolean {
    return !!(ENV.mqttBrokerHost && ENV.mqttUsername && ENV.mqttPassword);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  getDeviceState(topic: string): TasmotaDeviceState | undefined {
    return this.devices.get(topic);
  }

  getAllDeviceStates(): Map<string, TasmotaDeviceState> {
    return new Map(this.devices);
  }

  /**
   * Register a callback that fires whenever a device's real power state or
   * online status changes. This is used to sync to the database.
   */
  setOnStateChange(cb: OnDeviceStateChangeCallback): void {
    this.onStateChange = cb;
  }

  /**
   * Register a device topic to be polled periodically for its real state.
   * Call this for each site that has an mqttTopic configured.
   */
  trackDevice(topic: string): void {
    this.trackedTopics.add(topic);
  }

  // ── Connection Management ─────────────────────────────

  async connect(): Promise<boolean> {
    if (!this.isConfigured) {
      console.warn("[MQTT] Not configured — broker host, username, or password missing");
      return false;
    }

    if (this.client && this.connected) {
      return true;
    }

    return new Promise((resolve) => {
      try {
        const brokerUrl = `mqtt://${ENV.mqttBrokerHost}:${ENV.mqttBrokerPort}`;
        console.log(`[MQTT] Connecting to ${brokerUrl}...`);

        this.client = mqtt.connect(brokerUrl, {
          username: ENV.mqttUsername,
          password: ENV.mqttPassword,
          clientId: `bess-dashboard-${Date.now()}`,
          clean: true,
          connectTimeout: 10000,
          reconnectPeriod: 5000,
          keepalive: 60,
        });

        this.client.on("connect", () => {
          console.log("[MQTT] Connected to broker");
          this.connected = true;
          this.reconnectAttempts = 0;

          // Subscribe to all Tasmota status topics
          const subscriptions = [
            "stat/+/POWER",
            "stat/+/RESULT",
            "tele/+/STATE",
            "tele/+/LWT",
            "tele/+/SENSOR",
          ];

          for (const topic of subscriptions) {
            this.client!.subscribe(topic, { qos: 1 }, (err) => {
              if (err) console.error(`[MQTT] Subscribe error for ${topic}:`, err);
            });
          }

          // Immediately query all tracked devices on connect
          Array.from(this.trackedTopics).forEach((t) => {
            this.queryStatus(t);
          });

          resolve(true);
        });

        this.client.on("message", (topic, payload) => {
          this.handleMessage(topic, payload.toString());
        });

        this.client.on("error", (err) => {
          console.error("[MQTT] Connection error:", err.message);
          this.connected = false;
        });

        this.client.on("close", () => {
          console.warn("[MQTT] Connection closed");
          this.connected = false;
          this.reconnectAttempts++;
          if (this.reconnectAttempts > this.maxReconnectAttempts) {
            console.error("[MQTT] Max reconnect attempts reached, stopping");
            this.client?.end(true);
          }
        });

        this.client.on("offline", () => {
          console.warn("[MQTT] Client offline");
          this.connected = false;
        });

        // Timeout for initial connection
        setTimeout(() => {
          if (!this.connected) {
            console.warn("[MQTT] Connection timeout");
            resolve(false);
          }
        }, 15000);

      } catch (error) {
        console.error("[MQTT] Connection setup error:", error);
        resolve(false);
      }
    });
  }

  disconnect(): void {
    this.stopPolling();
    if (this.client) {
      this.client.end(true);
      this.client = null;
      this.connected = false;
      console.log("[MQTT] Disconnected");
    }
  }

  // ── Periodic Polling ─────────────────────────────────

  /**
   * Start polling all tracked devices every `intervalMs` (default 30s).
   * Sends cmnd/<topic>/STATE and cmnd/<topic>/POWER to request real state.
   */
  startPolling(intervalMs: number = 30_000): void {
    if (this.pollingInterval) return; // already polling

    console.log(`[MQTT] Starting device polling every ${intervalMs / 1000}s for ${this.trackedTopics.size} device(s)`);

    // Immediate first poll
    this.pollAllDevices();

    this.pollingInterval = setInterval(() => {
      this.pollAllDevices();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log("[MQTT] Polling stopped");
    }
  }

  private pollAllDevices(): void {
    if (!this.client || !this.connected) return;

    Array.from(this.trackedTopics).forEach((topic) => {
      this.queryStatus(topic);
    });

    // Also check for stale devices (no message in 120s → mark offline)
    const now = Date.now();
    Array.from(this.devices.entries()).forEach(([topic, device]) => {
      if (this.trackedTopics.has(topic) && device.online && (now - device.lastSeen) > 120_000) {
        console.warn(`[MQTT] Device ${topic} stale (${Math.round((now - device.lastSeen) / 1000)}s) — marking offline`);
        device.online = false;
        this.notifyStateChange(topic, device);
      }
    });
  }

  // ── Message Handling ──────────────────────────────────

  private handleMessage(topic: string, payload: string): void {
    const parts = topic.split("/");
    if (parts.length < 3) return;

    const prefix = parts[0];  // stat, tele, cmnd
    const deviceTopic = parts[1]; // device topic name
    const suffix = parts[2];  // POWER, RESULT, STATE, LWT, etc.

    // Ensure device entry exists
    if (!this.devices.has(deviceTopic)) {
      this.devices.set(deviceTopic, {
        online: false,
        power: "UNKNOWN",
        lastSeen: Date.now(),
        lastCommand: "",
        lastCommandTime: 0,
      });
    }

    const device = this.devices.get(deviceTopic)!;
    const prevPower = device.power;
    const prevOnline = device.online;
    device.lastSeen = Date.now();

    if (prefix === "stat") {
      if (suffix === "POWER") {
        // Power state confirmation (real state from device)
        const state = payload.toUpperCase().trim();
        if (state === "ON" || state === "OFF") {
          device.power = state;
          device.online = true;

          // Resolve pending command — só confirma sucesso ao ver o estado esperado.
          // Mensagens com o estado anterior (eco de queryStatus em voo, ou echo do Tasmota
          // antes de processar o comando) são ignoradas; deixa o timeout decidir falha.
          const pending = this.pendingCommands.get(deviceTopic);
          if (pending && state === pending.action) {
            clearTimeout(pending.timeout);
            this.pendingCommands.delete(deviceTopic);
            pending.resolve({ success: true, message: `Sonoff ${deviceTopic}: ${state === "ON" ? "LIGADO" : "DESLIGADO"} com sucesso.` });
          }
        }
      } else if (suffix === "RESULT") {
        // Command result (JSON)
        try {
          const result = JSON.parse(payload);
          if (result.POWER) {
            device.power = result.POWER.toUpperCase();
            device.online = true;
          }
        } catch { /* ignore non-JSON */ }
      }
    } else if (prefix === "tele") {
      if (suffix === "LWT") {
        // Last Will & Testament
        device.online = payload.toLowerCase() === "online";
        if (!device.online) {
          console.warn(`[MQTT] Device ${deviceTopic} went OFFLINE (LWT)`);
        }
      } else if (suffix === "STATE") {
        // Periodic telemetry (real state from device)
        device.online = true;
        try {
          const state = JSON.parse(payload);
          if (state.POWER) device.power = state.POWER.toUpperCase();
          if (state.Wifi?.RSSI) device.rssi = state.Wifi.RSSI;
          if (state.Uptime) device.uptime = state.Uptime;
        } catch { /* ignore */ }
      }
    }

    // Notify callback if power or online state changed
    if (device.power !== prevPower || device.online !== prevOnline) {
      this.notifyStateChange(deviceTopic, device);
    }
  }

  /**
   * Fire the onStateChange callback when the real device state changes.
   */
  private notifyStateChange(deviceTopic: string, device: TasmotaDeviceState): void {
    if (this.onStateChange) {
      try {
        this.onStateChange(deviceTopic, {
          online: device.online,
          power: device.power,
        });
      } catch (e) {
        console.error(`[MQTT] onStateChange callback error for ${deviceTopic}:`, e);
      }
    }
  }

  // ── Command Sending ───────────────────────────────────

  async sendCommand(deviceTopic: string, action: "ON" | "OFF"): Promise<{ success: boolean; message: string }> {
    if (!this.client || !this.connected) {
      // Try to connect first
      const connected = await this.connect();
      if (!connected) {
        return { success: false, message: "Não foi possível conectar ao broker MQTT. Verifique a configuração." };
      }
    }

    return new Promise((resolve) => {
      const commandTopic = `cmnd/${deviceTopic}/POWER`;

      // Set up pending command with timeout
      const existingPending = this.pendingCommands.get(deviceTopic);
      if (existingPending) {
        clearTimeout(existingPending.timeout);
        existingPending.resolve({ success: false, message: "Comando anterior cancelado — novo comando enviado." });
      }

      const timeout = setTimeout(() => {
        this.pendingCommands.delete(deviceTopic);
        // Even without confirmation, the command may have been sent
        resolve({
          success: false,
          message: `Timeout: Sonoff ${deviceTopic} não confirmou o comando ${action} em 10s. O dispositivo pode estar offline.`,
        });
      }, 10000);

      this.pendingCommands.set(deviceTopic, { resolve, timeout, action });

      // Update device state tracking
      const device = this.devices.get(deviceTopic) ?? {
        online: false, power: "UNKNOWN", lastSeen: 0, lastCommand: "", lastCommandTime: 0,
      };
      device.lastCommand = action;
      device.lastCommandTime = Date.now();
      this.devices.set(deviceTopic, device);

      // Publish command
      this.client!.publish(commandTopic, action, { qos: 1 }, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingCommands.delete(deviceTopic);
          resolve({ success: false, message: `Erro ao enviar comando: ${err.message}` });
        } else {
          console.log(`[MQTT] Command sent: ${commandTopic} = ${action}`);
        }
      });
    });
  }

  // ── Status Query ──────────────────────────────────────

  async queryStatus(deviceTopic: string): Promise<void> {
    if (!this.client || !this.connected) return;

    // Request current state — Tasmota responds on stat/<topic>/POWER and stat/<topic>/RESULT
    this.client.publish(`cmnd/${deviceTopic}/STATE`, "", { qos: 0 });
    this.client.publish(`cmnd/${deviceTopic}/POWER`, "", { qos: 0 });
  }
}

// ─── Singleton ──────────────────────────────────────────────

let _mqttClient: MqttTasmotaClient | null = null;

export function getMqttClient(): MqttTasmotaClient {
  if (!_mqttClient) {
    _mqttClient = new MqttTasmotaClient();
  }
  return _mqttClient;
}

export function isMqttConfigured(): boolean {
  return !!(ENV.mqttBrokerHost && ENV.mqttUsername && ENV.mqttPassword);
}
