-- Adds lat/lng to bess_sites — usados pra integração de clima (Open-Meteo) e
-- futuras integrações (mapa, irradiância solar histórica, etc.).
ALTER TABLE bess_sites
  ADD COLUMN lat FLOAT NULL AFTER backgroundUrl,
  ADD COLUMN lng FLOAT NULL AFTER lat;
