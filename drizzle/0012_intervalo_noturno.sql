-- Adds bess_config.intervaloNoturno: minutes between FusionSolar fetches
-- during the off-hours window [00:00, horarioLiberacao) when the pump is OFF.
-- Default 60 (1 hour) to reduce rate-limit pressure overnight.
ALTER TABLE bess_config
  ADD COLUMN intervaloNoturno INT NOT NULL DEFAULT 60 AFTER intervaloCritico;
