import { pool, query } from './db.js';

const organizerScopes = new Set([
  'active',
  'archived',
  'all'
]);

export function normalizeConversationScope(value) {
  const scope = String(value || '')
    .trim()
    .toLowerCase();

  return organizerScopes.has(scope)
    ? scope
    : 'active';
}

export function normalizeWhatsAppLabelId(value) {
  return String(value || '')
    .trim()
    .slice(0, 100);
}

function escapeLike(value) {
  return String(value || '')
    .replace(/[\\%_]/g, '\\$&');
}

function normalizedJid(value) {
  const jid = String(value || '')
    .trim()
    .toLowerCase();

  return /^[0-9]+@(lid|s\.whatsapp\.net|g\.us)$/.test(jid)
    ? jid
    : null;
}

function normalizedPhone(value) {
  let digits = String(value || '')
    .replace(/\D/g, '');

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

function derivedJid(record) {
  const stored = normalizedJid(
    record?.state_remote_jid ||
    record?.whatsapp_jid
  );

  if (stored) {
    return stored;
  }

  const phone = normalizedPhone(
    record?.phone_normalized ||
    record?.telefon
  );

  if (!phone) {
    return null;
  }

  const group =
    record?.tip_conversatie === 'grup' ||
    (
      phone.startsWith('120363') &&
      phone.length > 15
    );

  return `${phone}@${group ? 'g.us' : 's.whatsapp.net'}`;
}

export function buildWhatsAppOrganizerUrl({
  clientId = null,
  q = '',
  scope = 'active',
  labelId = '',
  saved = false
} = {}) {
  const params = new URLSearchParams();
  const normalizedScope = normalizeConversationScope(scope);
  const normalizedLabel = normalizeWhatsAppLabelId(labelId);
  const search = String(q || '').trim().slice(0, 100);
  const id = Number(clientId);

  params.set('scope', normalizedScope);

  if (Number.isSafeInteger(id) && id > 0) {
    params.set('client', String(id));
  }

  if (search) {
    params.set('q', search);
  }

  if (normalizedLabel) {
    params.set('label', normalizedLabel);
  }

  if (saved) {
    params.set('organizer_saved', '1');
  }

  return `/conversatii?${params.toString()}`;
}

export async function listWhatsAppLabels() {
  const result = await query(`
    SELECT
      label_id,
      name,
      color,
      predefined_id
    FROM crm.whatsapp_labels
    ORDER BY
      LOWER(name),
      label_id
  `);

  return result.rows;
}

export async function listOrganizedConversations(
  q,
  scope,
  labelId
) {
  const search = String(q || '').trim().slice(0, 100);
  const pattern = `%${escapeLike(search)}%`;
  const normalizedScope = normalizeConversationScope(scope);
  const normalizedLabel = normalizeWhatsAppLabelId(labelId);

  return query(`
    WITH latest AS (
      SELECT DISTINCT ON (cv.client_id)
        cv.id,
        cv.client_id,
        cv.directie,
        cv.tip,
        cv.mesaj,
        cv.media_url,
        cv.necesita_raspuns,
        cv.este_citit,
        cv.created_at,
        c.nume,
        c.telefon,
        c.tip_conversatie,
        c.whatsapp_jid,
        c.client_dificil,
        CASE
          WHEN phone_digits LIKE '00%'
            THEN SUBSTRING(phone_digits FROM 3)
          WHEN phone_digits LIKE '0%'
            THEN '40' || SUBSTRING(phone_digits FROM 2)
          ELSE phone_digits
        END AS phone_normalized,
        (
          SELECT COUNT(*)::INTEGER
          FROM crm.conversatii unread
          WHERE unread.client_id = cv.client_id
            AND unread.directie = 'incoming'
            AND unread.este_citit = FALSE
        ) AS necitite
      FROM crm.conversatii cv
      JOIN (
        SELECT
          client.*,
          REGEXP_REPLACE(
            COALESCE(client.telefon, ''),
            '\\D',
            '',
            'g'
          ) AS phone_digits
        FROM crm.clienti client
      ) c
        ON c.id = cv.client_id
      WHERE (
        $1 = ''
        OR COALESCE(c.nume, '') ILIKE $2 ESCAPE '\\'
        OR COALESCE(c.telefon, '') ILIKE $2 ESCAPE '\\'
      )
      ORDER BY
        cv.client_id,
        cv.created_at DESC,
        cv.id DESC
    ),
    enriched AS (
      SELECT
        latest.*,
        state.remote_jid AS whatsapp_remote_jid,
        COALESCE(
          state.archived,
          FALSE
        ) AS whatsapp_archived,
        COALESCE(
          state.archive_known,
          FALSE
        ) AS whatsapp_archive_known,
        COALESCE(
          label_data.labels,
          '[]'::JSONB
        ) AS whatsapp_labels
      FROM latest
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM crm.whatsapp_chat_state candidate
        WHERE
          candidate.client_id = latest.client_id
          OR (
            NULLIF(latest.whatsapp_jid, '') IS NOT NULL
            AND candidate.remote_jid = latest.whatsapp_jid
          )
          OR (
            NULLIF(latest.phone_normalized, '') IS NOT NULL
            AND candidate.phone = latest.phone_normalized
          )
        ORDER BY
          CASE
            WHEN candidate.client_id = latest.client_id
              THEN 0
            WHEN candidate.remote_jid = latest.whatsapp_jid
              THEN 1
            ELSE 2
          END,
          candidate.updated_at DESC
        LIMIT 1
      ) state
        ON TRUE
      LEFT JOIN LATERAL (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'label_id', label.label_id,
            'name', label.name,
            'color', label.color
          )
          ORDER BY
            LOWER(label.name),
            label.label_id
        ) AS labels
        FROM crm.whatsapp_chat_labels association
        JOIN crm.whatsapp_labels label
          ON label.label_id = association.label_id
        WHERE association.remote_jid = state.remote_jid
      ) label_data
        ON TRUE
    )
    SELECT *
    FROM enriched
    WHERE (
      $3 = 'all'
      OR (
        $3 = 'archived'
        AND whatsapp_archived = TRUE
      )
      OR (
        $3 = 'active'
        AND whatsapp_archived = FALSE
      )
    )
      AND (
        $4 = ''
        OR EXISTS (
          SELECT 1
          FROM crm.whatsapp_chat_labels filtered_label
          WHERE
            filtered_label.remote_jid =
              enriched.whatsapp_remote_jid
            AND filtered_label.label_id = $4
        )
      )
    ORDER BY
      CASE
        WHEN necesita_raspuns THEN 0
        ELSE 1
      END,
      created_at DESC,
      id DESC
    LIMIT 200
  `, [
    search,
    pattern,
    normalizedScope,
    normalizedLabel
  ]);
}

export async function getWhatsAppOrganizerForClient(
  clientId
) {
  const result = await query(`
    WITH target AS (
      SELECT
        client.id,
        client.whatsapp_jid,
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
        WHERE id = $1
      ) client
    )
    SELECT
      state.remote_jid AS whatsapp_remote_jid,
      COALESCE(
        state.archived,
        FALSE
      ) AS whatsapp_archived,
      COALESCE(
        state.archive_known,
        FALSE
      ) AS whatsapp_archive_known,
      COALESCE(
        label_data.labels,
        '[]'::JSONB
      ) AS whatsapp_labels
    FROM target
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM crm.whatsapp_chat_state candidate
      WHERE
        candidate.client_id = target.id
        OR (
          NULLIF(target.whatsapp_jid, '') IS NOT NULL
          AND candidate.remote_jid = target.whatsapp_jid
        )
        OR (
          NULLIF(target.phone_normalized, '') IS NOT NULL
          AND candidate.phone = target.phone_normalized
        )
      ORDER BY
        CASE
          WHEN candidate.client_id = target.id THEN 0
          WHEN candidate.remote_jid = target.whatsapp_jid THEN 1
          ELSE 2
        END,
        candidate.updated_at DESC
      LIMIT 1
    ) state
      ON TRUE
    LEFT JOIN LATERAL (
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'label_id', label.label_id,
          'name', label.name,
          'color', label.color
        )
        ORDER BY
          LOWER(label.name),
          label.label_id
      ) AS labels
      FROM crm.whatsapp_chat_labels association
      JOIN crm.whatsapp_labels label
        ON label.label_id = association.label_id
      WHERE association.remote_jid = state.remote_jid
    ) label_data
      ON TRUE
  `, [clientId]);

  return result.rows[0] || {
    whatsapp_remote_jid: null,
    whatsapp_archived: false,
    whatsapp_archive_known: false,
    whatsapp_labels: []
  };
}

export async function whatsappOrganizerState() {
  const result = await query(`
    SELECT
      revision,
      updated_at
    FROM crm.whatsapp_sync_meta
    WHERE id = 1
  `);

  return result.rows[0] || {
    revision: 0,
    updated_at: null
  };
}

async function resolveClientChat(database, clientId) {
  const result = await database.query(`
    WITH target AS (
      SELECT
        client.id,
        client.nume,
        client.telefon,
        client.tip_conversatie,
        client.whatsapp_jid,
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
          nume,
          telefon,
          tip_conversatie,
          whatsapp_jid,
          REGEXP_REPLACE(
            COALESCE(telefon, ''),
            '\\D',
            '',
            'g'
          ) AS digits
        FROM crm.clienti
        WHERE id = $1
      ) client
    )
    SELECT
      target.*,
      state.remote_jid AS state_remote_jid
    FROM target
    LEFT JOIN LATERAL (
      SELECT candidate.remote_jid
      FROM crm.whatsapp_chat_state candidate
      WHERE
        candidate.client_id = target.id
        OR (
          NULLIF(target.whatsapp_jid, '') IS NOT NULL
          AND candidate.remote_jid = target.whatsapp_jid
        )
        OR (
          NULLIF(target.phone_normalized, '') IS NOT NULL
          AND candidate.phone = target.phone_normalized
        )
      ORDER BY
        CASE
          WHEN candidate.client_id = target.id THEN 0
          WHEN candidate.remote_jid = target.whatsapp_jid THEN 1
          ELSE 2
        END,
        candidate.updated_at DESC
      LIMIT 1
    ) state
      ON TRUE
  `, [clientId]);

  if (!result.rowCount) {
    const error = new Error('Clientul nu a fost găsit.');
    error.code = 'client_not_found';
    throw error;
  }

  const record = result.rows[0];
  const remoteJid = derivedJid(record);

  if (!remoteJid) {
    const error = new Error(
      'Clientul nu are o identitate WhatsApp validă.'
    );
    error.code = 'whatsapp_identity_missing';
    throw error;
  }

  const inserted = await database.query(`
    INSERT INTO crm.whatsapp_chat_state (
      remote_jid,
      phone,
      client_id,
      name,
      archived,
      archive_known,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      NULLIF($4, ''),
      FALSE,
      FALSE,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (remote_jid)
    DO UPDATE SET
      phone = COALESCE(
        EXCLUDED.phone,
        crm.whatsapp_chat_state.phone
      ),
      client_id = EXCLUDED.client_id,
      name = COALESCE(
        EXCLUDED.name,
        crm.whatsapp_chat_state.name
      ),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [
    remoteJid,
    normalizedPhone(record.phone_normalized),
    record.id,
    String(record.nume || '').trim().slice(0, 255)
  ]);

  return inserted.rows[0];
}

async function touchRevision(database) {
  await database.query(`
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

async function transaction(work) {
  const database = await pool.connect();

  try {
    await database.query('BEGIN');
    const result = await work(database);
    await database.query('COMMIT');
    return result;
  } catch (error) {
    await database.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    database.release();
  }
}

export async function setLocalConversationArchived(
  clientId,
  archived
) {
  return transaction(async database => {
    const state = await resolveClientChat(
      database,
      clientId
    );

    const result = await database.query(`
      UPDATE crm.whatsapp_chat_state
      SET
        archived = $2,
        archive_known = TRUE,
        updated_at = CURRENT_TIMESTAMP
      WHERE remote_jid = $1
      RETURNING *
    `, [
      state.remote_jid,
      Boolean(archived)
    ]);

    await touchRevision(database);

    return result.rows[0];
  });
}

export async function addLocalConversationLabel(
  clientId,
  labelId
) {
  const normalizedLabel = normalizeWhatsAppLabelId(
    labelId
  );

  if (!normalizedLabel) {
    throw new Error('Eticheta nu este validă.');
  }

  return transaction(async database => {
    const label = await database.query(`
      SELECT label_id
      FROM crm.whatsapp_labels
      WHERE label_id = $1
    `, [normalizedLabel]);

    if (!label.rowCount) {
      throw new Error('Eticheta selectată nu există.');
    }

    const state = await resolveClientChat(
      database,
      clientId
    );

    await database.query(`
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
    `, [
      state.remote_jid,
      normalizedLabel
    ]);

    await touchRevision(database);

    return {
      remoteJid: state.remote_jid,
      labelId: normalizedLabel
    };
  });
}

export async function removeLocalConversationLabel(
  clientId,
  labelId
) {
  const normalizedLabel = normalizeWhatsAppLabelId(
    labelId
  );

  if (!normalizedLabel) {
    throw new Error('Eticheta nu este validă.');
  }

  return transaction(async database => {
    const state = await resolveClientChat(
      database,
      clientId
    );

    await database.query(`
      DELETE FROM crm.whatsapp_chat_labels
      WHERE remote_jid = $1
        AND label_id = $2
    `, [
      state.remote_jid,
      normalizedLabel
    ]);

    await touchRevision(database);

    return {
      remoteJid: state.remote_jid,
      labelId: normalizedLabel
    };
  });
}
