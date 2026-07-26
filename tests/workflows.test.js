import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('patch-ul n8n păstrează secretele și repară alerta', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mozy-workflow-test-')
  );
  const main = path.join(directory, 'main.json');
  const alert = path.join(directory, 'alert.json');

  fs.copyFileSync(
    'tests/fixtures/workflow-principal.json',
    main
  );
  fs.copyFileSync(
    'tests/fixtures/workflow-alerta.json',
    alert
  );

  const before = fs.readFileSync(main, 'utf8');
  const result = spawnSync(
    process.execPath,
    ['scripts/patch-live-workflows.mjs', main, alert],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);

  const mainWorkflow = JSON.parse(fs.readFileSync(main, 'utf8'));
  const alertWorkflow = JSON.parse(fs.readFileSync(alert, 'utf8'));
  const serialized = JSON.stringify(mainWorkflow);

  for (const placeholder of [
    'REPLACE_WITH_ROTATED_OPENAI_KEY',
    'REPLACE_WITH_EVOLUTION_API_KEY'
  ]) {
    if (before.includes(placeholder)) {
      assert.ok(serialized.includes(placeholder));
    }
  }

  const incomingQueries = mainWorkflow.nodes
    .filter(node =>
      String(node.parameters?.query || '')
        .includes('INSERT INTO whatsapp.mesaje')
    )
    .map(node => node.parameters.query)
    .filter(query => query.includes('$2'));

  assert.ok(
    incomingQueries.filter(query =>
      query.includes("CASE WHEN $2::text = 'incoming'")
    ).length >= 2
  );

  const getNode = alertWorkflow.nodes.find(node =>
    node.name === 'Get Unanswered Clients'
  );
  assert.match(getNode.parameters.query, /NOT EXISTS/);
  assert.match(getNode.parameters.query, /outgoing\.directie = 'outgoing'/);

  const andreiNode = alertWorkflow.nodes.find(node =>
    /^Send WhatsApp - Andrei/.test(node.name)
  );
  assert.equal(andreiNode.parameters.specifyHeaders, 'keypair');

  const markNode = alertWorkflow.nodes.find(node =>
    node.name === 'Mark Alert Sent'
  );
  assert.match(markNode.parameters.query, /pending\.contact_id = \$1/);
  assert.match(
    markNode.parameters.options.queryReplacement,
    /contact_id/
  );
});
