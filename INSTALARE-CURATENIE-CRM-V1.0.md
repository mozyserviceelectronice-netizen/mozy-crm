# Curățenie CRM și separare WhatsApp — v1.0.0

## Rezultat

- meniul CRM devine: Dashboard, Tehnician teren, Fișe, Clienți, Setări;
- „Recepție atelier” este afișată ca „Fișe”;
- vechile „Fișe domiciliu” și „Conversații” dispar din interfață;
- clienții din listă sunt numai cei legați de o fișă sau o operațiune de teren;
- mesajele și contactele WhatsApp sunt mutate logic într-un registru tehnic
  separat, în schema PostgreSQL `whatsapp`;
- alerta după 30 de minute se păstrează;
- GPT extrage programările, dar nu mai creează sau modifică date în
  `crm.clienti`, `crm.televizoare` ori `crm.fise_service`;
- raportul tehnicianului citește numai programările confirmate din registrul
  separat;
- datele istorice nu sunt șterse.

## Instalarea aplicației și a schemei

Înainte de extragere se face backup pentru fișierele modificate și pentru
schema bazei de date.

```bash
set -e
cd /opt/mozy-crm

tar -czf /opt/mozy-crm-before-curatenie-2026-07-24.tar.gz \
  src/server.js \
  src/views/dashboard.ejs \
  src/views/partials/header.ejs \
  src/views/receptie.ejs \
  src/views/receptie-noua.ejs \
  src/views/receptie-detalii.ejs

docker exec postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema-only' \
  > /opt/mozy-db-schema-before-curatenie-2026-07-24.sql

test -s /opt/mozy-crm-before-curatenie-2026-07-24.tar.gz
test -s /opt/mozy-db-schema-before-curatenie-2026-07-24.sql

tar -xzf /opt/mozy-curatenie-crm-v1.0.0.tar.gz \
  -C /opt/mozy-crm

docker exec -i postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < scripts/2026-07-24-separare-whatsapp-crm.sql

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

Rezultatul final trebuie să fie:

```json
{"status":"ok"}
```

## Înlocuirea workflow-urilor n8n

În n8n importă, dar nu activa încă:

1. `workflows/01-whatsapp-alerte-programari-separat.json`;
2. `workflows/02-alerta-30-minute-separat.json`;
3. `workflows/03-program-tehnician-separat.json`.

În primul workflow:

- selectează credențiala PostgreSQL existentă la toate nodurile PostgreSQL;
- la cele două noduri OpenAI înlocuiește valoarea
  `REPLACE_WITH_ROTATED_OPENAI_KEY` cu cheia nouă;
- cheia OpenAI veche trebuie revocată, deoarece exista în exportul inițial.

În workflow-urile 2 și 3:

- în nodurile de trimitere WhatsApp înlocuiește
  `REPLACE_WITH_EVOLUTION_API_KEY` cu cheia Evolution activă;
- păstrează numerele destinatarilor deja configurate.

Ordinea activării:

1. dezactivează vechiul workflow principal „My workflow”;
2. activează `Mozy WhatsApp - Alerte si programari separate`;
3. dezactivează vechiul workflow de alertă;
4. activează noul workflow de alertă;
5. dezactivează vechiul workflow „Program tehnician”;
6. activează noul workflow pentru program.

Nu lăsa simultan active versiunile vechi și noi, deoarece mesajele pot fi
procesate de două ori.

## Test funcțional

1. Trimite un mesaj incoming de test pe WhatsApp.
2. Verifică faptul că numărul nu apare în tabul `Clienți`.
3. Verifică în PostgreSQL:

```sql
SELECT * FROM whatsapp.contacte ORDER BY id DESC LIMIT 5;
SELECT * FROM whatsapp.mesaje ORDER BY id DESC LIMIT 10;
SELECT * FROM whatsapp.programari ORDER BY id DESC LIMIT 5;
```

4. Trimite o conversație care confirmă explicit data și ora.
5. Verifică faptul că programarea are status `confirmata`.
6. Pentru testul alertei, nu modifica pragul permanent de 30 de minute.

