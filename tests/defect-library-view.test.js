import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import ejs from 'ejs';

const views = path.resolve('src/views');

function common() {
  return {
    csrfToken: 'a'.repeat(64),
    cspNonce: 'nonce-test',
    user: { id: 1, username: 'andrei', role: 'admin' },
    active: 'biblioteca-defecte'
  };
}

test('pagina principală afișează mărci, filtre și cazuri', async () => {
  const html = await ejs.renderFile(
    path.join(views, 'biblioteca-defecte.ejs'),
    {
      ...common(),
      brandCards: [{
        id: 1,
        nume: 'Samsung',
        slug: 'samsung',
        numar_modele: 1,
        numar_cazuri: 1,
        ultima_actualizare: new Date()
      }],
      brands: [{ id: 1, nume: 'Samsung', activa: true }],
      families: [{
        id: 2,
        marca_id: 1,
        nume: 'QLED',
        activa: true
      }],
      models: [{
        id: 3,
        marca_id: 1,
        familie_id: 2,
        model: 'QE50Q60AAU'
      }],
      users: [{ id: 1, username: 'andrei' }],
      cases: [{
        id: 4,
        titlu: 'Restart repetat',
        simptom: 'Se restartează',
        dificultate: 'dificil',
        rezultat: 'reparat',
        status_verificare: 'confirmat_service',
        updated_at: new Date(),
        marca: 'Samsung',
        familie: 'QLED',
        model: 'QE50Q60AAU',
        autor: 'andrei',
        numar_atasamente: 2
      }],
      total: 1,
      totalPages: 1,
      page: 1,
      filters: {
        q: '',
        marca_id: null,
        familie_id: null,
        model_id: null,
        dificultate: '',
        rezultat: '',
        status_verificare: '',
        cu_atasamente: '',
        atasament: '',
        creat_de: null,
        data_de_la: '',
        data_pana_la: '',
        sort: 'updated_desc',
        page: 1,
        per_page: 25
      },
      filtersActive: false,
      difficulties: { dificil: 'Dificil' },
      results: { reparat: 'Reparat' },
      verificationStatuses: {
        confirmat_service: 'Soluție confirmată în service'
      },
      sorts: { updated_desc: 'Actualizate recent' },
      pageSizes: [25, 50, 100],
      buildLibraryUrl: () => '/biblioteca-defecte',
      isAdmin: true
    },
    { filename: path.join(views, 'biblioteca-defecte.ejs') }
  );

  for (const text of [
    'Biblioteca defecte',
    'Samsung',
    'QE50Q60AAU',
    'Restart repetat',
    'Filtre și ordonare',
    'Administrează structura'
  ]) {
    assert.match(html, new RegExp(text));
  }
});

test('formularul include toate secțiunile și uploadul controlat', async () => {
  const html = await ejs.renderFile(
    path.join(views, 'biblioteca-caz-form.ejs'),
    {
      ...common(),
      values: {
        marca_id: 1,
        familie_id: 2,
        familie_noua: '',
        model: 'QE50Q60AAU',
        model_descriere: '',
        titlu: '',
        simptom: '',
        defect_reclamat: '',
        manifestare: '',
        diagnostic: '',
        cauza_identificata: '',
        solutie: '',
        masuratori: '',
        componente_schimbate: '',
        valori_componente: '',
        firmware_folosit: '',
        cod_placa_baza: '',
        cod_sursa: '',
        cod_tcon: '',
        cod_panou: '',
        cod_sasiu: '',
        alte_coduri: '',
        dificultate: 'mediu',
        rezultat: 'in_cercetare',
        status_verificare: 'caz_intern',
        observatii: ''
      },
      errors: [],
      mode: 'create',
      caseId: null,
      brands: [{ id: 1, nume: 'Samsung' }],
      families: [{
        id: 2,
        marca_id: 1,
        nume: 'QLED'
      }],
      models: [{
        id: 3,
        marca_id: 1,
        familie_id: 2,
        model: 'QE50Q60AAU'
      }],
      difficulties: { mediu: 'Mediu' },
      results: { in_cercetare: 'În cercetare' },
      verificationStatuses: { caz_intern: 'Caz intern' },
      isAdmin: true
    },
    { filename: path.join(views, 'biblioteca-caz-form.ejs') }
  );

  for (const text of [
    'Identificare',
    'Defect',
    'Soluție',
    'Clasificare',
    'Atașamente',
    'data-library-case-form',
    'application/pdf'
  ]) {
    assert.match(html, new RegExp(text));
  }
});

test('pagina cazului are breadcrumb, galerie, PDF și acțiuni sigure', async () => {
  const html = await ejs.renderFile(
    path.join(views, 'biblioteca-caz.ejs'),
    {
      ...common(),
      caseRow: {
        id: 4,
        marca_id: 1,
        marca: 'Samsung',
        familie_id: 2,
        familie: 'QLED',
        model_id: 3,
        model: 'QE50Q60AAU',
        titlu: 'Restart repetat',
        simptom: 'Se restartează',
        defect_reclamat: null,
        manifestare: null,
        diagnostic: 'Sursă instabilă',
        cauza_identificata: 'Condensator',
        solutie: 'Înlocuire',
        masuratori: '12 V instabil',
        componente_schimbate: 'C101',
        valori_componente: '470 uF',
        firmware_folosit: null,
        observatii: null,
        cod_sasiu: null,
        cod_placa_baza: 'BN41-02756',
        cod_sursa: null,
        cod_tcon: null,
        cod_panou: null,
        alte_coduri: null,
        dificultate: 'dificil',
        rezultat: 'reparat',
        status_verificare: 'confirmat_service',
        autor: 'andrei',
        actualizat_de: 'andrei',
        created_at: new Date(),
        updated_at: new Date()
      },
      attachments: [
        {
          id: 10,
          tip: 'imagine',
          nume_original: 'placa.jpg',
          descriere: 'Zona sursei',
          dimensiune_bytes: 1000,
          incarcat_de: 'andrei'
        },
        {
          id: 11,
          tip: 'pdf',
          nume_original: 'schema.pdf',
          descriere: null,
          dimensiune_bytes: 2000,
          incarcat_de: 'andrei'
        }
      ],
      difficulties: { dificil: 'Dificil' },
      results: { reparat: 'Reparat' },
      verificationStatuses: {
        confirmat_service: 'Soluție confirmată în service'
      },
      formatBytes: value => `${value} B`,
      isAdmin: true,
      messages: {
        created: false,
        updated: false,
        uploaded: false,
        removed: false,
        archived: false,
        restored: false
      }
    },
    { filename: path.join(views, 'biblioteca-caz.ejs') }
  );

  assert.match(html, /Samsung[\s\S]*QLED[\s\S]*QE50Q60AAU/);
  assert.match(html, /data-library-image/);
  assert.match(html, /Deschide PDF/);
  assert.match(html, /data-library-viewer/);
  assert.match(html, /data-confirm=/);
  assert.match(html, /Șterge/);
});
