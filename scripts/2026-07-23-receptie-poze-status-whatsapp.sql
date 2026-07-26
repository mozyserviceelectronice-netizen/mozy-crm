BEGIN;

CREATE TABLE IF NOT EXISTS crm.receptie_fotografii (
  id BIGSERIAL PRIMARY KEY,
  receptie_id BIGINT NOT NULL
    REFERENCES crm.receptii_atelier(id) ON DELETE CASCADE,
  nume_original VARCHAR(255) NOT NULL,
  nume_stocare VARCHAR(255) NOT NULL UNIQUE,
  mime_type VARCHAR(50) NOT NULL
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  dimensiune_bytes BIGINT NOT NULL
    CHECK (dimensiune_bytes > 0 AND dimensiune_bytes <= 12582912),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receptie_fotografii_receptie
  ON crm.receptie_fotografii (receptie_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm.receptie_status_istoric (
  id BIGSERIAL PRIMARY KEY,
  receptie_id BIGINT NOT NULL
    REFERENCES crm.receptii_atelier(id) ON DELETE CASCADE,
  status_vechi VARCHAR(40) NOT NULL,
  status_nou VARCHAR(40) NOT NULL,
  notificare_ceruta BOOLEAN NOT NULL DEFAULT TRUE,
  notificare_trimisa_la TIMESTAMPTZ,
  whatsapp_message_id VARCHAR(200),
  notificare_eroare VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receptie_status_istoric_receptie
  ON crm.receptie_status_istoric (receptie_id, created_at DESC);

ALTER TABLE crm.receptii_atelier
  DROP CONSTRAINT IF EXISTS receptii_atelier_status_check;

ALTER TABLE crm.receptii_atelier
  ADD CONSTRAINT receptii_atelier_status_check
  CHECK (status IN (
    'primit',
    'in_diagnosticare',
    'asteapta_acord',
    'asteapta_piesa',
    'in_reparatie',
    'finalizat',
    'predat',
    'anulat'
  ));

COMMIT;
