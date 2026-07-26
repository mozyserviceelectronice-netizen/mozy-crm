import path from 'node:path';

export const libraryDifficulties = Object.freeze({
  usor: 'Ușor',
  mediu: 'Mediu',
  dificil: 'Dificil',
  foarte_dificil: 'Foarte dificil'
});

export const libraryResults = Object.freeze({
  reparat: 'Reparat',
  nereparabil: 'Nereparabil',
  solutie_temporara: 'Soluție temporară',
  in_cercetare: 'În cercetare'
});

export const libraryVerificationStatuses = Object.freeze({
  caz_intern: 'Caz intern',
  confirmat_service: 'Soluție confirmată în service',
  neverificat: 'Neverificat',
  arhivat: 'Arhivat'
});

export const librarySorts = Object.freeze({
  updated_desc: 'Actualizate recent',
  created_desc: 'Cele mai recente',
  created_asc: 'Cele mai vechi',
  brand_asc: 'Marcă',
  model_asc: 'Model',
  difficulty_asc: 'Dificultate'
});

export const libraryPageSizes = Object.freeze([25, 50, 100]);

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function cleanLibraryText(value, maxLength = 4000) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

export function normalizeLibraryKey(value, maxLength = 150) {
  return cleanLibraryText(value, maxLength)
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ro-RO');
}

export function librarySlug(value) {
  const slug = cleanLibraryText(value, 150)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');

  return slug || 'element';
}

export function positiveLibraryId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

export function isLibraryAdmin(user) {
  return String(user?.role || '') === 'admin';
}

function allowed(value, choices, fallback = '') {
  return Object.hasOwn(choices, value)
    ? value
    : fallback;
}

function validDate(value) {
  if (!datePattern.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : '';
}

export function libraryCaseValues(body = {}) {
  return {
    marca_id: positiveLibraryId(body.marca_id),
    familie_id: positiveLibraryId(body.familie_id),
    familie_noua: cleanLibraryText(body.familie_noua, 100),
    model: cleanLibraryText(body.model, 150)
      .replace(/\s+/g, ' '),
    model_descriere: cleanLibraryText(body.model_descriere, 2000),
    titlu: cleanLibraryText(body.titlu, 180),
    simptom: cleanLibraryText(body.simptom),
    defect_reclamat: cleanLibraryText(body.defect_reclamat),
    manifestare: cleanLibraryText(body.manifestare),
    diagnostic: cleanLibraryText(body.diagnostic),
    cauza_identificata: cleanLibraryText(body.cauza_identificata),
    solutie: cleanLibraryText(body.solutie),
    masuratori: cleanLibraryText(body.masuratori),
    componente_schimbate: cleanLibraryText(
      body.componente_schimbate
    ),
    valori_componente: cleanLibraryText(body.valori_componente),
    firmware_folosit: cleanLibraryText(body.firmware_folosit, 1000),
    cod_placa_baza: cleanLibraryText(body.cod_placa_baza, 180),
    cod_sursa: cleanLibraryText(body.cod_sursa, 180),
    cod_tcon: cleanLibraryText(body.cod_tcon, 180),
    cod_panou: cleanLibraryText(body.cod_panou, 180),
    cod_sasiu: cleanLibraryText(body.cod_sasiu, 180),
    alte_coduri: cleanLibraryText(body.alte_coduri, 2000),
    dificultate: allowed(
      cleanLibraryText(body.dificultate, 30),
      libraryDifficulties,
      'mediu'
    ),
    rezultat: allowed(
      cleanLibraryText(body.rezultat, 30),
      libraryResults,
      'in_cercetare'
    ),
    status_verificare: allowed(
      cleanLibraryText(body.status_verificare, 40),
      libraryVerificationStatuses,
      'caz_intern'
    ),
    observatii: cleanLibraryText(body.observatii)
  };
}

export function validateLibraryCase(values) {
  const errors = [];

  if (!values.marca_id) {
    errors.push('Marca este obligatorie.');
  }
  if (!values.model) {
    errors.push('Modelul este obligatoriu.');
  }
  if (!values.titlu) {
    errors.push('Titlul cazului este obligatoriu.');
  }
  if (
    !values.simptom &&
    !values.defect_reclamat &&
    !values.manifestare &&
    !values.diagnostic
  ) {
    errors.push(
      'Completează cel puțin simptomul, defectul reclamat, manifestarea sau diagnosticul.'
    );
  }
  if (
    values.familie_id &&
    values.familie_noua
  ) {
    errors.push(
      'Alege o familie existentă sau scrie una nouă, nu ambele.'
    );
  }

  return errors;
}

export function normalizeLibraryFilters(query = {}) {
  const page = positiveLibraryId(query.page) || 1;
  const requestedSize = Number(query.per_page);
  const perPage = libraryPageSizes.includes(requestedSize)
    ? requestedSize
    : 25;
  const attachment = cleanLibraryText(query.atasament, 20);
  const withAttachments = cleanLibraryText(
    query.cu_atasamente,
    10
  );

  return {
    q: cleanLibraryText(query.q, 200),
    marca_id: positiveLibraryId(query.marca_id),
    familie_id: positiveLibraryId(query.familie_id),
    model_id: positiveLibraryId(query.model_id),
    dificultate: allowed(
      cleanLibraryText(query.dificultate, 30),
      libraryDifficulties
    ),
    rezultat: allowed(
      cleanLibraryText(query.rezultat, 30),
      libraryResults
    ),
    status_verificare: allowed(
      cleanLibraryText(query.status_verificare, 40),
      libraryVerificationStatuses
    ),
    cu_atasamente: ['da', 'nu'].includes(withAttachments)
      ? withAttachments
      : '',
    atasament: ['imagine', 'pdf'].includes(attachment)
      ? attachment
      : '',
    creat_de: positiveLibraryId(query.creat_de),
    data_de_la: validDate(cleanLibraryText(query.data_de_la, 10)),
    data_pana_la: validDate(cleanLibraryText(query.data_pana_la, 10)),
    sort: allowed(
      cleanLibraryText(query.sort, 30),
      librarySorts,
      'updated_desc'
    ),
    page,
    per_page: perPage
  };
}

export function libraryFiltersActive(filters) {
  return Boolean(
    filters.q ||
    filters.marca_id ||
    filters.familie_id ||
    filters.model_id ||
    filters.dificultate ||
    filters.rezultat ||
    filters.status_verificare ||
    filters.cu_atasamente ||
    filters.atasament ||
    filters.creat_de ||
    filters.data_de_la ||
    filters.data_pana_la
  );
}

export function buildLibraryUrl(
  pathname,
  filters,
  overrides = {}
) {
  const values = {
    ...filters,
    ...overrides
  };
  const params = new URLSearchParams();
  const defaults = {
    sort: 'updated_desc',
    page: 1,
    per_page: 25
  };

  for (const key of [
    'q',
    'marca_id',
    'familie_id',
    'model_id',
    'dificultate',
    'rezultat',
    'status_verificare',
    'cu_atasamente',
    'atasament',
    'creat_de',
    'data_de_la',
    'data_pana_la',
    'sort',
    'page',
    'per_page'
  ]) {
    const value = values[key];
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      value === defaults[key]
    ) {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function safeLibraryReturnTo(
  value,
  fallback = '/biblioteca-defecte'
) {
  const candidate = cleanLibraryText(value, 2000);
  if (
    !candidate.startsWith('/biblioteca-defecte') ||
    candidate.startsWith('//') ||
    candidate.includes('\\')
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, 'https://mozy-library.local');
    return parsed.origin === 'https://mozy-library.local'
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export function detectLibraryFileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') {
    return {
      kind: 'imagine',
      mime: 'image/jpeg',
      extension: '.jpg',
      extensions: new Set(['.jpg', '.jpeg']),
      maxConfig: 'image'
    };
  }

  if (
    buffer.subarray(0, 8).toString('hex') ===
      '89504e470d0a1a0a'
  ) {
    return {
      kind: 'imagine',
      mime: 'image/png',
      extension: '.png',
      extensions: new Set(['.png']),
      maxConfig: 'image'
    };
  }

  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return {
      kind: 'imagine',
      mime: 'image/webp',
      extension: '.webp',
      extensions: new Set(['.webp']),
      maxConfig: 'image'
    };
  }

  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return {
      kind: 'pdf',
      mime: 'application/pdf',
      extension: '.pdf',
      extensions: new Set(['.pdf']),
      maxConfig: 'pdf'
    };
  }

  return null;
}

export function safeLibraryFileName(value) {
  let decoded = 'atasament';
  try {
    decoded = decodeURIComponent(String(value || 'atasament'));
  } catch {
    decoded = 'atasament';
  }

  if (decoded.includes('/') || decoded.includes('\\')) return null;
  const basename = path.basename(decoded);
  if (basename !== decoded) return null;

  const cleaned = basename
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 240);

  return cleaned || null;
}

export function libraryExtensionMatches(fileName, detected) {
  return detected?.extensions?.has(
    path.extname(String(fileName || '')).toLowerCase()
  ) || false;
}

export function formatLibraryBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
