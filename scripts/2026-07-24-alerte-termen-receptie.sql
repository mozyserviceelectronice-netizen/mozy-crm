BEGIN;

ALTER TABLE crm.receptii_atelier
  ADD COLUMN IF NOT EXISTS alerte_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS crm.receptie_alerte_termen (
  id BIGSERIAL PRIMARY KEY,
  receptie_id BIGINT NOT NULL
    REFERENCES crm.receptii_atelier(id) ON DELETE CASCADE,
  prag_zile INTEGER NOT NULL
    CHECK (prag_zile IN (3, 5, 6, 7)),
  trimisa_la TIMESTAMPTZ,
  ultima_incercare_la TIMESTAMPTZ,
  whatsapp_message_id VARCHAR(200),
  ultima_eroare TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (receptie_id, prag_zile)
);

CREATE INDEX IF NOT EXISTS idx_receptii_alerte_active
  ON crm.receptii_atelier (data_primire, status)
  WHERE alerte_active = TRUE;

COMMIT;
