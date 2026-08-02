import crypto from 'node:crypto';
import express from 'express';

import { query } from './db.js';
import {
  scheduleIncomingMediaCapture
} from './whatsapp-assets.js';

const forwardedEvents = new Set([
  'MESSAGES_UPSERT',
  'CONNECTION_UPDATE'
]);

const n8nWebhookUrl = String(
  process.env.N8N_WHATSAPP_WEBHOOK_URL ||
  'http://n8n:5678/webhook/whatsapp'
).trim();

function normalizedEvent(value) {
  return String(value || '')
    .trim()
    .replace(/[.-]/g, '_')
    .toUpperCase();
}

function items(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined || value === null
    ? []
    : [value];
}

function normalizedJid(value) {
  const jid = String(value || '').trim().toLowerCase();

  return /^[0-9]+@(lid|s\.whatsapp\.net|g\.us)$/.test(jid)
    ? jid
    : null;
}

function normalizedPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('0')) {
    digits = `40${digits.slice(1)}`;
  }

  return /^\d{8,15}$/.test(digits)
    ? digits
    : null;
}

function phoneFromJid(value) {
  const jid = String(value || '').trim().toLowerCase();

  if (!jid.endsWith('@s.whatsapp.net')) {
    return null;
  }

  return normalizedPhone(jid.split('@')[0]);
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');

  return a.length > 0 &&
    a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

async function clientIdFor(phone, remoteJid) {
  const result = await query(`
    WITH normalized_clients AS (
      SELECT
        id,
        whatsapp_jid,
        CASE
          WHEN digits LIKE '00%'
            THEN SUBSTRING(digits FROM 3)
          WHEN digits LIKE '0%'
            THEN '40' || SUBSTRING(digits FROM 2)
          ELSE digits
        END AS phone_normalized
      FROM (
        SELECT
          id,
          whatsapp_jid,
          REGEXP_REPLACE(
            COALESCE(telefon, ''),
            '\\D',
            '',
            'g'
          ) AS digits
        FROM crm.clienti
      ) source
    )
    SELECT id
    FROM normalized_clients
    WHERE
      ($2::TEXT IS NOT NULL AND whatsapp_jid = $2)
      OR
      ($1::TEXT IS NOT NULL AND phone_normalized = $1)
    ORDER BY
      CASE WHEN whatsapp_jid = $2 THEN 0 ELSE 1 END,
      id ASC
    LIMIT 1
  `, [phone, remoteJid]);

  return result.rows[0]?.id || null;
}

async function upsertChatState({
  remoteJid,
  phone = null,
  name = null,
  unreadCount = null,
  archived = false,
  archiveKnown = false
}) {
  const jid = normalizedJid(remoteJid);

  if (!jid) {
    return false;
  }

  const normalizedNumber =
    normalizedPhone(phone) ||
    phoneFromJid(jid);

  const clientId = await clientIdFor(
    normalizedNumber,
    jid
  );

  await query(`
    INSERT INTO crm.whatsapp_chat_state (
      remote_jid,
      phone,
      client_id,
      name,
      unread_count,
      archived,
      archive_known,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      NULLIF($4, ''),
      $5,
      $6,
      $7,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (remote_jid)
    DO UPDATE SET
      phone = COALESCE(
        EXCLUDED.phone,
        crm.whatsapp_chat_state.phone
      ),
      client_id = COALESCE(
        EXCLUDED.client_id,
        crm.whatsapp_chat_state.client_id
      ),
      name = COALESCE(
        EXCLUDED.name,
        crm.whatsapp_chat_state.name
      ),
      unread_count = COALESCE(
        EXCLUDED.unread_count,
        crm.whatsapp_chat_state.unread_count
      ),
      archived = CASE
        WHEN EXCLUDED.archive_known
          THEN EXCLUDED.archived
        ELSE crm.whatsapp_chat_state.archived
      END,
      archive_known =
        crm.whatsapp_chat_state.archive_known
        OR EXCLUDED.archive_known,
      updated_at = CURRENT_TIMESTAMP
  `, [
    jid,
    normalizedNumber,
    clientId,
    String(name || '').trim().slice(0, 255),
    Number.isInteger(Number(unreadCount))
      ? Number(unreadCount)
      : null,
    Boolean(archived),
    Boolean(archiveKnown)
  ]);

  return true;
}

async function processChats(event, data) {
  let changed = false;

  if (event === 'CHATS_DELETE') {
    for (const record of items(data)) {
      const jid = normalizedJid(
        typeof record === 'string'
          ? record
          : record?.remoteJid || record?.id
      );

      if (!jid) continue;

      await query(`
        DELETE FROM crm.whatsapp_chat_state
        WHERE remote_jid = $1
      `, [jid]);

      changed = true;
    }

    return changed;
  }

  for (const record of items(data)) {
    if (!record || typeof record !== 'object') {
      continue;
    }

    const archiveValue =
      typeof record.archived === 'boolean'
        ? record.archived
        : typeof record.archive === 'boolean'
          ? record.archive
          : false;

    const archiveKnown =
      typeof record.archived === 'boolean' ||
      typeof record.archive === 'boolean';

    changed = await upsertChatState({
      remoteJid:
        record.remoteJid ||
        record.id ||
        record.chatId,
      phone:
        record.phone ||
        record.remoteJidAlt,
      name:
        record.name ||
        record.pushName,
      unreadCount:
        record.unreadCount ??
        record.unreadMessages,
      archived: archiveValue,
      archiveKnown
    }) || changed;
  }

  return changed;
}

async function processMessageMapping(data) {
  let changed = false;

  for (const record of items(data)) {
    const key =
      record?.key ||
      record?.message?.key ||
      record?.data?.key;

    if (!key || typeof key !== 'object') {
      continue;
    }

    changed = await upsertChatState({
      remoteJid: key.remoteJid,
      phone:
        phoneFromJid(key.remoteJidAlt) ||
        phoneFromJid(key.remoteJid),
      name:
        record?.pushName ||
        record?.name
    }) || changed;
  }

  return changed;
}

async function processLabelEdit(data) {
  let changed = false;

  for (const record of items(data)) {
    if (!record || typeof record !== 'object') {
      continue;
    }

    const labelId = String(
      record.labelId ?? record.id ?? ''
    ).trim().slice(0, 100);

    if (!labelId) continue;

    const deleted =
      record.deleted === true ||
      String(record.type || '').toLowerCase() === 'delete';

    if (deleted) {
      await query(`
        DELETE FROM crm.whatsapp_labels
        WHERE label_id = $1
      `, [labelId]);
    } else {
      await query(`
        INSERT INTO crm.whatsapp_labels (
          label_id,
          name,
          color,
          predefined_id,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (label_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          color = EXCLUDED.color,
          predefined_id = EXCLUDED.predefined_id,
          updated_at = CURRENT_TIMESTAMP
      `, [
        labelId,
        String(
          record.name || `Etichetă ${labelId}`
        ).trim().slice(0, 255),
        Number.isInteger(Number(record.color))
          ? Number(record.color)
          : null,
        String(record.predefinedId || '')
          .trim()
          .slice(0, 100) || null
      ]);
    }

    changed = true;
  }

  return changed;
}

async function processLabelAssociation(data) {
  const record = Array.isArray(data)
    ? data[0]
    : data;

  if (!record || typeof record !== 'object') {
    return false;
  }

  const remoteJid = normalizedJid(
    record.chatId ||
    record.remoteJid ||
    record.association?.chatId
  );

  const labelId = String(
    record.labelId ??
    record.association?.labelId ??
    ''
  ).trim().slice(0, 100);

  const action = String(
    record.type ||
    record.action ||
    ''
  ).trim().toLowerCase();

  if (!remoteJid || !labelId) {
    return false;
  }

  await upsertChatState({ remoteJid });

  await query(`
    INSERT INTO crm.whatsapp_labels (
      label_id,
      name,
      updated_at
    )
    VALUES (
      $1,
      $2,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (label_id)
    DO NOTHING
  `, [labelId, `Etichetă ${labelId}`]);

  if (action === 'remove') {
    await query(`
      DELETE FROM crm.whatsapp_chat_labels
      WHERE remote_jid = $1
        AND label_id = $2
    `, [remoteJid, labelId]);
  } else {
    await query(`
      INSERT INTO crm.whatsapp_chat_labels (
        remote_jid,
        label_id,
        updated_at
      )
      VALUES (
        $1,
        $2,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (remote_jid, label_id)
      DO UPDATE SET
        updated_at = CURRENT_TIMESTAMP
    `, [remoteJid, labelId]);
  }

  return true;
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
      revision = crm.whatsapp_sync_meta.revision + 1,
      updated_at = CURRENT_TIMESTAMP
  `);
}

async function processPayload(payload) {
  const event = normalizedEvent(payload?.event);
  const data = payload?.data;
  let changed = false;

  if (
    event === 'CHATS_SET' ||
    event === 'CHATS_UPSERT' ||
    event === 'CHATS_UPDATE' ||
    event === 'CHATS_DELETE'
  ) {
    changed = await processChats(event, data);
  } else if (event === 'MESSAGES_UPSERT') {
    changed = await processMessageMapping(data);
  } else if (event === 'LABELS_EDIT') {
    changed = await processLabelEdit(data);
  } else if (event === 'LABELS_ASSOCIATION') {
    changed = await processLabelAssociation(data);
  }

  if (changed) {
    await touchRevision();
  }

  return event;
}

async function forwardToN8n(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    20_000
  );

  try {
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Webhook-ul n8n a răspuns HTTP ${response.status}.`
      );
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        'Webhook-ul n8n nu a răspuns în 20 de secunde.'
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function registerEvolutionWebhookRoute(app) {
  app.post(
    '/internal/evolution-webhook',
    express.json({
      limit: '20mb',
      type: 'application/json'
    }),
    async (req, res, next) => {
      try {
        const expected = String(
          process.env.EVOLUTION_WEBHOOK_SECRET || ''
        ).trim();

        const received = String(
          req.get('X-Mozy-Webhook-Token') || ''
        ).trim();

        if (!expected) {
          return res.status(503).json({
            ok: false,
            error: 'Webhook secret neconfigurat.'
          });
        }

        if (!secureEqual(expected, received)) {
          return res.status(401).json({
            ok: false,
            error: 'Webhook neautorizat.'
          });
        }

        const event = await processPayload(req.body);

        if (forwardedEvents.has(event)) {
          await forwardToN8n(req.body);
        }

        if (event === 'MESSAGES_UPSERT') {
          scheduleIncomingMediaCapture(
            req.body
          );
        }

        return res.status(204).end();
      } catch (error) {
        console.error(
          'Procesarea webhook-ului Evolution a eșuat:',
          error
        );

        next(error);
      }
    }
  );
}
