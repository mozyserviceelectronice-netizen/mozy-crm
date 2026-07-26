BEGIN;

ALTER TABLE crm.certificate_garantie
  ADD COLUMN IF NOT EXISTS receptie_id BIGINT;

ALTER TABLE crm.certificate_garantie
  ALTER COLUMN fisa_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'crm.certificate_garantie'::regclass
      AND conname = 'certificate_garantie_receptie_id_fkey'
  ) THEN
    ALTER TABLE crm.certificate_garantie
      ADD CONSTRAINT certificate_garantie_receptie_id_fkey
      FOREIGN KEY (receptie_id)
      REFERENCES crm.receptii_atelier(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'crm.certificate_garantie'::regclass
      AND conname = 'certificate_garantie_sursa_check'
  ) THEN
    ALTER TABLE crm.certificate_garantie
      ADD CONSTRAINT certificate_garantie_sursa_check
      CHECK (
        (fisa_id IS NOT NULL AND receptie_id IS NULL) OR
        (fisa_id IS NULL AND receptie_id IS NOT NULL)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_certificate_garantie_receptie
  ON crm.certificate_garantie (receptie_id);

CREATE UNIQUE INDEX IF NOT EXISTS
  certificate_garantie_receptie_uidx
  ON crm.certificate_garantie (receptie_id)
  WHERE receptie_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE
  ON crm.certificate_garantie
  TO mozy_crm_app;

COMMIT;
