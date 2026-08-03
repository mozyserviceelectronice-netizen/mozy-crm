import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../src/evolution-webhook.js', import.meta.url),
  'utf8'
);

test('Evolution schedules media before forwarding to n8n', () => {
  const mediaPosition = source.indexOf(
    "scheduleIncomingMediaCapture("
  );
  const forwardingPosition = source.indexOf(
    "void forwardToN8nWithRetry("
  );

  assert.ok(mediaPosition >= 0);
  assert.ok(forwardingPosition >= 0);
  assert.ok(mediaPosition < forwardingPosition);
});

test('Evolution forwarding is non-blocking and retried', () => {
  assert.match(
    source,
    /async function forwardToN8nWithRetry\(payload\)/
  );
  assert.match(
    source,
    /attempt <= 3/
  );
  assert.match(
    source,
    /void forwardToN8nWithRetry/
  );
  assert.doesNotMatch(
    source,
    /await forwardToN8n\(req\.body\)/
  );
});
