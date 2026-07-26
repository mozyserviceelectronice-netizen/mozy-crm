# Modul Tehnician teren - instalare

Pachetul este un overlay pentru instalarea existentă din
`/opt/mozy-crm`. Nu șterge baza de date și nu înlocuiește directorul
`data`.

## 1. Copiere pe server

Din PowerShell, pe PC:

```powershell
scp "$env:USERPROFILE\Downloads\mozy-tehnician-teren-v1.0.0.tar.gz" root@185.104.183.207:/opt/
ssh root@185.104.183.207
```

## 2. Backup și extragere

Pe server:

```bash
cd /opt/mozy-crm

tar -czf /opt/mozy-crm-backup-before-teren.tar.gz \
  --exclude='./data' \
  package.json package-lock.json public src scripts

tar -xzf /opt/mozy-tehnician-teren-v1.0.0.tar.gz \
  -C /opt/mozy-crm
```

## 3. Migrarea bazei de date

```bash
cd /opt/mozy-crm

docker exec -i postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < scripts/2026-07-23-tehnician-teren.sql
```

Rezultatul trebuie să se termine cu `COMMIT`.

## 4. Verificare și reconstruire

```bash
cd /opt/mozy-crm

docker compose config --quiet
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3005/health
```

Rezultatul final al verificării trebuie să fie:

```json
{"status":"ok"}
```

## 5. Test funcțional controlat

1. Deschide CRM și intră în `Tehnician teren`.
2. Creează o operațiune `Ridicare echipament de la client`.
3. Verifică apariția automată a fișei în `Recepție atelier`, cu marcajul
   `RIDICAT DE PE TEREN`.
4. Deschide linkul primit pe WhatsApp și semnează PV-ul.
5. Verifică primirea PDF-ului pe WhatsApp.
6. Revino în intervenție și deschide `Tipărește eticheta TV`.
7. Scanează QR-ul și confirmă că deschide fișa corectă după autentificare.

Nu folosi datele unui client real la primul test.
