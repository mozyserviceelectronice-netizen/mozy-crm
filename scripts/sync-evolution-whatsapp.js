import pg from 'pg';

const { Client } = pg;

function withoutPrismaSchema(value) {
  const raw = String(value || '').trim();

  if (!raw) {
    throw new Error('Lipsește URL-ul bazei de date.');
  }

  const parsed = new URL(raw);
  parsed.searchParams.delete('schema');

  return parsed.toString();
}

const crmDatabaseUrl = withoutPrismaSchema(
  process.env.DATABASE_URL
);

const evolutionDatabaseUrl = withoutPrismaSchema(
  process.env.EVOLUTION_DATABASE_URL
);

const instanceName = String(
  process.env.EVOLUTION_INSTANCE || 'mozy'
).trim();

const crm = new Client({
  connectionString: crmDatabaseUrl
});

const evolution = new Client({
  connectionString: evolutionDatabaseUrl
});

function phoneFromJid(value) {
  const jid = String(value || '').trim().toLowerCase();

  if (!jid.endsWith('@s.whatsapp.net')) {
    return null;
  }

  const digits = jid.split('@')[0].replace(/\D/g, '');

  return /^\d{8,15}$/.test(digits)
    ? digits
    : null;
}

try {
  await Promise.all([
    crm.connect(),
    evolution.connect()
  ]);

  const labelsResult = await evolution.query(`
    SELECT
      l."labelId"::TEXT AS label_id,
      COALESCE(NULLIF(BTRIM(l.name), ''),
        'Etichetă ' || l."labelId"::TEXT
      ) AS name,
      l.color,
      l."predefinedId"::TEXT AS predefined_id
    FROM evolution_api."Label" l
    JOIN evolution_api."Instance" i
      ON i.id = l."instanceId"
    WHERE i.name = $1
    ORDER BY l."labelId"
  `, [instanceName]);

  const chatsResult = await evolution.query(`
    WITH latest_phone AS (
      SELECT DISTINCT ON (m.key ->> 'remoteJid')
        m.key ->> 'remoteJid' AS remote_jid,
        CASE
          WHEN COALESCE(
            m.key ->> 'remoteJidAlt',
            ''
          ) LIKE '%@s.whatsapp.net'
            THEN SPLIT_PART(
              m.key ->> 'remoteJidAlt',
              '@',
              1
            )
          WHEN COALESCE(
            m.key ->> 'remoteJid',
            ''
          ) LIKE '%@s.whatsapp.net'
            THEN SPLIT_PART(
              m.key ->> 'remoteJid',
              '@',
              1
            )
          ELSE NULL
        END AS phone
      FROM evolution_api."Message" m
      JOIN evolution_api."Instance" i
        ON i.id = m."instanceId"
      WHERE i.name = $1
        AND NULLIF(
          BTRIM(m.key ->> 'remoteJid'),
          ''
        ) IS NOT NULL
      ORDER BY
        m.key ->> 'remoteJid',
        m."messageTimestamp" DESC,
        m.id DESC
    )
    SELECT
      c."remoteJid" AS remote_jid,
      NULLIF(BTRIM(c.name), '') AS name,
      c."unreadMessages" AS unread_count,
      COALESCE(c.labels, '[]'::JSONB) AS labels,
      COALESCE(
        latest_phone.phone,
        CASE
          WHEN c."remoteJid" LIKE '%@s.whatsapp.net'
            THEN SPLIT_PART(c."remoteJid", '@', 1)
          ELSE NULL
        END
      ) AS phone
    FROM evolution_api."Chat" c
    JOIN evolution_api."Instance" i
      ON i.id = c."instanceId"
    LEFT JOIN latest_phone
      ON latest_phone.remote_jid = c."remoteJid"
    WHERE i.name = $1
    ORDER BY c."remoteJid"
  `, [instanceName]);

  const labels = labelsResult.rows.map(record => ({
    label_id: String(record.label_id),
    name: String(record.name),
    color: record.color === null
      ? null
      : Number(record.color),
    predefined_id: record.predefined_id === null
      ? null
      : String(record.predefined_id)
  }));

  const chats = chatsResult.rows.map(record => ({
    remote_jid: String(record.remote_jid),
    phone:
      record.phone ||
      phoneFromJid(record.remote_jid),
    name: record.name,
    unread_count: record.unread_count === null
      ? null
      : Number(record.unread_count),
    labels: Array.isArray(record.labels)
      ? record.labels.map(String)
      : []
  }));

  const associations = [];

  for (const chat of chats) {
    for (const labelId of chat.labels) {
      associations.push({
        remote_jid: chat.remote_jid,
        label_id: labelId
      });
    }
  }

  await crm.query('BEGIN');

  await crm.query(`
    WITH incoming AS (
      SELECT *
      FROM JSONB_TO_RECORDSET($1::JSONB) AS x(
        label_id TEXT,
        name TEXT,
        color INTEGER,
        predefined_id TEXT
      )
    )
    INSERT INTO crm.whatsapp_labels (
      label_id,
      name,
      color,
      predefined_id,
      updated_at
    )
    SELECT
      label_id,
      name,
      color,
      predefined_id,
      CURRENT_TIMESTAMP
    FROM incoming
    ON CONFLICT (label_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      color = EXCLUDED.color,
      predefined_id = EXCLUDED.predefined_id,
      updated_at = CURRENT_TIMESTAMP
  `, [JSON.stringify(labels)]);

  await crm.query(`
    WITH incoming AS (
      SELECT *
      FROM JSONB_TO_RECORDSET($1::JSONB) AS x(
        remote_jid TEXT,
        phone TEXT,
        name TEXT,
        unread_count INTEGER
      )
    ),
    normalized_clients AS (
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
    ),
    mapped AS (
      SELECT
        incoming.*,
        client_match.id AS client_id
      FROM incoming
      LEFT JOIN LATERAL (
        SELECT normalized_clients.id
        FROM normalized_clients
        WHERE
          normalized_clients.whatsapp_jid =
            incoming.remote_jid
          OR
          (
            incoming.phone IS NOT NULL
            AND normalized_clients.phone_normalized =
              incoming.phone
          )
        ORDER BY
          CASE
            WHEN normalized_clients.whatsapp_jid =
              incoming.remote_jid
              THEN 0
            ELSE 1
          END,
          normalized_clients.id ASC
        LIMIT 1
      ) client_match
        ON TRUE
    )
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
    SELECT
      remote_jid,
      phone,
      client_id,
      name,
      unread_count,
      FALSE,
      FALSE,
      CURRENT_TIMESTAMP
    FROM mapped
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
      updated_at = CURRENT_TIMESTAMP
  `, [JSON.stringify(
    chats.map(({ labels: _labels, ...chat }) => chat)
  )]);

  await crm.query(`
    WITH imported_chats AS (
      SELECT remote_jid
      FROM JSONB_TO_RECORDSET($1::JSONB) AS x(
        remote_jid TEXT
      )
    )
    DELETE FROM crm.whatsapp_chat_labels existing
    USING imported_chats
    WHERE existing.remote_jid = imported_chats.remote_jid
  `, [JSON.stringify(
    chats.map(chat => ({
      remote_jid: chat.remote_jid
    }))
  )]);

  if (associations.length) {
    await crm.query(`
      WITH incoming AS (
        SELECT *
        FROM JSONB_TO_RECORDSET($1::JSONB) AS x(
          remote_jid TEXT,
          label_id TEXT
        )
      )
      INSERT INTO crm.whatsapp_chat_labels (
        remote_jid,
        label_id,
        updated_at
      )
      SELECT
        incoming.remote_jid,
        incoming.label_id,
        CURRENT_TIMESTAMP
      FROM incoming
      JOIN crm.whatsapp_chat_state state
        ON state.remote_jid = incoming.remote_jid
      JOIN crm.whatsapp_labels label
        ON label.label_id = incoming.label_id
      ON CONFLICT (remote_jid, label_id)
      DO UPDATE SET
        updated_at = CURRENT_TIMESTAMP
    `, [JSON.stringify(associations)]);
  }

  await crm.query(`
    UPDATE crm.whatsapp_sync_meta
    SET
      revision = revision + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `);

  await crm.query('COMMIT');

  const mappedClients = await crm.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM crm.whatsapp_chat_state
    WHERE client_id IS NOT NULL
  `);

  console.log(JSON.stringify({
    instance: instanceName,
    labels: labels.length,
    chats: chats.length,
    associations: associations.length,
    mappedClients: mappedClients.rows[0]?.count || 0
  }, null, 2));
} catch (error) {
  await crm.query('ROLLBACK').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([
    crm.end(),
    evolution.end()
  ]);
}
