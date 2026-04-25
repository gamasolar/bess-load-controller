/**
 * Centralized environment configuration for the self-hosted BESS dashboard.
 *
 * `cookieSecret` is reused as the JWT signing key (driven by JWT_SECRET).
 * The legacy field name is kept so existing call sites continue to work.
 */

export const ENV = {
  // Auth: HMAC secret used to sign session JWTs.
  cookieSecret: process.env.JWT_SECRET ?? "",

  // Database: MySQL 8 connection string.
  databaseUrl: process.env.DATABASE_URL ?? "",

  // Runtime mode.
  isProduction: process.env.NODE_ENV === "production",

  // FusionSolar Northbound API.
  fusionsolarBaseUrl:
    process.env.FUSIONSOLAR_BASE_URL ??
    "https://la5.fusionsolar.huawei.com/thirdData",
  fusionsolarUsername: process.env.FUSIONSOLAR_USERNAME ?? "",
  fusionsolarSystemCode: process.env.FUSIONSOLAR_SYSTEM_CODE ?? "",

  // MQTT Broker (Mosquitto on the self-hosted infra).
  mqttBrokerHost: process.env.MQTT_BROKER_HOST ?? "",
  mqttBrokerPort: parseInt(process.env.MQTT_BROKER_PORT ?? "1883", 10),
  mqttUsername: process.env.MQTT_USERNAME ?? "",
  mqttPassword: process.env.MQTT_PASSWORD ?? "",
};
