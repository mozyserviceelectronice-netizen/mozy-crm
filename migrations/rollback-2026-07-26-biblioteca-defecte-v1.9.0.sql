\set ON_ERROR_STOP on

\if :{?MOZY_CONFIRM_DROP_BIBLIOTECA}
\else
  \echo 'Rollback refuzat: setează MOZY_CONFIRM_DROP_BIBLIOTECA=DA numai după backup.'
  \quit 3
\endif

SELECT CASE
  WHEN :'MOZY_CONFIRM_DROP_BIBLIOTECA' = 'DA' THEN 1
  ELSE CAST('Confirmarea trebuie să fie exact DA' AS INTEGER)
END;

BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('mozy-biblioteca-defecte-v1.9.0')
);

DO $$
DECLARE
  record_count BIGINT;
BEGIN
  SELECT
    COALESCE((SELECT COUNT(*) FROM crm.biblioteca_cazuri), 0)
    + COALESCE((SELECT COUNT(*) FROM crm.biblioteca_atasamente), 0)
  INTO record_count;

  IF record_count > 0 THEN
    RAISE NOTICE
      'Se elimină % înregistrări de caz/atașament după confirmarea explicită.',
      record_count;
  END IF;
END
$$;

DROP TABLE IF EXISTS crm.biblioteca_audit;
DROP TABLE IF EXISTS crm.biblioteca_atasamente;
DROP TABLE IF EXISTS crm.biblioteca_cazuri;
DROP TABLE IF EXISTS crm.biblioteca_modele;
DROP TABLE IF EXISTS crm.biblioteca_familii;
DROP TABLE IF EXISTS crm.biblioteca_marci;

COMMIT;
