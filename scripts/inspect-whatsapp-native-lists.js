import pg from 'pg';

function pgUrl(value) {
  const url = new URL(
    String(value || '').trim()
  );

  url.searchParams.delete('schema');

  return url.toString();
}

const evolutionUrl = String(
  process.env.EVOLUTION_DATABASE_URL || ''
).trim();

if (!evolutionUrl) {
  throw new Error(
    'EVOLUTION_DATABASE_URL nu este configurată.'
  );
}

const database = new pg.Client({
  connectionString: pgUrl(evolutionUrl)
});

await database.connect();

try {
  console.log(
    '=== Structuri Evolution asociate cu liste/filtre ==='
  );

  const structures = await database.query(`
    SELECT
      table_schema,
      table_name,
      column_name,
      data_type
    FROM information_schema.columns
    WHERE table_schema = 'evolution_api'
      AND (
        table_name ILIKE ANY(
          ARRAY[
            '%list%',
            '%filter%',
            '%folder%'
          ]
        )
        OR column_name ILIKE ANY(
          ARRAY[
            '%list%',
            '%filter%',
            '%folder%'
          ]
        )
      )
    ORDER BY
      table_name,
      ordinal_position
  `);

  console.table(structures.rows);

  const chat = await database.query(`
    SELECT
      COUNT(*)::INTEGER AS chats_total,
      COUNT(*) FILTER (
        WHERE labels IS NOT NULL
          AND labels <> '[]'::JSONB
      )::INTEGER AS chats_with_labels
    FROM evolution_api."Chat"
  `);

  console.log('');
  console.log(
    'Chat-uri și etichete persistate:'
  );
  console.table(chat.rows);

  const tables = await database.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'evolution_api'
    ORDER BY table_name
  `);

  console.log('');
  console.log(
    'Tabele Evolution disponibile:'
  );
  console.log(
    tables.rows.map(row => row.table_name)
  );

  console.log('');
  console.log(
    'Diagnosticul este doar în citire. ' +
    'Listele personalizate native WhatsApp ' +
    'pot lipsi din baza Evolution chiar dacă ' +
    'există în aplicația telefonului.'
  );
} finally {
  await database.end();
}
