import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const assetsSource = fs.readFileSync(
  new URL('../src/whatsapp-assets.js', import.meta.url),
  'utf8'
);

const organizerSource = fs.readFileSync(
  new URL('../src/whatsapp-organizer.js', import.meta.url),
  'utf8'
);

const routeSource = fs.readFileSync(
  new URL('../src/whatsapp-crm-routes.js', import.meta.url),
  'utf8'
);

const webhookSource = fs.readFileSync(
  new URL('../src/evolution-webhook.js', import.meta.url),
  'utf8'
);

const viewSource = fs.readFileSync(
  new URL('../src/views/conversatii.ejs', import.meta.url),
  'utf8'
);

test('WhatsApp media recovery uses Evolution base64 endpoint', () => {
  assert.match(
    assetsSource,
    /getBase64FromMediaMessage/
  );

  assert.match(
    webhookSource,
    /scheduleIncomingMediaCapture/
  );

  assert.match(
    routeSource,
    /whatsapp_media_recovery/
  );
});

test('WhatsApp profile photos are stored locally and served protected', () => {
  assert.match(
    assetsSource,
    /whatsapp-profile-photos/
  );

  assert.match(
    assetsSource,
    /fetchProfilePictureUrl/
  );

  assert.match(
    routeSource,
    /\/conversatii\/avatar\/:clientId/
  );

  assert.match(
    viewSource,
    /profilePhotoUrl/
  );
});

test('CRM WhatsApp lists are separate from WhatsApp labels', () => {
  assert.match(
    organizerSource,
    /whatsapp_crm_lists/
  );

  assert.match(
    routeSource,
    /liste-creeaza/
  );

  assert.match(
    routeSource,
    /lista-adauga/
  );

  assert.match(
    viewSource,
    /Liste CRM/
  );

  assert.match(
    viewSource,
    /Etichete WhatsApp/
  );
});
