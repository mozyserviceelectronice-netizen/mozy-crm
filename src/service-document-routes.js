import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from './db.js';
import { generateServiceDocumentPdf } from './service-document-pdf.js';
import { sendWhatsAppPdf } from './evolution-whatsapp.js';

const ROOT = '/app/data/documente-service';
const SIGNATURE_ROOT = path.join(ROOT, 'semnaturi');
const TYPES = new Set(['deviz', 'constatare']);

const clean = value => String(value ?? '').trim();
const optional = value => clean(value) || null;
const integer = value => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};
const operatorName = user => (
  typeof user === 'string' ? user : user?.username || user?.name || 'operator'
);
const amount = value => {
  if (value === '' || value === null || value === undefined) return 0;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) && number >= 0 ? number : NaN;
};

async function loadSource(kind, id) {
  if (kind === 'fisa') {
    const result = await query(`
      SELECT f.id, f.client_id, f.televizor_id, NULL::bigint AS echipament_id,
        f.defect_reclamat, f.este_test, f.test_grup_id,
        c.nume, c.telefon, c.adresa,
        COALESCE(t.tip_tv, 'Televizor') AS tip_echipament,
        t.marca, t.model, t.serie
      FROM crm.fise_service f
      JOIN crm.clienti c ON c.id = f.client_id
      LEFT JOIN crm.televizoare t ON t.id = f.televizor_id
      WHERE f.id = $1
    `, [id]);
    return result.rows[0] || null;
  }
  const result = await query(`
    SELECT r.id, r.client_id, NULL::bigint AS televizor_id,
      r.echipament_id, r.defect_reclamat, r.este_test, r.test_grup_id,
      c.nume, c.telefon, c.adresa,
      CASE WHEN e.tip_echipament = 'Altul'
        THEN COALESCE(e.descriere_echipament, e.tip_echipament)
        ELSE e.tip_echipament END AS tip_echipament,
      e.marca, e.model, e.serie
    FROM crm.receptii_atelier r
    JOIN crm.clienti c ON c.id = r.client_id
    JOIN crm.echipamente_atelier e ON e.id = r.echipament_id
    WHERE r.id = $1
  `, [id]);
  return result.rows[0] || null;
}

function backUrl(kind, id) {
  return kind === 'fisa' ? `/fise/${id}` : `/receptie/${id}`;
}

function formUrl(kind, id, type) {
  return `/documente-service/${kind}/${id}/${type}`;
}

function parseForm(type, body, source, operator) {
  const common = {
    beneficiar: optional(body.beneficiar),
    telefon: clean(body.telefon),
    adresa: optional(body.adresa),
    echipament: optional(body.echipament),
    marca: optional(body.marca),
    model: optional(body.model),
    serie: optional(body.serie),
    operator,
    semnatura_data: optional(body.semnatura_data)
  };
  if (type === 'deviz') {
    return {
      ...common,
      identificator_beneficiar: optional(body.identificator_beneficiar),
      defect_reclamat: optional(body.defect_reclamat),
      diagnostic: clean(body.diagnostic),
      operatiuni: clean(body.operatiuni),
      piese: optional(body.piese),
      manopera_descriere: optional(body.manopera_descriere),
      cost_piese: amount(body.cost_piese),
      cost_manopera: amount(body.cost_manopera),
      alte_costuri: amount(body.alte_costuri),
      cota_tva: amount(body.cota_tva),
      termen_executie: optional(body.termen_executie),
      valabilitate: optional(body.valabilitate),
      observatii: optional(body.observatii),
      alte_mentiuni: optional(body.alte_mentiuni)
    };
  }
  return {
    ...common,
    destinatie: optional(body.destinatie),
    defect: optional(body.defect),
    stare_examinare: optional(body.stare_examinare),
    constatari: clean(body.constatari),
    cauza_probabila: optional(body.cauza_probabila),
    verificari: optional(body.verificari),
    recomandare: optional(body.recomandare),
    concluzie: clean(body.concluzie),
    observatii: optional(body.observatii)
  };
}

async function persistSignature(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('Semnătura are un format invalid.');
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) {
    throw new Error('Semnătura este goală sau prea mare.');
  }
  await fs.mkdir(SIGNATURE_ROOT, { recursive: true });
  const signaturePath = path.join(SIGNATURE_ROOT, `${crypto.randomUUID()}.png`);
  await fs.writeFile(signaturePath, bytes, { flag: 'wx' });
  return {
    path: signaturePath,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    signedAt: new Date().toISOString()
  };
}

function validate(type, data) {
  if (!data.telefon) return 'Telefonul clientului este obligatoriu.';
  if (type === 'deviz') {
    if (!data.diagnostic) return 'Completează diagnosticul.';
    if (!data.operatiuni) return 'Completează operațiunile propuse.';
    if ([data.cost_piese, data.cost_manopera, data.alte_costuri, data.cota_tva]
      .some(Number.isNaN)) return 'Valorile și TVA-ul trebuie să fie numere pozitive.';
    if (data.cota_tva > 100) return 'Cota TVA nu poate depăși 100%.';
  } else {
    if (!data.constatari) return 'Completează constatările tehnice.';
    if (!data.concluzie) return 'Completează concluzia tehnică.';
  }
  return null;
}

async function listDocuments(kind, id, type) {
  const column = kind === 'fisa' ? 'fisa_id' : 'receptie_id';
  return query(`
    SELECT id, numar_document, numar_inregistrare, tip_document,
      created_at, trimisa_la, eroare_trimitere, total_cu_tva,
      date_document ? 'semnatura_path' AS este_semnat
    FROM crm.documente_service
    WHERE ${column} = $1 AND tip_document = $2
    ORDER BY id DESC
  `, [id, type]);
}

async function renderForm(res, {
  kind, id, type, source, form = null, error = null, created = null
}) {
  const documents = await listDocuments(kind, id, type);
  res.render('service-document-form', {
    kind, id, type, source, form, error, created,
    documents: documents.rows,
    active: kind === 'fisa' ? 'fise' : 'receptie',
    backUrl: backUrl(kind, id),
    formAction: formUrl(kind, id, type)
  });
}

async function generatePdf(record) {
  const directory = path.join(ROOT, record.tip_document);
  const outputPath = path.join(directory, `${record.numar_document}.pdf`);
  await generateServiceDocumentPdf(record, outputPath);
  const bytes = await fs.readFile(outputPath);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  await query(`
    UPDATE crm.documente_service
    SET pdf_path = $1, pdf_sha256 = $2, updated_at = now()
    WHERE id = $3
  `, [outputPath, sha, record.id]);
  return outputPath;
}

async function sendDocument(record, pdfPath) {
  try {
    const result = await sendWhatsAppPdf({
      number: record.date_document.telefon,
      pdfPath,
      fileName: `${record.numar_document}.pdf`,
      caption: record.tip_document === 'deviz'
        ? `Bună ziua! Vă transmitem devizul ${record.numar_document}, emis de Mozy Service Electronice.`
        : `Bună ziua! Vă transmitem constatarea tehnică ${record.numar_document}, emisă de Mozy Service Electronice.`
    });
    await query(`
      UPDATE crm.documente_service SET trimisa_la = now(),
        whatsapp_message_id = $1, eroare_trimitere = NULL, updated_at = now()
      WHERE id = $2
    `, [result?.messageId || null, record.id]);
  } catch (error) {
    await query(`
      UPDATE crm.documente_service SET eroare_trimitere = $1,
        updated_at = now() WHERE id = $2
    `, [String(error.message || error).slice(0, 1000), record.id]);
    throw error;
  }
}

export function registerServiceDocumentRoutes(app, requireAuth) {
  app.get('/documente-service/:kind/:id/:type', requireAuth, async (req, res, next) => {
    try {
      const { kind, type } = req.params;
      const id = integer(req.params.id);
      if (!id || !['fisa', 'receptie'].includes(kind) || !TYPES.has(type)) {
        return res.status(404).send('Document inexistent');
      }
      const source = await loadSource(kind, id);
      if (!source) return res.status(404).send('Fișă inexistentă');
      await renderForm(res, {
        kind, id, type, source,
        created: integer(req.query.created)
      });
    } catch (error) { next(error); }
  });

  app.post('/documente-service/:kind/:id/:type', requireAuth, async (req, res, next) => {
    try {
      const { kind, type } = req.params;
      const id = integer(req.params.id);
      if (!id || !['fisa', 'receptie'].includes(kind) || !TYPES.has(type)) {
        return res.status(404).send('Document inexistent');
      }
      const source = await loadSource(kind, id);
      if (!source) return res.status(404).send('Fișă inexistentă');
      const data = parseForm(type, req.body, source, operatorName(req.user));
      const validationError = validate(type, data);
      if (validationError) {
        return res.status(400) && renderForm(res, {
          kind, id, type, source, form: data, error: validationError
        });
      }
      let signature = null;
      try {
        signature = await persistSignature(data.semnatura_data);
      } catch (signatureError) {
        return res.status(400) && renderForm(res, {
          kind, id, type, source, form: data,
          error: signatureError.message
        });
      }
      delete data.semnatura_data;
      if (signature) {
        data.semnatura_path = signature.path;
        data.semnatura_sha256 = signature.sha256;
        data.semnat_la = signature.signedAt;
      }
      const base = type === 'deviz'
        ? data.cost_piese + data.cost_manopera + data.alte_costuri
        : null;
      const vat = type === 'deviz' ? base * data.cota_tva / 100 : null;
      const inserted = await query(`
        INSERT INTO crm.documente_service (
          tip_document, fisa_id, receptie_id, client_id,
          echipament_id, televizor_id, date_document,
          total_fara_tva, cota_tva, valoare_tva, total_cu_tva,
          operator_username, trimite_whatsapp, este_test, test_grup_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb,
          $8, $9, $10, $11, $12, $13, $14, $15::uuid
        ) RETURNING *
      `, [
        type, kind === 'fisa' ? id : null, kind === 'receptie' ? id : null,
        source.client_id, source.echipament_id, source.televizor_id,
        JSON.stringify(data), base, type === 'deviz' ? data.cota_tva : null,
        vat, type === 'deviz' ? base + vat : null, operatorName(req.user),
        req.body.trimite_whatsapp === '1', source.este_test, source.test_grup_id
      ]);
      const numbered = await query(`
        UPDATE crm.documente_service SET
          numar_document = crm.urmatorul_numar_document(tip_document, este_test),
          updated_at = now()
        WHERE id = $1 RETURNING *
      `, [inserted.rows[0].id]);
      const registered = await query(`
        UPDATE crm.documente_service SET
          numar_inregistrare =
            substring(numar_document from '([0-9]+)$')::bigint,
          updated_at = now()
        WHERE id = $1 RETURNING *
      `, [numbered.rows[0].id]);
      const record = registered.rows[0];
      const pdfPath = await generatePdf(record);
      if (record.trimite_whatsapp) {
        await sendDocument(record, pdfPath).catch(() => {});
      }
      res.redirect(`${formUrl(kind, id, type)}?created=${record.id}`);
    } catch (error) { next(error); }
  });

  app.get('/documente-service/:documentId/pdf', requireAuth, async (req, res, next) => {
    try {
      const id = integer(req.params.documentId);
      const result = id ? await query(
        'SELECT * FROM crm.documente_service WHERE id = $1', [id]
      ) : { rows: [] };
      const record = result.rows[0];
      if (!record) return res.status(404).send('Document inexistent');
      let pdfPath = record.pdf_path;
      try { await fs.access(pdfPath); } catch { pdfPath = await generatePdf(record); }
      if (req.query.download === '1') {
        return res.download(pdfPath, `${record.numar_document}.pdf`);
      }
      res.type('application/pdf');
      res.set('Cache-Control', 'private, no-store');
      return res.sendFile(pdfPath);
    } catch (error) { next(error); }
  });

  app.post('/documente-service/:documentId/regenerare', requireAuth, async (req, res, next) => {
    try {
      const id = integer(req.params.documentId);
      const result = id ? await query(
        'SELECT * FROM crm.documente_service WHERE id = $1', [id]
      ) : { rows: [] };
      const record = result.rows[0];
      if (!record) return res.status(404).send('Document inexistent');
      await generatePdf(record);
      const kind = record.fisa_id ? 'fisa' : 'receptie';
      const sourceId = record.fisa_id || record.receptie_id;
      res.redirect(`${formUrl(kind, sourceId, record.tip_document)}?created=${record.id}`);
    } catch (error) { next(error); }
  });

  app.post('/documente-service/:documentId/trimite', requireAuth, async (req, res, next) => {
    try {
      const id = integer(req.params.documentId);
      const result = id ? await query(
        'SELECT * FROM crm.documente_service WHERE id = $1', [id]
      ) : { rows: [] };
      const record = result.rows[0];
      if (!record) return res.status(404).send('Document inexistent');
      let pdfPath = record.pdf_path;
      try { await fs.access(pdfPath); } catch { pdfPath = await generatePdf(record); }
      await sendDocument(record, pdfPath);
      const kind = record.fisa_id ? 'fisa' : 'receptie';
      const sourceId = record.fisa_id || record.receptie_id;
      res.redirect(`${formUrl(kind, sourceId, record.tip_document)}?created=${record.id}`);
    } catch (error) { next(error); }
  });
}
