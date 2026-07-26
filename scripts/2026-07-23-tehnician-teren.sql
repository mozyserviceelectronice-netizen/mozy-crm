BEGIN;

ALTER TABLE crm.receptii_atelier
  ADD COLUMN IF NOT EXISTS sursa_receptie VARCHAR(30)
    NOT NULL DEFAULT 'atelier',
  ADD COLUMN IF NOT EXISTS tehnician_cod VARCHAR(30),
  ADD COLUMN IF NOT EXISTS data_ridicare_teren TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS adresa_ridicare_teren TEXT;

ALTER TABLE crm.receptii_atelier
  DROP CONSTRAINT IF EXISTS receptii_atelier_sursa_check;

ALTER TABLE crm.receptii_atelier
  ADD CONSTRAINT receptii_atelier_sursa_check
  CHECK (sursa_receptie IN ('atelier', 'teren'));

CREATE TABLE IF NOT EXISTS crm.interventii_teren (
  id BIGSERIAL PRIMARY KEY,
  numar_interventie VARCHAR(30) UNIQUE,
  tip_operatiune VARCHAR(30) NOT NULL
    CHECK (tip_operatiune IN (
      'ridicare',
      'reparat_domiciliu',
      'predare_reparat',
      'predare_nereparat'
    )),
  tehnician_cod VARCHAR(30) NOT NULL DEFAULT 'TEHNICIAN-1',
  client_id BIGINT NOT NULL
    REFERENCES crm.clienti(id) ON DELETE RESTRICT,
  echipament_id BIGINT
    REFERENCES crm.echipamente_atelier(id) ON DELETE RESTRICT,
  receptie_id BIGINT
    REFERENCES crm.receptii_atelier(id) ON DELETE RESTRICT,
  fisa_service_id BIGINT
    REFERENCES crm.fise_service(id) ON DELETE SET NULL,
  adresa_interventie TEXT,
  defect_reclamat TEXT,
  constatare_tehnician TEXT,
  interventie_efectuata TEXT,
  piese_folosite TEXT,
  are_accesorii BOOLEAN NOT NULL DEFAULT FALSE,
  accesorii TEXT,
  rezultat_proba VARCHAR(40)
    CHECK (
      rezultat_proba IS NULL OR
      rezultat_proba IN (
        'functional',
        'nereparat',
        'refuz_client',
        'imposibil'
      )
    ),
  motiv_proba TEXT,
  pret_lucrare NUMERIC(12, 2)
    CHECK (pret_lucrare IS NULL OR pret_lucrare >= 0),
  suma_incasata NUMERIC(12, 2)
    CHECK (suma_incasata IS NULL OR suma_incasata >= 0),
  metoda_plata VARCHAR(30)
    CHECK (
      metoda_plata IS NULL OR
      metoda_plata IN ('numerar', 'card', 'transfer', 'neincasat')
    ),
  observatii_interne TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'asteapta_semnare'
    CHECK (status IN (
      'asteapta_semnare',
      'semnat',
      'finalizat',
      'anulat'
    )),
  semnare_token_hash VARCHAR(64),
  semnare_token_creat_la TIMESTAMPTZ,
  semnare_token_expira_la TIMESTAMPTZ,
  semnatura_path TEXT,
  semnatura_sha256 VARCHAR(64),
  semnat_la TIMESTAMPTZ,
  semnatura_ip INET,
  semnatura_user_agent TEXT,
  pdf_path TEXT,
  document_sha256 VARCHAR(64),
  whatsapp_link_message_id VARCHAR(200),
  whatsapp_pdf_message_id VARCHAR(200),
  whatsapp_eroare VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    are_accesorii = FALSE OR
    NULLIF(BTRIM(accesorii), '') IS NOT NULL
  ),
  CHECK (
    semnare_token_hash IS NULL OR
    semnare_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CHECK (
    semnatura_sha256 IS NULL OR
    semnatura_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CHECK (
    document_sha256 IS NULL OR
    document_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_interventii_teren_created
  ON crm.interventii_teren (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_interventii_teren_client
  ON crm.interventii_teren (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_interventii_teren_receptie
  ON crm.interventii_teren (receptie_id)
  WHERE receptie_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_interventii_teren_token
  ON crm.interventii_teren (semnare_token_hash)
  WHERE semnare_token_hash IS NOT NULL;

DO $$
DECLARE
  app_role name;
BEGIN
  FOR app_role IN
    SELECT grantee::name
    FROM information_schema.role_table_grants
    WHERE table_schema = 'crm'
      AND table_name = 'receptii_atelier'
      AND privilege_type = 'SELECT'
      AND grantee <> CURRENT_USER
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON crm.interventii_teren TO %I',
      app_role
    );
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE crm.interventii_teren_id_seq TO %I',
      app_role
    );
  END LOOP;
END;
$$;

COMMIT;
