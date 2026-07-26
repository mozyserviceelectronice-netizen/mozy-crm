BEGIN;

ALTER TABLE crm.clienti
  ADD COLUMN IF NOT EXISTS creat_din_test BOOLEAN
    NOT NULL DEFAULT FALSE;

ALTER TABLE crm.echipamente_atelier
  ADD COLUMN IF NOT EXISTS este_test BOOLEAN
    NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS test_grup_id UUID;

ALTER TABLE crm.receptii_atelier
  ADD COLUMN IF NOT EXISTS este_test BOOLEAN
    NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS test_grup_id UUID;

ALTER TABLE crm.interventii_teren
  ADD COLUMN IF NOT EXISTS este_test BOOLEAN
    NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS test_grup_id UUID;

ALTER TABLE crm.fise_service
  ADD COLUMN IF NOT EXISTS este_test BOOLEAN
    NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS test_grup_id UUID;

ALTER TABLE crm.certificate_garantie
  ADD COLUMN IF NOT EXISTS este_test BOOLEAN
    NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS test_grup_id UUID;

CREATE INDEX IF NOT EXISTS idx_echipamente_atelier_test_grup
  ON crm.echipamente_atelier (test_grup_id)
  WHERE este_test = TRUE;

CREATE INDEX IF NOT EXISTS idx_receptii_atelier_test_grup
  ON crm.receptii_atelier (test_grup_id)
  WHERE este_test = TRUE;

CREATE INDEX IF NOT EXISTS idx_interventii_teren_test_grup
  ON crm.interventii_teren (test_grup_id)
  WHERE este_test = TRUE;

CREATE INDEX IF NOT EXISTS idx_fise_service_test_grup
  ON crm.fise_service (test_grup_id)
  WHERE este_test = TRUE;

CREATE INDEX IF NOT EXISTS idx_certificate_garantie_test_grup
  ON crm.certificate_garantie (test_grup_id)
  WHERE este_test = TRUE;

CREATE SEQUENCE IF NOT EXISTS crm.numar_receptie_real_seq;
CREATE SEQUENCE IF NOT EXISTS crm.numar_receptie_test_seq;
CREATE SEQUENCE IF NOT EXISTS crm.numar_interventie_real_seq;
CREATE SEQUENCE IF NOT EXISTS crm.numar_interventie_test_seq;
CREATE SEQUENCE IF NOT EXISTS crm.numar_garantie_real_seq;
CREATE SEQUENCE IF NOT EXISTS crm.numar_garantie_test_seq;

DO $$
DECLARE
  valoare BIGINT;
BEGIN
  SELECT COALESCE(MAX(
    CASE
      WHEN numar_receptie ~ '^REC-[0-9]{4}-[0-9]+$'
      THEN SUBSTRING(numar_receptie FROM '([0-9]+)$')::BIGINT
    END
  ), 0)
  INTO valoare
  FROM crm.receptii_atelier
  WHERE este_test = FALSE;

  PERFORM setval(
    'crm.numar_receptie_real_seq',
    GREATEST(valoare, 1),
    valoare > 0
  );

  SELECT COALESCE(MAX(
    CASE
      WHEN numar_receptie ~ '^TEST-REC-[0-9]{4}-[0-9]+$'
      THEN SUBSTRING(numar_receptie FROM '([0-9]+)$')::BIGINT
    END
  ), 0)
  INTO valoare
  FROM crm.receptii_atelier
  WHERE este_test = TRUE;

  PERFORM setval(
    'crm.numar_receptie_test_seq',
    GREATEST(valoare, 1),
    valoare > 0
  );

  SELECT COALESCE(MAX(
    CASE
      WHEN numar_interventie ~ '^TRN-[0-9]{4}-[0-9]+$'
      THEN SUBSTRING(numar_interventie FROM '([0-9]+)$')::BIGINT
    END
  ), 0)
  INTO valoare
  FROM crm.interventii_teren
  WHERE este_test = FALSE;

  PERFORM setval(
    'crm.numar_interventie_real_seq',
    GREATEST(valoare, 1),
    valoare > 0
  );

  SELECT COALESCE(MAX(
    CASE
      WHEN numar_interventie ~ '^TEST-TRN-[0-9]{4}-[0-9]+$'
      THEN SUBSTRING(numar_interventie FROM '([0-9]+)$')::BIGINT
    END
  ), 0)
  INTO valoare
  FROM crm.interventii_teren
  WHERE este_test = TRUE;

  PERFORM setval(
    'crm.numar_interventie_test_seq',
    GREATEST(valoare, 1),
    valoare > 0
  );

  SELECT COALESCE(MAX(
    CASE
      WHEN numar_certificat ~ '^GAR-[0-9]{4}-[0-9]+$'
      THEN SUBSTRING(numar_certificat FROM '([0-9]+)$')::BIGINT
    END
  ), 0)
  INTO valoare
  FROM crm.certificate_garantie
  WHERE este_test = FALSE;

  PERFORM setval(
    'crm.numar_garantie_real_seq',
    GREATEST(valoare, 1),
    valoare > 0
  );

  SELECT COALESCE(MAX(
    CASE
      WHEN numar_certificat ~ '^TEST-GAR-[0-9]{4}-[0-9]+$'
      THEN SUBSTRING(numar_certificat FROM '([0-9]+)$')::BIGINT
    END
  ), 0)
  INTO valoare
  FROM crm.certificate_garantie
  WHERE este_test = TRUE;

  PERFORM setval(
    'crm.numar_garantie_test_seq',
    GREATEST(valoare, 1),
    valoare > 0
  );
END
$$;

CREATE OR REPLACE FUNCTION crm.urmatorul_numar_receptie(
  p_este_test BOOLEAN
)
RETURNS TEXT
LANGUAGE SQL
VOLATILE
AS $$
  SELECT
    CASE WHEN p_este_test THEN 'TEST-REC-' ELSE 'REC-' END ||
    TO_CHAR(
      CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bucharest',
      'YYYY'
    ) ||
    '-' ||
    LPAD(
      nextval(
        CASE
          WHEN p_este_test
          THEN 'crm.numar_receptie_test_seq'::regclass
          ELSE 'crm.numar_receptie_real_seq'::regclass
        END
      )::TEXT,
      CASE WHEN p_este_test THEN 6 ELSE 7 END,
      '0'
    );
$$;

CREATE OR REPLACE FUNCTION crm.urmatorul_numar_interventie(
  p_este_test BOOLEAN
)
RETURNS TEXT
LANGUAGE SQL
VOLATILE
AS $$
  SELECT
    CASE WHEN p_este_test THEN 'TEST-TRN-' ELSE 'TRN-' END ||
    TO_CHAR(
      CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bucharest',
      'YYYY'
    ) ||
    '-' ||
    LPAD(
      nextval(
        CASE
          WHEN p_este_test
          THEN 'crm.numar_interventie_test_seq'::regclass
          ELSE 'crm.numar_interventie_real_seq'::regclass
        END
      )::TEXT,
      6,
      '0'
    );
$$;

CREATE OR REPLACE FUNCTION crm.urmatorul_numar_garantie(
  p_este_test BOOLEAN
)
RETURNS TEXT
LANGUAGE SQL
VOLATILE
AS $$
  SELECT
    CASE WHEN p_este_test THEN 'TEST-GAR-' ELSE 'GAR-' END ||
    TO_CHAR(
      CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bucharest',
      'YYYY'
    ) ||
    '-' ||
    LPAD(
      nextval(
        CASE
          WHEN p_este_test
          THEN 'crm.numar_garantie_test_seq'::regclass
          ELSE 'crm.numar_garantie_real_seq'::regclass
        END
      )::TEXT,
      6,
      '0'
    );
$$;

GRANT EXECUTE ON FUNCTION crm.urmatorul_numar_receptie(BOOLEAN)
  TO mozy_crm_app;
GRANT EXECUTE ON FUNCTION crm.urmatorul_numar_interventie(BOOLEAN)
  TO mozy_crm_app;
GRANT EXECUTE ON FUNCTION crm.urmatorul_numar_garantie(BOOLEAN)
  TO mozy_crm_app;

GRANT USAGE, SELECT
  ON SEQUENCE
    crm.numar_receptie_real_seq,
    crm.numar_receptie_test_seq,
    crm.numar_interventie_real_seq,
    crm.numar_interventie_test_seq,
    crm.numar_garantie_real_seq,
    crm.numar_garantie_test_seq
  TO mozy_crm_app;

COMMIT;
