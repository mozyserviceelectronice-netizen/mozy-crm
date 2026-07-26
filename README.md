# Mozy CRM

CRM intern pentru Mozy Service Electronice, conectat la schema PostgreSQL `crm`.

## Funcții MVP

- autentificare cu sesiune HTTP-only;
- dashboard operațional;
- fișe service și filtrare;
- detalii client, televizor și conversații;
- actualizarea statusului fișei;
- listă clienți;
- conversații recente și semnalarea celor care necesită răspuns;
- interfață responsive;
- container Docker separat pe `infra_mozy-network`.

## Instalare

1. Copiază `.env.example` în `.env`.
2. Completează parola bazei, secretul sesiunii și hash-ul parolei CRM.
3. Rulează `docker compose up -d --build`.
4. Verifică `curl http://127.0.0.1:3005/health`.
5. Configurează Nginx Proxy Manager către `mozy_crm:3000`.

Nu publica fișierul `.env` și nu îl adăuga în Git.
