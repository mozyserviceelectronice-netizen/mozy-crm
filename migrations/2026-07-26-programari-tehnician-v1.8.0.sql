BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('mozy-programari-tehnician-v1.8.0')
);

ALTER TABLE crm.programari_tehnician
  ADD COLUMN IF NOT EXISTS fara_interval BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cost_deplasare NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS conditii_comerciale TEXT;

ALTER TABLE crm.programari_tehnician
  ALTER COLUMN ora_programare DROP NOT NULL;

ALTER TABLE crm.programari_tehnician
  DROP CONSTRAINT IF EXISTS programari_tehnician_interval_check;

ALTER TABLE crm.programari_tehnician
  DROP CONSTRAINT IF EXISTS programari_tehnician_cost_deplasare_check;

ALTER TABLE crm.programari_tehnician
  ADD CONSTRAINT programari_tehnician_interval_check
  CHECK (
    (
      fara_interval = TRUE
      AND ora_programare IS NULL
      AND ora_sfarsit IS NULL
    )
    OR
    (
      fara_interval = FALSE
      AND ora_programare IS NOT NULL
      AND ora_sfarsit IS NOT NULL
      AND ora_sfarsit > ora_programare
    )
  ),
  ADD CONSTRAINT programari_tehnician_cost_deplasare_check
  CHECK (
    cost_deplasare IS NULL
    OR cost_deplasare >= 0
  );

CREATE TABLE IF NOT EXISTS crm.programari_tehnician_preturi (
  id BIGSERIAL PRIMARY KEY,
  programare_id BIGINT NOT NULL
    REFERENCES crm.programari_tehnician(id)
    ON DELETE CASCADE,
  valoare NUMERIC(12,2) NOT NULL,
  descriere VARCHAR(160),
  ordine INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT programari_tehnician_preturi_valoare_check
    CHECK (valoare >= 0),
  CONSTRAINT programari_tehnician_preturi_ordine_check
    CHECK (ordine >= 0),
  CONSTRAINT programari_tehnician_preturi_descriere_check
    CHECK (
      descriere IS NULL
      OR BTRIM(descriere) <> ''
    ),
  CONSTRAINT programari_tehnician_preturi_ordine_unique
    UNIQUE (programare_id, ordine)
);

CREATE INDEX IF NOT EXISTS programari_tehnician_preturi_programare_idx
  ON crm.programari_tehnician_preturi(programare_id, ordine, id);

INSERT INTO crm.programari_tehnician_preturi (
  programare_id,
  valoare,
  descriere,
  ordine
)
SELECT
  p.id,
  p.pret_reparatie,
  NULL,
  0
FROM crm.programari_tehnician p
WHERE NOT EXISTS (
  SELECT 1
  FROM crm.programari_tehnician_preturi pp
  WHERE pp.programare_id = p.id
);

CREATE TABLE IF NOT EXISTS crm.programari_tehnician_trimiteri (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key UUID NOT NULL UNIQUE,
  data_program DATE NOT NULL,
  initiat_de_user_id BIGINT NOT NULL
    REFERENCES crm.utilizatori(id),
  expeditor_membru_cod VARCHAR(40),
  tehnicieni_inclusi TEXT[] NOT NULL DEFAULT '{}',
  programare_ids BIGINT[] NOT NULL,
  numar_programari INTEGER NOT NULL,
  mesaj TEXT NOT NULL,
  continut_sha256 CHAR(64) NOT NULL,
  crm_url TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'in_curs',
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  finalizat_la TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT programari_tehnician_trimiteri_status_check
    CHECK (status IN ('in_curs', 'trimis', 'partial', 'esuat')),
  CONSTRAINT programari_tehnician_trimiteri_numar_check
    CHECK (
      numar_programari > 0
      AND cardinality(programare_ids) = numar_programari
    ),
  CONSTRAINT programari_tehnician_trimiteri_sha_check
    CHECK (continut_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS programari_tehnician_trimiteri_data_idx
  ON crm.programari_tehnician_trimiteri(
    data_program,
    created_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS programari_tehnician_trimiteri_user_idx
  ON crm.programari_tehnician_trimiteri(
    initiat_de_user_id,
    created_at DESC,
    id DESC
  );

CREATE TABLE IF NOT EXISTS
crm.programari_tehnician_trimiteri_destinatari (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL
    REFERENCES crm.programari_tehnician_trimiteri(id)
    ON DELETE CASCADE,
  membru_cod VARCHAR(40) NOT NULL,
  membru_nume VARCHAR(100) NOT NULL,
  numar_normalizat VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  whatsapp_message_id VARCHAR(200),
  eroare_sigura VARCHAR(500),
  numar_incercari INTEGER NOT NULL DEFAULT 0,
  ultima_incercare_la TIMESTAMPTZ,
  trimis_la TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT programari_tehnician_dest_status_check
    CHECK (status IN ('pending', 'in_curs', 'trimis', 'esuat')),
  CONSTRAINT programari_tehnician_dest_numar_check
    CHECK (numar_normalizat ~ '^[0-9]{8,15}$'),
  CONSTRAINT programari_tehnician_dest_incercari_check
    CHECK (numar_incercari >= 0),
  CONSTRAINT programari_tehnician_dest_unique
    UNIQUE (operation_id, numar_normalizat)
);

CREATE INDEX IF NOT EXISTS programari_tehnician_dest_status_idx
  ON crm.programari_tehnician_trimiteri_destinatari(
    operation_id,
    status,
    id
  );

CREATE TABLE IF NOT EXISTS
crm.programari_tehnician_trimiteri_incercari (
  id BIGSERIAL PRIMARY KEY,
  destinatar_id BIGINT NOT NULL
    REFERENCES crm.programari_tehnician_trimiteri_destinatari(id)
    ON DELETE CASCADE,
  numar_incercare INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  whatsapp_message_id VARCHAR(200),
  eroare_sigura VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT programari_tehnician_incercari_status_check
    CHECK (status IN ('trimis', 'esuat')),
  CONSTRAINT programari_tehnician_incercari_numar_check
    CHECK (numar_incercare > 0),
  CONSTRAINT programari_tehnician_incercari_unique
    UNIQUE (destinatar_id, numar_incercare)
);

CREATE INDEX IF NOT EXISTS programari_tehnician_incercari_dest_idx
  ON crm.programari_tehnician_trimiteri_incercari(
    destinatar_id,
    created_at DESC,
    id DESC
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.programari_tehnician_preturi
  TO mozy_crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.programari_tehnician_trimiteri
  TO mozy_crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.programari_tehnician_trimiteri_destinatari
  TO mozy_crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.programari_tehnician_trimiteri_incercari
  TO mozy_crm_app;

GRANT SELECT, USAGE
  ON SEQUENCE crm.programari_tehnician_preturi_id_seq
  TO mozy_crm_app;
GRANT SELECT, USAGE
  ON SEQUENCE crm.programari_tehnician_trimiteri_id_seq
  TO mozy_crm_app;
GRANT SELECT, USAGE
  ON SEQUENCE
    crm.programari_tehnician_trimiteri_destinatari_id_seq
  TO mozy_crm_app;
GRANT SELECT, USAGE
  ON SEQUENCE
    crm.programari_tehnician_trimiteri_incercari_id_seq
  TO mozy_crm_app;

COMMIT;
