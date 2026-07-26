import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  maintenanceDownload,
  maintenanceRequest
} from './maintenance-client.js';

const uploadDirectory = String(
  process.env.UPDATE_UPLOAD_DIR || '/app/data/update-uploads'
);
const maxUpdateBytes = Number(
  process.env.MAX_UPDATE_UPLOAD_BYTES || 100 * 1024 * 1024
);

function safeBackupName(value) {
  const name = String(value || '');
  return /^mozy-backup-\d{8}-\d{6}\.tar\.gz$/.test(name)
    ? name
    : null;
}

function safeUploadName(value) {
  const basename = path.basename(String(value || ''));
  if (
    basename !== value ||
    !/^mozy-[a-z0-9._-]+\.tar\.gz$/i.test(basename)
  ) {
    return null;
  }
  return basename;
}

async function receiveUpdate(req) {
  const originalName = decodeURIComponent(
    String(req.headers['x-mozy-filename'] || '')
  );
  const safeName = safeUploadName(originalName);
  if (!safeName) {
    throw new Error(
      'Numele pachetului nu este valid. Este necesară o arhivă Mozy .tar.gz.'
    );
  }
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength <= 0 ||
    declaredLength > maxUpdateBytes
  ) {
    throw new Error('Pachetul depășește limita permisă sau este gol.');
  }

  await fsp.mkdir(uploadDirectory, { recursive: true });
  const token = crypto.randomBytes(12).toString('hex');
  const finalPath = path.join(
    uploadDirectory,
    `${Date.now()}-${token}-${safeName}`
  );
  const temporaryPath = `${finalPath}.partial`;
  let received = 0;

  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(temporaryPath, {
        flags: 'wx',
        mode: 0o600
      });
      req.on('data', chunk => {
        received += chunk.length;
        if (received > maxUpdateBytes) {
          req.destroy(new Error('Pachetul depășește limita permisă.'));
        }
      });
      req.on('aborted', () => reject(new Error('Încărcarea a fost întreruptă.')));
      req.on('error', reject);
      output.on('error', reject);
      output.on('finish', resolve);
      req.pipe(output);
    });

    if (!received || received !== declaredLength) {
      throw new Error('Pachetul a fost încărcat incomplet.');
    }
    await fsp.rename(temporaryPath, finalPath);
    return { finalPath, safeName };
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    await fsp.rm(finalPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function registerMaintenanceRoutes(app, requireAuth) {
  app.post(
    '/setari/backupuri',
    requireAuth,
    async (_req, res) => {
      try {
        const result = await maintenanceRequest(
          'POST',
          '/v1/backups',
          {}
        );
        res.json(result);
      } catch (error) {
        res.status(503).json({ error: error.message });
      }
    }
  );

  app.get(
    '/setari/backupuri/:name/descarca',
    requireAuth,
    (req, res) => {
      const name = safeBackupName(req.params.name);
      if (!name) {
        return res.status(400).render('error', {
          message: 'Numele backupului nu este valid.',
          active: 'setari'
        });
      }
      maintenanceDownload(
        `/v1/backups/${encodeURIComponent(name)}/download`,
        res
      );
    }
  );

  app.get(
    '/setari/mentenanta/job/:id',
    requireAuth,
    async (req, res) => {
      try {
        const id = String(req.params.id || '');
        if (!/^[a-f0-9]{24}$/.test(id)) {
          return res.status(400).json({ error: 'Job invalid.' });
        }
        const result = await maintenanceRequest(
          'GET',
          `/v1/jobs/${id}`
        );
        res.json(result);
      } catch (error) {
        res.status(503).json({ error: error.message });
      }
    }
  );

  app.post(
    '/setari/actualizare',
    requireAuth,
    async (req, res) => {
      let uploaded = null;
      try {
        uploaded = await receiveUpdate(req);
        const result = await maintenanceRequest(
          'POST',
          '/v1/updates',
          {
            path:
              '/opt/mozy-crm/data/update-uploads/' +
              path.basename(uploaded.finalPath),
            original_name: uploaded.safeName
          }
        );
        res.json(result);
      } catch (error) {
        if (uploaded?.finalPath) {
          await fsp.rm(uploaded.finalPath, { force: true }).catch(() => {});
        }
        res.status(400).json({ error: error.message });
      }
    }
  );
}
