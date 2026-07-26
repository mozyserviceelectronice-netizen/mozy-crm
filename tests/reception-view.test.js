import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import ejs from 'ejs';
import {
  buildReceptionListUrl,
  receptionFilterTabs
} from '../src/reception-filters.js';

const view = path.resolve('src/views/receptie.ejs');

const counts = {
  active: 5,
  toate: 52,
  primit: 5,
  in_diagnosticare: 0,
  asteapta_acord: 0,
  asteapta_piesa: 0,
  in_reparatie: 0,
  finalizat: 0,
  predat: 46,
  anulat: 1
};

function render(overrides = {}) {
  return ejs.renderFile(view, {
    rows: [],
    q: '',
    selectedStatus: 'active',
    receptionFilterTabs,
    counts,
    page: 1,
    totalPages: 1,
    totalRows: 5,
    buildReceptionListUrl,
    returnTo: '/receptie?status=active',
    testSters: false,
    active: 'receptie',
    csrfToken: 'test-csrf-token',
    ...overrides
  });
}

test('lista randată păstrează filtrul, căutarea și pagina', async () => {
  const html = await render({
    rows: [{
      id: 26,
      numar_receptie: 'REC-2026-0000026',
      este_test: false,
      status: 'predat',
      sursa_receptie: 'atelier',
      semnare_status: 'nesemnat',
      pdf_path: null,
      data_primire_afisata: '26.07.2026',
      nume: 'Client Test',
      telefon: '0700000000',
      tip_echipament: 'TV',
      marca: 'Samsung',
      model: 'UE50',
      serie: 'TEST'
    }],
    q: 'Samsung',
    selectedStatus: 'predat',
    page: 2,
    totalPages: 3,
    totalRows: 46,
    returnTo:
      '/receptie?status=predat&q=Samsung&page=2'
  });

  assert.match(html, /aria-current="page"/);
  assert.match(html, /name="status"\s+value="predat"/);
  assert.match(html, /status=predat&amp;q=Samsung&amp;page=3/);
  assert.match(
    html,
    /returnTo=%2Freceptie%3Fstatus%3Dpredat%26q%3DSamsung%26page%3D2/
  );
  assert.match(html, /Pagina <strong>2<\/strong> din/);
});

test('lista randată afișează empty state contextual', async () => {
  const html = await render({
    selectedStatus: 'anulat',
    totalRows: 0,
    returnTo: '/receptie?status=anulat'
  });

  assert.match(html, /Nu există fișe în categoria „Anulate”/);
  assert.match(html, /Vezi toate fișele/);
  assert.match(html, /Revino la Active/);
});
