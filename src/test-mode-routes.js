import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db.js';

const directories = {
  receptionSignatures: String(
    process.env.SIGNATURES_DIR || '/app/data/semnaturi'
  ),
  receptionPdfs: String(
    process.env.RECEPTION_PDF_DIR || '/app/data/receptii'
  ),
  receptionPhotos: String(
    process.env.RECEPTION_PHOTO_DIR || '/app/data/receptii-poze'
  ),
  fieldSignatures: String(
    process.env.FIELD_SIGNATURES_DIR ||
      '/app/data/semnaturi-teren'
  ),
  fieldPdfs: String(
    process.env.FIELD_PDF_DIR || '/app/data/pv-teren'
  ),
  fieldPhotos: String(
    process.env.FIELD_PHOTOS_DIR ||
      '/app/data/fotografii-teren'
  ),
  warrantyPdfs: String(
    process.env.WARRANTY_PDF_DIR ||
      '/app/data/garantii'
  )
};

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function insideDirectory(filePath, directory) {
  if (!filePath) return null;

  const root = `${path.resolve(directory)}${path.sep}`;
  const resolved = path.resolve(String(filePath));
  return resolved.startsWith(root) ? resolved : null;
}

function storedPhotoPath(directory, storedName) {
  if (!storedName) return null;
  return insideDirectory(
    path.join(directory, path.basename(String(storedName))),
    directory
  );
}

async function removeFiles(filePaths) {
  const uniquePaths = [...new Set(filePaths.filter(Boolean))];
  const failures = [];

  for (const filePath of uniquePaths) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        failures.push(`${filePath}: ${error.message}`);
      }
    }
  }

  if (failures.length) {
    console.error(
      'Fișiere de test rămase după ștergerea din DB:',
      failures
    );
  }
}

async function deleteTestGroup(groupId) {
  const client = await pool.connect();
  const filePaths = [];
  let receptionCount = 0;
  let fieldCount = 0;

  try {
    await client.query('BEGIN');

    const certificates = await client.query(`
      SELECT pdf_path
      FROM crm.certificate_garantie
      WHERE este_test = TRUE
        AND test_grup_id = $1::uuid
      FOR UPDATE
    `, [groupId]);

    certificates.rows.forEach(row => {
      filePaths.push(
        insideDirectory(row.pdf_path, directories.warrantyPdfs)
      );
    });

    const fields = await client.query(`
      SELECT id, client_id, pdf_path, semnatura_path
      FROM crm.interventii_teren
      WHERE este_test = TRUE
        AND test_grup_id = $1::uuid
      FOR UPDATE
    `, [groupId]);
    fieldCount = fields.rowCount;

    fields.rows.forEach(row => {
      filePaths.push(
        insideDirectory(row.pdf_path, directories.fieldPdfs),
        insideDirectory(
          row.semnatura_path,
          directories.fieldSignatures
        )
      );
    });

    const fieldPhotos = await client.query(`
      SELECT p.nume_stocare
      FROM crm.interventie_teren_fotografii p
      JOIN crm.interventii_teren i
        ON i.id = p.interventie_id
      WHERE i.este_test = TRUE
        AND i.test_grup_id = $1::uuid
    `, [groupId]);

    fieldPhotos.rows.forEach(row => {
      filePaths.push(
        storedPhotoPath(
          directories.fieldPhotos,
          row.nume_stocare
        )
      );
    });

    const receptions = await client.query(`
      SELECT id, client_id, pdf_path, semnatura_path
      FROM crm.receptii_atelier
      WHERE este_test = TRUE
        AND test_grup_id = $1::uuid
      FOR UPDATE
    `, [groupId]);
    receptionCount = receptions.rowCount;

    receptions.rows.forEach(row => {
      filePaths.push(
        insideDirectory(row.pdf_path, directories.receptionPdfs),
        insideDirectory(
          row.semnatura_path,
          directories.receptionSignatures
        )
      );
    });

    const receptionPhotos = await client.query(`
      SELECT p.nume_stocare
      FROM crm.receptie_fotografii p
      JOIN crm.receptii_atelier r
        ON r.id = p.receptie_id
      WHERE r.este_test = TRUE
        AND r.test_grup_id = $1::uuid
    `, [groupId]);

    receptionPhotos.rows.forEach(row => {
      filePaths.push(
        storedPhotoPath(
          directories.receptionPhotos,
          row.nume_stocare
        )
      );
    });

    const clients = await client.query(`
      SELECT DISTINCT client_id
      FROM (
        SELECT client_id
        FROM crm.interventii_teren
        WHERE este_test = TRUE
          AND test_grup_id = $1::uuid
        UNION
        SELECT client_id
        FROM crm.receptii_atelier
        WHERE este_test = TRUE
          AND test_grup_id = $1::uuid
        UNION
        SELECT client_id
        FROM crm.fise_service
        WHERE este_test = TRUE
          AND test_grup_id = $1::uuid
      ) source
    `, [groupId]);

    await client.query(`
      DELETE FROM crm.certificate_garantie
      WHERE este_test = TRUE
        AND test_grup_id = $1::uuid
    `, [groupId]);

    await client.query(`
      DELETE FROM crm.interventii_teren
      WHERE este_test = TRUE
        AND test_grup_id = $1::uuid
    `, [groupId]);

    await client.query(`
      DELETE FROM crm.receptii_atelier
      WHERE este_test = TRUE
        AND test_grup_id = $1::uuid
    `, [groupId]);

    await client.query(`
      DELETE FROM crm.procesari_ai
      WHERE fisa_service_id IN (
        SELECT id
        FROM crm.fise_service
        WHERE este_test = TRUE
          AND test_grup_id = $1::uuid
      )
    `, [groupId]);

    await client.query(`
      DELETE FROM crm.fise_service_echipamente
      WHERE fisa_id IN (
        SELECT id
        FROM crm.fise_service
        WHERE este_test = TRUE
          AND test_grup_id = $1::uuid
      )
    `, [groupId]);

    await client.query(`
      DELETE FROM crm.fise_service
      WHERE este_test = TRUE
        AND test_grup_id = $1::uuid
    `, [groupId]);

    await client.query(`
      DELETE FROM crm.echipamente_atelier
      WHERE este_test = TRUE
        AND test_grup_id = $1::uuid
    `, [groupId]);

    for (const row of clients.rows) {
      await client.query('SAVEPOINT stergere_client_test');

      try {
        await client.query(`
          DELETE FROM crm.clienti
          WHERE id = $1
            AND creat_din_test = TRUE
        `, [row.client_id]);
        await client.query(
          'RELEASE SAVEPOINT stergere_client_test'
        );
      } catch (error) {
        await client.query(
          'ROLLBACK TO SAVEPOINT stergere_client_test'
        );
        await client.query(
          'RELEASE SAVEPOINT stergere_client_test'
        );

        if (error?.code !== '23503') throw error;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  await removeFiles(filePaths);

  return { receptionCount, fieldCount };
}

async function groupForRecord(table, id) {
  const result = await pool.query(`
    SELECT test_grup_id
    FROM crm.${table}
    WHERE id = $1
      AND este_test = TRUE
      AND test_grup_id IS NOT NULL
  `, [id]);

  return result.rows[0]?.test_grup_id || null;
}

export function registerTestModeRoutes(app, requireAuth) {
  app.post(
    '/teste/receptie/:id/sterge',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = positiveInteger(req.params.id);
        if (!id) {
          return res.status(404).send('Recepție test inexistentă');
        }

        const groupId = await groupForRecord(
          'receptii_atelier',
          id
        );
        if (!groupId) {
          return res.status(409).send(
            'Ștergerea este permisă numai pentru recepții marcate TEST.'
          );
        }

        await deleteTestGroup(groupId);
        return res.redirect('/receptie?test_sters=1');
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/teste/teren/:id/sterge',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = positiveInteger(req.params.id);
        if (!id) {
          return res.status(404).send('Intervenție test inexistentă');
        }

        const groupId = await groupForRecord(
          'interventii_teren',
          id
        );
        if (!groupId) {
          return res.status(409).send(
            'Ștergerea este permisă numai pentru intervenții marcate TEST.'
          );
        }

        await deleteTestGroup(groupId);
        return res.redirect('/teren?test_sters=1');
      } catch (error) {
        next(error);
      }
    }
  );
}
