-- Adiciona intervaloBombaSemSolar: minutos entre fetches FusionSolar quando
-- a bomba está ON fora da janela de operação. Sem geração solar entrando,
-- a descarga é monodirecional e pode esvaziar a bateria mais rápido que o
-- intervaloPadrao consegue acompanhar.
ALTER TABLE bess_config
  ADD COLUMN intervaloBombaSemSolar INT NOT NULL DEFAULT 5 AFTER intervaloNoturno;
