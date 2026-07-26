BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('mozy-programari-tehnician-v1.8.0')
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM crm.programari_tehnician
    WHERE fara_interval = TRUE
  ) THEN
    RAISE EXCEPTION
      'Rollback oprit: există programări fără interval.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.programari_tehnician_preturi
    GROUP BY programare_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Rollback oprit: există programări cu prețuri multiple.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.programari_tehnician_preturi
    WHERE descriere IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Rollback oprit: există descrieri de preț care nu încap în schema veche.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.programari_tehnician
    WHERE cost_deplasare IS NOT NULL
       OR conditii_comerciale IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Rollback oprit: există date comerciale noi.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.programari_tehnician_trimiteri
  ) THEN
    RAISE EXCEPTION
      'Rollback oprit: există istoric nou de trimiteri WhatsApp.';
  END IF;
END
$$;

UPDATE crm.programari_tehnician p
SET pret_reparatie = pp.valoare
FROM crm.programari_tehnician_preturi pp
WHERE pp.programare_id = p.id
  AND pp.ordine = 0;

DROP TABLE IF EXISTS
  crm.programari_tehnician_trimiteri_incercari;
DROP TABLE IF EXISTS
  crm.programari_tehnician_trimiteri_destinatari;
DROP TABLE IF EXISTS
  crm.programari_tehnician_trimiteri;
DROP TABLE IF EXISTS
  crm.programari_tehnician_preturi;

ALTER TABLE crm.programari_tehnician
  DROP CONSTRAINT IF EXISTS
    programari_tehnician_cost_deplasare_check,
  DROP CONSTRAINT IF EXISTS
    programari_tehnician_interval_check;

ALTER TABLE crm.programari_tehnician
  ALTER COLUMN ora_programare SET NOT NULL;

ALTER TABLE crm.programari_tehnician
  ADD CONSTRAINT programari_tehnician_interval_check
  CHECK (
    ora_sfarsit IS NULL
    OR ora_sfarsit > ora_programare
  );

ALTER TABLE crm.programari_tehnician
  DROP COLUMN IF EXISTS fara_interval,
  DROP COLUMN IF EXISTS cost_deplasare,
  DROP COLUMN IF EXISTS conditii_comerciale;

COMMIT;
