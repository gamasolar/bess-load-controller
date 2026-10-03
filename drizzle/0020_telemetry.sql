-- Telemetria completa por equipamento (2026-10-03).
-- Camada separada do controle da bomba: guarda o pacote bruto de cada
-- equipamento (inversor, bateria, planta, estação), de qualquer fonte
-- (FusionSolar ou Modbus TCP), sem descartar campos. Só cria tabelas novas.
-- Aplicado manualmente, fora do drizzle-kit, seguindo o padrão do time.

CREATE TABLE IF NOT EXISTS `telemetry_devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `siteId` int NOT NULL,
  `source` enum('fusionsolar','modbus') NOT NULL,
  `externalId` varchar(64) NOT NULL,
  `kind` varchar(24) NOT NULL,
  `devTypeId` int NULL,
  `name` varchar(128) NULL,
  `model` varchar(64) NULL,
  `serial` varchar(64) NULL,
  `firmware` varchar(64) NULL,
  `meta` json NULL,
  `firstSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastSeenAt` timestamp NULL,
  `lastSampleAt` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `telemetry_devices_source_external` (`source`, `externalId`),
  KEY `telemetry_devices_site` (`siteId`)
);

CREATE TABLE IF NOT EXISTS `telemetry_samples` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `deviceId` int NOT NULL,
  `collectedAt` timestamp NOT NULL,
  `receivedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `data` json NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `telemetry_samples_device_time` (`deviceId`, `collectedAt`)
);
