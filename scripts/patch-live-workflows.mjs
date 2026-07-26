import fs from 'node:fs';

const [mainPath, alertPath] = process.argv.slice(2);

if (!mainPath || !alertPath) {
  throw new Error(
    'Utilizare: node patch-live-workflows.mjs WORKFLOW_PRINCIPAL WORKFLOW_ALERTA'
  );
}

function readWorkflow(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const workflow = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!workflow || !Array.isArray(workflow.nodes)) {
    throw new Error(`Workflow invalid: ${file}`);
  }
  return {
    workflow,
    wrapped: Array.isArray(parsed)
  };
}

function writeWorkflow(file, loaded) {
  const output = loaded.wrapped
    ? [loaded.workflow]
    : loaded.workflow;
  fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
}

function patchIncomingDefaults(workflow) {
  let patched = 0;

  for (const node of workflow.nodes) {
    const query = node.parameters?.query;
    if (
      node.type !== 'n8n-nodes-base.postgres' ||
      typeof query !== 'string' ||
      !query.includes('INSERT INTO whatsapp.mesaje')
    ) {
      continue;
    }

    const next = query.replace(
      /VALUES\s*\(\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*\$4\s*,\s*\$5\s*,\s*false\s*,\s*false\s*\)/i,
      `VALUES (
  $1,
  $2,
  $3,
  $4,
  $5,
  CASE WHEN $2::text = 'incoming' THEN TRUE ELSE FALSE END,
  FALSE
)`
    );

    if (next !== query) {
      node.parameters.query = next;
      patched += 1;
    }
  }

  if (patched < 2) {
    throw new Error(
      `Au fost găsite numai ${patched} inserări incoming de corectat în workflow-ul principal.`
    );
  }
}

function patchAlertWorkflow(workflow) {
  const getNode = workflow.nodes.find(node =>
    node.name === 'Get Unanswered Clients'
  );
  const markNode = workflow.nodes.find(node =>
    node.name === 'Mark Alert Sent'
  );
  const andreiNode = workflow.nodes.find(node =>
    /^Send WhatsApp - Andrei/.test(node.name)
  );

  if (!getNode || !markNode || !andreiNode) {
    throw new Error(
      'Workflow-ul alertei nu conține toate nodurile așteptate.'
    );
  }

  getNode.parameters.query = `WITH unanswered AS (
  SELECT
    m.id AS message_row_id,
    m.contact_id,
    m.tip,
    m.mesaj,
    m.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY m.contact_id
      ORDER BY m.created_at ASC, m.id ASC
    ) AS position
  FROM whatsapp.mesaje m
  WHERE m.directie = 'incoming'
    AND m.necesita_raspuns = TRUE
    AND m.alerta_trimisa = FALSE
    AND m.created_at <= CURRENT_TIMESTAMP - INTERVAL '30 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM whatsapp.mesaje outgoing
      WHERE outgoing.contact_id = m.contact_id
        AND outgoing.directie = 'outgoing'
        AND (
          outgoing.created_at,
          outgoing.id
        ) > (
          m.created_at,
          m.id
        )
    )
)
SELECT
  u.message_row_id,
  u.contact_id,
  c.nume,
  c.telefon,
  u.tip,
  u.mesaj AS ultimul_mesaj,
  u.created_at AS data_mesaj,
  FLOOR(EXTRACT(EPOCH FROM (
    CURRENT_TIMESTAMP - u.created_at
  )) / 60)::integer AS minute_asteptare
FROM unanswered u
JOIN whatsapp.contacte c ON c.id = u.contact_id
WHERE u.position = 1
ORDER BY u.created_at ASC;`;

  andreiNode.parameters.specifyHeaders = 'keypair';

  markNode.parameters.query = `UPDATE whatsapp.mesaje pending
SET alerta_trimisa = TRUE
WHERE pending.contact_id = $1::bigint
  AND pending.directie = 'incoming'
  AND pending.necesita_raspuns = TRUE
  AND pending.alerta_trimisa = FALSE
  AND pending.created_at <= CURRENT_TIMESTAMP - INTERVAL '30 minutes'
  AND NOT EXISTS (
    SELECT 1
    FROM whatsapp.mesaje outgoing
    WHERE outgoing.contact_id = pending.contact_id
      AND outgoing.directie = 'outgoing'
      AND (
        outgoing.created_at,
        outgoing.id
      ) > (
        pending.created_at,
        pending.id
      )
  )
RETURNING id, contact_id, necesita_raspuns, alerta_trimisa, created_at;`;

  markNode.parameters.options ||= {};
  markNode.parameters.options.queryReplacement =
    "={{ [$('Format Unanswered Alert').item.json.contact_id] }}";
}

const mainLoaded = readWorkflow(mainPath);
const alertLoaded = readWorkflow(alertPath);

patchIncomingDefaults(mainLoaded.workflow);
patchAlertWorkflow(alertLoaded.workflow);

writeWorkflow(mainPath, mainLoaded);
writeWorkflow(alertPath, alertLoaded);

console.log('Workflow-urile au fost corectate fără modificarea credențialelor.');
