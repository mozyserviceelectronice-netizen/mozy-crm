BEGIN;

ALTER TABLE crm.receptii_atelier
  ADD COLUMN IF NOT EXISTS recenzie_trimisa_la TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recenzie_ultima_incercare_la TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recenzie_whatsapp_message_id VARCHAR(200),
  ADD COLUMN IF NOT EXISTS recenzie_ultima_eroare TEXT;

COMMIT;
