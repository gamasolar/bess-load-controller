-- Adds bess_sites.backgroundUrl: optional URL of an uploaded image
-- (served from /storage/sites/<uuid>.<ext>) used as background of the
-- plant card on the dashboard. Admin-uploaded via /api/admin/sites/:id/background.
ALTER TABLE bess_sites
  ADD COLUMN backgroundUrl VARCHAR(512) NULL AFTER fusionsolarPlantCode;
