-- Snapshot diário consolidado de operação da bomba.
-- Alimentado por job interno (boot + cron 1x/hora) que agrega bess_actions.
-- Permite gráficos longos sem reprocessar 12 meses de actions a cada query.
CREATE TABLE bess_pump_daily (
  id INT AUTO_INCREMENT PRIMARY KEY,
  siteId INT NOT NULL,
  `date` VARCHAR(10) NOT NULL,
  secondsOn FLOAT NOT NULL DEFAULT 0,
  kwhEstimado FLOAT NOT NULL DEFAULT 0,
  cycles INT NOT NULL DEFAULT 0,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_site_date (siteId, `date`),
  INDEX idx_site_date (siteId, `date`)
);
