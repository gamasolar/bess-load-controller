-- DECISION-OVERSHOOT-COMPENSATION (2026-05-07).
-- Adiciona campo de compensação proporcional do overshoot BMS.
-- Default 0 = feature desligada (DECISION-RESPECT-CONFIG puro).
-- Aplicado manualmente, fora do drizzle-kit, seguindo padrão do time.

ALTER TABLE `bess_config` ADD `overshootFactor` float NOT NULL DEFAULT 0;
