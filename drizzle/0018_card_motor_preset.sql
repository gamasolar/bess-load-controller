-- Personalização do card por-site (Fase 4 — escopo motor + extensível).
-- Coluna JSON pra abrigar customizações por-site sem precisar de migration por field.
-- Estrutura esperada:
--   {
--     "motorPreset": "C" | "E" | "G" | "I",   // default no frontend = "C"
--     -- futuros campos: bgColor, bgUrl override, widgetVisibility, layoutOrder, etc.
--   }
-- NULL = aplica defaults do frontend.
ALTER TABLE bess_sites
  ADD COLUMN cardCustomization JSON NULL AFTER backgroundUrl;
