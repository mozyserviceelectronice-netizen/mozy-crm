import assert from 'node:assert/strict';
import test from 'node:test';
import { safeLoginReturnTo } from '../src/auth.js';
import {
  formatDailySchedule,
  formValues,
  sortAppointments,
  validateForm
} from '../src/technician-schedule-domain.js';
import {
  maskPhoneNumber,
  scheduleRecipients,
  teamMemberForUsername
} from '../src/technician-team.js';

function validValues(overrides = {}) {
  return formValues({
    telefon: '0712345678',
    nume: 'Client Test',
    tehnician_user_id: '3',
    tip_deplasare: 'reparatie',
    marca: 'Sony',
    model: 'KD-55',
    defect_reclamat: 'Nu pornește',
    oras: 'București',
    adresa: 'Strada Test 1',
    pret_valoare: ['450'],
    pret_descriere: ['Reparație placă'],
    cost_deplasare: '100',
    garantie_luni: '6',
    data_programare: '2026-07-27',
    ora_programare: '08:00',
    ora_sfarsit: '10:00',
    ...overrides
  });
}

test('identifică membrii echipei după username, fără diferență de litere', () => {
  assert.equal(teamMemberForUsername('andrei')?.code, 'andrei');
  assert.equal(teamMemberForUsername('GIANI')?.code, 'giani');
  assert.equal(teamMemberForUsername('Lucian')?.code, 'lucian');
  assert.equal(teamMemberForUsername('operator'), null);
});

test('Andrei trimite către Giani și ambele numere ale lui Lucian', () => {
  const result = scheduleRecipients({
    senderUsername: 'andrei'
  });
  assert.deepEqual(
    result.recipients.map(item => item.number),
    ['40731341491', '40765955446', '40775142016']
  );
});

test('Giani și Lucian nu primesc propriul mesaj', () => {
  const giani = scheduleRecipients({
    senderUsername: 'Giani'
  });
  assert.deepEqual(
    giani.recipients.map(item => item.number),
    ['40771559501', '40765955446', '40775142016']
  );

  const lucian = scheduleRecipients({
    senderUsername: 'Lucian'
  });
  assert.deepEqual(
    lucian.recipients.map(item => item.number),
    ['40771559501', '40731341491']
  );
});

test('un utilizator necunoscut poate alege numai membri autorizați', () => {
  const result = scheduleRecipients({
    senderUsername: 'operator',
    selectedMemberCodes: ['giani', 'invalid', 'giani']
  });
  assert.equal(result.sender, null);
  assert.deepEqual(
    result.recipients.map(item => item.number),
    ['40731341491']
  );
});

test('maschează numerele în forma cerută', () => {
  assert.equal(maskPhoneNumber('40765955446'), '0765***446');
  assert.equal(maskPhoneNumber('40775142016'), '0775***016');
});

test('validează o programare fără interval și salvează ore nule', () => {
  const values = validValues({
    fara_interval: '1',
    ora_programare: '',
    ora_sfarsit: ''
  });
  const validation = validateForm(values);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.startTime, null);
  assert.equal(validation.endTime, null);
});

test('cere ambele ore și ordinea corectă pentru programarea cu interval', () => {
  const values = validValues({
    ora_programare: '10:00',
    ora_sfarsit: '09:00'
  });
  assert.match(
    validateForm(values).errors.join(' '),
    /după ora de început/
  );
});

test('acceptă mai mult de trei prețuri și păstrează primul ca preț compatibil', () => {
  const values = validValues({
    pret_valoare: ['450', '550', '650', '750'],
    pret_descriere: ['Placă', 'Barete', 'Sursă', 'Pachet complet']
  });
  const validation = validateForm(values);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.prices.length, 4);
  assert.equal(validation.primaryPrice, 450);
});

test('respinge prețuri duplicate și descrieri lipsă la variante multiple', () => {
  const duplicate = validValues({
    pret_valoare: ['450', '450'],
    pret_descriere: ['Placă', 'Placă']
  });
  assert.match(
    validateForm(duplicate).errors.join(' '),
    /duplicate/
  );

  const missingDescription = validValues({
    pret_valoare: ['450', '550'],
    pret_descriere: ['', 'Barete']
  });
  assert.match(
    validateForm(missingDescription).errors.join(' '),
    /Descrierea este obligatorie/
  );
});

test('sortează intervalele cronologic și pune programările fără interval la final', () => {
  const sorted = sortAppointments([
    { id: 3, fara_interval: true, ora_programare: null },
    { id: 2, fara_interval: false, ora_programare: '12:00' },
    { id: 1, fara_interval: false, ora_programare: '08:00' }
  ]);
  assert.deepEqual(sorted.map(row => row.id), [1, 2, 3]);
});

test('formatează programul cu grupare, prețuri, interval opțional și link CRM', () => {
  const appointments = [
    {
      id: 2,
      tehnician_display: 'Lucian',
      fara_interval: true,
      ora_programare: null,
      ora_sfarsit: null,
      tip_deplasare: 'ridicare',
      nume: null,
      telefon: '0746901634',
      adresa: 'Strada A 1',
      oras: 'București',
      marca: 'Sony',
      model: null,
      defect_reclamat: 'Lipsă imagine',
      pret_reparatie: 500,
      preturi: [
        { valoare: 500, descriere: 'Reparație standard' },
        { valoare: 600, descriere: 'Inclusiv sursa' }
      ],
      cost_deplasare: 100,
      garantie_luni: 6,
      conditii_comerciale: null,
      observatii: null
    },
    {
      id: 1,
      tehnician_display: 'Lucian',
      fara_interval: false,
      ora_programare: '08:00',
      ora_sfarsit: '10:00',
      tip_deplasare: 'reparatie',
      nume: 'Popescu',
      telefon: '0711111111',
      adresa: 'Strada B 2',
      oras: 'București',
      marca: 'LG',
      model: '55NANO',
      defect_reclamat: 'Nu pornește',
      pret_reparatie: 450,
      preturi: [{ valoare: 450, descriere: null }],
      cost_deplasare: null,
      garantie_luni: 6,
      conditii_comerciale: 'Diagnostic inclus',
      observatii: 'Sună înainte'
    }
  ];
  const message = formatDailySchedule({
    date: '2026-07-27',
    appointments,
    crmUrl:
      'https://crm.reparatii-televizoare.com/tehnician/programari?data=2026-07-27'
  });
  assert.match(message, /08:00–10:00 — Reparație la domiciliu/);
  assert.match(message, /Fără interval stabilit — Ridicare echipament/);
  assert.ok(
    message.indexOf('08:00–10:00') <
      message.indexOf('Fără interval stabilit')
  );
  assert.match(message, /- 500 lei — Reparație standard/);
  assert.match(message, /Cost deplasare: 100 lei/);
  assert.match(message, /Client fără nume/);
  assert.match(message, /Vezi varianta actualizată în CRM/);
  assert.doesNotMatch(message, /undefined|null|\[object Object\]/);
});

test('redirectul după login acceptă numai căi locale sigure', () => {
  assert.equal(
    safeLoginReturnTo(
      '/tehnician/programari?data=2026-07-27'
    ),
    '/tehnician/programari?data=2026-07-27'
  );
  assert.equal(safeLoginReturnTo('https://evil.example'), '/');
  assert.equal(safeLoginReturnTo('//evil.example/path'), '/');
  assert.equal(safeLoginReturnTo('/login?returnTo=/x'), '/');
});
