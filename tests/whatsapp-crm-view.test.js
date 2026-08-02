import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const routeSource = fs.readFileSync(
  new URL('../src/whatsapp-crm-routes.js', import.meta.url),
  'utf8'
);

const viewSource = fs.readFileSync(
  new URL('../src/views/conversatii.ejs', import.meta.url),
  'utf8'
);

const appSource = fs.readFileSync(
  new URL('../public/app.js', import.meta.url),
  'utf8'
);

const headerSource = fs.readFileSync(
  new URL('../src/views/partials/header.ejs', import.meta.url),
  'utf8'
);

test('WhatsApp CRM registers protected routes', () => {
  assert.match(
    routeSource,
    /app\.get\(\s*['"]\/conversatii['"]/
  );

  assert.match(
    routeSource,
    /app\.post\(\s*['"]\/conversatii\/:clientId\/trimite['"]/
  );

  assert.match(
    routeSource,
    /requireAuth/
  );
});

test('WhatsApp CRM sends through Evolution helper', () => {
  assert.match(
    routeSource,
    /sendWhatsAppText/
  );

  assert.match(
    routeSource,
    /4096/
  );
});

test('WhatsApp view contains conversation and composer UI', () => {
  assert.match(
    viewSource,
    /whatsapp-conversation-list/
  );

  assert.match(
    viewSource,
    /whatsapp-message-history/
  );

  assert.match(
    viewSource,
    /name="mesaj"/
  );

  assert.match(
    viewSource,
    /name="_csrf"/
  );
});

test('WhatsApp appears in navigation', () => {
  assert.match(
    headerSource,
    /href="\/conversatii"/
  );
});

test('WhatsApp refreshes automatically when new messages arrive', () => {
  assert.match(
    routeSource,
    /\/conversatii\/stare-live/
  );

  assert.match(
    viewSource,
    /data-whatsapp-live/
  );

  assert.match(
    appSource,
    /setInterval\(\s*checkLiveState,\s*2000/
  );
});
