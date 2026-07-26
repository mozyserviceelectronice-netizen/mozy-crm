BEGIN;

CREATE TABLE IF NOT EXISTS crm.interventie_teren_fotografii (
  id BIGSERIAL PRIMARY KEY,
  interventie_id BIGINT NOT NULL
    REFERENCES crm.interventii_teren(id) ON DELETE CASCADE,
  nume_original VARCHAR(200) NOT NULL,
  nume_stocare VARCHAR(200) NOT NULL UNIQUE,
  mime_type VARCHAR(50) NOT NULL DEFAULT 'image/webp'
    CHECK (mime_type = 'image/webp'),
  dimensiune_bytes BIGINT NOT NULL
    CHECK (dimensiune_bytes > 0),
  latime INTEGER NOT NULL
    CHECK (latime > 0),
  inaltime INTEGER NOT NULL
    CHECK (inaltime > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interventie_teren_fotografii
  ON crm.interventie_teren_fotografii (
    interventie_id,
    created_at DESC
  );

DO $$
DECLARE
  app_role name;
BEGIN
  FOR app_role IN
    SELECT grantee::name
    FROM information_schema.role_table_grants
    WHERE table_schema = 'crm'
      AND table_name = 'interventii_teren'
      AND privilege_type = 'SELECT'
      AND grantee <> CURRENT_USER
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON crm.interventie_teren_fotografii TO %I',
      app_role
    );
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE crm.interventie_teren_fotografii_id_seq TO %I',
      app_role
    );
  END LOOP;
END;
$$;

COMMIT;
