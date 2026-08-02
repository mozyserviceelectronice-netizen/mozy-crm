import 'dotenv/config';
import express from 'express';
import {
  receiveWhatsAppMedia
} from './whatsapp-media.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { pool, query } from './db.js';
import {
  contentSecurityPolicy,
  csrfProtection,
  nonceMiddleware
} from './security.js';
import {
  logError,
  requestLogging
} from './request-logging.js';
import {
  processReceptionDeadlineAlerts
} from './reception-alerts.js';
import { registerWarrantyRoutes } from './warranty-routes.js';
import { registerFieldRoutes } from './field-routes.js';
import { registerTechnicianScheduleRoutes } from './technician-schedule-routes.js';
import { registerMaintenanceRoutes } from './maintenance-routes.js';
import { registerReceptionLabelRoutes } from './reception-label-routes.js';
import { registerTestModeRoutes } from './test-mode-routes.js';
import { registerTechnicalSheetRoutes } from './technical-sheet-routes.js';
import { registerServiceDocumentRoutes } from './service-document-routes.js';
import { registerWhatsAppCrmRoutes } from './whatsapp-crm-routes.js';
import {
  defectLibraryDashboardData,
  registerDefectLibraryRoutes
} from './defect-library-routes.js';
import { generateReceptionPdf } from './reception-pdf.js';
import {
  sendWhatsAppPdf,
  sendWhatsAppText
} from './evolution-whatsapp.js';
import {
  clearSession,
  createSession,
  hashPassword,
  requireAuth,
  safeLoginReturnTo,
  validCredentials
} from './auth.js';
import { crmPublicUrl } from './app-config.js';
import {
  buildReceptionListUrl,
  escapeLikePattern,
  normalizeReceptionFilter,
  normalizeReceptionPage,
  normalizeReceptionSearch,
  receptionActiveStatuses,
  receptionFilterTabs,
  receptionPageSize,
  receptionSearchWhereSql,
  receptionStatuses,
  receptionStatusWhereSql,
  receptionStatusLabels,
  safeReceptionReturnTo
} from './reception-filters.js';

const requiredEnv = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'CRM_ADMIN_USER',
  'CRM_ADMIN_PASSWORD_HASH'
];

for (const name of requiredEnv) {
  if (!process.env[name]) {
    throw new Error(`Lipse\u0219te variabila ${name}`);
  }
}

const app = express();
const port = Number(process.env.PORT || 3000);

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', new URL('./views', import.meta.url).pathname);

app.use(express.urlencoded({
  extended: false,
  limit: '700kb'
}));
app.post(
  '/internal/whatsapp-media',
  express.json({
    limit: '70mb',
    type: 'application/json'
  }),
  receiveWhatsAppMedia
);

app.use(cookieParser());
app.use(nonceMiddleware);
app.use(contentSecurityPolicy());
app.use(requestLogging);
app.use(csrfProtection);
app.use(express.static(
  new URL('../public', import.meta.url).pathname,
  {
    etag: true,
    maxAge: process.env.NODE_ENV === 'production'
      ? '1h'
      : 0
  }
));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

const signingLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

function signingTokenHash(token) {
  return crypto
    .createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

function signingPublicBaseUrl() {
  return crmPublicUrl();
}

const signatureDirectory = String(
  process.env.SIGNATURES_DIR || '/app/data/semnaturi'
);

const receptionPdfDirectory = String(
  process.env.RECEPTION_PDF_DIR || '/app/data/receptii'
);

const receptionPhotoDirectory = String(
  process.env.RECEPTION_PHOTO_DIR || '/app/data/receptii-poze'
);

const fieldPhotoDirectory = String(
  process.env.FIELD_PHOTOS_DIR || '/app/data/fotografii-teren'
);

function deletionFilePath(candidate) {
  if (!candidate) return null;

  const dataRoot = `${path.resolve('/app/data')}${path.sep}`;
  const resolved = path.resolve(String(candidate));

  return resolved.startsWith(dataRoot) ? resolved : null;
}

async function removeDeletedReceptionFiles(filePaths) {
  for (const candidate of new Set(filePaths.filter(Boolean))) {
    const filePath = deletionFilePath(candidate);

    if (!filePath) {
      console.error(
        'Fișier ignorat la ștergerea recepției: cale în afara /app/data',
        candidate
      );
      continue;
    }

    await fs.unlink(filePath).catch(error => {
      if (error?.code !== 'ENOENT') {
        console.error(
          'Ștergerea unui fișier asociat recepției a eșuat:',
          error
        );
      }
    });
  }
}

const googleReviewUrl =
  'https://g.page/r/CYETp8zBojPIEBM/review';

function reviewRequestMessage(reception) {
  const name = String(reception.nume || '').trim();
  const greeting = name
    ? `Bună ziua, ${name}!`
    : 'Bună ziua!';

  return [
    ...(reception.este_test
      ? ['DOCUMENT DE TEST – FĂRĂ VALOARE', '']
      : []),
    greeting,
    '',
    'Vă mulțumim că ați ales Mozy Service Electronice.',
    '',
    'Dacă ați fost mulțumit(ă) de serviciile noastre, ne-ar ajuta mult să ne lăsați o recenzie sinceră pe Google. Durează mai puțin de un minut:',
    googleReviewUrl,
    '',
    'Experiența dumneavoastră îi ajută și pe alți clienți să aleagă un service de încredere.',
    '',
    'Dacă există ceva ce putem îmbunătăți, răspundeți direct acestui mesaj și vom face tot posibilul să rezolvăm.',
    '',
    'Vă mulțumim!',
    'Echipa Mozy Service Electronice'
  ].join('\n');
}

function receptionStatusMessage(reception, status) {
  const number = reception.numar_receptie || `#${reception.id}`;
  const messages = {
    primit:
      `Bună ziua! Echipamentul aferent fișei ${number} a fost primit în atelierul Mozy Service.`,
    in_diagnosticare:
      `Bună ziua! Echipamentul aferent fișei ${number} este în diagnosticare. Vă contactăm după stabilirea soluției.`,
    asteapta_acord:
      `Bună ziua! Fișa ${number} așteaptă acordul dumneavoastră pentru continuarea reparației.`,
    asteapta_piesa:
      `Bună ziua! Pentru fișa ${number} așteptăm piesa necesară reparației. Vă anunțăm când intervenția poate continua.`,
    in_reparatie:
      `Bună ziua! Echipamentul aferent fișei ${number} a intrat în reparație.`,
    finalizat:
      `Bună ziua! Reparația aferentă fișei ${number} a fost finalizată.`,
    predat:
      `Bună ziua! Echipamentul aferent fișei ${number} a fost predat. Vă mulțumim!`,
    anulat:
      `Bună ziua! Fișa ${number} a fost anulată.`
  };

  const message = messages[status] ||
    `Bună ziua! Statusul fișei ${number} este acum „${receptionStatusLabels[status] || status}”.`;

  return reception.este_test
    ? `DOCUMENT DE TEST – FĂRĂ VALOARE\n\n${message}`
    : message;
}

function detectedImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') {
    return { mime: 'image/jpeg', extension: '.jpg' };
  }

  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { mime: 'image/png', extension: '.png' };
  }

  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: '.webp' };
  }

  return null;
}

function safeOriginalFileName(value, extension) {
  let decoded = 'fotografie';

  try {
    decoded = decodeURIComponent(String(value || 'fotografie'));
  } catch {
    decoded = 'fotografie';
  }

  const cleaned = path.basename(decoded)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 180);

  return cleaned || `fotografie${extension}`;
}

async function signingReceptionByToken(
  database,
  tokenHash,
  lock = false
) {
  return database.query(`
    SELECT
      r.*,
      TO_CHAR(r.data_primire, 'DD.MM.YYYY')
        AS data_primire_afisata,
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
      e.stare_la_primire
    FROM crm.receptii_atelier r
    JOIN crm.clienti c
      ON c.id = r.client_id
    JOIN crm.echipamente_atelier e
      ON e.id = r.echipament_id
    WHERE r.semnare_token_hash = $1
    ${lock ? 'FOR UPDATE OF r' : ''}
  `, [tokenHash]);
}

function signingUnavailableReason(receptie) {
  if (receptie.semnare_status === 'semnat') {
    return 'Fișa a fost deja semnată.';
  }

  if (
    receptie.status === 'anulat' ||
    receptie.semnare_status === 'anulat'
  ) {
    return 'Recepția a fost anulată.';
  }

  if (
    !receptie.semnare_token_expira_la ||
    new Date(receptie.semnare_token_expira_la) <= new Date()
  ) {
    return 'Linkul a expirat. Solicită un link nou.';
  }

  return null;
}

function decodePngSignature(value) {
  const match = String(value || '').match(
    /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/
  );

  if (!match) {
    throw new Error('signature_format');
  }

  const buffer = Buffer.from(match[1], 'base64');
  const pngMagic = '89504e470d0a1a0a';

  if (
    buffer.length < 1000 ||
    buffer.length > 500000 ||
    buffer.subarray(0, 8).toString('hex') !== pngMagic
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

function whatsappErrorMessage(error) {
  return String(
    error?.message || 'Expedierea prin WhatsApp a eșuat.'
  ).slice(0, 500);
}

async function saveWhatsAppResult({
  receptionId,
  type,
  sent,
  messageId = null,
  error = null
}) {
  const sentColumn = type === 'link'
    ? 'whatsapp_link_trimis_la'
    : 'whatsapp_pdf_trimis_la';
  const idColumn = type === 'link'
    ? 'whatsapp_link_message_id'
    : 'whatsapp_pdf_message_id';

  await query(`
    UPDATE crm.receptii_atelier
    SET
      ${sentColumn} = CASE WHEN $2 THEN NOW() ELSE ${sentColumn} END,
      ${idColumn} = CASE WHEN $2 THEN $3 ELSE ${idColumn} END,
      whatsapp_ultima_incercare_la = NOW(),
      whatsapp_ultima_eroare = $4,
      updated_at = NOW()
    WHERE id = $1
  `, [receptionId, sent, messageId, error]);
}

async function createAndSendReceptionSigningLink(receptionId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = signingTokenHash(token);
  const client = await pool.connect();
  let transactionOpen = false;
  let receptie;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    const locked = await client.query(`
      SELECT
        r.id,
        r.numar_receptie,
        r.status,
        r.semnare_status,
        r.este_test,
        c.telefon
      FROM crm.receptii_atelier r
      JOIN crm.clienti c
        ON c.id = r.client_id
      WHERE r.id = $1
      FOR UPDATE OF r
    `, [receptionId]);

    if (!locked.rowCount) {
      const error = new Error('Recepție inexistentă');
      error.code = 'reception_not_found';
      throw error;
    }

    receptie = locked.rows[0];

    if (receptie.semnare_status === 'semnat') {
      const error = new Error('Fișa este deja semnată');
      error.code = 'reception_already_signed';
      throw error;
    }

    if (receptie.status === 'anulat') {
      const error = new Error('Recepția este anulată');
      error.code = 'reception_cancelled';
      throw error;
    }

    await client.query(`
      UPDATE crm.receptii_atelier
      SET
        semnare_token_hash = $2,
        semnare_token_creat_la = NOW(),
        semnare_token_expira_la = NOW() + INTERVAL '48 hours',
        semnare_status = 'nesemnat',
        updated_at = NOW()
      WHERE id = $1
    `, [receptionId, tokenHash]);

    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }

  const signingUrl =
    `${signingPublicBaseUrl()}/semnare/${token}`;

  try {
    const sent = await sendWhatsAppText({
      number: receptie.telefon,
      text:
        (receptie.este_test
          ? 'DOCUMENT DE TEST – FĂRĂ VALOARE\n\n'
          : '') +
        `Bună ziua! Fișa de recepție ${receptie.numar_receptie} ` +
        'este pregătită pentru verificare și semnare:\n\n' +
        `${signingUrl}\n\n` +
        'Linkul este valabil 48 de ore.\n' +
        'Mozy Service Electronice'
    });

    await saveWhatsAppResult({
      receptionId: receptie.id,
      type: 'link',
      sent: true,
      messageId: sent.messageId
    }).catch((trackingError) => {
      console.error('Eroare jurnalizare WhatsApp:', trackingError);
    });

    return {
      receptie,
      signingUrl,
      whatsappTrimis: true,
      whatsappEroare: null
    };
  } catch (error) {
    const whatsappEroare = whatsappErrorMessage(error);

    await saveWhatsAppResult({
      receptionId: receptie.id,
      type: 'link',
      sent: false,
      error: whatsappEroare
    }).catch((trackingError) => {
      console.error('Eroare jurnalizare WhatsApp:', trackingError);
    });

    return {
      receptie,
      signingUrl,
      whatsappTrimis: false,
      whatsappEroare
    };
  }
}

function dataBucuresti() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function dataValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function deplaseazaData(value, zile) {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + zile);
  return parsed.toISOString().slice(0, 10);
}

app.get('/health', async (_req, res) => {
  try {
    const [, disk] = await Promise.all([
      query('SELECT 1'),
      fs.statfs('/app/data')
    ]);
    const freeBytes = Number(disk.bavail) * Number(disk.bsize);
    const totalBytes = Number(disk.blocks) * Number(disk.bsize);
    const freePercent = totalBytes > 0
      ? (freeBytes / totalBytes) * 100
      : 0;

    if (freePercent < 5) {
      return res.status(503).json({
        status: 'disk_space_low',
        disk_free_percent: Number(freePercent.toFixed(1))
      });
    }

    res.json({
      status: 'ok',
      disk_free_percent: Number(freePercent.toFixed(1))
    });
  } catch (error) {
    logError(error);
    res.status(503).json({
      status: 'dependency_unavailable'
    });
  }
});

app.get('/login', (req, res) => {
  res.render('login', {
    error: null,
    returnTo: safeLoginReturnTo(req.query.returnTo)
  });
});

app.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  const user = await validCredentials(username, password);

  if (!user) {
    return res.status(401).render('login', {
      error: 'Utilizator sau parol\u0103 incorect\u0103.',
      returnTo: safeLoginReturnTo(req.body.returnTo)
    });
  }

  createSession(res, user);
  res.redirect(safeLoginReturnTo(req.body.returnTo));
});

app.post('/logout', requireAuth, (_req, res) => {
  clearSession(res);
  res.redirect('/login');
});

app.get('/setari', requireAuth, async (req, res, next) => {
  try {
    const [users, maintenance] = await Promise.all([
      query(`
        SELECT id, username, activ, created_at, ultima_autentificare_la
        FROM crm.utilizatori
        ORDER BY LOWER(username), id
      `),
      import('./maintenance-client.js')
        .then(({ maintenanceRequest }) =>
          maintenanceRequest('GET', '/v1/backups', null, 3000)
        )
        .catch(() => null)
    ]);

    res.render('setari', {
      users: users.rows,
      backups: maintenance?.backups || [],
      maintenanceAvailable: Boolean(maintenance),
      currentUser: req.user,
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      active: 'setari'
    });
  } catch (error) {
    next(error);
  }
});

app.post('/setari/utilizatori', requireAuth, async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const confirmation = String(req.body.password_confirmation || '');

    if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
      return res.redirect('/setari?error=username_nevalid');
    }
    if (password.length < 10) {
      return res.redirect('/setari?error=parola_scurta');
    }
    if (password !== confirmation) {
      return res.redirect('/setari?error=parole_diferite');
    }

    await query(`
      INSERT INTO crm.utilizatori (username, password_hash)
      VALUES ($1, $2)
    `, [username, await hashPassword(password)]);

    res.redirect('/setari?success=utilizator_creat');
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect('/setari?error=username_existent');
    }
    next(error);
  }
});

app.post(
  '/setari/utilizatori/:id/status',
  requireAuth,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const active = req.body.activ === '1';

      if (!Number.isInteger(id) || id <= 0) {
        return res.redirect('/setari?error=utilizator_inexistent');
      }
      if (!active && id === req.user.id) {
        return res.redirect('/setari?error=cont_propriu');
      }

      const result = await query(`
        UPDATE crm.utilizatori
        SET activ = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `, [id, active]);

      if (!result.rowCount) {
        return res.redirect('/setari?error=utilizator_inexistent');
      }

      res.redirect(
        `/setari?success=${active ? 'utilizator_activat' : 'utilizator_dezactivat'}`
      );
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  '/setari/utilizatori/:id/parola',
  requireAuth,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const password = String(req.body.password || '');
      const confirmation = String(req.body.password_confirmation || '');

      if (!Number.isInteger(id) || id <= 0) {
        return res.redirect('/setari?error=utilizator_inexistent');
      }
      if (password.length < 10) {
        return res.redirect('/setari?error=parola_scurta');
      }
      if (password !== confirmation) {
        return res.redirect('/setari?error=parole_diferite');
      }

      const result = await query(`
        UPDATE crm.utilizatori
        SET password_hash = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `, [id, await hashPassword(password)]);

      if (!result.rowCount) {
        return res.redirect('/setari?error=utilizator_inexistent');
      }

      if (id === req.user.id) {
        clearSession(res);
        return res.redirect('/login');
      }
      res.redirect('/setari?success=parola_resetata');
    } catch (error) {
      next(error);
    }
  }
);

app.get('/', requireAuth, async (req, res, next) => {
  try {
    const azi = dataBucuresti();
    const dataCeruta = String(req.query.data || '').trim();

    const dataSelectata = dataValida(dataCeruta)
      ? dataCeruta
      : azi;

    const dataAnterioara = deplaseazaData(
      dataSelectata,
      -1
    );

    const dataUrmatoare = deplaseazaData(
      dataSelectata,
      1
    );

    const [metrics, fiseRecente, defectLibrary] =
      await Promise.all([
        query(`
          SELECT
            (
              SELECT COUNT(*)
              FROM crm.receptii_atelier
              WHERE status NOT IN ('predat', 'anulat')
            ) AS fise_active,

            (
              SELECT COUNT(*)
              FROM crm.receptii_atelier
              WHERE data_primire = $1::date
                AND status <> 'anulat'
            ) AS fise_selectate
        `, [dataSelectata]),

        query(`
          SELECT
            r.id,
            r.numar_receptie,
            r.status,
            r.data_primire,
            r.sursa_receptie,
            c.nume,
            c.telefon,
            e.tip_echipament,
            e.marca,
            e.model
          FROM crm.receptii_atelier r
          JOIN crm.clienti c
            ON c.id = r.client_id
          JOIN crm.echipamente_atelier e
            ON e.id = r.echipament_id
          WHERE r.data_primire = $1::date
            AND r.status <> 'anulat'
          ORDER BY
            r.id DESC
          LIMIT 100
        `, [dataSelectata]),

        defectLibraryDashboardData()
      ]);

    res.render('dashboard', {
      user: req.user,
      metrics: metrics.rows[0],
      fiseRecente: fiseRecente.rows,
      defectLibrary,
      dataSelectata,
      dataAnterioara,
      dataUrmatoare,
      azi,
      esteAstazi: dataSelectata === azi,
      active: 'dashboard'
    });
  } catch (error) {
    next(error);
  }
});

app.get('/fise', requireAuth, async (req, res, next) => {
  try {
    const search = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const params = [];
    const conditions = [];

    if (search) {
      params.push(`%${search}%`);

      conditions.push(`(
        c.nume ILIKE $${params.length}
        OR c.telefon ILIKE $${params.length}
        OR t.marca ILIKE $${params.length}
        OR t.model ILIKE $${params.length}
        OR t.serie ILIKE $${params.length}
        OR f.defect_reclamat ILIKE $${params.length}
      )`);
    }

    if (status) {
      params.push(status);
      conditions.push(`f.status = $${params.length}`);
    }

    const result = await query(`
      SELECT
        f.id,
        f.status,
        f.defect_reclamat,
        f.data_programare,
        f.ora_programare,
        f.adresa_interventie,
        f.este_garantie,
        f.updated_at,
        c.nume,
        c.telefon,
        c.client_dificil,
        t.marca,
        t.model,
        t.diagonala
      FROM crm.fise_service f
      JOIN crm.clienti c
        ON c.id = f.client_id
      LEFT JOIN crm.televizoare t
        ON t.id = f.televizor_id
      ${conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : ''
      }
      ORDER BY
        f.updated_at DESC NULLS LAST,
        f.id DESC
      LIMIT 200
    `, params);

    res.render('fise', {
      rows: result.rows,
      search,
      status,
      active: 'fise'
    });
  } catch (error) {
    next(error);
  }
});

app.get('/fise/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(404).send(
        'Fi\u0219\u0103 inexistent\u0103'
      );
    }

    const details = await query(`
      SELECT
        f.*,
        c.nume,
        c.telefon,
        c.email,
        c.adresa AS adresa_client,
        c.client_dificil,
        t.marca,
        t.model,
        t.serie,
        t.cod_produs,
        t.diagonala,
        t.cod_placa,
        t.alte_coduri,
        t.tip_tv
      FROM crm.fise_service f
      JOIN crm.clienti c
        ON c.id = f.client_id
      LEFT JOIN crm.televizoare t
        ON t.id = f.televizor_id
      WHERE f.id = $1
    `, [id]);

    if (!details.rowCount) {
      return res.status(404).send(
        'Fi\u0219\u0103 inexistent\u0103'
      );
    }

    const conversations = await query(`
      SELECT
        id,
        directie,
        tip,
        mesaj,
        created_at
      FROM crm.conversatii
      WHERE client_id = $1
      ORDER BY
        created_at DESC,
        id DESC
      LIMIT 50
    `, [details.rows[0].client_id]);

    res.render('fisa', {
      fisa: details.rows[0],
      conversatii: conversations.rows,
      saved: req.query.saved === '1',
      errorCode: String(req.query.error || ''),
      active: 'fise'
    });
  } catch (error) {
    next(error);
  }
});

app.post(
  '/fise/:id/status',
  requireAuth,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);

      const statusuriPermise = [
        'noua',
        'in_asteptare',
        'confirmata',
        'in_lucru',
        'finalizata',
        'anulata'
      ];

      if (!Number.isInteger(id)) {
        return res.status(404).send(
          'Fi\u0219\u0103 inexistent\u0103'
        );
      }

      if (!statusuriPermise.includes(req.body.status)) {
        return res.redirect(
          `/fise/${id}?error=status_nevalid`
        );
      }

      const textSauNull = (valoare) => {
        const text = String(valoare ?? '').trim();
        return text === '' ? null : text;
      };

      const numarSauNull = (valoare) => {
        const text = String(valoare ?? '').trim();

        if (text === '') {
          return null;
        }

        const numar = Number(text.replace(',', '.'));

        if (!Number.isFinite(numar) || numar < 0) {
          return undefined;
        }

        return numar;
      };

      const dataFormularValida = (valoare) => {
        if (valoare === null) {
          return true;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(valoare)) {
          return false;
        }

        const data = new Date(`${valoare}T00:00:00Z`);

        return (
          !Number.isNaN(data.getTime()) &&
          data.toISOString().slice(0, 10) === valoare
        );
      };

      const oraFormularValida = (valoare) => {
        if (valoare === null) {
          return true;
        }

        return /^([01]\d|2[0-3]):[0-5]\d$/.test(
          valoare
        );
      };

      const defectReclamat = textSauNull(
        req.body.defect_reclamat
      );

      const defectEstimat = textSauNull(
        req.body.defect_estimat
      );

      const adresaInterventie = textSauNull(
        req.body.adresa_interventie
      );

      const observatii = textSauNull(
        req.body.observatii
      );

      const dataProgramare = textSauNull(
        req.body.data_programare
      );

      const oraProgramare = textSauNull(
        req.body.ora_programare
      );

      const pretEstimat = numarSauNull(
        req.body.pret_estimat
      );

      const pretAgreat = numarSauNull(
        req.body.pret_agreat
      );

      if (
        pretEstimat === undefined ||
        pretAgreat === undefined ||
        !dataFormularValida(dataProgramare) ||
        !oraFormularValida(oraProgramare)
      ) {
        return res.redirect(
          `/fise/${id}?error=date_nevalide`
        );
      }

      if (
        req.body.status === 'confirmata' &&
        (
          dataProgramare === null ||
          oraProgramare === null
        )
      ) {
        return res.redirect(
          `/fise/${id}?error=programare_incompleta`
        );
      }

      const esteGarantie =
        req.body.este_garantie === '1';

      const clientDificil =
        req.body.client_dificil === '1';

      const result = await query(`
        WITH updated_fisa AS (
          UPDATE crm.fise_service
          SET
            status = $1,
            este_garantie = $2,
            defect_reclamat = $3,
            defect_estimat = $4,
            pret_estimat = $5,
            pret_agreat = $6,
            data_programare = $7,
            ora_programare = $8,
            adresa_interventie = $9,
            observatii = $10,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $12
          RETURNING client_id
        )
        UPDATE crm.clienti AS c
        SET
          client_dificil = $11,
          updated_at = CURRENT_TIMESTAMP
        FROM updated_fisa
        WHERE c.id = updated_fisa.client_id
        RETURNING c.id
      `, [
        req.body.status,
        esteGarantie,
        defectReclamat,
        defectEstimat,
        pretEstimat,
        pretAgreat,
        dataProgramare,
        oraProgramare,
        adresaInterventie,
        observatii,
        clientDificil,
        id
      ]);

      if (!result.rowCount) {
        return res.status(404).send(
          'Fi\u0219\u0103 inexistent\u0103'
        );
      }

      res.redirect(`/fise/${id}?saved=1`);
    } catch (error) {
      next(error);
    }
  }
);

app.get('/clienti', requireAuth, (_req, res) => {
  res.redirect(302, '/');
});

registerWhatsAppCrmRoutes(app, requireAuth);

app.get('/receptie', requireAuth, async (req, res, next) => {
  try {
    const q = normalizeReceptionSearch(req.query.q);
    const selectedStatus = normalizeReceptionFilter(req.query.status);
    const searchPattern = `%${escapeLikePattern(q)}%`;

    const counterResult = await query(`
      SELECT
        COUNT(*)::INTEGER AS toate,
        COUNT(*) FILTER (
          WHERE r.status = ANY($3::TEXT[])
        )::INTEGER AS active,
        COUNT(*) FILTER (
          WHERE r.status = 'primit'
        )::INTEGER AS primit,
        COUNT(*) FILTER (
          WHERE r.status = 'in_diagnosticare'
        )::INTEGER AS in_diagnosticare,
        COUNT(*) FILTER (
          WHERE r.status = 'asteapta_acord'
        )::INTEGER AS asteapta_acord,
        COUNT(*) FILTER (
          WHERE r.status = 'asteapta_piesa'
        )::INTEGER AS asteapta_piesa,
        COUNT(*) FILTER (
          WHERE r.status = 'in_reparatie'
        )::INTEGER AS in_reparatie,
        COUNT(*) FILTER (
          WHERE r.status = 'finalizat'
        )::INTEGER AS finalizat,
        COUNT(*) FILTER (
          WHERE r.status = 'predat'
        )::INTEGER AS predat,
        COUNT(*) FILTER (
          WHERE r.status = 'anulat'
        )::INTEGER AS anulat
      FROM crm.receptii_atelier r
      JOIN crm.clienti c
        ON c.id = r.client_id
      JOIN crm.echipamente_atelier e
        ON e.id = r.echipament_id
      WHERE ${receptionSearchWhereSql}
    `, [q, searchPattern, receptionActiveStatuses]);

    const counts = Object.fromEntries(
      ['toate', 'active', ...receptionStatuses].map(key => [
        key,
        Number(counterResult.rows[0]?.[key] || 0)
      ])
    );
    const totalRows = counts[selectedStatus] || 0;
    const totalPages = Math.max(
      1,
      Math.ceil(totalRows / receptionPageSize)
    );
    const page = normalizeReceptionPage(
      req.query.page,
      totalPages
    );
    const offset = (page - 1) * receptionPageSize;

    const result = await query(`
      SELECT
        r.id,
        r.numar_receptie,
        r.este_test,
        r.status,
        r.sursa_receptie,
        r.tehnician_cod,
        r.semnare_status,
        r.pdf_path,
        r.data_primire,
        TO_CHAR(r.data_primire, 'DD.MM.YYYY')
          AS data_primire_afisata,
        c.nume,
        c.telefon,
        e.tip_echipament,
        e.marca,
        e.model,
        e.serie
      FROM crm.receptii_atelier r
      JOIN crm.clienti c
        ON c.id = r.client_id
      JOIN crm.echipamente_atelier e
        ON e.id = r.echipament_id
      WHERE ${receptionSearchWhereSql}
        AND ${receptionStatusWhereSql}
      ORDER BY
        r.data_primire DESC,
        r.id DESC
      LIMIT $5
      OFFSET $6
    `, [
      q,
      searchPattern,
      selectedStatus,
      receptionActiveStatuses,
      receptionPageSize,
      offset
    ]);

    const returnTo = buildReceptionListUrl({
      status: selectedStatus,
      q,
      page
    });

    res.render('receptie', {
      rows: result.rows,
      q,
      selectedStatus,
      receptionFilterTabs,
      counts,
      page,
      totalPages,
      totalRows,
      buildReceptionListUrl,
      returnTo,
      testSters: req.query.test_sters === '1',
      active: 'receptie'
    });
  } catch (error) {
    next(error);
  }
});

app.get(
  '/receptie/noua',
  requireAuth,
  (_req, res) => {
    res.render('receptie-noua', {
      error: null,
      values: {},
      active: 'receptie'
    });
  }
);

/* GENERARE LINK SECURIZAT DE SEMNARE */
app.post(
  '/receptie/:id/link-semnare',
  requireAuth,
  async (req, res, next) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).send(
        'Recepție inexistentă'
      );
    }

    try {
      const result = await createAndSendReceptionSigningLink(id);

      res.render('link-semnare-generat', {
        ...result,
        active: 'receptie'
      });
    } catch (error) {
      if (error.code === 'reception_not_found') {
        return res.status(404).send('Recepție inexistentă');
      }
      if (error.code === 'reception_already_signed') {
        return res.redirect(
          `/receptie/${id}?eroare=fisa_deja_semnata`
        );
      }
      if (error.code === 'reception_cancelled') {
        return res.redirect(
          `/receptie/${id}?eroare=receptie_anulata`
        );
      }
      next(error);
    }
  }
);

/* PAGINĂ PUBLICĂ — VERIFICARE LINK ȘI DOCUMENTE */
app.get(
  '/semnare/:token',
  signingLinkLimiter,
  async (req, res, next) => {
    try {
      const token = String(req.params.token || '');

      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
        return res.status(404).render(
          'semnare-indisponibila',
          { motiv: 'Linkul nu este valid.' }
        );
      }

      const result = await signingReceptionByToken(
        pool,
        signingTokenHash(token)
      );

      if (!result.rowCount) {
        return res.status(404).render(
          'semnare-indisponibila',
          { motiv: 'Linkul nu este valid sau a fost înlocuit.' }
        );
      }

      const receptie = result.rows[0];

      const indisponibil = signingUnavailableReason(receptie);

      if (indisponibil) {
        return res.status(410).render(
          'semnare-indisponibila',
          { motiv: indisponibil }
        );
      }

      res.set('Cache-Control', 'no-store');
      res.render('semnare-receptie', {
        receptie,
        error: null
      });
    } catch (error) {
      next(error);
    }
  }
);

/* ACCEPTĂRI ȘI SEMNĂTURĂ ELECTRONICĂ SIMPLĂ */
app.post(
  '/semnare/:token',
  signingLinkLimiter,
  async (req, res, next) => {
    const token = String(req.params.token || '');

    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return res.status(404).render(
        'semnare-indisponibila',
        { motiv: 'Linkul nu este valid.' }
      );
    }

    const tokenHash = signingTokenHash(token);
    const termsAccepted = req.body.termeni_acceptati === 'on';
    const gdprConfirmed =
      req.body.informare_gdpr_confirmata === 'on';
    let signatureBuffer;

    try {
      signatureBuffer = decodePngSignature(
        req.body.semnatura_data
      );
    } catch {
      signatureBuffer = null;
    }

    if (!termsAccepted || !gdprConfirmed || !signatureBuffer) {
      try {
        const result = await signingReceptionByToken(
          pool,
          tokenHash
        );

        if (!result.rowCount) {
          return res.status(404).render(
            'semnare-indisponibila',
            { motiv: 'Linkul nu este valid sau a fost înlocuit.' }
          );
        }

        const receptie = result.rows[0];
        const indisponibil = signingUnavailableReason(receptie);

        if (indisponibil) {
          return res.status(410).render(
            'semnare-indisponibila',
            { motiv: indisponibil }
          );
        }

        res.set('Cache-Control', 'no-store');
        return res.status(422).render('semnare-receptie', {
          receptie,
          error: !termsAccepted || !gdprConfirmed
            ? 'Bifează ambele confirmări înainte de semnare.'
            : 'Semnătura lipsește sau nu este validă. Semnează din nou în chenar.'
        });
      } catch (error) {
        return next(error);
      }
    }

    const client = await pool.connect();
    let temporaryPath = null;
    let finalPath = null;
    let temporaryPdfPath = null;
    let finalPdfPath = null;
    let committed = false;

    try {
      await client.query('BEGIN');

      const result = await signingReceptionByToken(
        client,
        tokenHash,
        true
      );

      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).render(
          'semnare-indisponibila',
          { motiv: 'Linkul nu este valid sau a fost deja folosit.' }
        );
      }

      const receptie = result.rows[0];
      const indisponibil = signingUnavailableReason(receptie);

      if (indisponibil) {
        await client.query('ROLLBACK');
        return res.status(410).render(
          'semnare-indisponibila',
          { motiv: indisponibil }
        );
      }

      if (
        !receptie.termeni_text ||
        !receptie.informare_gdpr_text ||
        !receptie.termeni_sha256 ||
        !receptie.informare_gdpr_sha256
      ) {
        await client.query('ROLLBACK');
        return res.status(409).render(
          'semnare-indisponibila',
          { motiv: 'Documentele juridice ale fișei sunt incomplete. Contactează service-ul.' }
        );
      }

      await fs.mkdir(signatureDirectory, {
        recursive: true,
        mode: 0o750
      });

      const fileName =
        `receptie-${receptie.id}-${crypto.randomUUID()}.png`;
      finalPath = path.join(signatureDirectory, fileName);
      temporaryPath = `${finalPath}.tmp`;

      await fs.writeFile(temporaryPath, signatureBuffer, {
        flag: 'wx',
        mode: 0o600
      });
      await fs.rename(temporaryPath, finalPath);
      temporaryPath = null;

      const signatureHash = crypto
        .createHash('sha256')
        .update(signatureBuffer)
        .digest('hex');
      const userAgent = String(
        req.get('user-agent') || ''
      ).slice(0, 1000) || null;
      const ipAddress = signingIp(req);
      const signedAt = new Date();

      await fs.mkdir(receptionPdfDirectory, {
        recursive: true,
        mode: 0o750
      });

      const pdfFileName = `${receptie.numar_receptie}.pdf`;
      finalPdfPath = path.join(
        receptionPdfDirectory,
        pdfFileName
      );
      temporaryPdfPath = path.join(
        receptionPdfDirectory,
        `.${pdfFileName}.${crypto.randomUUID()}.tmp`
      );

      await generateReceptionPdf({
        ...receptie,
        semnatura_path: finalPath,
        semnatura_sha256: signatureHash,
        semnatura_ip: ipAddress,
        semnatura_user_agent: userAgent,
        termeni_acceptati_la: signedAt,
        informare_gdpr_confirmata_la: signedAt,
        semnat_la: signedAt
      }, temporaryPdfPath);

      const pdfBuffer = await fs.readFile(temporaryPdfPath);
      const documentHash = crypto
        .createHash('sha256')
        .update(pdfBuffer)
        .digest('hex');
      await fs.rename(temporaryPdfPath, finalPdfPath);
      temporaryPdfPath = null;

      const updated = await client.query(`
        UPDATE crm.receptii_atelier
        SET
          termeni_acceptati = TRUE,
          termeni_acceptati_la = $6,
          informare_gdpr_confirmata = TRUE,
          informare_gdpr_confirmata_la = $6,
          semnare_status = 'semnat',
          semnatura_path = $2,
          semnatura_sha256 = $3,
          semnat_la = $6,
          semnatura_ip = $4::inet,
          semnatura_user_agent = $5,
          semnare_token_hash = NULL,
          semnare_token_creat_la = NULL,
          semnare_token_expira_la = NULL,
          pdf_path = $7,
          document_sha256 = $8,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          numar_receptie,
          este_test,
          TO_CHAR(
            semnat_la AT TIME ZONE 'Europe/Bucharest',
            'DD.MM.YYYY HH24:MI'
          ) AS semnat_la_afisat
      `, [
        receptie.id,
        finalPath,
        signatureHash,
        ipAddress,
        userAgent,
        signedAt,
        finalPdfPath,
        documentHash
      ]);

      await client.query('COMMIT');
      committed = true;

      let whatsappTrimis = false;
      let whatsappEroare = null;

      try {
        const sent = await sendWhatsAppPdf({
          number: receptie.telefon,
          filePath: finalPdfPath,
          fileName: `${receptie.numar_receptie}.pdf`,
          caption:
            (receptie.este_test
              ? 'DOCUMENT DE TEST – FĂRĂ VALOARE\n'
              : '') +
            `Fișa de recepție semnată ${receptie.numar_receptie}. ` +
            'Vă mulțumim! — Mozy Service Electronice'
        });

        whatsappTrimis = true;
        await saveWhatsAppResult({
          receptionId: receptie.id,
          type: 'pdf',
          sent: true,
          messageId: sent.messageId
        });
      } catch (error) {
        whatsappEroare = whatsappErrorMessage(error);
        await saveWhatsAppResult({
          receptionId: receptie.id,
          type: 'pdf',
          sent: false,
          error: whatsappEroare
        }).catch((trackingError) => {
          console.error('Eroare jurnalizare WhatsApp:', trackingError);
        });
      }

      res.set('Cache-Control', 'no-store');
      res.render('semnare-succes', {
        receptie: updated.rows[0],
        whatsappTrimis,
        whatsappEroare
      });
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});

        for (const filePath of [
          temporaryPath,
          finalPath,
          temporaryPdfPath,
          finalPdfPath
        ]) {
          if (filePath) {
            await fs.unlink(filePath).catch(() => {});
          }
        }
      }

      next(error);
    } finally {
      client.release();
    }
  }
);

/* DESCĂRCARE PDF SEMNAT - NUMAI DIN CRM */
app.get(
  '/receptie/:id/pdf',
  requireAuth,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(404).send('Recepție inexistentă');
      }

      const result = await query(`
        SELECT
          numar_receptie,
          pdf_path
        FROM crm.receptii_atelier
        WHERE id = $1
          AND semnare_status = 'semnat'
          AND pdf_path IS NOT NULL
      `, [id]);

      if (!result.rowCount) {
        return res.status(404).send('PDF indisponibil');
      }

      const reception = result.rows[0];
      const root = `${path.resolve(receptionPdfDirectory)}${path.sep}`;
      const filePath = path.resolve(reception.pdf_path);

      if (!filePath.startsWith(root)) {
        return res.status(409).send('Cale PDF nevalidă');
      }

      await fs.access(filePath);
      const download = req.query.download === '1';
      const fileName = `${String(reception.numar_receptie || `receptie-${id}`)
        .replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`;

      res.set('Cache-Control', 'private, no-store');

      if (download) {
        return res.download(filePath, fileName);
      }

      res.set('Content-Type', 'application/pdf');
      res.set(
        'Content-Disposition',
        `inline; filename="${fileName}"`
      );
      return res.sendFile(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return res.status(404).send('Fișier PDF inexistent');
      }

      next(error);
    }
  }
);

/* FOTOGRAFII RECEPTIE: INCARCARE, VIZUALIZARE SI STERGERE */
app.post(
  '/receptie/:id/fotografii',
  requireAuth,
  express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: '12mb'
  }),
  async (req, res, next) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).json({ error: 'Recepție inexistentă.' });
    }

    const imageType = detectedImageType(req.body);

    if (!imageType || !req.body.length) {
      return res.status(415).json({
        error: 'Sunt acceptate numai fotografii JPG, PNG sau WEBP.'
      });
    }

    const reception = await query(`
      SELECT id
      FROM crm.receptii_atelier
      WHERE id = $1
    `, [id]);

    if (!reception.rowCount) {
      return res.status(404).json({ error: 'Recepție inexistentă.' });
    }

    const storageName =
      `${id}-${crypto.randomUUID()}${imageType.extension}`;
    const filePath = path.join(receptionPhotoDirectory, storageName);
    const originalName = safeOriginalFileName(
      req.get('X-File-Name'),
      imageType.extension
    );

    try {
      await fs.mkdir(receptionPhotoDirectory, { recursive: true });
      await fs.writeFile(filePath, req.body, { flag: 'wx' });

      const inserted = await query(`
        INSERT INTO crm.receptie_fotografii (
          receptie_id,
          nume_original,
          nume_stocare,
          mime_type,
          dimensiune_bytes
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        id,
        originalName,
        storageName,
        imageType.mime,
        req.body.length
      ]);

      res.status(201).json({
        ok: true,
        id: inserted.rows[0].id
      });
    } catch (error) {
      await fs.unlink(filePath).catch(() => {});
      next(error);
    }
  }
);

app.get(
  '/receptie/:id/fotografii/:photoId',
  requireAuth,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const photoId = Number(req.params.photoId);

      if (
        !Number.isInteger(id) || id <= 0 ||
        !Number.isInteger(photoId) || photoId <= 0
      ) {
        return res.status(404).send('Fotografie inexistentă');
      }

      const result = await query(`
        SELECT nume_stocare, nume_original, mime_type
        FROM crm.receptie_fotografii
        WHERE id = $1 AND receptie_id = $2
      `, [photoId, id]);

      if (!result.rowCount) {
        return res.status(404).send('Fotografie inexistentă');
      }

      const photo = result.rows[0];
      const filePath = path.join(
        receptionPhotoDirectory,
        path.basename(photo.nume_stocare)
      );

      await fs.access(filePath);
      res.type(photo.mime_type);
      res.set('Cache-Control', 'private, max-age=3600');

      if (req.query.download === '1') {
        return res.download(filePath, photo.nume_original);
      }

      return res.sendFile(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return res.status(404).send('Fișierul fotografiei lipsește');
      }

      next(error);
    }
  }
);

app.post(
  '/receptie/:id/fotografii/:photoId/sterge',
  requireAuth,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const photoId = Number(req.params.photoId);

      if (
        !Number.isInteger(id) || id <= 0 ||
        !Number.isInteger(photoId) || photoId <= 0
      ) {
        return res.status(404).send('Fotografie inexistentă');
      }

      const deleted = await query(`
        DELETE FROM crm.receptie_fotografii
        WHERE id = $1 AND receptie_id = $2
        RETURNING nume_stocare
      `, [photoId, id]);

      if (!deleted.rowCount) {
        return res.status(404).send('Fotografie inexistentă');
      }

      const filePath = path.join(
        receptionPhotoDirectory,
        path.basename(deleted.rows[0].nume_stocare)
      );

      await fs.unlink(filePath).catch(error => {
        if (error?.code !== 'ENOENT') {
          console.error('Ștergere fișier fotografie eșuată:', error);
        }
      });

      res.redirect(`/receptie/${id}?poza_stearsa=1#fotografii`);
    } catch (error) {
      next(error);
    }
  }
);

/* RUTA DETALII RECEPTIE */
app.get(
  '/receptie/:id',
  requireAuth,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(404).send(
          'Recepție inexistentă'
        );
      }

      const result = await query(`
        SELECT
          r.*,
          TO_CHAR(
            r.data_primire,
            'DD.MM.YYYY HH24:MI'
          ) AS data_primire_afisata,
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
          e.stare_la_primire
        FROM crm.receptii_atelier r
        JOIN crm.clienti c
          ON c.id = r.client_id
        JOIN crm.echipamente_atelier e
          ON e.id = r.echipament_id
        WHERE r.id = $1
      `, [id]);

      if (!result.rowCount) {
        return res.status(404).send(
          'Recepție inexistentă'
        );
      }

      const photos = await query(`
        SELECT
          id,
          nume_original,
          mime_type,
          dimensiune_bytes,
          TO_CHAR(created_at, 'DD.MM.YYYY HH24:MI') AS created_at_afisata
        FROM crm.receptie_fotografii
        WHERE receptie_id = $1
        ORDER BY created_at DESC, id DESC
      `, [id]);

      const fieldDocuments = await query(`
        SELECT
          id,
          numar_interventie,
          tip_operatiune,
          context_operatiune,
          status,
          pdf_path,
          semnat_la
        FROM crm.interventii_teren
        WHERE receptie_id = $1
        ORDER BY created_at DESC, id DESC
      `, [id]);

      const warrantyCertificates = await query(`
        SELECT
          id,
          numar_certificat,
          data_emiterii,
          durata_luni,
          data_expirarii,
          status,
          trimisa_la,
          eroare_trimitere
        FROM crm.certificate_garantie
        WHERE receptie_id = $1
        ORDER BY id DESC
      `, [id]);

      res.render('receptie-detalii', {
        receptie: result.rows[0],
        returnTo: safeReceptionReturnTo(req.query.returnTo),
        hasReturnTo: Boolean(req.query.returnTo),
        fotografii: photos.rows,
        documenteTeren: fieldDocuments.rows,
        documenteSemnate: [
          ...(result.rows[0].semnare_status === 'semnat' &&
          result.rows[0].pdf_path
            ? [{
                categorie: 'receptie',
                id: result.rows[0].id,
                numar_document: result.rows[0].numar_receptie,
                denumire: 'Proces-verbal de primire în service',
                semnat_la: result.rows[0].semnat_la,
                url: `/receptie/${result.rows[0].id}/pdf`
              }]
            : []),
          ...fieldDocuments.rows
            .filter(document =>
              document.status === 'semnat' &&
              document.pdf_path
            )
            .map(document => ({
              categorie: 'operatiune',
              id: document.id,
              numar_document: document.numar_interventie,
              denumire:
                document.tip_operatiune === 'ridicare'
                  ? 'Proces-verbal de preluare de la client'
                  : document.tip_operatiune === 'predare_reparat'
                    ? 'Proces-verbal de predare — reparat'
                    : document.tip_operatiune === 'predare_nereparat'
                      ? 'Proces-verbal de restituire — nereparat'
                      : 'Proces-verbal operațiune',
              semnat_la: document.semnat_la,
              url: `/teren/${document.id}/pdf`
            }))
        ].sort((a, b) =>
          new Date(b.semnat_la || 0) - new Date(a.semnat_la || 0)
        ),
        certificateGarantie: warrantyCertificates.rows,
        created: req.query.created === '1',
        whatsappLink: String(req.query.whatsapp_link || ''),
        statusSalvat: req.query.salvat === '1',
        notificare: String(req.query.notificare || ''),
        garantie: String(req.query.garantie || ''),
        recenzie: String(req.query.recenzie || ''),
        alerte: String(req.query.alerte || ''),
        pozaStearsa: req.query.poza_stearsa === '1',
        predareCreata: req.query.predare_creata === '1',
        whatsappPredare:
          String(req.query.whatsapp_predare || ''),
        eroare: String(req.query.eroare || ''),
        active: 'receptie'
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  '/receptie/:id/recenzie',
  requireAuth,
  async (req, res, next) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).send('Recepție inexistentă');
    }

    try {
      const result = await query(`
        SELECT
          r.id,
          r.recenzie_trimisa_la,
          r.este_test,
          c.nume,
          c.telefon
        FROM crm.receptii_atelier r
        JOIN crm.clienti c ON c.id = r.client_id
        WHERE r.id = $1
      `, [id]);

      if (!result.rowCount) {
        return res.status(404).send('Recepție inexistentă');
      }

      const reception = result.rows[0];

      if (
        reception.recenzie_trimisa_la &&
        Date.now() - new Date(reception.recenzie_trimisa_la).getTime()
          < 5 * 60 * 1000
      ) {
        return res.redirect(
          `/receptie/${id}?recenzie=deja_trimisa`
        );
      }

      try {
        const sent = await sendWhatsAppText({
          number: reception.telefon,
          text: reviewRequestMessage(reception)
        });

        await query(`
          UPDATE crm.receptii_atelier
          SET
            recenzie_trimisa_la = NOW(),
            recenzie_ultima_incercare_la = NOW(),
            recenzie_whatsapp_message_id = $2,
            recenzie_ultima_eroare = NULL,
            updated_at = NOW()
          WHERE id = $1
        `, [id, sent.messageId]);

        return res.redirect(
          `/receptie/${id}?recenzie=trimisa`
        );
      } catch (error) {
        await query(`
          UPDATE crm.receptii_atelier
          SET
            recenzie_ultima_incercare_la = NOW(),
            recenzie_ultima_eroare = $2,
            updated_at = NOW()
          WHERE id = $1
        `, [id, whatsappErrorMessage(error)]).catch(dbError => {
          console.error(
            'Salvare eroare solicitare recenzie eșuată:',
            dbError
          );
        });

        return res.redirect(
          `/receptie/${id}?recenzie=eroare`
        );
      }
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  '/receptie/:id/alerte',
  requireAuth,
  async (req, res, next) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).send('Recepție inexistentă');
    }

    const active = req.body.alerte_active === '1';

    try {
      const result = await query(`
        UPDATE crm.receptii_atelier
        SET alerte_active = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `, [id, active]);

      if (!result.rowCount) {
        return res.status(404).send('Recepție inexistentă');
      }

      return res.redirect(
        `/receptie/${id}?alerte=${active ? 'pornite' : 'oprite'}`
      );
    } catch (error) {
      next(error);
    }
  }
);

/* ACTIUNI RECEPTIE: STATUS SI STERGERE */
app.post(
  '/receptie/:id/status',
  requireAuth,
  async (req, res, next) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).send('Recepție inexistentă');
    }

    const status = String(req.body.status || '').trim();
    const notifyClient = req.body.notifica_client === '1';

    if (!receptionStatuses.includes(status)) {
      return res.redirect(`/receptie/${id}?eroare=status_nevalid`);
    }

    const client = await pool.connect();
    let reception;
    let historyId = null;

    try {
      await client.query('BEGIN');

      const locked = await client.query(`
        SELECT
          r.id,
          r.numar_receptie,
          r.status,
          r.este_test,
          c.telefon
        FROM crm.receptii_atelier r
        JOIN crm.clienti c ON c.id = r.client_id
        WHERE r.id = $1
        FOR UPDATE OF r
      `, [id]);

      if (!locked.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).send('Recepție inexistentă');
      }

      reception = locked.rows[0];

      if (reception.status === status) {
        await client.query('ROLLBACK');
        return res.redirect(
          `/receptie/${id}?salvat=1&notificare=neschimbat`
        );
      }

      await client.query(`
        UPDATE crm.receptii_atelier
        SET status = $2, updated_at = NOW()
        WHERE id = $1
      `, [id, status]);

      const history = await client.query(`
        INSERT INTO crm.receptie_status_istoric (
          receptie_id,
          status_vechi,
          status_nou,
          notificare_ceruta
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [id, reception.status, status, notifyClient]);

      historyId = history.rows[0].id;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      return next(error);
    } finally {
      client.release();
    }

    if (!notifyClient) {
      return res.redirect(
        `/receptie/${id}?salvat=1&notificare=dezactivata`
      );
    }

    try {
      const sent = await sendWhatsAppText({
        number: reception.telefon,
        text: receptionStatusMessage(reception, status)
      });

      await query(`
        UPDATE crm.receptie_status_istoric
        SET
          notificare_trimisa_la = NOW(),
          whatsapp_message_id = $2,
          notificare_eroare = NULL
        WHERE id = $1
      `, [historyId, sent.messageId]);

      return res.redirect(
        `/receptie/${id}?salvat=1&notificare=trimisa`
      );
    } catch (error) {
      await query(`
        UPDATE crm.receptie_status_istoric
        SET notificare_eroare = $2
        WHERE id = $1
      `, [historyId, whatsappErrorMessage(error)]).catch(dbError => {
        console.error('Salvare eroare notificare status eșuată:', dbError);
      });

      return res.redirect(
        `/receptie/${id}?salvat=1&notificare=esuata`
      );
    }
  }
);

app.post(
  '/receptie/:id/sterge',
  requireAuth,
  async (req, res, next) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).send(
        'Recepție inexistentă'
      );
    }

    const client = await pool.connect();
    const filePaths = [];

    try {
      await client.query('BEGIN');

      const result = await client.query(`
        SELECT
          id,
          echipament_id,
          semnare_status,
          este_test
        FROM crm.receptii_atelier
        WHERE id = $1
        FOR UPDATE
      `, [id]);

      if (!result.rowCount) {
        await client.query('ROLLBACK');

        return res.status(404).send(
          'Recepție inexistentă'
        );
      }

      const receptie = result.rows[0];

      if (receptie.este_test) {
        await client.query('ROLLBACK');

        return res.redirect(
          `/receptie/${id}?eroare=foloseste_stergere_test`
        );
      }

      if (receptie.semnare_status === 'semnat') {
        await client.query('ROLLBACK');

        return res.redirect(
          `/receptie/${id}?eroare=fisa_semnata`
        );
      }

      const linkedInterventions = await client.query(`
        SELECT
          id,
          status,
          semnat_la,
          semnatura_path,
          pdf_path
        FROM crm.interventii_teren
        WHERE receptie_id = $1
        FOR UPDATE
      `, [id]);

      const signedIntervention = linkedInterventions.rows.find(row => (
        row.status === 'semnat' || row.semnat_la
      ));

      if (signedIntervention) {
        await client.query('ROLLBACK');

        return res.redirect(
          `/receptie/${id}?eroare=interventie_semnata`
        );
      }

      for (const row of linkedInterventions.rows) {
        filePaths.push(row.semnatura_path, row.pdf_path);
      }

      if (linkedInterventions.rowCount) {
        const interventionPhotos = await client.query(`
          SELECT nume_stocare
          FROM crm.interventie_teren_fotografii
          WHERE interventie_id = ANY($1::bigint[])
        `, [linkedInterventions.rows.map(row => row.id)]);

        for (const row of interventionPhotos.rows) {
          filePaths.push(path.join(
            fieldPhotoDirectory,
            path.basename(row.nume_stocare)
          ));
        }
      }

      const receptionFiles = await client.query(`
        SELECT semnatura_path AS file_path
        FROM crm.receptii_atelier
        WHERE id = $1
        UNION ALL
        SELECT pdf_path
        FROM crm.receptii_atelier
        WHERE id = $1
        UNION ALL
        SELECT pdf_path
        FROM crm.certificate_garantie
        WHERE receptie_id = $1
        UNION ALL
        SELECT pdf_path
        FROM crm.documente_service
        WHERE receptie_id = $1
        UNION ALL
        SELECT semnatura_path
        FROM crm.documente_service
        WHERE receptie_id = $1
      `, [id]);

      filePaths.push(...receptionFiles.rows.map(row => row.file_path));

      const receptionPhotos = await client.query(`
        SELECT nume_stocare
        FROM crm.receptie_fotografii
        WHERE receptie_id = $1
      `, [id]);

      for (const row of receptionPhotos.rows) {
        filePaths.push(path.join(
          receptionPhotoDirectory,
          path.basename(row.nume_stocare)
        ));
      }

      await client.query(`
        DELETE FROM crm.certificate_garantie
        WHERE receptie_id = $1
      `, [id]);

      await client.query(`
        DELETE FROM crm.interventii_teren
        WHERE receptie_id = $1
      `, [id]);

      await client.query(`
        DELETE FROM crm.receptii_atelier
        WHERE id = $1
      `, [id]);

      await client.query('COMMIT');

      await removeDeletedReceptionFiles(filePaths);

      res.redirect('/receptie?stearsa=1');
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

app.post(
  '/receptie/noua',
  requireAuth,
  async (req, res, next) => {
    try {
      const text = (value) =>
        String(value ?? '').trim();

      const nullIfEmpty = (value) => {
        const result = text(value);
        return result || null;
      };

      const values = {
        este_test: req.body.este_test === 'on',
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
        stare_la_primire: text(req.body.stare_la_primire),
        are_accesorii: text(req.body.are_accesorii),
        accesorii: text(req.body.accesorii),
        observatii: text(req.body.observatii)
      };

      const areAccesoriiValid =
        values.are_accesorii === 'nu' ||
        values.are_accesorii === 'da';
      const pretEstimatText =
        values.pret_estimat_reparatie.replace(',', '.');
      const pretEstimat = pretEstimatText === ''
        ? null
        : Number(pretEstimatText);
      const pretEstimatValid =
        pretEstimat === null ||
        (Number.isFinite(pretEstimat) && pretEstimat >= 0);

      if (
        !values.nume ||
        !values.telefon ||
        !values.tip_echipament ||
        !values.defect_reclamat ||
        !areAccesoriiValid
      ) {
        return res.status(400).render('receptie-noua', {
          error:
            'Completeaz\u0103 toate c\u00e2mpurile obligatorii.',
          values,
          active: 'receptie'
        });
      }

      if (!pretEstimatValid) {
        return res.status(400).render('receptie-noua', {
          error:
            'Prețul estimat trebuie să fie un număr pozitiv sau zero.',
          values,
          active: 'receptie'
        });
      }

      if (
        values.are_accesorii === 'da' &&
        !values.accesorii
      ) {
        return res.status(400).render('receptie-noua', {
          error: 'Descrie accesoriile predate.',
          values,
          active: 'receptie'
        });
      }

      if (
        values.tip_echipament === 'Altul' &&
        !values.descriere_echipament
      ) {
        return res.status(400).render('receptie-noua', {
          error:
            'Descrie echipamentul selectat ca Altul.',
          values,
          active: 'receptie'
        });
      }

      const areAccesorii =
        values.are_accesorii === 'da';
      const testGroupId = values.este_test
        ? crypto.randomUUID()
        : null;

      const result = await query(`
        WITH client AS (
          INSERT INTO crm.clienti (
            telefon,
            nume,
            email,
            adresa,
            creat_din_test,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $15, CURRENT_TIMESTAMP)
          ON CONFLICT (telefon)
          DO UPDATE SET
            nume = CASE
              WHEN $15 THEN crm.clienti.nume
              ELSE COALESCE(EXCLUDED.nume, crm.clienti.nume)
            END,
            email = CASE
              WHEN $15 THEN crm.clienti.email
              ELSE COALESCE(EXCLUDED.email, crm.clienti.email)
            END,
            adresa = CASE
              WHEN $15 THEN crm.clienti.adresa
              ELSE COALESCE(EXCLUDED.adresa, crm.clienti.adresa)
            END,
            creat_din_test = CASE
              WHEN $15 THEN crm.clienti.creat_din_test
              ELSE FALSE
            END,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id
        ),
        echipament AS (
          INSERT INTO crm.echipamente_atelier (
            client_id,
            tip_echipament,
            descriere_echipament,
            marca,
            model,
            serie,
            stare_la_primire,
            este_test,
            test_grup_id
          )
          SELECT
            id,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $15,
            $16::uuid
          FROM client
          RETURNING id, client_id
        )
        INSERT INTO crm.receptii_atelier (
          client_id,
          echipament_id,
          defect_reclamat,
          are_accesorii,
          accesorii,
          observatii,
          pret_estimat_reparatie,
          este_test,
          test_grup_id
        )
        SELECT
          client_id,
          id,
          $11,
          $12,
          $13,
          $14,
          $17,
          $15,
          $16::uuid
        FROM echipament
        RETURNING id
      `, [
        values.telefon,
        nullIfEmpty(values.nume),
        nullIfEmpty(values.email),
        nullIfEmpty(values.adresa),
        values.tip_echipament,
        nullIfEmpty(values.descriere_echipament),
        nullIfEmpty(values.marca),
        nullIfEmpty(values.model),
        nullIfEmpty(values.serie),
        nullIfEmpty(values.stare_la_primire),
        values.defect_reclamat,
        areAccesorii,
        areAccesorii ? values.accesorii : null,
        nullIfEmpty(values.observatii),
        values.este_test,
        testGroupId,
        pretEstimat
      ]);

      await query(`
        UPDATE crm.receptii_atelier
        SET
          numar_receptie =
            crm.urmatorul_numar_receptie(este_test),
          updated_at = NOW()
        WHERE id = $1
      `, [result.rows[0].id]);

      let whatsappLink = 'eroare';

      try {
        const signing = await createAndSendReceptionSigningLink(
          result.rows[0].id
        );
        whatsappLink = signing.whatsappTrimis
          ? 'trimis'
          : 'eroare';
      } catch (error) {
        console.error(
          'Eroare trimitere automată link recepție:',
          error
        );
      }

      res.redirect(
        `/receptie/${result.rows[0].id}` +
        `?created=1&whatsapp_link=${whatsappLink}`
      );
    } catch (error) {
      next(error);
    }
  }
);

registerFieldRoutes(
  app,
  requireAuth,
  signingLinkLimiter
);
registerTechnicianScheduleRoutes(app, requireAuth);
registerReceptionLabelRoutes(app, requireAuth);
registerMaintenanceRoutes(app, requireAuth);
registerWarrantyRoutes(app, requireAuth);
registerTestModeRoutes(app, requireAuth);
registerTechnicalSheetRoutes(app, { requireAuth });
registerServiceDocumentRoutes(app, requireAuth);
registerDefectLibraryRoutes(app, requireAuth);

app.use((error, req, res, _next) => {
  logError(error, req);

  res.status(500).render('error', {
    message:
      'A ap\u0103rut o eroare. ' +
      'Verific\u0103 jurnalul aplica\u021biei.',
    active: ''
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(
    `Mozy CRM ruleaz\u0103 pe portul ${port}`
  );

  processReceptionDeadlineAlerts();
  setInterval(
    processReceptionDeadlineAlerts,
    60 * 60 * 1000
  );
});
