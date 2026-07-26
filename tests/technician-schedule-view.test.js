import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ejs from 'ejs';

const views = path.resolve('src/views');

function commonLocals() {
  return {
    csrfToken: 'a'.repeat(64),
    cspNonce: 'nonce-test',
    user: { id: 1, username: 'andrei' },
    active: 'programari-tehnician'
  };
}

test('randarea listei păstrează toate acțiunile și modalul de trimitere', async () => {
  const html = await ejs.renderFile(
    path.join(views, 'tehnician-programari.ejs'),
    {
      ...commonLocals(),
      appointments: [{
        id: 7,
        fara_interval: false,
        ora_programare: '08:00:00',
        ora_sfarsit: '10:00:00',
        tip_deplasare: 'reparatie',
        status: 'programata',
        tehnician_display: 'Lucian',
        nume: null,
        telefon: '0712345678',
        adresa: 'Strada Test 1',
        oras: 'București',
        marca: 'Sony',
        model: 'KD-55',
        defect_reclamat: 'Nu pornește',
        preturi: [
          { valoare: '450.00', descriere: 'Reparație placă' }
        ],
        cost_deplasare: '100.00',
        garantie_luni: 6,
        conditii_comerciale: 'Diagnostic inclus',
        observatii: 'Sună înainte',
        phoneHref: 'tel:0712345678',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=x',
        wazeUrl: 'https://waze.com/ul?q=x&navigate=yes'
      }],
      travelTypes: {
        reparatie: 'Reparație la domiciliu',
        ridicare: 'Ridicare echipament',
        livrare: 'Livrare echipament'
      },
      statusLabels: { programata: 'Programată' },
      selectedDate: '2026-07-27',
      selectedType: 'reparatie',
      today: '2026-07-26',
      previousDay: '2026-07-26',
      nextDay: '2026-07-28',
      previousMonth: '2026-06-01',
      nextMonth: '2026-08-01',
      monthLabel: 'Iulie 2026',
      calendarDays: [],
      sendHistory: [],
      senderMember: { code: 'andrei' },
      created: false,
      updated: false,
      deleted: false
    },
    { filename: path.join(views, 'tehnician-programari.ejs') }
  );

  for (const text of [
    'Trimite programul zilei',
    'Sună',
    'Google Maps',
    'Waze',
    'Reparat',
    'Nu a răspuns',
    'Nu s-a putut repara',
    'Amână programarea',
    'Șterge programarea',
    'Editează programarea',
    'Observații tehnician'
  ]) {
    assert.match(html, new RegExp(text));
  }
  assert.match(html, /data-schedule-modal/);
  assert.match(html, /data-confirm=/);
  assert.match(html, /name="tip" value="reparatie"/);
});

test('formularul randat include interval opțional și editor extensibil de prețuri', async () => {
  const html = await ejs.renderFile(
    path.join(views, 'tehnician-programare-noua.ejs'),
    {
      ...commonLocals(),
      values: {
        telefon: '',
        nume: '',
        tehnician_user_id: '3',
        tip_deplasare: 'reparatie',
        oras: 'București',
        adresa: '',
        marca: '',
        model: '',
        defect_reclamat: '',
        cost_deplasare: '',
        garantie_luni: '6',
        conditii_comerciale: '',
        data_programare: '2026-07-27',
        fara_interval: true,
        ora_programare: '',
        ora_sfarsit: '',
        observatii: '',
        priceRows: [
          { amount: '450', description: 'Placă' },
          { amount: '550', description: 'Barete' },
          { amount: '650', description: 'Sursă' },
          { amount: '750', description: 'Pachet' }
        ]
      },
      travelTypes: { reparatie: 'Reparație la domiciliu' },
      technicians: [{
        id: 3,
        displayName: 'Lucian',
        username: 'Lucian'
      }],
      errors: [],
      mode: 'create',
      appointmentId: null
    },
    {
      filename: path.join(
        views,
        'tehnician-programare-noua.ejs'
      )
    }
  );

  assert.match(html, /data-no-interval-toggle/);
  assert.match(html, /Nu există interval orar stabilit/);
  assert.equal(
    (html.match(/name="pret_valoare"/g) || []).length,
    5
  );
  assert.match(html, /\+ Adaugă variantă de preț/);
  assert.match(html, /name="cost_deplasare"/);
  assert.match(html, /name="tehnician_user_id"/);
});

test('JavaScript-ul public include protecția de dublu click și retry selectiv', () => {
  const source = fs.readFileSync('public/app.js', 'utf8');
  assert.match(source, /idempotency_key/);
  assert.match(source, /crypto\.randomUUID/);
  assert.match(source, /\/retry/);
  assert.match(source, /data-retry-operation/);
  assert.match(source, /X-CSRF-Token/);
});
