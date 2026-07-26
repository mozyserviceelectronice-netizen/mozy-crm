import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReceptionListUrl,
  escapeLikePattern,
  normalizeReceptionFilter,
  normalizeReceptionPage,
  normalizeReceptionSearch,
  receptionActiveStatuses,
  receptionFilterTabs,
  receptionSearchWhereSql,
  receptionStatuses,
  receptionStatusWhereSql,
  safeReceptionReturnTo
} from '../src/reception-filters.js';

test('statusurile și filtrul Active folosesc valorile tehnice reale', () => {
  assert.deepEqual(receptionStatuses, [
    'primit',
    'in_diagnosticare',
    'asteapta_acord',
    'asteapta_piesa',
    'in_reparatie',
    'finalizat',
    'predat',
    'anulat'
  ]);
  assert.deepEqual(receptionActiveStatuses, receptionStatuses.slice(0, 5));
  assert.equal(receptionFilterTabs.length, 10);
});

test('statusul invalid revine sigur la Active', () => {
  assert.equal(normalizeReceptionFilter('predat'), 'predat');
  assert.equal(normalizeReceptionFilter('active'), 'active');
  assert.equal(normalizeReceptionFilter('toate'), 'toate');
  assert.equal(
    normalizeReceptionFilter("predat' OR 1=1 --"),
    'active'
  );
});

test('SQL-ul filtrează prin parametri, inclusiv Active și căutarea', () => {
  assert.match(receptionSearchWhereSql, /\$1 = ''/);
  assert.match(receptionSearchWhereSql, /ILIKE \$2/);
  assert.match(receptionSearchWhereSql, /defect_reclamat/);
  assert.match(receptionStatusWhereSql, /\$3 = 'active'/);
  assert.match(receptionStatusWhereSql, /ANY\(\$4::TEXT\[\]\)/);
  assert.match(receptionStatusWhereSql, /r\.status = \$3/);
  assert.doesNotMatch(receptionStatusWhereSql, /req\.query/);
});

test('căutarea este limitată și wildcard-urile ILIKE sunt escapate', () => {
  assert.equal(normalizeReceptionSearch('  Samsung  '), 'Samsung');
  assert.equal(normalizeReceptionSearch('x'.repeat(101)).length, 100);
  assert.equal(
    escapeLikePattern(String.raw`50%_TV\serie`),
    String.raw`50\%\_TV\\serie`
  );
});

test('paginarea respinge valori invalide și respectă limita', () => {
  assert.equal(normalizeReceptionPage('2', 5), 2);
  assert.equal(normalizeReceptionPage('0', 5), 1);
  assert.equal(normalizeReceptionPage('-2', 5), 1);
  assert.equal(normalizeReceptionPage('2abc', 5), 1);
  assert.equal(normalizeReceptionPage('99', 5), 5);
});

test('URL-urile păstrează statusul, căutarea și pagina', () => {
  assert.equal(
    buildReceptionListUrl({
      status: 'predat',
      q: 'Samsung UE50',
      page: 2
    }),
    '/receptie?status=predat&q=Samsung+UE50&page=2'
  );
  assert.equal(
    buildReceptionListUrl({
      status: 'invalid',
      page: -3
    }),
    '/receptie?status=active'
  );
});

test('returnTo acceptă numai lista internă de recepții', () => {
  assert.equal(
    safeReceptionReturnTo(
      '/receptie?status=predat&q=Samsung&page=2'
    ),
    '/receptie?status=predat&q=Samsung&page=2'
  );
  assert.equal(
    safeReceptionReturnTo('https://example.com/receptie'),
    '/receptie'
  );
  assert.equal(
    safeReceptionReturnTo('//example.com/receptie'),
    '/receptie'
  );
  assert.equal(
    safeReceptionReturnTo('/receptie/26?status=predat'),
    '/receptie'
  );
});
