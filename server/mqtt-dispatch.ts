/**
 * Shared MQTT dispatch helper.
 *
 * Extraído de routers.ts pra permitir que control-engine.ts importe sem criar
 * ciclo (routers → control-engine → routers).
 */

import { upsertBessState } from "./db";
import { getMqttClient, isMqttConfigured } from "./mqtt-tasmota";

export async function sendMqttCommand(
  siteId: number,
  mqttTopic: string,
  action: "ON" | "OFF",
  context: string = "manual",
): Promise<{ success: boolean; message: string }> {
  if (!isMqttConfigured()) {
    return { success: false, message: "MQTT não configurado no servidor." };
  }
  try {
    const mqtt = getMqttClient();
    const result = await mqtt.sendCommand(mqttTopic, action);
    const deviceState = mqtt.getDeviceState(mqttTopic);
    await upsertBessState(siteId, {
      mqttConnected: mqtt.isConnected,
      sonoffOnline: deviceState?.online ?? false,
    });
    console.log(`[MQTT:${context}] siteId=${siteId}: ${action} → ${result.message}`);
    return result;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[MQTT:${context}] siteId=${siteId}: ${action} failed — ${errMsg}`);
    return { success: false, message: `Falha MQTT: ${errMsg}` };
  }
}
