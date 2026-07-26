BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('mozy-biblioteca-defecte-v1.9.0')
);

CREATE TABLE IF NOT EXISTS crm.biblioteca_marci (
  id BIGSERIAL PRIMARY KEY,
  nume VARCHAR(80) NOT NULL,
  nume_normalizat VARCHAR(80) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  ordine INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT biblioteca_marci_nume_check
    CHECK (BTRIM(nume) <> ''),
  CONSTRAINT biblioteca_marci_normalizat_check
    CHECK (BTRIM(nume_normalizat) <> ''),
  CONSTRAINT biblioteca_marci_slug_check
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT biblioteca_marci_ordine_check
    CHECK (ordine >= 0),
  CONSTRAINT biblioteca_marci_nume_unique
    UNIQUE (nume_normalizat),
  CONSTRAINT biblioteca_marci_slug_unique
    UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS crm.biblioteca_familii (
  id BIGSERIAL PRIMARY KEY,
  marca_id BIGINT NOT NULL
    REFERENCES crm.biblioteca_marci(id),
  nume VARCHAR(100) NOT NULL,
  nume_normalizat VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  ordine INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT biblioteca_familii_nume_check
    CHECK (BTRIM(nume) <> ''),
  CONSTRAINT biblioteca_familii_normalizat_check
    CHECK (BTRIM(nume_normalizat) <> ''),
  CONSTRAINT biblioteca_familii_slug_check
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT biblioteca_familii_ordine_check
    CHECK (ordine >= 0),
  CONSTRAINT biblioteca_familii_nume_unique
    UNIQUE (marca_id, nume_normalizat),
  CONSTRAINT biblioteca_familii_slug_unique
    UNIQUE (marca_id, slug),
  CONSTRAINT biblioteca_familii_id_marca_unique
    UNIQUE (id, marca_id)
);

CREATE TABLE IF NOT EXISTS crm.biblioteca_modele (
  id BIGSERIAL PRIMARY KEY,
  marca_id BIGINT NOT NULL
    REFERENCES crm.biblioteca_marci(id),
  familie_id BIGINT,
  model VARCHAR(150) NOT NULL,
  model_normalizat VARCHAR(150) NOT NULL,
  descriere TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arhivat_la TIMESTAMPTZ,
  CONSTRAINT biblioteca_modele_model_check
    CHECK (BTRIM(model) <> ''),
  CONSTRAINT biblioteca_modele_normalizat_check
    CHECK (BTRIM(model_normalizat) <> ''),
  CONSTRAINT biblioteca_modele_marca_model_unique
    UNIQUE (marca_id, model_normalizat),
  CONSTRAINT biblioteca_modele_familie_marca_fk
    FOREIGN KEY (familie_id, marca_id)
    REFERENCES crm.biblioteca_familii(id, marca_id)
);

CREATE TABLE IF NOT EXISTS crm.biblioteca_cazuri (
  id BIGSERIAL PRIMARY KEY,
  model_id BIGINT NOT NULL
    REFERENCES crm.biblioteca_modele(id),
  titlu VARCHAR(180) NOT NULL,
  simptom TEXT,
  defect_reclamat TEXT,
  manifestare TEXT,
  diagnostic TEXT,
  cauza_identificata TEXT,
  solutie TEXT,
  masuratori TEXT,
  componente_schimbate TEXT,
  valori_componente TEXT,
  firmware_folosit TEXT,
  cod_placa_baza VARCHAR(180),
  cod_sursa VARCHAR(180),
  cod_tcon VARCHAR(180),
  cod_panou VARCHAR(180),
  cod_sasiu VARCHAR(180),
  alte_coduri TEXT,
  dificultate VARCHAR(30) NOT NULL DEFAULT 'mediu',
  rezultat VARCHAR(30) NOT NULL DEFAULT 'in_cercetare',
  status_verificare VARCHAR(40) NOT NULL DEFAULT 'caz_intern',
  observatii TEXT,
  creat_de_user_id BIGINT NOT NULL
    REFERENCES crm.utilizatori(id),
  actualizat_de_user_id BIGINT NOT NULL
    REFERENCES crm.utilizatori(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arhivat_la TIMESTAMPTZ,
  sters_la TIMESTAMPTZ,
  sters_de_user_id BIGINT
    REFERENCES crm.utilizatori(id),
  CONSTRAINT biblioteca_cazuri_titlu_check
    CHECK (BTRIM(titlu) <> ''),
  CONSTRAINT biblioteca_cazuri_descriere_check
    CHECK (
      NULLIF(BTRIM(COALESCE(simptom, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(defect_reclamat, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(manifestare, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(diagnostic, '')), '') IS NOT NULL
    ),
  CONSTRAINT biblioteca_cazuri_dificultate_check
    CHECK (
      dificultate IN (
        'usor',
        'mediu',
        'dificil',
        'foarte_dificil'
      )
    ),
  CONSTRAINT biblioteca_cazuri_rezultat_check
    CHECK (
      rezultat IN (
        'reparat',
        'nereparabil',
        'solutie_temporara',
        'in_cercetare'
      )
    ),
  CONSTRAINT biblioteca_cazuri_status_check
    CHECK (
      status_verificare IN (
        'caz_intern',
        'confirmat_service',
        'neverificat',
        'arhivat'
      )
    ),
  CONSTRAINT biblioteca_cazuri_arhivare_check
    CHECK (
      (status_verificare = 'arhivat' AND arhivat_la IS NOT NULL)
      OR
      (status_verificare <> 'arhivat' AND arhivat_la IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS crm.biblioteca_atasamente (
  id BIGSERIAL PRIMARY KEY,
  caz_id BIGINT NOT NULL
    REFERENCES crm.biblioteca_cazuri(id),
  tip VARCHAR(20) NOT NULL,
  nume_original VARCHAR(255) NOT NULL,
  nume_stocat VARCHAR(255) NOT NULL,
  cale_relativa VARCHAR(500) NOT NULL,
  thumbnail_cale_relativa VARCHAR(500),
  mime_type VARCHAR(50) NOT NULL,
  dimensiune_bytes BIGINT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  descriere VARCHAR(300),
  incarcat_de_user_id BIGINT NOT NULL
    REFERENCES crm.utilizatori(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sters_la TIMESTAMPTZ,
  sters_de_user_id BIGINT
    REFERENCES crm.utilizatori(id),
  CONSTRAINT biblioteca_atasamente_tip_check
    CHECK (tip IN ('imagine', 'pdf')),
  CONSTRAINT biblioteca_atasamente_mime_check
    CHECK (
      mime_type IN (
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf'
      )
    ),
  CONSTRAINT biblioteca_atasamente_dimensiune_check
    CHECK (
      dimensiune_bytes > 0
      AND dimensiune_bytes <= 41943040
    ),
  CONSTRAINT biblioteca_atasamente_sha_check
    CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT biblioteca_atasamente_cale_check
    CHECK (
      cale_relativa ~ '^[0-9]{4}/caz-[0-9]+/[a-f0-9-]+\.(jpg|png|webp|pdf)$'
    ),
  CONSTRAINT biblioteca_atasamente_thumbnail_check
    CHECK (
      thumbnail_cale_relativa IS NULL
      OR thumbnail_cale_relativa ~
        '^[0-9]{4}/caz-[0-9]+/thumb-[a-f0-9-]+\.webp$'
    ),
  CONSTRAINT biblioteca_atasamente_cale_unique
    UNIQUE (cale_relativa)
);

CREATE TABLE IF NOT EXISTS crm.biblioteca_audit (
  id BIGSERIAL PRIMARY KEY,
  entitate VARCHAR(30) NOT NULL,
  entitate_id BIGINT NOT NULL,
  actiune VARCHAR(40) NOT NULL,
  user_id BIGINT NOT NULL
    REFERENCES crm.utilizatori(id),
  detalii JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT biblioteca_audit_entitate_check
    CHECK (
      entitate IN (
        'marca',
        'familie',
        'model',
        'caz',
        'atasament'
      )
    ),
  CONSTRAINT biblioteca_audit_actiune_check
    CHECK (
      actiune IN (
        'creare',
        'editare',
        'activare',
        'dezactivare',
        'arhivare',
        'restaurare',
        'stergere_logica',
        'incarcare'
      )
    )
);

CREATE INDEX IF NOT EXISTS biblioteca_familii_marca_idx
  ON crm.biblioteca_familii(marca_id, activa, ordine, nume);

CREATE INDEX IF NOT EXISTS biblioteca_modele_marca_idx
  ON crm.biblioteca_modele(marca_id, arhivat_la, model);

CREATE INDEX IF NOT EXISTS biblioteca_modele_familie_idx
  ON crm.biblioteca_modele(familie_id, arhivat_la, model);

CREATE INDEX IF NOT EXISTS biblioteca_cazuri_model_idx
  ON crm.biblioteca_cazuri(model_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS biblioteca_cazuri_rezultat_idx
  ON crm.biblioteca_cazuri(rezultat, updated_at DESC);

CREATE INDEX IF NOT EXISTS biblioteca_cazuri_status_idx
  ON crm.biblioteca_cazuri(status_verificare, updated_at DESC);

CREATE INDEX IF NOT EXISTS biblioteca_cazuri_dificultate_idx
  ON crm.biblioteca_cazuri(dificultate, updated_at DESC);

CREATE INDEX IF NOT EXISTS biblioteca_cazuri_created_idx
  ON crm.biblioteca_cazuri(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS biblioteca_cazuri_updated_idx
  ON crm.biblioteca_cazuri(updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS biblioteca_cazuri_cod_placa_idx
  ON crm.biblioteca_cazuri(cod_placa_baza)
  WHERE cod_placa_baza IS NOT NULL;

CREATE INDEX IF NOT EXISTS biblioteca_cazuri_cod_sasiu_idx
  ON crm.biblioteca_cazuri(cod_sasiu)
  WHERE cod_sasiu IS NOT NULL;

CREATE INDEX IF NOT EXISTS biblioteca_atasamente_caz_idx
  ON crm.biblioteca_atasamente(caz_id, sters_la, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS biblioteca_atasamente_tip_idx
  ON crm.biblioteca_atasamente(tip, created_at DESC)
  WHERE sters_la IS NULL;

CREATE INDEX IF NOT EXISTS biblioteca_audit_entitate_idx
  ON crm.biblioteca_audit(
    entitate,
    entitate_id,
    created_at DESC,
    id DESC
  );

INSERT INTO crm.biblioteca_marci (
  nume,
  nume_normalizat,
  slug,
  ordine
)
VALUES
  ('Samsung', 'samsung', 'samsung', 10),
  ('LG', 'lg', 'lg', 20),
  ('Philips', 'philips', 'philips', 30),
  ('Panasonic', 'panasonic', 'panasonic', 40),
  ('Sony', 'sony', 'sony', 50),
  ('Vortex', 'vortex', 'vortex', 60),
  ('Xiaomi', 'xiaomi', 'xiaomi', 70),
  ('JVC', 'jvc', 'jvc', 80),
  ('Hisense', 'hisense', 'hisense', 90),
  ('Hitachi', 'hitachi', 'hitachi', 100),
  ('TCL', 'tcl', 'tcl', 110),
  ('Sharp', 'sharp', 'sharp', 120),
  ('Toshiba', 'toshiba', 'toshiba', 130),
  ('Horizon', 'horizon', 'horizon', 140),
  ('Star-Light', 'star-light', 'star-light', 150),
  ('Blaupunkt', 'blaupunkt', 'blaupunkt', 160),
  ('Telefunken', 'telefunken', 'telefunken', 170),
  ('Finlux', 'finlux', 'finlux', 180),
  ('Grundig', 'grundig', 'grundig', 190),
  ('Vestel', 'vestel', 'vestel', 200),
  ('Thomson', 'thomson', 'thomson', 210),
  ('Metz', 'metz', 'metz', 220),
  ('Loewe', 'loewe', 'loewe', 230),
  ('Haier', 'haier', 'haier', 240),
  ('Allview', 'allview', 'allview', 250),
  ('Smart Tech', 'smart tech', 'smart-tech', 260),
  ('Nei', 'nei', 'nei', 270),
  ('Orion', 'orion', 'orion', 280),
  ('Akai', 'akai', 'akai', 290),
  ('Daewoo', 'daewoo', 'daewoo', 300),
  ('Altă marcă', 'altă marcă', 'alta-marca', 310)
ON CONFLICT (nume_normalizat) DO NOTHING;

INSERT INTO crm.biblioteca_familii (
  marca_id,
  nume,
  nume_normalizat,
  slug,
  ordine
)
SELECT
  m.id,
  seed.nume,
  seed.nume_normalizat,
  seed.slug,
  seed.ordine
FROM (
  VALUES
    ('samsung', 'Seria 5', 'seria 5', 'seria-5', 10),
    ('samsung', 'Seria 6', 'seria 6', 'seria-6', 20),
    ('samsung', 'Seria 7', 'seria 7', 'seria-7', 30),
    ('samsung', 'QLED', 'qled', 'qled', 40),
    ('samsung', 'Neo QLED', 'neo qled', 'neo-qled', 50),
    ('samsung', 'OLED', 'oled', 'oled', 60),
    ('samsung', 'Alte modele', 'alte modele', 'alte-modele', 999),
    ('lg', 'NanoCell', 'nanocell', 'nanocell', 10),
    ('lg', 'OLED', 'oled', 'oled', 20),
    ('lg', 'QNED', 'qned', 'qned', 30),
    ('lg', 'UHD', 'uhd', 'uhd', 40),
    ('lg', 'Alte modele', 'alte modele', 'alte-modele', 999)
) AS seed(
  marca_normalizata,
  nume,
  nume_normalizat,
  slug,
  ordine
)
JOIN crm.biblioteca_marci m
  ON m.nume_normalizat = seed.marca_normalizata
ON CONFLICT (marca_id, nume_normalizat) DO NOTHING;

INSERT INTO crm.biblioteca_familii (
  marca_id,
  nume,
  nume_normalizat,
  slug,
  ordine
)
SELECT
  m.id,
  'Alte modele',
  'alte modele',
  'alte-modele',
  999
FROM crm.biblioteca_marci m
ON CONFLICT (marca_id, nume_normalizat) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.biblioteca_marci
  TO mozy_crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.biblioteca_familii
  TO mozy_crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.biblioteca_modele
  TO mozy_crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.biblioteca_cazuri
  TO mozy_crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.biblioteca_atasamente
  TO mozy_crm_app;
GRANT SELECT, INSERT
  ON TABLE crm.biblioteca_audit
  TO mozy_crm_app;

GRANT SELECT, USAGE
  ON SEQUENCE crm.biblioteca_marci_id_seq
  TO mozy_crm_app;
GRANT SELECT, USAGE
  ON SEQUENCE crm.biblioteca_familii_id_seq
  TO mozy_crm_app;
GRANT SELECT, USAGE
  ON SEQUENCE crm.biblioteca_modele_id_seq
  TO mozy_crm_app;
GRANT SELECT, USAGE
  ON SEQUENCE crm.biblioteca_cazuri_id_seq
  TO mozy_crm_app;
GRANT SELECT, USAGE
  ON SEQUENCE crm.biblioteca_atasamente_id_seq
  TO mozy_crm_app;
GRANT SELECT, USAGE
  ON SEQUENCE crm.biblioteca_audit_id_seq
  TO mozy_crm_app;

COMMIT;
