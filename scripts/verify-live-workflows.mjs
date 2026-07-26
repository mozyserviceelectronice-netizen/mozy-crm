import fs from 'node:fs';

const [mainPath, alertPath] = process.argv.slice(2);

if (!mainPath || !alertPath) {
  throw new Error(
    'Utilizare: node verify-live-workflows.mjs WORKFLOW_PRINCIPAL WORKFLOW_ALERTA'
  );
}

function readWorkflow(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

const main = readWorkflow(mainPath);
const alert = readWorkflow(alertPath);

if (!main.active || !alert.active) {
  throw new Error('Unul dintre workflow-uri nu este activ.');
}

const defaults = main.nodes
  .map(node => String(node.parameters?.query || ''))
  .filter(query => query.includes('INSERT INTO whatsapp.mesaje'))
  .filter(query =>
    query.includes("CASE WHEN $2::text = 'incoming'")
  );

if (defaults.length < 2) {
  throw new Error(
    'Mesajele incoming nu pornesc implicit cu necesita_raspuns=true.'
  );
}

const getNode = alert.nodes.find(node =>
  node.name === 'Get Unanswered Clients'
);
const markNode = alert.nodes.find(node =>
  node.name === 'Mark Alert Sent'
);
const andreiNode = alert.nodes.find(node =>
  /^Send WhatsApp - Andrei/.test(node.name)
);

if (
  !getNode?.parameters?.query?.includes('NOT EXISTS') ||
  !getNode.parameters.query.includes(
    "outgoing.directie = 'outgoing'"
  )
) {
  throw new Error('Interogarea alertei nu verifică răspunsurile outgoing.');
}

if (andreiNode?.parameters?.specifyHeaders !== 'keypair') {
  throw new Error('Header-ele pentru alerta Andrei nu sunt configurate corect.');
}

if (
  !markNode?.parameters?.query?.includes(
    'pending.contact_id = $1::bigint'
  )
) {
  throw new Error('Marcarea alertelor expediate nu este corectă.');
}

console.log('Workflow-urile active au fost verificate.');
