\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
DECLARE
  first_index RECORD;
  second_index RECORD;
BEGIN
  SELECT
    indrelid,
    indkey,
    indclass,
    indcollation,
    indexprs,
    indpred,
    indisunique
  INTO first_index
  FROM pg_index
  WHERE indexrelid =
    to_regclass('crm.documente_legale_un_singur_activ_per_tip');

  SELECT
    indrelid,
    indkey,
    indclass,
    indcollation,
    indexprs,
    indpred,
    indisunique
  INTO second_index
  FROM pg_index
  WHERE indexrelid =
    to_regclass('crm.documente_legale_unul_activ_per_tip_idx');

  IF first_index IS NOT NULL
     AND second_index IS NOT NULL
     AND first_index.indrelid = second_index.indrelid
     AND first_index.indkey = second_index.indkey
     AND first_index.indclass = second_index.indclass
     AND first_index.indcollation = second_index.indcollation
     AND first_index.indexprs::text
       IS NOT DISTINCT FROM second_index.indexprs::text
     AND first_index.indpred::text
       IS NOT DISTINCT FROM second_index.indpred::text
     AND first_index.indisunique = second_index.indisunique
  THEN
    DROP INDEX crm.documente_legale_unul_activ_per_tip_idx;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS clienti_nume_trgm_idx
  ON crm.clienti
  USING gin ((COALESCE(nume, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS clienti_telefon_trgm_idx
  ON crm.clienti
  USING gin ((COALESCE(telefon, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS televizoare_marca_trgm_idx
  ON crm.televizoare
  USING gin ((COALESCE(marca, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS televizoare_model_trgm_idx
  ON crm.televizoare
  USING gin ((COALESCE(model, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS televizoare_serie_trgm_idx
  ON crm.televizoare
  USING gin ((COALESCE(serie, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS fise_service_defect_trgm_idx
  ON crm.fise_service
  USING gin ((COALESCE(defect_reclamat, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS receptii_numar_trgm_idx
  ON crm.receptii_atelier
  USING gin ((COALESCE(numar_receptie, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS echipamente_descriere_trgm_idx
  ON crm.echipamente_atelier
  USING gin ((COALESCE(descriere_echipament, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS echipamente_marca_trgm_idx
  ON crm.echipamente_atelier
  USING gin ((COALESCE(marca, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS echipamente_model_trgm_idx
  ON crm.echipamente_atelier
  USING gin ((COALESCE(model, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS echipamente_serie_trgm_idx
  ON crm.echipamente_atelier
  USING gin ((COALESCE(serie, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS interventii_numar_trgm_idx
  ON crm.interventii_teren
  USING gin ((COALESCE(numar_interventie, '')) gin_trgm_ops);

ANALYZE crm.clienti;
ANALYZE crm.televizoare;
ANALYZE crm.fise_service;
ANALYZE crm.receptii_atelier;
ANALYZE crm.echipamente_atelier;
ANALYZE crm.interventii_teren;
