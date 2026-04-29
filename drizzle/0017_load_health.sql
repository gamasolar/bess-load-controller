-- Adiciona campos pro load-monitor (Fase 2 do plano "Monitor de Saúde da Bomba").
-- Estado em DB (não memória) sobrevive a restart do serviço.
ALTER TABLE bess_state
  ADD COLUMN loadHealth VARCHAR(16) NULL AFTER socSource,
  ADD COLUMN loadFailureSince TIMESTAMP NULL AFTER loadHealth;
