# Mozy CRM — garanție din Recepție atelier

## Conținut

- `src/warranty-routes.js`
- `src/server.js`
- `src/views/garantie-form.ejs`
- `src/views/receptie-detalii.ejs`
- `scripts/2026-07-24-garantie-receptie.sql`

## Instalare

Comenzile se rulează pe server, după încărcarea arhivei în `/opt/`.

```bash
set -e
cd /opt/mozy-crm

tar -czf /opt/mozy-crm-before-garantie-receptie-2026-07-24.tar.gz \
  src/warranty-routes.js \
  src/server.js \
  src/views/garantie-form.ejs \
  src/views/receptie-detalii.ejs

docker exec postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -t crm.certificate_garantie' \
  > /opt/certificate-garantie-before-receptie-2026-07-24.sql

test -s /opt/mozy-crm-before-garantie-receptie-2026-07-24.tar.gz
test -s /opt/certificate-garantie-before-receptie-2026-07-24.sql

tar -xzf /opt/mozy-garantie-receptie-v1.0.0.tar.gz \
  -C /opt/mozy-crm

docker exec -i postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < scripts/2026-07-24-garantie-receptie.sql

docker run --rm \
  -v /opt/mozy-crm:/work \
  -w /work \
  node:22-alpine \
  node --check src/warranty-routes.js

docker run --rm \
  -v /opt/mozy-crm:/work \
  -w /work \
  node:22-alpine \
  node --check src/server.js

docker compose config --quiet
docker compose up -d --build
docker compose ps

curl --retry 15 \
  --retry-delay 2 \
  --retry-all-errors \
  -fsS http://127.0.0.1:3005/health
```

Răspunsul final trebuie să fie:

```json
{"status":"ok"}
```

## Test funcțional

1. Deschide o recepție de test.
2. Schimbă statusul în `Finalizat`.
3. Apasă `Emite garanție`.
4. Completează intervenția, piesele, prețul și durata.
5. Emite certificatul.
6. Descarcă PDF-ul și verifică aspectul.
7. Apasă `Trimite pe WhatsApp`.
8. Confirmă primirea și data trimiterii afișată în CRM.

