\set ON_ERROR_STOP on

DROP INDEX IF EXISTS crm.clienti_nume_trgm_idx;
DROP INDEX IF EXISTS crm.clienti_telefon_trgm_idx;
DROP INDEX IF EXISTS crm.televizoare_marca_trgm_idx;
DROP INDEX IF EXISTS crm.televizoare_model_trgm_idx;
DROP INDEX IF EXISTS crm.televizoare_serie_trgm_idx;
DROP INDEX IF EXISTS crm.fise_service_defect_trgm_idx;
DROP INDEX IF EXISTS crm.receptii_numar_trgm_idx;
DROP INDEX IF EXISTS crm.echipamente_descriere_trgm_idx;
DROP INDEX IF EXISTS crm.echipamente_marca_trgm_idx;
DROP INDEX IF EXISTS crm.echipamente_model_trgm_idx;
DROP INDEX IF EXISTS crm.echipamente_serie_trgm_idx;
DROP INDEX IF EXISTS crm.interventii_numar_trgm_idx;

CREATE UNIQUE INDEX IF NOT EXISTS
  documente_legale_unul_activ_per_tip_idx
ON crm.documente_legale (tip)
WHERE activ = TRUE;
