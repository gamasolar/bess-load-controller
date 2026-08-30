-- Marca quando o Sonoff foi visto offline pela primeira vez.
-- NULL = dispositivo online (ou nunca avaliado).
-- Base para o alarme SONOFF_OFFLINE (ver server/connectivity-alarm.ts).
ALTER TABLE `bess_state` ADD COLUMN `sonoffOfflineSince` timestamp NULL;
