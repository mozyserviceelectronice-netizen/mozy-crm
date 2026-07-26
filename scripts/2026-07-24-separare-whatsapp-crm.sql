BEGIN;

CREATE SCHEMA IF NOT EXISTS whatsapp;

CREATE TABLE IF NOT EXISTS whatsapp.contacte (
  id BIGSERIAL PRIMARY KEY,
  telefon VARCHAR(30) NOT NULL UNIQUE,
  nume VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whatsapp.mesaje (
  id BIGSERIAL PRIMARY KEY,
  contact_id BIGINT NOT NULL
    REFERENCES whatsapp.contacte(id) ON DELETE CASCADE,
  message_id VARCHAR(255) NOT NULL UNIQUE,
  directie VARCHAR(20) NOT NULL
    CHECK (directie IN ('incoming', 'outgoing')),
  tip VARCHAR(30) NOT NULL DEFAULT 'text',
  mesaj TEXT,
  necesita_raspuns BOOLEAN NOT NULL DEFAULT false,
  alerta_trimisa BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_mesaje_contact_data
  ON whatsapp.mesaje(contact_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_mesaje_alerte
  ON whatsapp.mesaje(created_at)
  WHERE directie = 'incoming'
    AND necesita_raspuns = true
    AND alerta_trimisa = false;

CREATE TABLE IF NOT EXISTS whatsapp.programari (
  id BIGSERIAL PRIMARY KEY,
  contact_id BIGINT NOT NULL
    REFERENCES whatsapp.contacte(id) ON DELETE CASCADE,
  conversation_message_id BIGINT
    REFERENCES whatsapp.mesaje(id) ON DELETE SET NULL,
  data_programare DATE,
  ora_programare TIME,
  adresa TEXT,
  defect_reclamat TEXT,
  marca VARCHAR(100),
  model VARCHAR(150),
  diagonala VARCHAR(30),
  observatii TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'in_asteptare'
    CHECK (
      status IN (
        'in_asteptare',
        'confirmata',
        'anulata',
        'reprogramata'
      )
    ),
  incredere NUMERIC(4,3),
  rezultat_ai JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_whatsapp_programari_mesaj
  ON whatsapp.programari(conversation_message_id)
  WHERE conversation_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_programari_data_status
  ON whatsapp.programari(data_programare, status);

COMMIT;
