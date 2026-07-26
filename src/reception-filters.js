export const receptionStatuses = Object.freeze([
  'primit',
  'in_diagnosticare',
  'asteapta_acord',
  'asteapta_piesa',
  'in_reparatie',
  'finalizat',
  'predat',
  'anulat'
]);

export const receptionActiveStatuses = Object.freeze([
  'primit',
  'in_diagnosticare',
  'asteapta_acord',
  'asteapta_piesa',
  'in_reparatie'
]);

export const receptionStatusLabels = Object.freeze({
  primit: 'Primit',
  in_diagnosticare: 'În diagnosticare',
  asteapta_acord: 'Așteaptă acordul clientului',
  asteapta_piesa: 'Așteaptă piesa',
  in_reparatie: 'În reparație',
  finalizat: 'Finalizat',
  predat: 'Predat',
  anulat: 'Anulat'
});

export const receptionFilterTabs = Object.freeze([
  { value: 'active', label: 'Active' },
  { value: 'toate', label: 'Toate' },
  { value: 'primit', label: 'Primite' },
  { value: 'in_diagnosticare', label: 'În diagnosticare' },
  { value: 'asteapta_acord', label: 'Așteaptă acord' },
  { value: 'asteapta_piesa', label: 'Așteaptă piesă' },
  { value: 'in_reparatie', label: 'În reparație' },
  { value: 'finalizat', label: 'Finalizate' },
  { value: 'predat', label: 'Predate' },
  { value: 'anulat', label: 'Anulate' }
]);

export const receptionPageSize = 25;

export const receptionSearchWhereSql = `
  (
    $1 = ''
    OR CAST(r.id AS TEXT) ILIKE $2 ESCAPE '\\'
    OR COALESCE(r.numar_receptie, '') ILIKE $2 ESCAPE '\\'
    OR COALESCE(c.nume, '') ILIKE $2 ESCAPE '\\'
    OR COALESCE(c.telefon, '') ILIKE $2 ESCAPE '\\'
    OR COALESCE(e.tip_echipament, '') ILIKE $2 ESCAPE '\\'
    OR COALESCE(e.descriere_echipament, '') ILIKE $2 ESCAPE '\\'
    OR COALESCE(e.marca, '') ILIKE $2 ESCAPE '\\'
    OR COALESCE(e.model, '') ILIKE $2 ESCAPE '\\'
    OR COALESCE(e.serie, '') ILIKE $2 ESCAPE '\\'
    OR COALESCE(r.defect_reclamat, '') ILIKE $2 ESCAPE '\\'
    OR (
      REGEXP_REPLACE($1, '[^0-9]', '', 'g') <> ''
      AND REGEXP_REPLACE(
        COALESCE(c.telefon, ''),
        '[^0-9]',
        '',
        'g'
      ) LIKE '%' ||
        REGEXP_REPLACE($1, '[^0-9]', '', 'g') ||
        '%'
    )
  )
`;

export const receptionStatusWhereSql = `
  (
    $3 = 'toate'
    OR (
      $3 = 'active'
      AND r.status = ANY($4::TEXT[])
    )
    OR (
      $3 NOT IN ('toate', 'active')
      AND r.status = $3
    )
  )
`;

const allowedReceptionFilters = new Set(
  receptionFilterTabs.map(tab => tab.value)
);

export function normalizeReceptionFilter(value) {
  const candidate = String(value || 'active').trim();
  return allowedReceptionFilters.has(candidate)
    ? candidate
    : 'active';
}

export function normalizeReceptionSearch(value) {
  return String(value || '').trim().slice(0, 100);
}

export function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

export function normalizeReceptionPage(value, totalPages = Infinity) {
  const candidate = Number(value);
  const page = Number.isInteger(candidate) && candidate > 0
    ? candidate
    : 1;

  if (!Number.isFinite(totalPages)) return page;

  return Math.min(page, Math.max(1, Math.floor(totalPages)));
}

export function buildReceptionListUrl({
  status = 'active',
  q = '',
  page = 1
} = {}) {
  const params = new URLSearchParams();
  params.set('status', normalizeReceptionFilter(status));

  const search = normalizeReceptionSearch(q);
  if (search) params.set('q', search);

  const normalizedPage = normalizeReceptionPage(page);
  if (normalizedPage > 1) {
    params.set('page', String(normalizedPage));
  }

  return `/receptie?${params.toString()}`;
}

export function safeReceptionReturnTo(value) {
  const candidate = String(value || '').trim().slice(0, 2000);
  if (!candidate.startsWith('/')) return '/receptie';

  try {
    const parsed = new URL(candidate, 'https://crm.local');
    if (
      parsed.origin !== 'https://crm.local' ||
      parsed.pathname !== '/receptie'
    ) {
      return '/receptie';
    }

    return buildReceptionListUrl({
      status: parsed.searchParams.get('status') || 'active',
      q: parsed.searchParams.get('q') || '',
      page: parsed.searchParams.get('page') || 1
    });
  } catch {
    return '/receptie';
  }
}
