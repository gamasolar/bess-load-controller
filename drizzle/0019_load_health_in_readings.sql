-- Histórico de loadHealth em cada leitura, pra cruzar "comando ON" (bess_actions)
-- com "bomba realmente operando" (loadHealth=RUNNING_OK). Permite identificar
-- dias onde sistema armou mas softstarter falhou / operador colocou em manual /
-- manutenção, etc. Aplica a TODAS as microrredes (universal).
ALTER TABLE bess_readings
  ADD COLUMN loadHealth VARCHAR(16) NULL AFTER loadPower;
