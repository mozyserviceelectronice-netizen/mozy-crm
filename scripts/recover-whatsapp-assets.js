import pg from 'pg';

import { pool } from '../src/db.js';
import {
  markMediaRecoveryFailure,
  recoverMediaFromWebMessage,
  refreshWhatsAppProfilePhotos
} from '../src/whatsapp-assets.js';

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv
    .slice(2)
    .find(value => value.startsWith(prefix));

  return found
    ? found.slice(prefix.length)
    : fallback;
}

function flag(name) {
  return process.argv
    .slice(2)
    .includes(`--${name}`);
}

function pgUrl(value) {
  const url = new URL(
    String(value || '').trim()
  );

  url.searchParams.delete('schema');

  return url.toString();
}

const limit = Math.max(
  1,
  Math.min(
    Number(argument('limit', 250)) || 250,
    1000
  )
);

const profileLimit = Math.max(
  0,
  Math.min(
    Number(argument('profiles', 180)) || 0,
    500
  )
);

const force = flag('force');

const evolutionUrl = String(
  process.env.EVOLUTION_DATABASE_URL || ''
).trim();

if (!evolutionUrl) {
  throw new Error(
    'EVOLUTION_DATABASE_URL nu este configurată.'
  );
}

const crm = new pg.Client({
  connectionString: process.env.DATABASE_URL
});

const evolution = new pg.Client({
  connectionString: pgUrl(evolutionUrl)
});

await crm.connect();
await evolution.connect();

const summary = {
  candidates: 0,
  messagesFound: 0,
  recovered: 0,
  unavailable: 0,
  errors: 0
};

try {
  const candidates = await crm.query(`
    SELECT
      conversation.id,
      conversation.client_id,
      conversation.message_id,
      conversation.tip,
      conversation.media_url,
      conversation.created_at,
      COALESCE(recovery.attempts, 0) AS attempts
    FROM crm.conversatii conversation
    LEFT JOIN crm.whatsapp_media_recovery recovery
      ON recovery.conversation_id = conversation.id
    WHERE conversation.tip IN (
      'image',
      'video',
      'audio',
      'document'
    )
      AND conversation.message_id IS NOT NULL
      AND (
        conversation.media_url IS NULL
        OR BTRIM(conversation.media_url) = ''
        OR conversation.media_url NOT LIKE
          'whatsapp-media/%'
      )
      AND (
        $2::BOOLEAN = TRUE
        OR recovery.conversation_id IS NULL
        OR recovery.status <> 'recovered'
        OR recovery.last_attempt_at <
          CURRENT_TIMESTAMP - INTERVAL '6 hours'
      )
    ORDER BY
      conversation.created_at DESC,
      conversation.id DESC
    LIMIT $1
  `, [
    limit,
    force
  ]);

  summary.candidates = candidates.rowCount;

  console.log(
    `Candidați media: ${summary.candidates}`
  );

  const messageIds = candidates.rows
    .map(row => String(row.message_id || ''))
    .filter(Boolean);

  const messages = messageIds.length
    ? await evolution.query(`
        SELECT
          message.key ->> 'id' AS message_id,
          TO_JSONB(message) AS web_message
        FROM evolution_api."Message" message
        JOIN evolution_api."Instance" instance
          ON instance.id = message."instanceId"
        WHERE instance.name = $1
          AND message.key ->> 'id' =
            ANY($2::TEXT[])
        ORDER BY
          message."messageTimestamp" DESC,
          message.id DESC
      `, [
        String(
          process.env.EVOLUTION_INSTANCE ||
          'mozy'
        ).trim(),
        messageIds
      ])
    : { rows: [] };

  const byMessageId = new Map();

  for (const row of messages.rows) {
    const id = String(row.message_id || '');

    if (
      id &&
      !byMessageId.has(id)
    ) {
      byMessageId.set(
        id,
        row.web_message
      );
    }
  }

  summary.messagesFound = byMessageId.size;

  console.log(
    `Mesaje găsite în Evolution: ${
      summary.messagesFound
    }`
  );

  for (const row of candidates.rows) {
    const messageId = String(
      row.message_id || ''
    );

    const webMessage = byMessageId.get(
      messageId
    );

    if (!webMessage) {
      summary.unavailable += 1;

      await markMediaRecoveryFailure({
        conversationId: row.id,
        messageId,
        status: 'unavailable',
        error:
          'Mesajul nu mai există în baza Evolution.'
      });

      console.log(
        `[indisponibil] CRM ${row.id} / ${messageId}`
      );

      continue;
    }

    try {
      const result =
        await recoverMediaFromWebMessage({
          conversationId: row.id,
          messageId,
          webMessage
        });

      summary.recovered += 1;

      console.log(
        `[recuperat] CRM ${row.id} / ${
          messageId
        } / ${result.bytes} bytes`
      );
    } catch (error) {
      summary.errors += 1;

      const unavailable =
        /nu a returnat|not found|indisponibil|decrypt|download/i
          .test(
            String(error?.message || '')
          );

      await markMediaRecoveryFailure({
        conversationId: row.id,
        messageId,
        status:
          unavailable
            ? 'unavailable'
            : 'error',
        error
      }).catch(() => {});

      console.log(
        `[eroare] CRM ${row.id} / ${messageId}: ${
          error?.message || String(error)
        }`
      );
    }

    await new Promise(resolve =>
      setTimeout(resolve, 120)
    );
  }
} finally {
  await evolution.end();
  await crm.end();
}

let profiles = null;

if (profileLimit > 0) {
  console.log('');
  console.log(
    `Sincronizare poze de profil: limită ${
      profileLimit
    }`
  );

  profiles = await refreshWhatsAppProfilePhotos({
    limit: profileLimit,
    force
  });
}

console.log('');
console.log('REZUMAT ACTIVE WHATSAPP');
console.log(JSON.stringify({
  media: summary,
  profiles
}, null, 2));

await pool.end();
