ALTER TABLE crm.receptii_atelier
  ADD COLUMN IF NOT EXISTS whatsapp_link_trimis_la TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_link_message_id TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_pdf_trimis_la TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_pdf_message_id TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_ultima_incercare_la TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_ultima_eroare TEXT;
