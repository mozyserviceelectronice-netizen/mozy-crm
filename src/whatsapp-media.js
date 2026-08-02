import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { query } from './db.js';
import { normalizeWhatsAppNumber } from './evolution-whatsapp.js';

const MEDIA_ROOT = '/app/data/whatsapp-media';

const mediaTypes = Object.freeze({
  'image/jpeg': {
    extension: '.jpg',
    type: 'image',
    limit: 15 * 1024 * 1024
  },
  'image/png': {
    extension: '.png',
    type: 'image',
    limit: 15 * 1024 * 1024
  },
  'image/webp': {
    extension: '.webp',
    type: 'image',
    limit: 15 * 1024 * 1024
  },
  'image/gif': {
    extension: '.gif',
    type: 'image',
    limit: 15 * 1024 * 1024
  },
  'audio/ogg': {
    extension: '.ogg',
    type: 'audio',
    limit: 25 * 1024 * 1024
  },
  'audio/opus': {
    extension: '.opus',
    type: 'audio',
    limit: 25 * 1024 * 1024
  },
  'audio/mpeg': {
    extension: '.mp3',
    type: 'audio',
    limit: 25 * 1024 * 1024
  },
  'audio/mp4': {
    extension: '.m4a',
    type: 'audio',
    limit: 25 * 1024 * 1024
  },
  'audio/wav': {
    extension: '.wav',
    type: 'audio',
    limit: 25 * 1024 * 1024
  },
  'video/mp4': {
    extension: '.mp4',
    type: 'video',
    limit: 50 * 1024 * 1024
  },
  'video/3gpp': {
    extension: '.3gp',
    type: 'video',
    limit: 50 * 1024 * 1024
  },
  'application/pdf': {
    extension: '.pdf',
    type: 'document',
    limit: 25 * 1024 * 1024
  },
  'application/msword': {
    extension: '.doc',
    type: 'document',
    limit: 25 * 1024 * 1024
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extension: '.docx',
    type: 'document',
    limit: 25 * 1024 * 1024
  },
  'application/vnd.ms-excel': {
    extension: '.xls',
    type: 'document',
    limit: 25 * 1024 * 1024
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    extension: '.xlsx',
    type: 'document',
    limit: 25 * 1024 * 1024
  },
  'text/plain': {
    extension: '.txt',
    type: 'document',
    limit: 10 * 1024 * 1024
  },
  'application/zip': {
    extension: '.zip',
    type: 'document',
    limit: 25 * 1024 * 1024
  },
  'application/octet-stream': {
    extension: '.bin',
    type: 'document',
    limit: 25 * 1024 * 1024
  }
});

function normalizedMime(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function safeText(value, maximum) {
  return String(value || '')
    .trim()
    .slice(0, maximum);
}

function safeMessageId(value) {
  const id = safeText(value, 200);

  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) {
    return null;
  }

  return id;
}

function safeOriginalName(value, fallback) {
  const name = path.basename(
    String(value || fallback)
  );

  return name
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .slice(0, 180) || fallback;
}

function privateAddress(value) {
  const address = String(value || '')
    .replace(/^::ffff:/, '');

  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    /^10\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
    /^192\.168\./.test(address)
  );
}

function internalRequest(req) {
  const host = String(req.headers.host || '')
    .toLowerCase()
    .split(':')[0];

  const forwarded = req.headers['x-forwarded-for'];

  return (
    !forwarded &&
    privateAddress(req.socket.remoteAddress) &&
    ['mozy_crm', 'mozy-crm'].includes(host)
  );
}

function decodeBase64(value) {
  const compact = String(value || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');

  if (
    !compact ||
    compact.length > 95 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    return null;
  }

  const bytes = Buffer.from(compact, 'base64');

  return bytes.length ? bytes : null;
}

export function absoluteWhatsAppMediaPath(relativePath) {
  const normalized = String(relativePath || '')
    .replace(/\\/g, '/');

  if (
    !normalized.startsWith('whatsapp-media/') ||
    normalized.includes('..')
  ) {
    return null;
  }

  const absolute = path.resolve(
    '/app/data',
    normalized
  );

  const root = path.resolve(MEDIA_ROOT);

  if (
    absolute !== root &&
    !absolute.startsWith(`${root}${path.sep}`)
  ) {
    return null;
  }

  return absolute;
}

export function whatsappMediaContentType(relativePath) {
  const extension = path
    .extname(String(relativePath || ''))
    .toLowerCase();

  const found = Object.entries(mediaTypes)
    .find(([, settings]) => settings.extension === extension);

  return found?.[0] || 'application/octet-stream';
}

export function whatsappMediaDownloadName(relativePath) {
  const stored = path.basename(
    String(relativePath || 'fisier')
  );

  const firstDash = stored.indexOf('-');

  return firstDash >= 0
    ? stored.slice(firstDash + 1)
    : stored;
}

export async function receiveWhatsAppMedia(req, res) {
  if (!internalRequest(req)) {
    return res.status(403).json({
      ok: false,
      error: 'forbidden'
    });
  }

  try {
    const messageId = safeMessageId(
      req.body?.messageId
    );

    const phone = normalizeWhatsAppNumber(
      req.body?.telefon
    );

    const mime = normalizedMime(
      req.body?.mimetype
    );

    const settings = mediaTypes[mime];
    const bytes = decodeBase64(req.body?.base64);

    if (!messageId) {
      return res.status(400).json({
        ok: false,
        error: 'message_id_invalid'
      });
    }

    if (!settings) {
      return res.status(415).json({
        ok: false,
        error: 'media_type_not_allowed'
      });
    }

    if (!bytes || bytes.length > settings.limit) {
      return res.status(413).json({
        ok: false,
        error: 'media_too_large'
      });
    }

    const originalName = safeOriginalName(
      req.body?.fileName,
      `atasament${settings.extension}`
    );

    const extension = path.extname(originalName)
      ? ''
      : settings.extension;

    const storedName = [
      messageId,
      '-',
      crypto.randomUUID(),
      '-',
      originalName,
      extension
    ].join('');

    const relativePath = `whatsapp-media/${storedName}`;
    const finalPath = absoluteWhatsAppMediaPath(
      relativePath
    );

    const temporaryPath =
      `${finalPath}.${crypto.randomUUID()}.tmp`;

    await fs.mkdir(MEDIA_ROOT, {
      recursive: true,
      mode: 0o750
    });

    await fs.writeFile(temporaryPath, bytes, {
      mode: 0o640,
      flag: 'wx'
    });

    await fs.rename(temporaryPath, finalPath);

    const clientResult = await query(`
      INSERT INTO crm.clienti (
        telefon,
        nume
      )
      VALUES (
        $1,
        NULLIF($2, '')
      )
      ON CONFLICT (telefon)
      DO UPDATE SET
        nume = COALESCE(
          crm.clienti.nume,
          EXCLUDED.nume
        ),
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `, [
      phone,
      safeText(req.body?.nume, 255)
    ]);

    const clientId = clientResult.rows[0].id;

    const result = await query(`
      INSERT INTO crm.conversatii (
        client_id,
        directie,
        tip,
        mesaj,
        media_url,
        message_id,
        este_citit,
        necesita_raspuns,
        alerta_trimisa,
        created_at
      )
      VALUES (
        $1,
        'incoming',
        $2,
        NULLIF($3, ''),
        $4,
        $5,
        FALSE,
        TRUE,
        FALSE,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (message_id)
      DO UPDATE SET
        client_id = EXCLUDED.client_id,
        tip = EXCLUDED.tip,
        mesaj = COALESCE(
          NULLIF(EXCLUDED.mesaj, ''),
          crm.conversatii.mesaj
        ),
        media_url = EXCLUDED.media_url,
        necesita_raspuns = TRUE,
        alerta_trimisa = FALSE
      RETURNING id
    `, [
      clientId,
      settings.type,
      safeText(req.body?.mesaj, 4096),
      relativePath,
      messageId
    ]);

    return res.status(201).json({
      ok: true,
      conversationId: result.rows[0].id,
      type: settings.type
    });
  } catch (error) {
    console.error(
      'Eroare primire media WhatsApp:',
      error
    );

    return res.status(500).json({
      ok: false,
      error: 'media_store_failed'
    });
  }
}
