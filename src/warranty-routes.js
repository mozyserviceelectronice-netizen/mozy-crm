import fs from 'node:fs';
import path from 'node:path';
import { query } from './db.js';
import { generateWarrantyPdf } from './warranty-pdf.js';
import { sendWhatsAppPdf } from './evolution-whatsapp.js';

const DURATIONS = [1, 3, 6, 9, 12];
const PDF_DIRECTORY = '/app/data/garantii';
// GARANTII INDEPENDENTE v1.0.0

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function optional(value) {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
}

function required(value) {
  return String(value ?? '').trim();
}

function operatorName(user) {
  if (typeof user === 'string') return user;
  return user?.username || user?.name || 'operator';
}

async function loadServiceFile(id) {
  const result = await query(`
    SELECT
      f.id,
      f.client_id,
      f.televizor_id,
      f.este_test,
      f.test_grup_id,
      f.defect_reclamat,
      f.pret_agreat,
      f.pret_estimat,
      c.nume,
      c.telefon,
      c.adresa,
      t.tip_tv,
      t.marca,
      t.model,
      t.serie
    FROM crm.fise_service f
    JOIN crm.clienti c ON c.id = f.client_id
    LEFT JOIN crm.televizoare t ON t.id = f.televizor_id
    WHERE f.id = $1
  `, [id]);

  return result.rows[0] || null;
}

async function loadReception(id) {
  const result = await query(`
    SELECT
      r.id,
      r.status,
      r.client_id,
      r.echipament_id,
      r.este_test,
      r.test_grup_id,
      r.defect_reclamat,
      c.nume,
      c.telefon,
      c.adresa,
      e.tip_echipament,
      e.descriere_echipament,
      e.marca,
      e.model,
      e.serie
    FROM crm.receptii_atelier r
    JOIN crm.clienti c ON c.id = r.client_id
    JOIN crm.echipamente_atelier e ON e.id = r.echipament_id
    WHERE r.id = $1
  `, [id]);

  return result.rows[0] || null;
}

async function certificatesFor(column, id) {
  return query(`
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
    WHERE ${column} = $1
    ORDER BY id DESC
  `, [id]);
}

function warrantyFormData(body) {
  return {
    nume_client: optional(body.nume_client),
    telefon: required(body.telefon),
    adresa_client: optional(body.adresa_client),
    tip_echipament: optional(body.tip_echipament),
    marca: optional(body.marca),
    model: optional(body.model),
    serie: optional(body.serie),
    defect_reclamat: optional(body.defect_reclamat),
    interventie_efectuata: required(body.interventie_efectuata),
    piese_componente: optional(body.piese_componente),
    pret_lucrare: optional(body.pret_lucrare)
  };
}

function validateWarranty(form, duration) {
  if (!form.telefon) return 'Telefonul este obligatoriu.';
  if (!form.interventie_efectuata) {
    return 'Completează intervenția efectuată.';
  }
  if (!DURATIONS.includes(duration)) {
    return 'Durata garanției nu este validă.';
  }
  if (
    form.pret_lucrare !== null &&
    (
      !Number.isFinite(Number(form.pret_lucrare)) ||
      Number(form.pret_lucrare) < 0
    )
  ) {
    return 'Prețul lucrării nu este valid.';
  }
  return null;
}

async function generateCertificate(certificate) {
  const filename = `${certificate.numar_certificat}.pdf`;
  const outputPath = path.join(PDF_DIRECTORY, filename);

  try {
    await generateWarrantyPdf(certificate, outputPath);
    await query(`
      UPDATE crm.certificate_garantie
      SET pdf_path = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [outputPath, certificate.id]);
  } catch (pdfError) {
    await query(`
      UPDATE crm.certificate_garantie
      SET
        status = 'eroare_trimitere',
        eroare_trimitere = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [
      String(pdfError.message || pdfError).slice(0, 1000),
      certificate.id
    ]);
    throw pdfError;
  }
}


function certificateBackUrl(certificate, result) {
  if (certificate.receptie_id) {
    return `/receptie/${certificate.receptie_id}?garantie=${result}`;
  }
  if (certificate.fisa_id) {
    return `/fise/${certificate.fisa_id}/garantie?trimitere=${result}`;
  }
  return `/garantii?created=${certificate.id}&trimitere=${result}`;
}

function independentFormValues(body = {}) {
  const form = warrantyFormData(body);
  return {
    ...form,
    durata_luni: integer(body.durata_luni) || 6
  };
}

export function registerWarrantyRoutes(app, requireAuth) {
  app.get('/fise/:id/garantie', requireAuth, async (req, res, next) => {
    try {
      const id = integer(req.params.id);
      if (!id) return res.status(404).send('Fi\u0219\u0103 inexistent\u0103');

      const fisa = await loadServiceFile(id);
      if (!fisa) return res.status(404).send('Fi\u0219\u0103 inexistent\u0103');

      const certificates = await certificatesFor('fisa_id', id);

      res.render('garantie-form', {
        fisa,
        certificates: certificates.rows,
        durations: DURATIONS,
        created: integer(req.query.created),
        error: null,
        active: 'fise',
        formAction: `/fise/${id}/garantie`,
        backUrl: `/fise/${id}`,
        sourceLabel: `Fișă service #${id}`,
        isReception: false
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/fise/:id/garantie', requireAuth, async (req, res, next) => {
    try {
      const id = integer(req.params.id);
      const duration = integer(req.body.durata_luni);
      const fisa = id ? await loadServiceFile(id) : null;

      if (!fisa) return res.status(404).send('Fi\u0219\u0103 inexistent\u0103');

      const form = warrantyFormData(req.body);
      const validationError = validateWarranty(form, duration);

      if (validationError) {
        const certificates = await certificatesFor('fisa_id', id);

        return res.status(400).render('garantie-form', {
          fisa: { ...fisa, ...form },
          certificates: certificates.rows,
          durations: DURATIONS,
          created: null,
          error: validationError,
          active: 'fise',
          formAction: `/fise/${id}/garantie`,
          backUrl: `/fise/${id}`,
          sourceLabel: `Fișă service #${id}`,
          isReception: false
        });
      }

      const inserted = await query(`
        INSERT INTO crm.certificate_garantie (
          fisa_id, client_id, televizor_id,
          durata_luni, data_expirarii, operator_username,
          nume_client, telefon, adresa_client,
          tip_echipament, marca, model, serie,
          defect_reclamat, interventie_efectuata,
          piese_componente, pret_lucrare,
          este_test, test_grup_id
        )
        VALUES (
          $1, $2, $3,
          $4,
          ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bucharest')::date + make_interval(months => $4::integer))::date,
          $5,
          $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16,
          $17, $18::uuid
        )
        RETURNING *
      `, [
        id,
        fisa.client_id,
        fisa.televizor_id,
        duration,
        operatorName(req.user),
        form.nume_client,
        form.telefon,
        form.adresa_client,
        form.tip_echipament,
        form.marca,
        form.model,
        form.serie,
        form.defect_reclamat,
        form.interventie_efectuata,
        form.piese_componente,
        form.pret_lucrare === null ? null : Number(form.pret_lucrare),
        fisa.este_test,
        fisa.test_grup_id
      ]);

      const numbered = await query(`
        UPDATE crm.certificate_garantie
        SET
          numar_certificat =
            crm.urmatorul_numar_garantie(este_test),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `, [inserted.rows[0].id]);
      const certificate = numbered.rows[0];
      await generateCertificate(certificate);

      res.redirect(`/fise/${id}/garantie?created=${certificate.id}`);
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/receptie/:id/garantie',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = integer(req.params.id);
        if (!id) return res.status(404).send('Recepție inexistentă');

        const receptie = await loadReception(id);
        if (!receptie) {
          return res.status(404).send('Recepție inexistentă');
        }
        if (receptie.status !== 'finalizat') {
          return res.redirect(
            `/receptie/${id}?eroare=garantie_status`
          );
        }

        const certificates = await certificatesFor('receptie_id', id);

        res.render('garantie-form', {
          fisa: receptie,
          certificates: certificates.rows,
          durations: DURATIONS,
          created: integer(req.query.created),
          error: null,
          active: 'receptie',
          formAction: `/receptie/${id}/garantie`,
          backUrl: `/receptie/${id}`,
          sourceLabel: `Recepție atelier #${id}`,
          isReception: true
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/receptie/:id/garantie',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = integer(req.params.id);
        const duration = integer(req.body.durata_luni);
        const receptie = id ? await loadReception(id) : null;

        if (!receptie) {
          return res.status(404).send('Recepție inexistentă');
        }
        if (receptie.status !== 'finalizat') {
          return res.redirect(
            `/receptie/${id}?eroare=garantie_status`
          );
        }

        const existing = await certificatesFor('receptie_id', id);
        if (existing.rowCount) {
          return res.redirect(`/receptie/${id}/garantie`);
        }

        const form = warrantyFormData(req.body);
        const validationError = validateWarranty(form, duration);

        if (validationError) {
          return res.status(400).render('garantie-form', {
            fisa: { ...receptie, ...form },
            certificates: existing.rows,
            durations: DURATIONS,
            created: null,
            error: validationError,
            active: 'receptie',
            formAction: `/receptie/${id}/garantie`,
            backUrl: `/receptie/${id}`,
            sourceLabel: `Recepție atelier #${id}`,
            isReception: true
          });
        }

        const inserted = await query(`
          INSERT INTO crm.certificate_garantie (
            receptie_id,
            client_id,
            durata_luni,
            data_expirarii,
            operator_username,
            nume_client,
            telefon,
            adresa_client,
            tip_echipament,
            marca,
            model,
            serie,
            defect_reclamat,
            interventie_efectuata,
            piese_componente,
            pret_lucrare,
            este_test,
            test_grup_id
          )
          VALUES (
            $1, $2, $3,
            (
              (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bucharest')::date +
              make_interval(months => $3::integer)
            )::date,
            $4, $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15,
            $16, $17::uuid
          )
          RETURNING *
        `, [
          id,
          receptie.client_id,
          duration,
          operatorName(req.user),
          form.nume_client,
          form.telefon,
          form.adresa_client,
          form.tip_echipament,
          form.marca,
          form.model,
          form.serie,
          form.defect_reclamat,
          form.interventie_efectuata,
          form.piese_componente,
          form.pret_lucrare === null
            ? null
            : Number(form.pret_lucrare),
          receptie.este_test,
          receptie.test_grup_id
        ]);

        const numbered = await query(`
          UPDATE crm.certificate_garantie
          SET
            numar_certificat =
              crm.urmatorul_numar_garantie(este_test),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `, [inserted.rows[0].id]);
        const certificate = numbered.rows[0];
        await generateCertificate(certificate);

        res.redirect(
          `/receptie/${id}/garantie?created=${certificate.id}`
        );
      } catch (error) {
        if (error?.code === '23505') {
          return res.redirect(`/receptie/${req.params.id}/garantie`);
        }
        next(error);
      }
    }
  );


  app.get('/garantii', requireAuth, async (req, res, next) => {
    try {
      const search = required(req.query.q).slice(0, 120);
      const result = await query(`
        SELECT
          id,
          fisa_id,
          receptie_id,
          numar_certificat,
          data_emiterii,
          data_expirarii,
          durata_luni,
          nume_client,
          telefon,
          tip_echipament,
          marca,
          model,
          serie,
          status,
          trimisa_la,
          eroare_trimitere,
          este_test
        FROM crm.certificate_garantie
        WHERE (
          $1 = ''
          OR numar_certificat ILIKE '%' || $1 || '%'
          OR COALESCE(nume_client, '') ILIKE '%' || $1 || '%'
          OR telefon ILIKE '%' || $1 || '%'
          OR COALESCE(marca, '') ILIKE '%' || $1 || '%'
          OR COALESCE(model, '') ILIKE '%' || $1 || '%'
          OR COALESCE(serie, '') ILIKE '%' || $1 || '%'
        )
        ORDER BY id DESC
        LIMIT 150
      `, [search]);

      res.render('garantii-lista', {
        active: 'garantii',
        certificates: result.rows,
        search,
        created: integer(req.query.created),
        trimitere: required(req.query.trimitere)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/garantii/noua', requireAuth, (req, res) => {
    res.render('garantie-independenta', {
      active: 'garantii',
      durations: DURATIONS,
      values: independentFormValues(),
      error: null
    });
  });

  app.post('/garantii/noua', requireAuth, async (req, res, next) => {
    try {
      const duration = integer(req.body.durata_luni);
      const values = independentFormValues(req.body);
      const validationError = validateWarranty(values, duration);
      const phoneDigits = values.telefon.replace(/\D/g, '');

      if (validationError || phoneDigits.length < 9) {
        return res.status(400).render('garantie-independenta', {
          active: 'garantii',
          durations: DURATIONS,
          values,
          error: validationError || 'Numărul de telefon nu este valid.'
        });
      }

      const inserted = await query(`
        WITH matched_client AS (
          SELECT id
          FROM crm.clienti
          WHERE RIGHT(
            REGEXP_REPLACE(telefon, '[^0-9]', '', 'g'),
            9
          ) = RIGHT($1, 9)
          ORDER BY id
          LIMIT 1
        ),
        updated_client AS (
          UPDATE crm.clienti AS c
          SET
            nume = COALESCE($2, c.nume),
            adresa = COALESCE($3, c.adresa),
            updated_at = CURRENT_TIMESTAMP
          WHERE c.id = (SELECT id FROM matched_client)
          RETURNING c.id
        ),
        created_client AS (
          INSERT INTO crm.clienti (
            telefon,
            nume,
            adresa,
            updated_at
          )
          SELECT
            $4,
            $2,
            $3,
            CURRENT_TIMESTAMP
          WHERE NOT EXISTS (SELECT 1 FROM updated_client)
          ON CONFLICT (telefon)
          DO UPDATE SET
            nume = COALESCE(EXCLUDED.nume, crm.clienti.nume),
            adresa = COALESCE(EXCLUDED.adresa, crm.clienti.adresa),
            updated_at = CURRENT_TIMESTAMP
          RETURNING id
        ),
        selected_client AS (
          SELECT id FROM updated_client
          UNION ALL
          SELECT id FROM created_client
          LIMIT 1
        )
        INSERT INTO crm.certificate_garantie (
          client_id,
          durata_luni,
          data_expirarii,
          operator_username,
          nume_client,
          telefon,
          adresa_client,
          tip_echipament,
          marca,
          model,
          serie,
          defect_reclamat,
          interventie_efectuata,
          piese_componente,
          pret_lucrare,
          este_test
        )
        SELECT
          selected_client.id,
          $5,
          (
            (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bucharest')::date +
            make_interval(months => $5::integer)
          )::date,
          $6,
          $2,
          $4,
          $3,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          FALSE
        FROM selected_client
        RETURNING *
      `, [
        phoneDigits,
        values.nume_client,
        values.adresa_client,
        values.telefon,
        duration,
        operatorName(req.user),
        values.tip_echipament,
        values.marca,
        values.model,
        values.serie,
        values.defect_reclamat,
        values.interventie_efectuata,
        values.piese_componente,
        values.pret_lucrare === null
          ? null
          : Number(values.pret_lucrare)
      ]);

      if (!inserted.rowCount) {
        throw new Error('Clientul nu a putut fi creat sau identificat.');
      }

      const numbered = await query(`
        UPDATE crm.certificate_garantie
        SET
          numar_certificat =
            crm.urmatorul_numar_garantie(este_test),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `, [inserted.rows[0].id]);
      const certificate = numbered.rows[0];

      await generateCertificate(certificate);
      res.redirect(`/garantii?created=${certificate.id}`);
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/garantii/:id/trimite',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = integer(req.params.id);
        if (!id) return res.status(404).send('Certificat inexistent');

        const result = await query(`
          SELECT
            id,
            fisa_id,
            receptie_id,
            numar_certificat,
            este_test,
            telefon,
            pdf_path,
            trimisa_la
          FROM crm.certificate_garantie
          WHERE id = $1
        `, [id]);
        const certificate = result.rows[0];

        if (
          !certificate?.pdf_path ||
          !fs.existsSync(certificate.pdf_path)
        ) {
          return res.status(404).send(
            'PDF-ul certificatului nu a fost găsit.'
          );
        }

        if (
          certificate.trimisa_la &&
          Date.now() - new Date(certificate.trimisa_la).getTime() < 60_000
        ) {
          return res.redirect(
            certificateBackUrl(certificate, 'deja_trimisa')
          );
        }

        try {
          const sent = await sendWhatsAppPdf({
            number: certificate.telefon,
            filePath: certificate.pdf_path,
            fileName: `${certificate.numar_certificat}.pdf`,
            caption:
              (certificate.este_test
                ? 'DOCUMENT DE TEST – FĂRĂ VALOARE\n'
                : '') +
              `Certificat de garanție ${certificate.numar_certificat} - ` +
              'Mozy Service Electronice'
          });

          await query(`
            UPDATE crm.certificate_garantie
            SET
              status = 'trimisa',
              whatsapp_message_id = $2,
              trimisa_la = CURRENT_TIMESTAMP,
              eroare_trimitere = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [id, sent.messageId]);
        } catch (sendError) {
          await query(`
            UPDATE crm.certificate_garantie
            SET
              status = 'eroare_trimitere',
              eroare_trimitere = $2,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [
            id,
            String(sendError.message || sendError).slice(0, 1000)
          ]);

          return res.redirect(
            certificateBackUrl(certificate, 'eroare')
          );
        }

        res.redirect(
          certificateBackUrl(certificate, 'trimisa')
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.get('/garantii/:id/pdf', requireAuth, async (req, res, next) => {
    try {
      const id = integer(req.params.id);
      if (!id) return res.status(404).send('Certificat inexistent');

      const result = await query(`
        SELECT numar_certificat, pdf_path
        FROM crm.certificate_garantie
        WHERE id = $1
      `, [id]);

      const certificate = result.rows[0];
      if (!certificate?.pdf_path || !fs.existsSync(certificate.pdf_path)) {
        return res.status(404).send('PDF-ul certificatului nu a fost g\u0103sit.');
      }

      res.download(certificate.pdf_path, `${certificate.numar_certificat}.pdf`);
    } catch (error) {
      next(error);
    }
  });
}
