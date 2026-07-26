import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { pool, query } from './db.js';
import { generateFieldPdf } from './field-pdf.js';
import { generateClientDeliveryPdf } from './client-delivery-pdf.js';
import {
  sendWhatsAppPdf,
  sendWhatsAppText
} from './evolution-whatsapp.js';

const fieldSignatureDirectory = String(
  process.env.FIELD_SIGNATURES_DIR ||
    '/app/data/semnaturi-teren'
);
const fieldPdfDirectory = String(
  process.env.FIELD_PDF_DIR ||
    '/app/data/pv-teren'
);
const fieldPhotoDirectory = String(
  process.env.FIELD_PHOTOS_DIR ||
    '/app/data/fotografii-teren'
);
const acceptedPhotoTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/octet-stream'
]);

const signedOperations = new Set([
  'ridicare',
  'predare_reparat',
  'predare_nereparat'
]);

const operationLabels = {
  ridicare: 'Ridicare echipament',
  reparat_domiciliu: 'Reparat la domiciliu',
  predare_reparat: 'Predare echipament reparat',
  predare_nereparat: 'Predare echipament nereparat'
};

const fieldTermsVersion = 'TEREN-1.0-2026-07-23';
const fieldTermsText = [
  'TERMENI ȘI CONDIȚII PENTRU OPERAȚIUNI DE TEREN',
  '',
  '1. Clientul confirmă exactitatea datelor din procesul-verbal, predarea sau primirea echipamentului și accesoriilor menționate și situația vizibilă consemnată de tehnician.',
  '',
  '2. Verificarea făcută la adresă este una vizuală și funcțională în limitele permise de starea echipamentului. Ea nu reprezintă o expertiză tehnică exhaustivă. Defectele ascunse sau preexistente, intervențiile anterioare, oxidările, urmele de lichid, componentele degradate și deficiențele care pot fi observate numai după demontare, alimentare, testare ori restabilirea funcționării pot fi constatate ulterior.',
  '',
  '3. Pentru televizoarele cu diagonala de peste 43 inch, clientul este informat înaintea preluării că displayul, sticla internă, foliile și circuitele flexibile sunt foarte fragile. În special la înlocuirea sistemului de iluminare LED, demontarea și remontarea necesită ridicarea și manipularea panoului, operațiuni care pot materializa riscuri de fisurare, apariție a liniilor, petelor, dezlipirilor ori pierderii imaginii din cauza unor vicii ascunse, tensiuni interne, deformări, intervenții anterioare sau degradări preexistente imposibil de identificat rezonabil înaintea demontării. Clientul acceptă efectuarea intervenției în cunoștința acestui risc. Mozy Service nu răspunde pentru materializarea riscului tehnic inerent ori pentru defecte ascunse/preexistente atunci când prejudiciul nu îi este imputabil.',
  '',
  '4. La ridicare, clientul declară dacă echipamentul a fost ambalat de el și, dacă da, dacă ambalarea este corespunzătoare sau insuficientă. Ambalarea corespunzătoare presupune protecție rezonabilă pentru transport, precum cutie rigidă adecvată, material de amortizare, folie cu bule ori protecție echivalentă. Dacă ambalarea realizată de client este insuficientă, Mozy Service nu răspunde pentru deteriorările cauzate direct de această ambalare, inclusiv când societatea pune ulterior la dispoziție o cutie, dacă protecția inițială sau fixarea realizată de client rămâne necorespunzătoare.',
  '',
  '5. Clientul este responsabil să realizeze copii de siguranță înaintea intervenției. Diagnosticarea, repararea, înlocuirea componentelor, resetarea sau actualizarea pot conduce la pierderea datelor, conturilor, aplicațiilor, setărilor, parolelor ori licențelor. Mozy Service nu răspunde pentru pierderi cauzate de defectul inițial, degradarea suportului de stocare, lipsa copiilor de siguranță sau operațiuni tehnice necesare și aprobate, în măsura în care pierderea nu este produsă prin culpa dovedită a service-ului.',
  '',
  '6. Mozy Service nu răspunde pentru evenimente neimputabile, inclusiv vicii ascunse, degradări preexistente, caz fortuit, forță majoră ori fapta clientului sau a unui terț. Nicio clauză nu înlătură răspunderea Mozy Service pentru prejudiciile produse prin culpa sa dovedită și nu limitează drepturile imperative ale consumatorului.'
].join('\n');

const fieldGdprVersion = 'TEREN-GDPR-1.0-2026-07-23';
const fieldGdprText = [
  'INFORMARE PRIVIND PRELUCRAREA DATELOR PERSONALE',
  '',
  'Operatorul este MOZY SERVICE ELECTRONICE SRL, CUI 42090319. Datele de identificare și contact, datele despre echipament, adresa intervenției, semnătura, data și ora, adresa IP și informațiile tehnice ale browserului sunt prelucrate pentru inițierea și executarea serviciului, evidența predării și primirii, comunicarea cu clientul, emiterea documentelor, apărarea drepturilor și îndeplinirea obligațiilor legale.',
  '',
  'Temeiurile prelucrării sunt executarea contractului sau demersurile solicitate înaintea încheierii lui, obligațiile legale și interesul legitim privind securitatea și dovedirea operațiunilor. Datele pot fi transmise furnizorilor tehnici și autorităților numai în măsura necesară. Ele sunt păstrate pe durata raportului contractual și ulterior potrivit termenelor legale ori atât cât este necesar pentru constatarea, exercitarea sau apărarea unui drept.',
  '',
  'Persoana vizată poate solicita accesul, rectificarea, ștergerea sau restricționarea, se poate opune prelucrării în cazurile prevăzute de lege, poate solicita portabilitatea când este aplicabilă și poate depune plângere la ANSPDCP. Confirmarea de mai jos atestă primirea și citirea informării; nu reprezintă un consimțământ general pentru prelucrări care au alt temei legal.'
].join('\n');

const repairedDeliveryTermsVersion =
  'PREDARE-CLIENT-REPARAT-1.0-2026-07-25';
const repairedDeliveryTermsText = [
  'CONDIȚII PENTRU PREDAREA CĂTRE CLIENT A ECHIPAMENTULUI REPARAT',
  '',
  '1. Clientul confirmă că a primit echipamentul și accesoriile înscrise în procesul-verbal și că datele de identificare ale acestora sunt corecte.',
  '',
  '2. Starea funcțională este cea consemnată la rubrica „Rezultatul probei”. Dacă proba a fost efectuată, clientul confirmă rezultatul observat în prezența sa. Dacă a refuzat proba sau aceasta nu a fost posibilă, situația este menționată expres în document.',
  '',
  '3. Predarea ca echipament reparat confirmă remedierea intervenției consemnate și nu reprezintă o certificare a tuturor componentelor ori funcțiilor care nu au făcut obiectul lucrării.',
  '',
  '4. Garanția reparației, atunci când este aplicabilă, este stabilită prin certificatul de garanție emis separat. Prezentul proces-verbal dovedește predarea materială, proba și starea consemnată la momentul predării.',
  '',
  '5. Clientul confirmă că a verificat vizual echipamentul și accesoriile la predare. Orice observație identificabilă în mod rezonabil la acel moment trebuie consemnată în procesul-verbal înaintea semnării.',
  '',
  '6. Pentru televizoarele cu diagonala de peste 43 inch la care s-a solicitat sau efectuat înlocuirea sistemului de iluminare LED, clientul confirmă că a fost informat că demontarea și remontarea ansamblului de afișare implică manipularea unui panou foarte subțire și fragil. Pot apărea fisuri, linii, pete, dezlipiri ale circuitelor flexibile ori pierderea imaginii ca urmare a unor vicii ascunse, tensiuni interne, deformări, intervenții anterioare sau degradări preexistente care nu puteau fi identificate rezonabil înaintea demontării. Mozy Service nu răspunde pentru materializarea acestor riscuri tehnice inerente atunci când prejudiciul nu îi este imputabil.',
  '',
  '7. Semnarea nu limitează drepturile imperative ale consumatorului și nu înlătură răspunderea Mozy Service pentru prejudiciile produse prin culpa sa dovedită.'
].join('\n');

const unrepairedDeliveryTermsVersion =
  'PREDARE-CLIENT-NEREPARAT-1.0-2026-07-25';
const unrepairedDeliveryTermsText = [
  'CONDIȚII PENTRU RESTITUIREA CĂTRE CLIENT A ECHIPAMENTULUI NEREPARAT',
  '',
  '1. Clientul confirmă că a primit echipamentul și accesoriile înscrise în procesul-verbal și că datele de identificare ale acestora sunt corecte.',
  '',
  '2. Echipamentul este restituit fără remedierea defectului reclamat, în starea consemnată la primire, ținând seama de operațiunile tehnice necesare diagnosticării, demontării și reasamblării, dacă acestea au fost efectuate.',
  '',
  '3. Starea funcțională este cea consemnată la rubrica „Rezultatul probei”. Dacă proba nu a fost posibilă ori a fost refuzată, această împrejurare nu echivalează cu o confirmare a funcționării.',
  '',
  '4. Observațiile clientului privind starea vizibilă, accesoriile sau eventualele diferențe față de primire trebuie consemnate înaintea semnării.',
  '',
  '5. Pentru televizoarele cu diagonala de peste 43 inch asupra cărora au fost necesare operațiuni de diagnosticare sau demontare a ansamblului de afișare, clientul confirmă că a fost informat asupra fragilității panoului și asupra riscurilor generate de vicii ascunse, tensiuni interne, deformări, intervenții anterioare ori degradări preexistente. Mozy Service nu răspunde pentru materializarea unor asemenea riscuri tehnice inerente atunci când prejudiciul nu îi este imputabil.',
  '',
  '6. Prezentul proces-verbal dovedește restituirea materială a echipamentului și accesoriilor. Semnarea nu limitează drepturile imperative ale consumatorului și nu înlătură răspunderea Mozy Service pentru prejudiciile produse prin culpa sa dovedită.'
].join('\n');

function termsForOperation(operation) {
  if (operation === 'predare_reparat') {
    return {
      version: repairedDeliveryTermsVersion,
      text: repairedDeliveryTermsText
    };
  }

  if (operation === 'predare_nereparat') {
    return {
      version: unrepairedDeliveryTermsVersion,
      text: unrepairedDeliveryTermsText
    };
  }

  return {
    version: fieldTermsVersion,
    text: fieldTermsText
  };
}

function sha256Text(value) {
  return crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

function publicBaseUrl() {
  return String(
    process.env.CRM_PUBLIC_URL ||
      'https://crm.reparatii-televizoare.com'
  ).replace(/\/+$/, '');
}

function tokenHash(token) {
  return crypto
    .createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

function text(value) {
  return String(value ?? '').trim();
}

function nullIfEmpty(value) {
  const result = text(value);
  return result || null;
}

function numberOrNull(value) {
  const raw = text(value);
  if (!raw) return null;
  const result = Number(raw.replace(',', '.'));
  return Number.isFinite(result) && result >= 0
    ? result
    : undefined;
}

function decodePngSignature(value) {
  const match = String(value || '').match(
    /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/
  );

  if (!match) {
    throw new Error('signature_format');
  }

  const buffer = Buffer.from(match[1], 'base64');

  if (
    buffer.length < 1000 ||
    buffer.length > 500000 ||
    buffer.subarray(0, 8).toString('hex') !==
      '89504e470d0a1a0a'
  ) {
    throw new Error('signature_invalid');
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  if (
    width < 400 ||
    width > 2000 ||
    height < 150 ||
    height > 1000
  ) {
    throw new Error('signature_dimensions');
  }

  return buffer;
}

function signingIp(req) {
  const value = String(
    req.ip || req.socket.remoteAddress || ''
  ).replace(/^::ffff:/, '').trim();

  return /^[0-9a-fA-F:.]{2,64}$/.test(value)
    ? value
    : null;
}

function whatsappError(error) {
  return String(
    error?.message || 'Trimiterea WhatsApp a eșuat.'
  ).slice(0, 500);
}

function safePhotoName(value) {
  let decoded = 'fotografie';

  try {
    decoded = decodeURIComponent(String(value || 'fotografie'));
  } catch {
    decoded = 'fotografie';
  }

  return decoded
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .slice(0, 150) || 'fotografie';
}

function signingMessage(field, url) {
  const label = field.tip_operatiune === 'ridicare'
    ? 'procesul-verbal de preluare'
    : 'procesul-verbal de predare';

  return (
    (field.este_test
      ? 'DOCUMENT DE TEST – FĂRĂ VALOARE\n\n'
      : '') +
    `Bună ziua! ${label} ${field.numar_interventie} ` +
    'este pregătit pentru verificare și semnare:\n\n' +
    `${url}\n\n` +
    'Linkul este valabil 48 de ore.\n' +
    'Mozy Service Electronice'
  );
}

async function fullFieldById(database, id, lock = false) {
  return database.query(`
    SELECT
      i.*,
      c.nume,
      c.telefon,
      c.email,
      c.adresa AS adresa_client,
      e.tip_echipament,
      e.descriere_echipament,
      e.marca,
      e.model,
      e.serie,
      e.diagonala,
      r.numar_receptie,
      r.status AS receptie_status
    FROM crm.interventii_teren i
    JOIN crm.clienti c
      ON c.id = i.client_id
    LEFT JOIN crm.echipamente_atelier e
      ON e.id = i.echipament_id
    LEFT JOIN crm.receptii_atelier r
      ON r.id = i.receptie_id
    WHERE i.id = $1
    ${lock ? 'FOR UPDATE OF i' : ''}
  `, [id]);
}

async function fullFieldByToken(
  database,
  hash,
  lock = false
) {
  return database.query(`
    SELECT
      i.*,
      c.nume,
      c.telefon,
      c.email,
      c.adresa AS adresa_client,
      e.tip_echipament,
      e.descriere_echipament,
      e.marca,
      e.model,
      e.serie,
      e.diagonala,
      r.numar_receptie,
      r.status AS receptie_status
    FROM crm.interventii_teren i
    JOIN crm.clienti c
      ON c.id = i.client_id
    LEFT JOIN crm.echipamente_atelier e
      ON e.id = i.echipament_id
    LEFT JOIN crm.receptii_atelier r
      ON r.id = i.receptie_id
    WHERE i.semnare_token_hash = $1
    ${lock ? 'FOR UPDATE OF i' : ''}
  `, [hash]);
}

function unavailableReason(field) {
  if (field.status === 'semnat') {
    return 'Procesul-verbal a fost deja semnat.';
  }

  if (field.status === 'anulat') {
    return 'Intervenția a fost anulată.';
  }

  if (
    !field.semnare_token_expira_la ||
    new Date(field.semnare_token_expira_la) <= new Date()
  ) {
    return 'Linkul a expirat. Solicită un link nou.';
  }

  return null;
}

async function openReceptions() {
  return query(`
    SELECT
      r.id,
      r.numar_receptie,
      r.este_test,
      r.test_grup_id,
      r.defect_reclamat,
      c.nume,
      c.telefon,
      e.tip_echipament,
      e.marca,
      e.model,
      e.serie
    FROM crm.receptii_atelier r
    JOIN crm.clienti c ON c.id = r.client_id
    JOIN crm.echipamente_atelier e
      ON e.id = r.echipament_id
    WHERE r.status NOT IN ('predat', 'anulat')
    ORDER BY r.data_primire DESC, r.id DESC
    LIMIT 250
  `);
}

async function sendSigningLink(field) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = tokenHash(token);

  await query(`
    UPDATE crm.interventii_teren
    SET
      semnare_token_hash = $2,
      semnare_token_creat_la = NOW(),
      semnare_token_expira_la =
        NOW() + INTERVAL '48 hours',
      status = 'asteapta_semnare',
      updated_at = NOW()
    WHERE id = $1
  `, [field.id, hash]);

  const url = `${publicBaseUrl()}/semnare-teren/${token}`;

  try {
    const sent = await sendWhatsAppText({
      number: field.telefon,
      text: signingMessage(field, url)
    });

    await query(`
      UPDATE crm.interventii_teren
      SET
        whatsapp_link_message_id = $2,
        whatsapp_eroare = NULL,
        updated_at = NOW()
      WHERE id = $1
    `, [field.id, sent.messageId]);

    return { sent: true };
  } catch (error) {
    const message = whatsappError(error);

    await query(`
      UPDATE crm.interventii_teren
      SET whatsapp_eroare = $2, updated_at = NOW()
      WHERE id = $1
    `, [field.id, message]);

    return { sent: false, error: message };
  }
}

export function registerFieldRoutes(
  app,
  requireAuth,
  signingLimiter
) {
  app.get('/teren', requireAuth, async (req, res, next) => {
    try {
      const q = text(req.query.q).slice(0, 100);
      const pattern = `%${q}%`;
      const result = await query(`
        SELECT
          i.id,
          i.numar_interventie,
          i.este_test,
          i.tip_operatiune,
          i.tehnician_cod,
          i.status,
          i.created_at,
          i.receptie_id,
          i.fisa_service_id,
          c.nume,
          c.telefon,
          e.tip_echipament,
          e.marca,
          e.model,
          r.numar_receptie
        FROM crm.interventii_teren i
        JOIN crm.clienti c ON c.id = i.client_id
        LEFT JOIN crm.echipamente_atelier e
          ON e.id = i.echipament_id
        LEFT JOIN crm.receptii_atelier r
          ON r.id = i.receptie_id
        WHERE COALESCE(i.context_operatiune, 'teren') = 'teren'
          AND (
          $1 = '' OR
          COALESCE(i.numar_interventie, '') ILIKE $2 OR
          COALESCE(c.nume, '') ILIKE $2 OR
          COALESCE(c.telefon, '') ILIKE $2 OR
          COALESCE(e.marca, '') ILIKE $2 OR
          COALESCE(e.model, '') ILIKE $2 OR
          COALESCE(r.numar_receptie, '') ILIKE $2
        )
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT 250
      `, [q, pattern]);

      res.render('teren', {
        rows: result.rows,
        q,
        testSters: req.query.test_sters === '1',
        operationLabels,
        active: 'teren'
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/teren/noua',
    requireAuth,
    async (req, res, next) => {
      try {
        const receptions = await openReceptions();

        res.render('teren-noua', {
          error: null,
          values: {
            este_test: req.query.este_test === '1',
            tip_operatiune: text(
              req.query.tip_operatiune || 'ridicare'
            ),
            receptie_id: text(req.query.receptie_id),
            rezultat_proba: text(req.query.rezultat_proba),
            context_operatiune:
              req.query.context_operatiune === 'atelier'
                ? 'atelier'
                : 'teren',
            tehnician_cod:
              req.query.context_operatiune === 'atelier'
                ? 'RECEPTIE'
                : text(req.query.tehnician_cod) || 'TEHNICIAN-1'
          },
          receptii: receptions.rows,
          active:
            req.query.context_operatiune === 'atelier'
              ? 'receptie'
              : 'teren'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/teren/noua',
    requireAuth,
    async (req, res, next) => {
      const values = {
        este_test: req.body.este_test === 'on',
        tip_operatiune: text(req.body.tip_operatiune),
        context_operatiune:
          req.body.context_operatiune === 'atelier'
            ? 'atelier'
            : 'teren',
        tehnician_cod:
          text(req.body.tehnician_cod) || 'TEHNICIAN-1',
        receptie_id: text(req.body.receptie_id),
        nume: text(req.body.nume),
        telefon: text(req.body.telefon),
        email: text(req.body.email),
        adresa: text(req.body.adresa),
        tip_echipament: text(req.body.tip_echipament),
        descriere_echipament: text(
          req.body.descriere_echipament
        ),
        marca: text(req.body.marca),
        model: text(req.body.model),
        serie: text(req.body.serie),
        pret_estimat_reparatie: text(
          req.body.pret_estimat_reparatie
        ),
        defect_reclamat: text(req.body.defect_reclamat),
        constatare_tehnician: text(
          req.body.constatare_tehnician
        ),
        interventie_efectuata: text(
          req.body.interventie_efectuata
        ),
        are_accesorii: text(req.body.are_accesorii),
        accesorii: text(req.body.accesorii),
        ambalat_de_client: text(req.body.ambalat_de_client),
        stare_ambalaj: text(req.body.stare_ambalaj),
        rezultat_proba: text(req.body.rezultat_proba),
        motiv_proba: text(req.body.motiv_proba),
        pret_reparatie: text(req.body.pret_reparatie),
        metoda_plata: text(req.body.metoda_plata),
        observatii_interne: text(
          req.body.observatii_interne
        )
      };

      const allowedOperations = Object.keys(operationLabels);
      const isDelivery = values.tip_operatiune.startsWith(
        'predare_'
      );
      const price = numberOrNull(values.pret_reparatie);
      const estimatedPrice = numberOrNull(
        values.pret_estimat_reparatie
      );
      let validationError = null;

      if (!allowedOperations.includes(values.tip_operatiune)) {
        validationError = 'Selectează operațiunea.';
      } else if (isDelivery && !/^\d+$/.test(values.receptie_id)) {
        validationError =
          'Selectează fișa din atelier care se predă.';
      } else if (
        values.context_operatiune === 'atelier' &&
        !isDelivery
      ) {
        validationError =
          'Contextul atelier poate fi folosit numai pentru predarea către client.';
      } else if (
        !isDelivery &&
        (!values.telefon ||
          !values.tip_echipament ||
          !values.defect_reclamat)
      ) {
        validationError =
          'Telefonul, echipamentul și defectul sunt obligatorii.';
      } else if (
        values.are_accesorii === 'da' &&
        !values.accesorii
      ) {
        validationError = 'Descrie accesoriile.';
      } else if (
        values.tip_operatiune === 'ridicare' &&
        !['da', 'nu'].includes(values.ambalat_de_client)
      ) {
        validationError =
          'Selectează dacă echipamentul a fost ambalat de client.';
      } else if (
        values.tip_operatiune === 'ridicare' &&
        values.ambalat_de_client === 'da' &&
        !['corespunzator', 'insuficient'].includes(
          values.stare_ambalaj
        )
      ) {
        validationError =
          'Selectează dacă ambalarea clientului este corespunzătoare sau insuficientă.';
      } else if (
        values.tip_operatiune === 'reparat_domiciliu' &&
        !values.interventie_efectuata
      ) {
        validationError = 'Descrie lucrarea efectuată.';
      } else if (
        isDelivery &&
        ![
          'functional',
          'nereparat',
          'refuz_client',
          'imposibil'
        ].includes(values.rezultat_proba)
      ) {
        validationError = 'Selectează rezultatul probei.';
      } else if (
        (values.rezultat_proba === 'imposibil' ||
          values.rezultat_proba === 'refuz_client') &&
        !values.motiv_proba
      ) {
        validationError =
          'Completează motivul pentru situația probei.';
      } else if (
        price === undefined ||
        estimatedPrice === undefined
      ) {
        validationError = 'Sumele introduse nu sunt valide.';
      }

      if (validationError) {
        try {
          const receptions = await openReceptions();
          return res.status(400).render('teren-noua', {
            error: validationError,
            values,
            receptii: receptions.rows,
            active:
              values.context_operatiune === 'atelier'
                ? 'receptie'
                : 'teren'
          });
        } catch (error) {
          return next(error);
        }
      }

      const client = await pool.connect();
      let fieldId;

      try {
        await client.query('BEGIN');

        let clientId;
        let equipmentId;
        let receptionId = null;
        let serviceSheetId = null;
        let phone = values.telefon;
        let testGroupId = values.este_test
          ? crypto.randomUUID()
          : null;

        if (isDelivery) {
          const reception = await client.query(`
            SELECT
              r.id,
              r.client_id,
              r.echipament_id,
              r.defect_reclamat,
              r.are_accesorii,
              r.accesorii,
              r.este_test,
              r.test_grup_id,
              c.telefon,
              c.adresa
            FROM crm.receptii_atelier r
            JOIN crm.clienti c ON c.id = r.client_id
            WHERE r.id = $1
              AND r.este_test = $2
              AND r.status NOT IN ('predat', 'anulat')
            FOR UPDATE OF r
          `, [
            Number(values.receptie_id),
            values.este_test
          ]);

          if (!reception.rowCount) {
            await client.query('ROLLBACK');
            const receptions = await openReceptions();
            return res.status(400).render('teren-noua', {
              error:
                'Fișa selectată nu există sau este deja închisă.',
              values,
              receptii: receptions.rows,
              active:
                values.context_operatiune === 'atelier'
                  ? 'receptie'
                  : 'teren'
            });
          }

          const selected = reception.rows[0];
          clientId = selected.client_id;
          equipmentId = selected.echipament_id;
          receptionId = selected.id;
          testGroupId = selected.test_grup_id;
          phone = selected.telefon;
          values.telefon = phone;
          values.adresa = values.adresa || selected.adresa || '';
          values.defect_reclamat =
            values.defect_reclamat ||
            selected.defect_reclamat ||
            '';
          values.are_accesorii = selected.are_accesorii
            ? 'da'
            : 'nu';
          values.accesorii = selected.accesorii || '';

          if (values.tip_operatiune === 'predare_reparat') {
            const sheet = await client.query(`
              INSERT INTO crm.fise_service (
                client_id,
                defect_reclamat,
                pret_agreat,
                adresa_interventie,
                observatii,
                status,
                este_test,
                test_grup_id
              )
              VALUES (
                $1, $2, $3, $4, $5, 'finalizata',
                $6, $7::uuid
              )
              RETURNING id
            `, [
              clientId,
              nullIfEmpty(values.defect_reclamat),
              price,
              nullIfEmpty(values.adresa),
              nullIfEmpty(
                `Lucrare teren: ${values.interventie_efectuata}`
              ),
              values.este_test,
              testGroupId
            ]);
            serviceSheetId = sheet.rows[0].id;
          }
        } else {
          const customer = await client.query(`
            INSERT INTO crm.clienti (
              telefon,
              nume,
              email,
              adresa,
              creat_din_test,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            ON CONFLICT (telefon)
            DO UPDATE SET
              nume = CASE
                WHEN $5 THEN crm.clienti.nume
                ELSE COALESCE(EXCLUDED.nume, crm.clienti.nume)
              END,
              email = CASE
                WHEN $5 THEN crm.clienti.email
                ELSE COALESCE(EXCLUDED.email, crm.clienti.email)
              END,
              adresa = CASE
                WHEN $5 THEN crm.clienti.adresa
                ELSE COALESCE(EXCLUDED.adresa, crm.clienti.adresa)
              END,
              creat_din_test = CASE
                WHEN $5 THEN crm.clienti.creat_din_test
                ELSE FALSE
              END,
              updated_at = CURRENT_TIMESTAMP
            RETURNING id
          `, [
            values.telefon,
            nullIfEmpty(values.nume),
            nullIfEmpty(values.email),
            nullIfEmpty(values.adresa),
            values.este_test
          ]);
          clientId = customer.rows[0].id;

          const equipment = await client.query(`
            INSERT INTO crm.echipamente_atelier (
              client_id,
              tip_echipament,
              descriere_echipament,
              marca,
              model,
              serie,
              este_test,
              test_grup_id
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8::uuid
            )
            RETURNING id
          `, [
            clientId,
            values.tip_echipament,
            nullIfEmpty(values.descriere_echipament),
            nullIfEmpty(values.marca),
            nullIfEmpty(values.model),
            nullIfEmpty(values.serie),
            values.este_test,
            testGroupId
          ]);
          equipmentId = equipment.rows[0].id;

          if (values.tip_operatiune === 'ridicare') {
            const reception = await client.query(`
              INSERT INTO crm.receptii_atelier (
                client_id,
                echipament_id,
                defect_reclamat,
                are_accesorii,
                accesorii,
                observatii,
                pret_estimat_reparatie,
                sursa_receptie,
                tehnician_cod,
                data_ridicare_teren,
                adresa_ridicare_teren,
                este_test,
                test_grup_id
              )
              VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                'teren', $8, NOW(), $9, $10, $11::uuid
              )
              RETURNING id
            `, [
              clientId,
              equipmentId,
              values.defect_reclamat,
              values.are_accesorii === 'da',
              values.are_accesorii === 'da'
                ? values.accesorii
                : null,
              'Echipament ridicat de la client, nu adus personal la sediu.',
              estimatedPrice,
              values.tehnician_cod,
              nullIfEmpty(values.adresa),
              values.este_test,
              testGroupId
            ]);
            receptionId = reception.rows[0].id;

            await client.query(`
              UPDATE crm.receptii_atelier
              SET
                numar_receptie =
                  crm.urmatorul_numar_receptie(este_test),
                updated_at = NOW()
              WHERE id = $1
            `, [receptionId]);
          } else {
            const sheet = await client.query(`
              INSERT INTO crm.fise_service (
                client_id,
                defect_reclamat,
                pret_agreat,
                adresa_interventie,
                observatii,
                status,
                este_test,
                test_grup_id
              )
              VALUES (
                $1, $2, $3, $4, $5, 'finalizata',
                $6, $7::uuid
              )
              RETURNING id
            `, [
              clientId,
              values.defect_reclamat,
              price,
              nullIfEmpty(values.adresa),
              nullIfEmpty(
                `Reparat la domiciliu. ${values.interventie_efectuata}`
              ),
              values.este_test,
              testGroupId
            ]);
            serviceSheetId = sheet.rows[0].id;
          }
        }

        const initialStatus = signedOperations.has(
          values.tip_operatiune
        )
          ? 'asteapta_semnare'
          : 'finalizat';

        const inserted = await client.query(`
          INSERT INTO crm.interventii_teren (
            tip_operatiune,
            context_operatiune,
            tehnician_cod,
            client_id,
            echipament_id,
            receptie_id,
            fisa_service_id,
            adresa_interventie,
            defect_reclamat,
            pret_estimat_reparatie,
            constatare_tehnician,
            interventie_efectuata,
            piese_folosite,
            are_accesorii,
            accesorii,
            ambalat_de_client,
            stare_ambalaj,
            rezultat_proba,
            motiv_proba,
            pret_lucrare,
            suma_incasata,
            metoda_plata,
            observatii_interne,
            status,
            este_test,
            test_grup_id
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26::uuid
          )
          RETURNING id
        `, [
          values.tip_operatiune,
          values.context_operatiune,
          values.tehnician_cod,
          clientId,
          equipmentId,
          receptionId,
          serviceSheetId,
          nullIfEmpty(values.adresa),
          nullIfEmpty(values.defect_reclamat),
          estimatedPrice,
          nullIfEmpty(values.constatare_tehnician),
          nullIfEmpty(values.interventie_efectuata),
          null,
          values.are_accesorii === 'da',
          values.are_accesorii === 'da'
            ? values.accesorii
            : null,
          values.tip_operatiune === 'ridicare'
            ? values.ambalat_de_client === 'da'
            : null,
          values.tip_operatiune === 'ridicare' &&
          values.ambalat_de_client === 'da'
            ? values.stare_ambalaj
            : null,
          nullIfEmpty(values.rezultat_proba),
          nullIfEmpty(values.motiv_proba),
          price,
          price,
          nullIfEmpty(values.metoda_plata),
          nullIfEmpty(values.observatii_interne),
          initialStatus,
          values.este_test,
          testGroupId
        ]);

        fieldId = inserted.rows[0].id;

        await client.query(`
          UPDATE crm.interventii_teren
          SET
            numar_interventie =
              crm.urmatorul_numar_interventie(este_test),
            updated_at = NOW()
          WHERE id = $1
        `, [fieldId]);

        await client.query('COMMIT');

        const created = await fullFieldById(pool, fieldId);
        const field = created.rows[0];

        if (signedOperations.has(values.tip_operatiune)) {
          const sent = await sendSigningLink({
            ...field,
            telefon: phone
          });
          if (values.context_operatiune === 'atelier') {
            return res.redirect(
              `/receptie/${receptionId}?predare_creata=1&whatsapp_predare=${
                sent.sent ? 'trimis' : 'eroare'
              }#procese-verbale`
            );
          }
          return res.redirect(
            `/teren/${fieldId}?created=1&whatsapp=${
              sent.sent ? 'trimis' : 'eroare'
            }`
          );
        }

        return res.redirect(`/teren/${fieldId}?created=1`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        next(error);
      } finally {
        client.release();
      }
    }
  );

  app.get(
    '/teren/:id',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
          return res.status(404).send(
            'Intervenție inexistentă'
          );
        }

        const result = await fullFieldById(pool, id);

        if (!result.rowCount) {
          return res.status(404).send(
            'Intervenție inexistentă'
          );
        }

        const photos = await query(`
          SELECT
            id,
            nume_original,
            dimensiune_bytes,
            latime,
            inaltime,
            created_at
          FROM crm.interventie_teren_fotografii
          WHERE interventie_id = $1
          ORDER BY created_at DESC, id DESC
        `, [id]);

        let documenteSemnate = [];

        if (result.rows[0].receptie_id) {
          const documents = await query(`
            SELECT
              'receptie'::text AS categorie,
              r.id,
              r.numar_receptie AS numar_document,
              'Proces-verbal de primire în service'::text AS denumire,
              r.semnat_la,
              '/receptie/' || r.id || '/pdf' AS url
            FROM crm.receptii_atelier r
            WHERE r.id = $1
              AND r.semnare_status = 'semnat'
              AND r.pdf_path IS NOT NULL

            UNION ALL

            SELECT
              'operatiune'::text AS categorie,
              i.id,
              i.numar_interventie AS numar_document,
              CASE i.tip_operatiune
                WHEN 'ridicare' THEN 'Proces-verbal de preluare de la client'
                WHEN 'predare_reparat' THEN 'Proces-verbal de predare — reparat'
                WHEN 'predare_nereparat' THEN 'Proces-verbal de restituire — nereparat'
                ELSE 'Proces-verbal operațiune'
              END AS denumire,
              i.semnat_la,
              '/teren/' || i.id || '/pdf' AS url
            FROM crm.interventii_teren i
            WHERE i.receptie_id = $1
              AND i.status = 'semnat'
              AND i.pdf_path IS NOT NULL

            ORDER BY semnat_la DESC NULLS LAST, id DESC
          `, [result.rows[0].receptie_id]);
          documenteSemnate = documents.rows;
        } else if (
          result.rows[0].status === 'semnat' &&
          result.rows[0].pdf_path
        ) {
          documenteSemnate = [{
            categorie: 'operatiune',
            id: result.rows[0].id,
            numar_document: result.rows[0].numar_interventie,
            denumire:
              operationLabels[result.rows[0].tip_operatiune] ||
              'Proces-verbal operațiune',
            semnat_la: result.rows[0].semnat_la,
            url: `/teren/${result.rows[0].id}/pdf`
          }];
        }

        res.render('teren-detalii', {
          field: result.rows[0],
          fotografii: photos.rows,
          documenteSemnate,
          operationLabels,
          created: req.query.created === '1',
          whatsapp: text(req.query.whatsapp),
          photoError: text(req.query.photo_error),
          active:
            result.rows[0].context_operatiune === 'atelier'
              ? 'receptie'
              : 'teren'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/teren/:id/fotografii',
    requireAuth,
    (req, res, next) => {
      if (!acceptedPhotoTypes.has(String(req.get('content-type') || '').split(';')[0])) {
        return res.status(415).json({
          error: 'Sunt acceptate numai fotografii JPEG, PNG, WEBP, HEIC sau HEIF.'
        });
      }

      return express.raw({ limit: '15mb', type: '*/*' })(req, res, next);
    },
    async (req, res, next) => {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(404).json({ error: 'Intervenție inexistentă.' });
      }

      let filePath;

      try {
        const fieldResult = await fullFieldById(pool, id);
        const field = fieldResult.rows[0];

        if (!field) {
          return res.status(404).json({ error: 'Intervenție inexistentă.' });
        }

        if (field.tip_operatiune !== 'ridicare') {
          return res.status(409).json({
            error: 'Fotografiile se pot adăuga numai la o operațiune de ridicare.'
          });
        }

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          return res.status(400).json({ error: 'Fotografia este goală.' });
        }

        const count = await query(`
          SELECT COUNT(*)::integer AS total
          FROM crm.interventie_teren_fotografii
          WHERE interventie_id = $1
        `, [id]);

        if (count.rows[0].total >= 20) {
          return res.status(409).json({
            error: 'O fișă poate avea maximum 20 de fotografii.'
          });
        }

        const image = sharp(req.body, {
          failOn: 'error',
          limitInputPixels: 40_000_000
        }).rotate();
        const metadata = await image.metadata();

        if (!metadata.width || !metadata.height) {
          return res.status(415).json({ error: 'Fișierul nu este o fotografie validă.' });
        }

        await fs.mkdir(fieldPhotoDirectory, { recursive: true });
        const storageName = `${id}-${crypto.randomUUID()}.webp`;
        filePath = path.join(fieldPhotoDirectory, storageName);

        const info = await image
          .resize({
            width: 1600,
            height: 1600,
            fit: 'inside',
            withoutEnlargement: true
          })
          .webp({ quality: 78, effort: 4 })
          .toFile(filePath);

        const inserted = await query(`
          INSERT INTO crm.interventie_teren_fotografii (
            interventie_id,
            nume_original,
            nume_stocare,
            mime_type,
            dimensiune_bytes,
            latime,
            inaltime
          )
          VALUES ($1, $2, $3, 'image/webp', $4, $5, $6)
          RETURNING id
        `, [
          id,
          safePhotoName(req.get('X-File-Name')),
          storageName,
          info.size,
          info.width,
          info.height
        ]);

        return res.status(201).json({
          id: inserted.rows[0].id,
          size: info.size
        });
      } catch (error) {
        if (filePath) {
          await fs.unlink(filePath).catch(() => {});
        }

        if (['Input buffer contains unsupported image format', 'Input file contains unsupported image format'].includes(error?.message)) {
          return res.status(415).json({ error: 'Formatul fotografiei nu este acceptat.' });
        }

        next(error);
      }
    }
  );

  app.get(
    '/teren/:id/fotografii/:photoId',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const photoId = Number(req.params.photoId);
        const result = await query(`
          SELECT nume_stocare
          FROM crm.interventie_teren_fotografii
          WHERE id = $1 AND interventie_id = $2
        `, [photoId, id]);

        if (!result.rowCount) {
          return res.status(404).send('Fotografie inexistentă');
        }

        const root = `${path.resolve(fieldPhotoDirectory)}${path.sep}`;
        const filePath = path.resolve(
          fieldPhotoDirectory,
          result.rows[0].nume_stocare
        );

        if (!filePath.startsWith(root)) {
          return res.status(409).send('Cale fotografie nevalidă');
        }

        await fs.access(filePath);
        res.set('Cache-Control', 'private, max-age=86400');
        res.type('image/webp');
        return res.sendFile(filePath);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return res.status(404).send('Fișier fotografie inexistent');
        }
        next(error);
      }
    }
  );

  app.post(
    '/teren/:id/fotografii/:photoId/sterge',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const photoId = Number(req.params.photoId);
        const result = await query(`
          DELETE FROM crm.interventie_teren_fotografii
          WHERE id = $1 AND interventie_id = $2
          RETURNING nume_stocare
        `, [photoId, id]);

        if (result.rowCount) {
          const filePath = path.resolve(
            fieldPhotoDirectory,
            result.rows[0].nume_stocare
          );
          const root = `${path.resolve(fieldPhotoDirectory)}${path.sep}`;

          if (filePath.startsWith(root)) {
            await fs.unlink(filePath).catch(() => {});
          }
        }

        return res.redirect(`/teren/${id}#fotografii`);
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/teren/:id/link-semnare',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const result = await fullFieldById(pool, id);

        if (!result.rowCount) {
          return res.status(404).send(
            'Intervenție inexistentă'
          );
        }

        const field = result.rows[0];

        if (
          field.status === 'semnat' ||
          !signedOperations.has(field.tip_operatiune)
        ) {
          return res.redirect(`/teren/${id}`);
        }

        const sent = await sendSigningLink(field);
        return res.redirect(
          `/teren/${id}?whatsapp=${
            sent.sent ? 'trimis' : 'eroare'
          }`
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/semnare-teren/:token',
    signingLimiter,
    async (req, res, next) => {
      try {
        const hash = tokenHash(req.params.token);
        const result = await fullFieldByToken(pool, hash);

        if (!result.rowCount) {
          return res.status(404).render(
            'semnare-teren-indisponibila',
            { reason: 'Linkul nu este valid.' }
          );
        }

        const field = result.rows[0];
        const reason = unavailableReason(field);
        const operationTerms = termsForOperation(
          field.tip_operatiune
        );

        if (reason) {
          return res.status(410).render(
            'semnare-teren-indisponibila',
            { reason }
          );
        }

        res.render('semnare-teren', {
          field,
          operationLabels,
          fieldTermsVersion: operationTerms.version,
          fieldTermsText: operationTerms.text,
          fieldGdprVersion,
          fieldGdprText,
          error: null
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/semnare-teren/:token',
    signingLimiter,
    async (req, res, next) => {
      const hash = tokenHash(req.params.token);
      const client = await pool.connect();
      let signaturePath = null;
      let pdfPath = null;
      let committed = false;

      try {
        const signature = decodePngSignature(
          req.body.semnatura_data
        );

        if (
          req.body.confirmare_pv !== 'da' ||
          req.body.termeni_acceptati !== 'da' ||
          req.body.informare_gdpr_confirmata !== 'da'
        ) {
          throw new Error('confirmation_required');
        }

        await client.query('BEGIN');
        const result = await fullFieldByToken(
          client,
          hash,
          true
        );

        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).render(
            'semnare-teren-indisponibila',
            { reason: 'Linkul nu este valid.' }
          );
        }

        const field = result.rows[0];
        const reason = unavailableReason(field);
        const operationTerms = termsForOperation(
          field.tip_operatiune
        );

        if (reason) {
          await client.query('ROLLBACK');
          return res.status(410).render(
            'semnare-teren-indisponibila',
            { reason }
          );
        }

        await fs.mkdir(fieldSignatureDirectory, {
          recursive: true,
          mode: 0o750
        });
        signaturePath = path.join(
          fieldSignatureDirectory,
          `teren-${field.id}-${crypto.randomUUID()}.png`
        );
        await fs.writeFile(signaturePath, signature, {
          flag: 'wx',
          mode: 0o600
        });
        const signatureSha = crypto
          .createHash('sha256')
          .update(signature)
          .digest('hex');
        const ipAddress = signingIp(req);
        const userAgent =
          text(req.get('user-agent')).slice(0, 1000) || null;
        const termsSha = sha256Text(operationTerms.text);
        const gdprSha = sha256Text(fieldGdprText);

        const updated = await client.query(`
          UPDATE crm.interventii_teren
          SET
            pv_confirmat = TRUE,
            termeni_acceptati = TRUE,
            informare_gdpr_confirmata = TRUE,
            termeni_versiune = $6,
            termeni_text = $7,
            termeni_sha256 = $8,
            informare_gdpr_versiune = $9,
            informare_gdpr_text = $10,
            informare_gdpr_sha256 = $11,
            semnatura_path = $2,
            semnatura_sha256 = $3,
            semnat_la = NOW(),
            semnatura_ip = $4,
            semnatura_user_agent = $5,
            status = 'semnat',
            updated_at = NOW()
          WHERE id = $1
          RETURNING semnat_la
        `, [
          field.id,
          signaturePath,
          signatureSha,
          ipAddress,
          userAgent,
          operationTerms.version,
          operationTerms.text,
          termsSha,
          fieldGdprVersion,
          fieldGdprText,
          gdprSha
        ]);

        const finalField = {
          ...field,
          semnatura_path: signaturePath,
          semnatura_sha256: signatureSha,
          semnat_la: updated.rows[0].semnat_la,
          semnatura_ip: ipAddress,
          semnatura_user_agent: userAgent,
          pv_confirmat: true,
          termeni_acceptati: true,
          informare_gdpr_confirmata: true,
          termeni_versiune: operationTerms.version,
          termeni_text: operationTerms.text,
          termeni_sha256: termsSha,
          informare_gdpr_versiune: fieldGdprVersion,
          informare_gdpr_text: fieldGdprText,
          informare_gdpr_sha256: gdprSha,
          status: 'semnat'
        };

        await fs.mkdir(fieldPdfDirectory, {
          recursive: true,
          mode: 0o750
        });
        pdfPath = path.join(
          fieldPdfDirectory,
          `${finalField.numar_interventie}.pdf`
        );
        if (
          finalField.tip_operatiune === 'predare_reparat' ||
          finalField.tip_operatiune === 'predare_nereparat'
        ) {
          await generateClientDeliveryPdf(finalField, pdfPath);
        } else {
          await generateFieldPdf(finalField, pdfPath);
        }
        const pdfBuffer = await fs.readFile(pdfPath);
        const documentSha = crypto
          .createHash('sha256')
          .update(pdfBuffer)
          .digest('hex');

        await client.query(`
          UPDATE crm.interventii_teren
          SET
            pdf_path = $2,
            document_sha256 = $3,
            updated_at = NOW()
          WHERE id = $1
        `, [field.id, pdfPath, documentSha]);

        if (
          field.tip_operatiune === 'predare_reparat' ||
          field.tip_operatiune === 'predare_nereparat'
        ) {
          await client.query(`
            INSERT INTO crm.receptie_status_istoric (
              receptie_id,
              status_vechi,
              status_nou,
              notificare_ceruta
            )
            VALUES ($1, $2, 'predat', FALSE)
          `, [field.receptie_id, field.receptie_status]);

          await client.query(`
            UPDATE crm.receptii_atelier
            SET status = 'predat', updated_at = NOW()
            WHERE id = $1
          `, [field.receptie_id]);
        }

        await client.query('COMMIT');
        committed = true;

        try {
          const sent = await sendWhatsAppPdf({
            number: finalField.telefon,
            filePath: pdfPath,
            fileName: `${finalField.numar_interventie}.pdf`,
            caption:
              (finalField.este_test
                ? 'DOCUMENT DE TEST – FĂRĂ VALOARE\n'
                : '') +
              `Proces-verbal semnat ${finalField.numar_interventie} - ` +
              'Mozy Service Electronice'
          });

          await query(`
            UPDATE crm.interventii_teren
            SET
              whatsapp_pdf_message_id = $2,
              whatsapp_eroare = NULL,
              updated_at = NOW()
            WHERE id = $1
          `, [field.id, sent.messageId]);
        } catch (error) {
          await query(`
            UPDATE crm.interventii_teren
            SET whatsapp_eroare = $2, updated_at = NOW()
            WHERE id = $1
          `, [field.id, whatsappError(error)]);
        }

        return res.render('semnare-teren-succes', {
          field: finalField
        });
      } catch (error) {
        if (!committed) {
          await client.query('ROLLBACK').catch(() => {});
        }

        if (
          error.message === 'signature_format' ||
          error.message === 'signature_invalid' ||
          error.message === 'signature_dimensions' ||
          error.message === 'confirmation_required'
        ) {
          const result = await fullFieldByToken(pool, hash);

          if (result.rowCount) {
            const operationTerms = termsForOperation(
              result.rows[0].tip_operatiune
            );
            return res.status(400).render('semnare-teren', {
              field: result.rows[0],
              operationLabels,
              fieldTermsVersion: operationTerms.version,
              fieldTermsText: operationTerms.text,
              fieldGdprVersion,
              fieldGdprText,
              error:
                'Confirmă procesul-verbal, termenii și informarea GDPR, apoi trasează semnătura completă în chenar.'
            });
          }
        }

        if (!committed && pdfPath) {
          await fs.unlink(pdfPath).catch(() => {});
        }
        if (!committed && signaturePath) {
          await fs.unlink(signaturePath).catch(() => {});
        }
        next(error);
      } finally {
        client.release();
      }
    }
  );

  app.get(
    '/teren/:id/pdf',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const result = await fullFieldById(pool, id);

        if (!result.rowCount || !result.rows[0].pdf_path) {
          return res.status(404).send('PDF inexistent');
        }

        const field = result.rows[0];
        await fs.access(field.pdf_path);
        const fileName = `${field.numar_interventie}.pdf`;

        res.set('Cache-Control', 'private, no-store');
        if (req.query.download === '1') {
          return res.download(field.pdf_path, fileName);
        }

        res.set('Content-Type', 'application/pdf');
        res.set(
          'Content-Disposition',
          `inline; filename="${fileName}"`
        );
        return res.sendFile(field.pdf_path);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return res.status(404).send('PDF inexistent');
        }
        next(error);
      }
    }
  );

  app.get(
    '/teren/:id/eticheta',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const result = await fullFieldById(pool, id);

        if (!result.rowCount) {
          return res.status(404).send(
            'Intervenție inexistentă'
          );
        }

        const field = result.rows[0];

        if (
          field.tip_operatiune !== 'ridicare' ||
          field.status !== 'semnat' ||
          !field.receptie_id
        ) {
          return res.status(409).send(
            'Eticheta devine disponibilă după semnarea PV-ului de preluare.'
          );
        }

        const qrDataUrl = await QRCode.toDataURL(
          `${publicBaseUrl()}/receptie/${field.receptie_id}`,
          {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 320
          }
        );

        res.render('teren-eticheta', {
          field,
          qrDataUrl
        });
      } catch (error) {
        next(error);
      }
    }
  );
}
