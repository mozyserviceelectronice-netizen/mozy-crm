BEGIN;

CREATE TABLE IF NOT EXISTS crm.utilizatori (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  password_hash TEXT NOT NULL,
  activ BOOLEAN NOT NULL DEFAULT TRUE,
  ultima_autentificare_la TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS utilizatori_username_lower_uidx
  ON crm.utilizatori (LOWER(username));

COMMIT;
