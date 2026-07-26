import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildLibraryUrl,
  detectLibraryFileType,
  isLibraryAdmin,
  libraryCaseValues,
  libraryExtensionMatches,
  libraryFiltersActive,
  normalizeLibraryFilters,
  normalizeLibraryKey,
  safeLibraryFileName,
  safeLibraryReturnTo,
  validateLibraryCase
} from '../src/defect-library-domain.js';
import {
  libraryContentDisposition,
  resolveLibraryStoredPath
} from '../src/defect-library-files.js';
import {
  defectLibraryInternals
} from '../src/defect-library-routes.js';

function validCase(overrides = {}) {
  return libraryCaseValues({
    marca_id: '1',
    familie_id: '2',
    model: ' QE50Q60AAU ',
    titlu: 'Restart repetat',
    simptom: 'Pornește și se restartează',
    dificultate: 'dificil',
    rezultat: 'reparat',
    status_verificare: 'confirmat_service',
    ...overrides
  });
}

test('normalizează literele și spațiile pentru deduplicare', () => {
  assert.equal(
    normalizeLibraryKey('  QE50Q60AAU   '),
    normalizeLibraryKey('qe50q60aau')
  );
  assert.equal(
    normalizeLibraryKey('Smart   Tech'),
    'smart tech'
  );
});

test('validează câmpurile minime ale cazului', () => {
  assert.deepEqual(validateLibraryCase(validCase()), []);
  assert.match(
    validateLibraryCase(validCase({
      simptom: '',
      defect_reclamat: '',
      manifestare: '',
      diagnostic: ''
    })).join(' '),
    /cel puțin simptomul/
  );
});

test('nu acceptă familie existentă și familie nouă simultan', () => {
  assert.match(
    validateLibraryCase(validCase({
      familie_noua: 'QLED'
    })).join(' '),
    /nu ambele/
  );
});

test('valorile filtrabile sunt validate prin allowlist', () => {
  const filters = normalizeLibraryFilters({
    dificultate: 'root',
    rezultat: 'reparat',
    status_verificare: 'confirmat_service',
    sort: 'DROP TABLE',
    per_page: '100',
    page: '2'
  });
  assert.equal(filters.dificultate, '');
  assert.equal(filters.rezultat, 'reparat');
  assert.equal(filters.status_verificare, 'confirmat_service');
  assert.equal(filters.sort, 'updated_desc');
  assert.equal(filters.per_page, 100);
  assert.equal(filters.page, 2);
});

test('URL-ul păstrează filtrele și nu păstrează valorile implicite', () => {
  const filters = normalizeLibraryFilters({
    q: 'BN41',
    marca_id: '1',
    page: '3',
    sort: 'model_asc'
  });
  assert.equal(
    buildLibraryUrl('/biblioteca-defecte', filters),
    '/biblioteca-defecte?q=BN41&marca_id=1&sort=model_asc&page=3'
  );
  assert.equal(libraryFiltersActive(filters), true);
});

test('returnTo acceptă numai rute interne ale bibliotecii', () => {
  assert.equal(
    safeLibraryReturnTo(
      '/biblioteca-defecte?q=restart#rezultate'
    ),
    '/biblioteca-defecte?q=restart#rezultate'
  );
  assert.equal(
    safeLibraryReturnTo('//evil.example'),
    '/biblioteca-defecte'
  );
  assert.equal(
    safeLibraryReturnTo('/receptie'),
    '/biblioteca-defecte'
  );
});

test('recunoaște semnăturile reale JPEG, PNG, WebP și PDF', () => {
  const jpeg = Buffer.from('ffd8ffe00000000000000000', 'hex');
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const webp = Buffer.from('524946460000000057454250', 'hex');
  const pdf = Buffer.from('%PDF-1.7 test data');
  assert.equal(detectLibraryFileType(jpeg)?.mime, 'image/jpeg');
  assert.equal(detectLibraryFileType(png)?.mime, 'image/png');
  assert.equal(detectLibraryFileType(webp)?.mime, 'image/webp');
  assert.equal(detectLibraryFileType(pdf)?.mime, 'application/pdf');
  assert.equal(
    detectLibraryFileType(Buffer.from('<svg></svg>')),
    null
  );
});

test('respinge extensia falsă chiar dacă semnătura este validă', () => {
  const pdf = detectLibraryFileType(
    Buffer.from('%PDF-1.7 test data')
  );
  assert.equal(libraryExtensionMatches('schema.pdf', pdf), true);
  assert.equal(libraryExtensionMatches('schema.jpg', pdf), false);
});

test('numele fișierului nu permite path traversal', () => {
  assert.equal(safeLibraryFileName('../secret.pdf'), null);
  assert.equal(safeLibraryFileName('..\\secret.pdf'), null);
  assert.equal(
    safeLibraryFileName('măsurători panou.pdf'),
    'măsurători panou.pdf'
  );
});

test('căutarea folosește parametri și escapează wildcardurile', () => {
  const filters = normalizeLibraryFilters({
    q: "Samsung BN41% '_"
  });
  const result = defectLibraryInternals.caseSearchSql(filters);
  assert.doesNotMatch(result.where, /Samsung|BN41/);
  assert.ok(result.params.includes('%BN41\\%%'));
  assert.ok(result.params.includes("%'\\_%"));
});

test('ordonarea SQL nu poate veni din query string', () => {
  const filters = normalizeLibraryFilters({
    sort: 'c.updated_at; DROP TABLE crm.clienti'
  });
  assert.equal(filters.sort, 'updated_desc');
  assert.match(
    defectLibraryInternals.sortSql[filters.sort],
    /^c\.updated_at DESC/
  );
});

test('permisiunea administrativă este bazată pe rolul backend', () => {
  assert.equal(isLibraryAdmin({ role: 'admin' }), true);
  assert.equal(isLibraryAdmin({ role: 'operator' }), false);
  assert.equal(isLibraryAdmin(null), false);
});

test('calea internă acceptă numai structura controlată', () => {
  assert.match(
    resolveLibraryStoredPath(
      '2026/caz-42/123e4567-e89b-12d3-a456-426614174000.pdf'
    ),
    /biblioteca-defecte/
  );
  assert.equal(
    resolveLibraryStoredPath('../../etc/passwd'),
    null
  );
});

test('Content-Disposition nu permite injectarea de headere', () => {
  const header = libraryContentDisposition(
    'attachment',
    'fișă"\r\nX-Evil: 1.pdf'
  );
  assert.doesNotMatch(header, /\r|\n/);
  assert.match(header, /^attachment;/);
});

test('migrarea include seedul și rollbackul cere confirmare explicită', () => {
  const migration = fs.readFileSync(
    'migrations/2026-07-26-biblioteca-defecte-v1.9.0.sql',
    'utf8'
  );
  const rollback = fs.readFileSync(
    'migrations/rollback-2026-07-26-biblioteca-defecte-v1.9.0.sql',
    'utf8'
  );
  for (const table of [
    'biblioteca_marci',
    'biblioteca_familii',
    'biblioteca_modele',
    'biblioteca_cazuri',
    'biblioteca_atasamente',
    'biblioteca_audit'
  ]) {
    assert.match(migration, new RegExp(`crm\\.${table}`));
  }
  assert.match(migration, /ON CONFLICT \(nume_normalizat\) DO NOTHING/);
  assert.match(rollback, /MOZY_CONFIRM_DROP_BIBLIOTECA/);
});
