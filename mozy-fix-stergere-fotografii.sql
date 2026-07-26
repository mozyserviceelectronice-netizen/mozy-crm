BEGIN;

GRANT DELETE
ON TABLE crm.receptie_fotografii
TO mozy_crm_app;

DO $$
BEGIN
  IF NOT has_table_privilege(
    'mozy_crm_app',
    'crm.receptie_fotografii',
    'DELETE'
  ) THEN
    RAISE EXCEPTION
      'Dreptul DELETE nu a fost acordat utilizatorului mozy_crm_app';
  END IF;
END
$$;

COMMIT;
