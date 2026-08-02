import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { query } from './db.js';

const evolutionBaseUrl = String(
  process.env.EVOLUTION_API_URL ||
  'http://evolution_api:8080'
).replace(/\/+$/, '');

const evolutionInstance = String(
  process.env.EVOLUTION_INSTANCE || 'mozy'
).trim();

const DATA_ROOT = '/app/data';
const MEDIA_ROOT = `${DATA_ROOT}/whatsapp-media`;
const PROFILE_ROOT = `${DATA_ROOT}/whatsapp-profile-photos`;

const mediaExtensions = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    '.xlsx',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/octet-stream': '.bin'
});

const mediaLimits = Object.freeze({
  image: 20 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
  video: 60 * 1024 * 1024,
  document: 35 * 1024 * 1024,
  sticker: 10 * 1024 * 1024
});

function apiKey() {
  const value = String(
    process.env.EVOLUTION_API_KEY || ''
  ).trim();

  if (!value) {
    throw new Error(
      'EVOLUTION_API_KEY nu este configurată.'
    );
  }

  return value;
}

function safeMessageId(value) {
  const id = String(value || '').trim();

  return /^[A-Za-z0-9._-]{3,200}$/.test(id)
    ? id
    : null;
}

function safeRemoteJid(value) {
  const jid = String(value || '')
    .trim()
    .toLowerCase();

  return /^[0-9]+@(lid|s\.whatsapp\.net|g\.us)$/.test(jid)
    ? jid
    : null;
}

function normalizedMime(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function extensionForMime(mime, fallback = '.bin') {
  return mediaExtensions[normalizedMime(mime)] ||
    fallback;
}

function safeOriginalName(value, fallback) {
  const source = path.basename(
    String(value || fallback)
  );

  const cleaned = source
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .slice(0, 160);

  return cleaned || fallback;
}

function absoluteDataPath(relativePath, prefix) {
  const normalized = String(relativePath || '')
    .replace(/\\/g, '/');

  if (
    !normalized.startsWith(`${prefix}/`) ||
    normalized.includes('..')
  ) {
    return null;
  }

  const absolute = path.resolve(
    DATA_ROOT,
    normalized
  );

  const root = path.resolve(
    DATA_ROOT,
    prefix
  );

  return (
    absolute === root ||
    absolute.startsWith(`${root}${path.sep}`)
  )
    ? absolute
    : null;
}

export function absoluteProfilePhotoPath(relativePath) {
  return absoluteDataPath(
    relativePath,
    'whatsapp-profile-photos'
  );
}

function absoluteRecoveredMediaPath(relativePath) {
  return absoluteDataPath(
    relativePath,
    'whatsapp-media'
  );
}

async function evolutionPost(
  endpoint,
  body,
  timeoutMs = 30_000
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(
      `${evolutionBaseUrl}${endpoint}`,
      {
        method: 'POST',
        headers: {
          apikey: apiKey(),
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    );

    const text = await response.text();
    let payload = {};

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    if (!response.ok) {
      const message = String(
        payload?.response?.message?.[0]?.message?.[0] ||
        payload?.response?.message?.[0] ||
        payload?.message ||
        payload?.error ||
        `HTTP ${response.status}`
      ).slice(0, 800);

      throw new Error(
        `Evolution API: ${message}`
      );
    }

    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        `Evolution API nu a răspuns în ${Math.round(
          timeoutMs / 1000
        )} secunde.`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function objectValues(value) {
  return value &&
    typeof value === 'object'
    ? Object.values(value)
    : [];
}

function findStringByKeys(
  value,
  keys,
  depth = 0
) {
  if (
    !value ||
    typeof value !== 'object' ||
    depth > 5
  ) {
    return null;
  }

  for (const key of keys) {
    if (
      typeof value[key] === 'string' &&
      value[key].trim()
    ) {
      return value[key].trim();
    }
  }

  for (const child of objectValues(value)) {
    const found = findStringByKeys(
      child,
      keys,
      depth + 1
    );

    if (found) {
      return found;
    }
  }

  return null;
}

function decodeBase64Candidate(value) {
  let compact = String(value || '').trim();

  if (!compact) {
    return null;
  }

  compact = compact
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  if (
    compact.length < 80 ||
    compact.length > 90 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    return null;
  }

  const remainder = compact.length % 4;

  if (remainder) {
    compact += '='.repeat(4 - remainder);
  }

  const bytes = Buffer.from(compact, 'base64');

  return bytes.length >= 32
    ? bytes
    : null;
}

function findBase64(value, depth = 0) {
  if (depth > 6 || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return decodeBase64Candidate(value);
  }

  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findBase64(
        child,
        depth + 1
      );

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const preferredKeys = [
    'base64',
    'media',
    'file',
    'buffer',
    'data'
  ];

  for (const key of preferredKeys) {
    if (key in value) {
      const found = findBase64(
        value[key],
        depth + 1
      );

      if (found) {
        return found;
      }
    }
  }

  for (const child of objectValues(value)) {
    const found = findBase64(
      child,
      depth + 1
    );

    if (found) {
      return found;
    }
  }

  return null;
}

function unwrapMessage(message) {
  let current = message;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const wrapper =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message;

    if (!wrapper) {
      break;
    }

    current = wrapper;
  }

  return current || {};
}

function normalizeWebMessage(value) {
  if (
    value?.data?.key &&
    value?.data?.message
  ) {
    return value.data;
  }

  if (
    value?.message?.key &&
    value?.message?.message
  ) {
    return value.message;
  }

  return value;
}

function messageMediaMetadata(webMessage) {
  const message = unwrapMessage(
    webMessage?.message ||
    webMessage?.data?.message ||
    {}
  );

  const candidates = [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['audioMessage', 'audio'],
    ['documentMessage', 'document'],
    ['stickerMessage', 'sticker']
  ];

  for (const [key, kind] of candidates) {
    const node = message?.[key];

    if (!node) {
      continue;
    }

    const fallbackMime = {
      image: 'image/jpeg',
      video: 'video/mp4',
      audio: 'audio/ogg',
      document: 'application/octet-stream',
      sticker: 'image/webp'
    }[kind];

    return {
      kind,
      node,
      mime:
        normalizedMime(
          node.mimetype ||
          node.mimeType
        ) || fallbackMime,
      fileName:
        node.fileName ||
        node.filename ||
        null
    };
  }

  return null;
}

async function writeAtomic(
  finalPath,
  bytes,
  mode = 0o640
) {
  const temporary =
    `${finalPath}.${crypto.randomUUID()}.tmp`;

  await fs.mkdir(path.dirname(finalPath), {
    recursive: true,
    mode: 0o750
  });

  await fs.writeFile(temporary, bytes, {
    mode,
    flag: 'wx'
  });

  await fs.rename(temporary, finalPath);
}

async function touchRevision() {
  await query(`
    INSERT INTO crm.whatsapp_sync_meta (
      id,
      revision,
      updated_at
    )
    VALUES (
      1,
      1,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (id)
    DO UPDATE SET
      revision =
        crm.whatsapp_sync_meta.revision + 1,
      updated_at = CURRENT_TIMESTAMP
  `);
}

export async function markMediaRecoveryFailure({
  conversationId,
  messageId,
  status = 'error',
  error
}) {
  const normalizedStatus =
    status === 'unavailable'
      ? 'unavailable'
      : 'error';

  await query(`
    INSERT INTO crm.whatsapp_media_recovery (
      conversation_id,
      message_id,
      status,
      attempts,
      last_error,
      last_attempt_at,
      recovered_at,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      1,
      $4,
      CURRENT_TIMESTAMP,
      NULL,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (conversation_id)
    DO UPDATE SET
      message_id = EXCLUDED.message_id,
      status = EXCLUDED.status,
      attempts =
        crm.whatsapp_media_recovery.attempts + 1,
      last_error = EXCLUDED.last_error,
      last_attempt_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [
    conversationId,
    safeMessageId(messageId),
    normalizedStatus,
    String(
      error?.message || error || 'Media indisponibilă'
    ).slice(0, 1500)
  ]);
}

async function markMediaRecovered({
  conversationId,
  messageId
}) {
  await query(`
    INSERT INTO crm.whatsapp_media_recovery (
      conversation_id,
      message_id,
      status,
      attempts,
      last_error,
      last_attempt_at,
      recovered_at,
      updated_at
    )
    VALUES (
      $1,
      $2,
      'recovered',
      1,
      NULL,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (conversation_id)
    DO UPDATE SET
      message_id = EXCLUDED.message_id,
      status = 'recovered',
      attempts =
        crm.whatsapp_media_recovery.attempts + 1,
      last_error = NULL,
      last_attempt_at = CURRENT_TIMESTAMP,
      recovered_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `, [
    conversationId,
    safeMessageId(messageId)
  ]);
}

export async function recoverMediaFromWebMessage({
  conversationId,
  messageId,
  webMessage
}) {
  const normalizedId = safeMessageId(messageId);

  if (!normalizedId) {
    throw new Error(
      'Mesajul nu are un ID WhatsApp valid.'
    );
  }

  const normalizedWebMessage =
    normalizeWebMessage(webMessage);

  const metadata = messageMediaMetadata(
    normalizedWebMessage
  );

  if (!metadata) {
    throw new Error(
      'Mesajul nu conține media recuperabilă.'
    );
  }

  const payload = await evolutionPost(
    `/chat/getBase64FromMediaMessage/${
      encodeURIComponent(evolutionInstance)
    }`,
    {
      message: normalizedWebMessage,
      convertToMp4: false
    },
    45_000
  );

  const bytes = findBase64(payload);

  if (!bytes) {
    throw new Error(
      'Evolution nu a returnat conținutul media.'
    );
  }

  const responseMime = normalizedMime(
    findStringByKeys(
      payload,
      ['mimetype', 'mimeType']
    )
  );

  const mime = responseMime || metadata.mime;
  const limit =
    mediaLimits[metadata.kind] ||
    35 * 1024 * 1024;

  if (bytes.length > limit) {
    throw new Error(
      `Fișierul recuperat depășește limita de ${
        Math.round(limit / 1024 / 1024)
      } MB.`
    );
  }

  const responseName = findStringByKeys(
    payload,
    ['fileName', 'filename']
  );

  const fallbackExtension = extensionForMime(
    mime,
    metadata.kind === 'image'
      ? '.jpg'
      : '.bin'
  );

  const originalName = safeOriginalName(
    responseName ||
    metadata.fileName,
    `atasament${fallbackExtension}`
  );

  const extension = path.extname(originalName)
    ? ''
    : fallbackExtension;

  const storedName = [
    normalizedId,
    '-',
    crypto.randomUUID(),
    '-',
    originalName,
    extension
  ].join('');

  const relativePath =
    `whatsapp-media/${storedName}`;

  const finalPath = absoluteRecoveredMediaPath(
    relativePath
  );

  if (!finalPath) {
    throw new Error(
      'Calea media generată nu este validă.'
    );
  }

  await writeAtomic(finalPath, bytes);

  let result;

  if (conversationId) {
    result = await query(`
      UPDATE crm.conversatii
      SET media_url = $2
      WHERE id = $1
      RETURNING id
    `, [
      conversationId,
      relativePath
    ]);
  } else {
    result = await query(`
      UPDATE crm.conversatii
      SET media_url = $2
      WHERE message_id = $1
      RETURNING id
    `, [
      normalizedId,
      relativePath
    ]);
  }

  if (!result.rowCount) {
    await fs.unlink(finalPath).catch(() => {});

    throw new Error(
      'Mesajul nu a fost găsit încă în CRM.'
    );
  }

  const resolvedConversationId =
    result.rows[0].id;

  await markMediaRecovered({
    conversationId: resolvedConversationId,
    messageId: normalizedId
  });

  await touchRevision();

  return {
    conversationId: resolvedConversationId,
    messageId: normalizedId,
    relativePath,
    bytes: bytes.length,
    mime
  };
}

async function waitForConversation(
  messageId,
  attempts = 8
) {
  for (
    let attempt = 1;
    attempt <= attempts;
    attempt += 1
  ) {
    const result = await query(`
      SELECT id
      FROM crm.conversatii
      WHERE message_id = $1
      LIMIT 1
    `, [messageId]);

    if (result.rowCount) {
      return result.rows[0].id;
    }

    await new Promise(resolve =>
      setTimeout(resolve, 750)
    );
  }

  return null;
}

async function captureMediaPayload(payload) {
  const data = Array.isArray(payload?.data)
    ? payload.data
    : [payload?.data].filter(Boolean);

  for (const record of data) {
    const key =
      record?.key ||
      record?.message?.key ||
      record?.data?.key;

    const messageId = safeMessageId(
      key?.id
    );

    const webMessage =
      normalizeWebMessage(record);

    if (
      !messageId ||
      !messageMediaMetadata(webMessage)
    ) {
      continue;
    }

    const existing = await query(`
      SELECT id, media_url
      FROM crm.conversatii
      WHERE message_id = $1
      LIMIT 1
    `, [messageId]);

    if (
      existing.rows[0]?.media_url &&
      String(existing.rows[0].media_url)
        .startsWith('whatsapp-media/')
    ) {
      continue;
    }

    const conversationId =
      existing.rows[0]?.id ||
      await waitForConversation(messageId);

    if (!conversationId) {
      console.error(
        'Media WhatsApp nu a putut fi asociată:',
        {
          messageId,
          reason: 'conversation_not_found'
        }
      );
      continue;
    }

    try {
      await recoverMediaFromWebMessage({
        conversationId,
        messageId,
        webMessage
      });
    } catch (error) {
      await markMediaRecoveryFailure({
        conversationId,
        messageId,
        status:
          /not found|indisponibil|returnat/i.test(
            String(error?.message || '')
          )
            ? 'unavailable'
            : 'error',
        error
      }).catch(() => {});

      console.error(
        'Recuperarea media WhatsApp a eșuat:',
        {
          messageId,
          error:
            error?.message ||
            String(error)
        }
      );
    }
  }
}

export function scheduleIncomingMediaCapture(
  payload
) {
  setTimeout(() => {
    captureMediaPayload(payload).catch(error => {
      console.error(
        'Capturarea media din webhook a eșuat:',
        error
      );
    });
  }, 250);
}

function profileUrlAllowed(value) {
  try {
    const url = new URL(String(value || ''));

    return (
      url.protocol === 'https:' &&
      (
        url.hostname === 'pps.whatsapp.net' ||
        url.hostname.endsWith(
          '.pps.whatsapp.net'
        )
      )
    )
      ? url
      : null;
  } catch {
    return null;
  }
}

async function downloadProfilePhoto(value) {
  const url = profileUrlAllowed(value);

  if (!url) {
    throw new Error(
      'URL-ul pozei de profil nu este permis.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    20_000
  );

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'image/*',
        'User-Agent': 'Mozy-CRM/1.0'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Poza de profil a răspuns HTTP ${
          response.status
        }.`
      );
    }

    const contentLength = Number(
      response.headers.get('content-length') ||
      0
    );

    if (contentLength > 5 * 1024 * 1024) {
      throw new Error(
        'Poza de profil este prea mare.'
      );
    }

    const source = Buffer.from(
      await response.arrayBuffer()
    );

    if (
      !source.length ||
      source.length > 5 * 1024 * 1024
    ) {
      throw new Error(
        'Poza de profil este goală sau prea mare.'
      );
    }

    return sharp(source)
      .rotate()
      .resize(192, 192, {
        fit: 'cover',
        position: 'centre'
      })
      .jpeg({
        quality: 84,
        progressive: true
      })
      .toBuffer();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        'Descărcarea pozei de profil a expirat.'
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function removeStoredProfilePhoto(
  relativePath
) {
  const filePath = absoluteProfilePhotoPath(
    relativePath
  );

  if (filePath) {
    await fs.unlink(filePath).catch(error => {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    });
  }
}

async function profileCandidates({
  limit,
  force
}) {
  const result = await query(`
    WITH clients_with_phone AS (
      SELECT
        client.*,
        CASE
          WHEN digits LIKE '00%'
            THEN SUBSTRING(digits FROM 3)
          WHEN digits LIKE '0%'
            THEN '40' || SUBSTRING(digits FROM 2)
          ELSE digits
        END AS phone_normalized
      FROM (
        SELECT
          c.*,
          REGEXP_REPLACE(
            COALESCE(c.telefon, ''),
            '\\D',
            '',
            'g'
          ) AS digits
        FROM crm.clienti c
      ) client
    )
    SELECT
      client.id,
      client.nume,
      client.telefon,
      COALESCE(
        state.remote_jid,
        NULLIF(client.whatsapp_jid, ''),
        CASE
          WHEN client.phone_normalized ~
            '^[0-9]{8,15}$'
            THEN client.phone_normalized ||
              '@s.whatsapp.net'
          ELSE NULL
        END
      ) AS remote_jid,
      profile.file_path,
      profile.status,
      profile.next_refresh_at
    FROM clients_with_phone client
    LEFT JOIN LATERAL (
      SELECT remote_jid
      FROM crm.whatsapp_chat_state candidate
      WHERE
        candidate.client_id = client.id
        OR (
          NULLIF(client.whatsapp_jid, '') IS NOT NULL
          AND candidate.remote_jid =
            client.whatsapp_jid
        )
        OR (
          NULLIF(client.phone_normalized, '') IS NOT NULL
          AND candidate.phone =
            client.phone_normalized
        )
      ORDER BY
        CASE
          WHEN candidate.client_id = client.id
            THEN 0
          WHEN candidate.remote_jid =
            client.whatsapp_jid
            THEN 1
          ELSE 2
        END,
        candidate.updated_at DESC
      LIMIT 1
    ) state
      ON TRUE
    LEFT JOIN crm.whatsapp_profile_photos profile
      ON profile.client_id = client.id
    WHERE EXISTS (
      SELECT 1
      FROM crm.conversatii conversation
      WHERE conversation.client_id = client.id
    )
      AND COALESCE(
        state.remote_jid,
        NULLIF(client.whatsapp_jid, ''),
        CASE
          WHEN client.phone_normalized ~
            '^[0-9]{8,15}$'
            THEN client.phone_normalized ||
              '@s.whatsapp.net'
          ELSE NULL
        END
      ) IS NOT NULL
      AND (
        $2::BOOLEAN = TRUE
        OR profile.client_id IS NULL
        OR profile.next_refresh_at IS NULL
        OR profile.next_refresh_at <=
          CURRENT_TIMESTAMP
      )
    ORDER BY
      (
        SELECT MAX(conversation.created_at)
        FROM crm.conversatii conversation
        WHERE conversation.client_id = client.id
      ) DESC NULLS LAST,
      client.id DESC
    LIMIT $1
  `, [
    Math.max(1, Math.min(Number(limit) || 20, 500)),
    Boolean(force)
  ]);

  return result.rows;
}

async function updateProfileNone(record) {
  await removeStoredProfilePhoto(
    record.file_path
  );

  await query(`
    INSERT INTO crm.whatsapp_profile_photos (
      client_id,
      remote_jid,
      file_path,
      content_type,
      status,
      fetched_at,
      next_refresh_at,
      last_error,
      updated_at
    )
    VALUES (
      $1,
      $2,
      NULL,
      NULL,
      'none',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + INTERVAL '7 days',
      NULL,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (client_id)
    DO UPDATE SET
      remote_jid = EXCLUDED.remote_jid,
      file_path = NULL,
      content_type = NULL,
      status = 'none',
      fetched_at = CURRENT_TIMESTAMP,
      next_refresh_at =
        CURRENT_TIMESTAMP + INTERVAL '7 days',
      last_error = NULL,
      updated_at = CURRENT_TIMESTAMP
  `, [
    record.id,
    record.remote_jid
  ]);
}

async function updateProfileError(
  record,
  error
) {
  await query(`
    INSERT INTO crm.whatsapp_profile_photos (
      client_id,
      remote_jid,
      file_path,
      content_type,
      status,
      fetched_at,
      next_refresh_at,
      last_error,
      updated_at
    )
    VALUES (
      $1,
      $2,
      NULL,
      NULL,
      'error',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + INTERVAL '12 hours',
      $3,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (client_id)
    DO UPDATE SET
      remote_jid = EXCLUDED.remote_jid,
      status = CASE
        WHEN crm.whatsapp_profile_photos.file_path
          IS NOT NULL
          THEN crm.whatsapp_profile_photos.status
        ELSE 'error'
      END,
      fetched_at = CURRENT_TIMESTAMP,
      next_refresh_at =
        CURRENT_TIMESTAMP + INTERVAL '12 hours',
      last_error = EXCLUDED.last_error,
      updated_at = CURRENT_TIMESTAMP
  `, [
    record.id,
    record.remote_jid,
    String(
      error?.message || error || 'Eroare necunoscută'
    ).slice(0, 1200)
  ]);
}

async function refreshOneProfile(record) {
  const remoteJid = safeRemoteJid(
    record.remote_jid
  );

  if (!remoteJid) {
    throw new Error(
      'Identitatea WhatsApp nu este validă.'
    );
  }

  const payload = await evolutionPost(
    `/chat/fetchProfilePictureUrl/${
      encodeURIComponent(evolutionInstance)
    }`,
    {
      number: remoteJid
    },
    20_000
  );

  const profileUrl = String(
    payload?.profilePictureUrl || ''
  ).trim();

  if (!profileUrl) {
    await updateProfileNone(record);

    return {
      clientId: record.id,
      status: 'none'
    };
  }

  const bytes = await downloadProfilePhoto(
    profileUrl
  );

  const relativePath =
    `whatsapp-profile-photos/${record.id}.jpg`;

  const finalPath = absoluteProfilePhotoPath(
    relativePath
  );

  if (!finalPath) {
    throw new Error(
      'Calea pozei de profil nu este validă.'
    );
  }

  await writeAtomic(finalPath, bytes);

  await query(`
    INSERT INTO crm.whatsapp_profile_photos (
      client_id,
      remote_jid,
      file_path,
      content_type,
      status,
      fetched_at,
      next_refresh_at,
      last_error,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      'image/jpeg',
      'ok',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + INTERVAL '3 days',
      NULL,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (client_id)
    DO UPDATE SET
      remote_jid = EXCLUDED.remote_jid,
      file_path = EXCLUDED.file_path,
      content_type = EXCLUDED.content_type,
      status = 'ok',
      fetched_at = CURRENT_TIMESTAMP,
      next_refresh_at =
        CURRENT_TIMESTAMP + INTERVAL '3 days',
      last_error = NULL,
      updated_at = CURRENT_TIMESTAMP
  `, [
    record.id,
    remoteJid,
    relativePath
  ]);

  return {
    clientId: record.id,
    status: 'ok',
    bytes: bytes.length
  };
}

export async function refreshWhatsAppProfilePhotos({
  limit = 20,
  force = false
} = {}) {
  const records = await profileCandidates({
    limit,
    force
  });

  const summary = {
    checked: records.length,
    ok: 0,
    none: 0,
    error: 0
  };

  for (const record of records) {
    try {
      const result = await refreshOneProfile(
        record
      );

      summary[result.status] += 1;
    } catch (error) {
      summary.error += 1;

      await updateProfileError(
        record,
        error
      ).catch(() => {});

      console.error(
        'Sincronizarea pozei de profil a eșuat:',
        {
          clientId: record.id,
          remoteJid: record.remote_jid,
          error:
            error?.message ||
            String(error)
        }
      );
    }

    await new Promise(resolve =>
      setTimeout(resolve, 120)
    );
  }

  if (records.length) {
    await touchRevision();
  }

  return summary;
}

let profileRefreshRunning = false;
let lastProfileRefreshAt = 0;

export function scheduleProfilePhotoRefresh() {
  const now = Date.now();

  if (
    profileRefreshRunning ||
    now - lastProfileRefreshAt <
      10 * 60 * 1000
  ) {
    return;
  }

  profileRefreshRunning = true;
  lastProfileRefreshAt = now;

  setTimeout(async () => {
    try {
      await refreshWhatsAppProfilePhotos({
        limit: 8,
        force: false
      });
    } catch (error) {
      console.error(
        'Actualizarea periodică a avatarurilor a eșuat:',
        error
      );
    } finally {
      profileRefreshRunning = false;
    }
  }, 100);
}
