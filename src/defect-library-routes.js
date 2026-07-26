import fs from 'node:fs/promises';
import path from 'node:path';
import { pool, query } from './db.js';
import {
  buildLibraryUrl,
  cleanLibraryText,
  formatLibraryBytes,
  isLibraryAdmin,
  libraryCaseValues,
  libraryDifficulties,
  libraryFiltersActive,
  libraryPageSizes,
  libraryResults,
  librarySlug,
  librarySorts,
  libraryVerificationStatuses,
  normalizeLibraryFilters,
  normalizeLibraryKey,
  positiveLibraryId,
  validateLibraryCase
} from './defect-library-domain.js';
import {
  cleanupLibraryUpload,
  finalizeLibraryUpload,
  libraryContentDisposition,
  receiveLibraryUpload,
  resolveLibraryStoredPath
} from './defect-library-files.js';

const sortSql = Object.freeze({
  updated_desc: 'c.updated_at DESC, c.id DESC',
  created_desc: 'c.created_at DESC, c.id DESC',
  created_asc: 'c.created_at ASC, c.id ASC',
  brand_asc:
    'LOWER(b.nume) ASC, LOWER(m.model) ASC, c.updated_at DESC',
  model_asc:
    'LOWER(m.model) ASC, LOWER(b.nume) ASC, c.updated_at DESC',
  difficulty_asc: `
    CASE c.dificultate
      WHEN 'usor' THEN 1
      WHEN 'mediu' THEN 2
      WHEN 'dificil' THEN 3
      WHEN 'foarte_dificil' THEN 4
      ELSE 5
    END,
    c.updated_at DESC,
    c.id DESC
  `
});

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function jsonRequested(req) {
  return String(req.get('Accept') || '').includes('application/json');
}

function renderLibraryError(res, status, message) {
  return res.status(status).render('error', {
    message,
    active: 'biblioteca-defecte'
  });
}

function handleExpectedError(req, res, next, error) {
  if (error?.status) {
    if (jsonRequested(req)) {
      return res.status(error.status).json({ error: error.message });
    }
    return renderLibraryError(res, error.status, error.message);
  }
  return next(error);
}

function libraryAdminOnly(handler) {
  return async (req, res, next) => {
    if (!isLibraryAdmin(req.user)) {
      if (jsonRequested(req)) {
        return res.status(403).json({
          error: 'Această acțiune este disponibilă numai administratorilor.'
        });
      }
      return renderLibraryError(
        res,
        403,
        'Această acțiune este disponibilă numai administratorilor.'
      );
    }
    return handler(req, res, next);
  };
}

async function audit(
  database,
  {
    entity,
    entityId,
    action,
    userId,
    details = {}
  }
) {
  const run = typeof database === 'function'
    ? database
    : database.query.bind(database);
  await run(`
    INSERT INTO crm.biblioteca_audit (
      entitate,
      entitate_id,
      actiune,
      user_id,
      detalii
    )
    VALUES ($1, $2, $3, $4, $5::jsonb)
  `, [
    entity,
    entityId,
    action,
    userId,
    JSON.stringify(details)
  ]);
}

async function uniqueSlug(
  database,
  {
    table,
    base,
    brandId = null,
    excludedId = null
  }
) {
  if (!['biblioteca_marci', 'biblioteca_familii'].includes(table)) {
    throw new Error('Tabel nepermis pentru generarea slugului.');
  }
  const root = librarySlug(base);
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index ? `-${index + 1}` : '';
    const candidate = `${root.slice(0, 100 - suffix.length)}${suffix}`;
    const params = [candidate];
    let where = 'slug = $1';
    if (brandId) {
      params.push(brandId);
      where += ` AND marca_id = $${params.length}`;
    }
    if (excludedId) {
      params.push(excludedId);
      where += ` AND id <> $${params.length}`;
    }
    const existing = await database.query(`
      SELECT id
      FROM crm.${table}
      WHERE ${where}
      LIMIT 1
    `, params);
    if (!existing.rowCount) return candidate;
  }
  throw new Error('Nu s-a putut genera un identificator unic.');
}

async function structureLists() {
  const [brands, families, models, users] = await Promise.all([
    query(`
      SELECT id, nume, slug, activa
      FROM crm.biblioteca_marci
      ORDER BY activa DESC, ordine, LOWER(nume), id
    `),
    query(`
      SELECT id, marca_id, nume, slug, activa
      FROM crm.biblioteca_familii
      ORDER BY activa DESC, ordine, LOWER(nume), id
    `),
    query(`
      SELECT id, marca_id, familie_id, model
      FROM crm.biblioteca_modele
      WHERE arhivat_la IS NULL
      ORDER BY LOWER(model), id
    `),
    query(`
      SELECT id, username
      FROM crm.utilizatori
      WHERE activ = TRUE
      ORDER BY LOWER(username), id
    `)
  ]);
  return {
    brands: brands.rows,
    families: families.rows,
    models: models.rows,
    users: users.rows
  };
}

function caseSearchSql(filters) {
  const params = [];
  const clauses = ['c.sters_la IS NULL'];

  if (filters.status_verificare) {
    params.push(filters.status_verificare);
    clauses.push(`c.status_verificare = $${params.length}`);
  } else {
    clauses.push('c.arhivat_la IS NULL');
  }

  for (const [column, value] of [
    ['b.id', filters.marca_id],
    ['f.id', filters.familie_id],
    ['m.id', filters.model_id],
    ['c.dificultate', filters.dificultate],
    ['c.rezultat', filters.rezultat],
    ['c.creat_de_user_id', filters.creat_de]
  ]) {
    if (!value) continue;
    params.push(value);
    clauses.push(`${column} = $${params.length}`);
  }

  if (filters.data_de_la) {
    params.push(filters.data_de_la);
    clauses.push(`c.created_at >= $${params.length}::date`);
  }
  if (filters.data_pana_la) {
    params.push(filters.data_pana_la);
    clauses.push(
      `c.created_at < ($${params.length}::date + INTERVAL '1 day')`
    );
  }

  if (filters.cu_atasamente) {
    const exists = `
      EXISTS (
        SELECT 1
        FROM crm.biblioteca_atasamente a_exists
        WHERE a_exists.caz_id = c.id
          AND a_exists.sters_la IS NULL
      )
    `;
    clauses.push(
      filters.cu_atasamente === 'da'
        ? exists
        : `NOT ${exists}`
    );
  }

  if (filters.atasament) {
    params.push(filters.atasament);
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM crm.biblioteca_atasamente a_type
        WHERE a_type.caz_id = c.id
          AND a_type.sters_la IS NULL
          AND a_type.tip = $${params.length}
      )
    `);
  }

  const terms = filters.q
    .split(/\s+/)
    .map(term => term.trim())
    .filter(Boolean)
    .slice(0, 8);

  for (const term of terms) {
    params.push(`%${escapeLike(term)}%`);
    const position = params.length;
    clauses.push(`
      (
        CONCAT_WS(
          ' ',
          b.nume,
          f.nume,
          m.model,
          m.descriere,
          c.titlu,
          c.simptom,
          c.defect_reclamat,
          c.manifestare,
          c.diagnostic,
          c.cauza_identificata,
          c.solutie,
          c.masuratori,
          c.componente_schimbate,
          c.valori_componente,
          c.firmware_folosit,
          c.cod_placa_baza,
          c.cod_sursa,
          c.cod_tcon,
          c.cod_panou,
          c.cod_sasiu,
          c.alte_coduri,
          c.observatii
        ) ILIKE $${position} ESCAPE '\\'
        OR EXISTS (
          SELECT 1
          FROM crm.biblioteca_atasamente a_search
          WHERE a_search.caz_id = c.id
            AND a_search.sters_la IS NULL
            AND a_search.nume_original
              ILIKE $${position} ESCAPE '\\'
        )
      )
    `);
  }

  return {
    where: clauses.join('\nAND '),
    params
  };
}

async function searchCases(filters) {
  const search = caseSearchSql(filters);
  const count = await query(`
    SELECT COUNT(*)::integer AS total
    FROM crm.biblioteca_cazuri c
    JOIN crm.biblioteca_modele m
      ON m.id = c.model_id
    JOIN crm.biblioteca_marci b
      ON b.id = m.marca_id
    LEFT JOIN crm.biblioteca_familii f
      ON f.id = m.familie_id
    WHERE ${search.where}
  `, search.params);

  const total = Number(count.rows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / filters.per_page));
  const page = Math.min(filters.page, totalPages);
  const params = [
    ...search.params,
    filters.per_page,
    (page - 1) * filters.per_page
  ];
  const limitPosition = search.params.length + 1;
  const offsetPosition = search.params.length + 2;
  const rows = await query(`
    SELECT
      c.id,
      c.titlu,
      c.simptom,
      c.dificultate,
      c.rezultat,
      c.status_verificare,
      c.created_at,
      c.updated_at,
      b.id AS marca_id,
      b.nume AS marca,
      f.id AS familie_id,
      f.nume AS familie,
      m.id AS model_id,
      m.model,
      u.username AS autor,
      (
        SELECT COUNT(*)::integer
        FROM crm.biblioteca_atasamente a
        WHERE a.caz_id = c.id
          AND a.sters_la IS NULL
      ) AS numar_atasamente
    FROM crm.biblioteca_cazuri c
    JOIN crm.biblioteca_modele m
      ON m.id = c.model_id
    JOIN crm.biblioteca_marci b
      ON b.id = m.marca_id
    LEFT JOIN crm.biblioteca_familii f
      ON f.id = m.familie_id
    JOIN crm.utilizatori u
      ON u.id = c.creat_de_user_id
    WHERE ${search.where}
    ORDER BY ${sortSql[filters.sort]}
    LIMIT $${limitPosition}
    OFFSET $${offsetPosition}
  `, params);

  return {
    cases: rows.rows,
    total,
    totalPages,
    page
  };
}

async function brandCards() {
  const result = await query(`
    SELECT
      b.id,
      b.nume,
      b.slug,
      COUNT(DISTINCT m.id)
        FILTER (WHERE m.arhivat_la IS NULL)::integer
        AS numar_modele,
      COUNT(DISTINCT c.id)
        FILTER (
          WHERE c.arhivat_la IS NULL
            AND c.sters_la IS NULL
        )::integer AS numar_cazuri,
      MAX(c.updated_at)
        FILTER (
          WHERE c.arhivat_la IS NULL
            AND c.sters_la IS NULL
        ) AS ultima_actualizare
    FROM crm.biblioteca_marci b
    LEFT JOIN crm.biblioteca_modele m
      ON m.marca_id = b.id
    LEFT JOIN crm.biblioteca_cazuri c
      ON c.model_id = m.id
    WHERE b.activa = TRUE
    GROUP BY b.id
    ORDER BY
      b.ordine,
      LOWER(b.nume),
      b.id
  `);
  return result.rows;
}

export async function defectLibraryDashboardData() {
  const [metrics, recent] = await Promise.all([
    query(`
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM crm.biblioteca_cazuri
          WHERE arhivat_la IS NULL
            AND sters_la IS NULL
        ) AS total_cazuri,
        (
          SELECT COUNT(*)::integer
          FROM crm.biblioteca_modele
          WHERE arhivat_la IS NULL
        ) AS total_modele,
        (
          SELECT COUNT(*)::integer
          FROM crm.biblioteca_marci
          WHERE activa = TRUE
        ) AS total_marci
    `),
    query(`
      SELECT
        c.id,
        c.titlu,
        c.updated_at,
        b.nume AS marca,
        m.model
      FROM crm.biblioteca_cazuri c
      JOIN crm.biblioteca_modele m
        ON m.id = c.model_id
      JOIN crm.biblioteca_marci b
        ON b.id = m.marca_id
      WHERE c.arhivat_la IS NULL
        AND c.sters_la IS NULL
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT 4
    `)
  ]);
  return {
    metrics: metrics.rows[0],
    recent: recent.rows
  };
}

async function libraryCase(caseId) {
  const result = await query(`
    SELECT
      c.*,
      b.id AS marca_id,
      b.nume AS marca,
      f.id AS familie_id,
      f.nume AS familie,
      m.id AS model_id,
      m.model,
      m.descriere AS model_descriere,
      creator.username AS autor,
      editor.username AS actualizat_de
    FROM crm.biblioteca_cazuri c
    JOIN crm.biblioteca_modele m
      ON m.id = c.model_id
    JOIN crm.biblioteca_marci b
      ON b.id = m.marca_id
    LEFT JOIN crm.biblioteca_familii f
      ON f.id = m.familie_id
    JOIN crm.utilizatori creator
      ON creator.id = c.creat_de_user_id
    JOIN crm.utilizatori editor
      ON editor.id = c.actualizat_de_user_id
    WHERE c.id = $1
      AND c.sters_la IS NULL
  `, [caseId]);
  return result.rows[0] || null;
}

async function libraryAttachments(caseId) {
  const result = await query(`
    SELECT
      a.*,
      u.username AS incarcat_de
    FROM crm.biblioteca_atasamente a
    JOIN crm.utilizatori u
      ON u.id = a.incarcat_de_user_id
    WHERE a.caz_id = $1
      AND a.sters_la IS NULL
    ORDER BY a.created_at DESC, a.id DESC
  `, [caseId]);
  return result.rows;
}

async function resolveFamily(
  database,
  values,
  userId
) {
  if (values.familie_id) {
    const selected = await database.query(`
      SELECT id, nume, activa
      FROM crm.biblioteca_familii
      WHERE id = $1
        AND marca_id = $2
      FOR UPDATE
    `, [values.familie_id, values.marca_id]);
    if (!selected.rowCount || !selected.rows[0].activa) {
      const error = new Error(
        'Familia selectată nu aparține mărcii sau este dezactivată.'
      );
      error.status = 400;
      throw error;
    }
    return selected.rows[0].id;
  }

  if (!values.familie_noua) return null;
  const normalized = normalizeLibraryKey(values.familie_noua, 100);
  const existing = await database.query(`
    SELECT id, activa
    FROM crm.biblioteca_familii
    WHERE marca_id = $1
      AND nume_normalizat = $2
    FOR UPDATE
  `, [values.marca_id, normalized]);
  if (existing.rowCount) {
    if (!existing.rows[0].activa) {
      const error = new Error(
        'Familia există, dar este dezactivată. Un administrator trebuie să o reactiveze.'
      );
      error.status = 400;
      throw error;
    }
    return existing.rows[0].id;
  }

  const slug = await uniqueSlug(database, {
    table: 'biblioteca_familii',
    base: values.familie_noua,
    brandId: values.marca_id
  });
  const inserted = await database.query(`
    INSERT INTO crm.biblioteca_familii (
      marca_id,
      nume,
      nume_normalizat,
      slug,
      ordine
    )
    VALUES ($1, $2, $3, $4, 500)
    RETURNING id
  `, [
    values.marca_id,
    values.familie_noua,
    normalized,
    slug
  ]);
  await audit(database, {
    entity: 'familie',
    entityId: inserted.rows[0].id,
    action: 'creare',
    userId,
    details: { marca_id: values.marca_id, sursa: 'formular_caz' }
  });
  return inserted.rows[0].id;
}

async function resolveModel(
  database,
  {
    values,
    familyId,
    userId
  }
) {
  const normalized = normalizeLibraryKey(values.model, 150);
  const existing = await database.query(`
    SELECT id, familie_id, arhivat_la
    FROM crm.biblioteca_modele
    WHERE marca_id = $1
      AND model_normalizat = $2
    FOR UPDATE
  `, [values.marca_id, normalized]);

  if (existing.rowCount) {
    const model = existing.rows[0];
    if (
      familyId &&
      model.familie_id &&
      Number(model.familie_id) !== Number(familyId)
    ) {
      const error = new Error(
        'Modelul există deja într-o altă familie a aceleiași mărci.'
      );
      error.status = 409;
      throw error;
    }
    await database.query(`
      UPDATE crm.biblioteca_modele
      SET
        familie_id = COALESCE(familie_id, $2),
        descriere = COALESCE(NULLIF($3, ''), descriere),
        arhivat_la = NULL,
        updated_at = NOW()
      WHERE id = $1
    `, [model.id, familyId, values.model_descriere]);
    if (model.arhivat_la) {
      await audit(database, {
        entity: 'model',
        entityId: model.id,
        action: 'restaurare',
        userId
      });
    }
    return model.id;
  }

  const inserted = await database.query(`
    INSERT INTO crm.biblioteca_modele (
      marca_id,
      familie_id,
      model,
      model_normalizat,
      descriere
    )
    VALUES ($1, $2, $3, $4, NULLIF($5, ''))
    RETURNING id
  `, [
    values.marca_id,
    familyId,
    values.model,
    normalized,
    values.model_descriere
  ]);
  await audit(database, {
    entity: 'model',
    entityId: inserted.rows[0].id,
    action: 'creare',
    userId,
    details: {
      marca_id: values.marca_id,
      familie_id: familyId
    }
  });
  return inserted.rows[0].id;
}

async function validateBrand(database, brandId) {
  const brand = await database.query(`
    SELECT id, nume, activa
    FROM crm.biblioteca_marci
    WHERE id = $1
    FOR SHARE
  `, [brandId]);
  if (!brand.rowCount || !brand.rows[0].activa) {
    const error = new Error(
      'Marca selectată nu există sau este dezactivată.'
    );
    error.status = 400;
    throw error;
  }
  return brand.rows[0];
}

function caseInsertValues(values) {
  return [
    values.titlu,
    values.simptom || null,
    values.defect_reclamat || null,
    values.manifestare || null,
    values.diagnostic || null,
    values.cauza_identificata || null,
    values.solutie || null,
    values.masuratori || null,
    values.componente_schimbate || null,
    values.valori_componente || null,
    values.firmware_folosit || null,
    values.cod_placa_baza || null,
    values.cod_sursa || null,
    values.cod_tcon || null,
    values.cod_panou || null,
    values.cod_sasiu || null,
    values.alte_coduri || null,
    values.dificultate,
    values.rezultat,
    values.status_verificare,
    values.observatii || null
  ];
}

function caseFormLocals({
  values,
  errors = [],
  mode = 'create',
  caseId = null,
  lists,
  user
}) {
  return {
    values,
    errors,
    mode,
    caseId,
    brands: lists.brands.filter(item => item.activa),
    families: lists.families.filter(item => item.activa),
    models: lists.models,
    difficulties: libraryDifficulties,
    results: libraryResults,
    verificationStatuses: libraryVerificationStatuses,
    isAdmin: isLibraryAdmin(user),
    active: 'biblioteca-defecte'
  };
}

export function registerDefectLibraryRoutes(app, requireAuth) {
  app.get(
    '/biblioteca-defecte',
    requireAuth,
    async (req, res, next) => {
      try {
        const filters = normalizeLibraryFilters(req.query);
        const [cards, lists, result] = await Promise.all([
          brandCards(),
          structureLists(),
          searchCases(filters)
        ]);
        res.render('biblioteca-defecte', {
          brandCards: cards,
          ...lists,
          ...result,
          filters: { ...filters, page: result.page },
          filtersActive: libraryFiltersActive(filters),
          difficulties: libraryDifficulties,
          results: libraryResults,
          verificationStatuses: libraryVerificationStatuses,
          sorts: librarySorts,
          pageSizes: libraryPageSizes,
          buildLibraryUrl,
          isAdmin: isLibraryAdmin(req.user),
          user: req.user,
          active: 'biblioteca-defecte'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/biblioteca-defecte/api/familii',
    requireAuth,
    async (req, res, next) => {
      try {
        const brandId = positiveLibraryId(req.query.marca_id);
        if (!brandId) return res.status(400).json({ error: 'Marcă invalidă.' });
        const result = await query(`
          SELECT id, nume
          FROM crm.biblioteca_familii
          WHERE marca_id = $1
            AND activa = TRUE
          ORDER BY ordine, LOWER(nume), id
        `, [brandId]);
        res.json({ families: result.rows });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/biblioteca-defecte/api/modele',
    requireAuth,
    async (req, res, next) => {
      try {
        const brandId = positiveLibraryId(req.query.marca_id);
        const familyId = positiveLibraryId(req.query.familie_id);
        if (!brandId) return res.status(400).json({ error: 'Marcă invalidă.' });
        const params = [brandId];
        let familySql = '';
        if (familyId) {
          params.push(familyId);
          familySql = `AND familie_id = $${params.length}`;
        }
        const result = await query(`
          SELECT id, model, familie_id
          FROM crm.biblioteca_modele
          WHERE marca_id = $1
            AND arhivat_la IS NULL
            ${familySql}
          ORDER BY LOWER(model), id
          LIMIT 500
        `, params);
        res.json({ models: result.rows });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/biblioteca-defecte/marci/:id',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = positiveLibraryId(req.params.id);
        if (!id) return renderLibraryError(res, 404, 'Marca nu există.');
        const search = cleanLibraryText(req.query.q, 150);
        const [brand, families, models] = await Promise.all([
          query(`
            SELECT id, nume, activa
            FROM crm.biblioteca_marci
            WHERE id = $1
          `, [id]),
          query(`
            SELECT
              f.id,
              f.nume,
              f.activa,
              COUNT(DISTINCT m.id)
                FILTER (WHERE m.arhivat_la IS NULL)::integer
                AS numar_modele,
              COUNT(DISTINCT c.id)
                FILTER (
                  WHERE c.arhivat_la IS NULL
                    AND c.sters_la IS NULL
                )::integer AS numar_cazuri
            FROM crm.biblioteca_familii f
            LEFT JOIN crm.biblioteca_modele m
              ON m.familie_id = f.id
            LEFT JOIN crm.biblioteca_cazuri c
              ON c.model_id = m.id
            WHERE f.marca_id = $1
              AND f.activa = TRUE
            GROUP BY f.id
            ORDER BY f.ordine, LOWER(f.nume), f.id
          `, [id]),
          query(`
            SELECT
              m.id,
              m.model,
              f.nume AS familie,
              COUNT(c.id)
                FILTER (
                  WHERE c.arhivat_la IS NULL
                    AND c.sters_la IS NULL
                )::integer AS numar_cazuri
            FROM crm.biblioteca_modele m
            LEFT JOIN crm.biblioteca_familii f
              ON f.id = m.familie_id
            LEFT JOIN crm.biblioteca_cazuri c
              ON c.model_id = m.id
            WHERE m.marca_id = $1
              AND m.arhivat_la IS NULL
              AND (
                $2 = ''
                OR CONCAT_WS(' ', m.model, f.nume)
                  ILIKE $3 ESCAPE '\\'
                OR EXISTS (
                  SELECT 1
                  FROM crm.biblioteca_cazuri c_search
                  WHERE c_search.model_id = m.id
                    AND c_search.sters_la IS NULL
                    AND CONCAT_WS(
                      ' ',
                      c_search.titlu,
                      c_search.simptom,
                      c_search.diagnostic,
                      c_search.solutie
                    ) ILIKE $3 ESCAPE '\\'
                )
              )
            GROUP BY m.id, f.nume
            ORDER BY LOWER(m.model), m.id
            LIMIT 500
          `, [id, search, `%${escapeLike(search)}%`])
        ]);
        if (!brand.rowCount) {
          return renderLibraryError(res, 404, 'Marca nu există.');
        }
        res.render('biblioteca-marca', {
          brand: brand.rows[0],
          families: families.rows,
          models: models.rows,
          q: search,
          isAdmin: isLibraryAdmin(req.user),
          active: 'biblioteca-defecte'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/biblioteca-defecte/familii/:id',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = positiveLibraryId(req.params.id);
        if (!id) return renderLibraryError(res, 404, 'Familia nu există.');
        const [family, models] = await Promise.all([
          query(`
            SELECT
              f.id,
              f.nume,
              f.activa,
              b.id AS marca_id,
              b.nume AS marca
            FROM crm.biblioteca_familii f
            JOIN crm.biblioteca_marci b
              ON b.id = f.marca_id
            WHERE f.id = $1
          `, [id]),
          query(`
            SELECT
              m.id,
              m.model,
              m.descriere,
              COUNT(c.id)
                FILTER (
                  WHERE c.arhivat_la IS NULL
                    AND c.sters_la IS NULL
                )::integer AS numar_cazuri,
              MAX(c.updated_at)
                FILTER (
                  WHERE c.arhivat_la IS NULL
                    AND c.sters_la IS NULL
                ) AS ultima_actualizare
            FROM crm.biblioteca_modele m
            LEFT JOIN crm.biblioteca_cazuri c
              ON c.model_id = m.id
            WHERE m.familie_id = $1
              AND m.arhivat_la IS NULL
            GROUP BY m.id
            ORDER BY LOWER(m.model), m.id
          `, [id])
        ]);
        if (!family.rowCount) {
          return renderLibraryError(res, 404, 'Familia nu există.');
        }
        res.render('biblioteca-familie', {
          family: family.rows[0],
          models: models.rows,
          active: 'biblioteca-defecte'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/biblioteca-defecte/modele/:id',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = positiveLibraryId(req.params.id);
        if (!id) return renderLibraryError(res, 404, 'Modelul nu există.');
        const [model, cases] = await Promise.all([
          query(`
            SELECT
              m.*,
              b.id AS marca_id,
              b.nume AS marca,
              f.id AS familie_id,
              f.nume AS familie
            FROM crm.biblioteca_modele m
            JOIN crm.biblioteca_marci b
              ON b.id = m.marca_id
            LEFT JOIN crm.biblioteca_familii f
              ON f.id = m.familie_id
            WHERE m.id = $1
              AND m.arhivat_la IS NULL
          `, [id]),
          query(`
            SELECT
              c.id,
              c.titlu,
              c.simptom,
              c.dificultate,
              c.rezultat,
              c.status_verificare,
              c.updated_at,
              u.username AS autor,
              (
                SELECT COUNT(*)::integer
                FROM crm.biblioteca_atasamente a
                WHERE a.caz_id = c.id
                  AND a.sters_la IS NULL
              ) AS numar_atasamente
            FROM crm.biblioteca_cazuri c
            JOIN crm.utilizatori u
              ON u.id = c.creat_de_user_id
            WHERE c.model_id = $1
              AND c.sters_la IS NULL
            ORDER BY
              (c.arhivat_la IS NOT NULL),
              c.updated_at DESC,
              c.id DESC
          `, [id])
        ]);
        if (!model.rowCount) {
          return renderLibraryError(res, 404, 'Modelul nu există.');
        }
        res.render('biblioteca-model', {
          model: model.rows[0],
          cases: cases.rows,
          difficulties: libraryDifficulties,
          results: libraryResults,
          verificationStatuses: libraryVerificationStatuses,
          active: 'biblioteca-defecte'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/biblioteca-defecte/cazuri/nou',
    requireAuth,
    async (req, res, next) => {
      try {
        const lists = await structureLists();
        const modelId = positiveLibraryId(req.query.model_id);
        const model = modelId
          ? lists.models.find(item => Number(item.id) === modelId)
          : null;
        const values = libraryCaseValues({
          marca_id: model?.marca_id || req.query.marca_id,
          familie_id: model?.familie_id || req.query.familie_id,
          model: model?.model || ''
        });
        res.render('biblioteca-caz-form', caseFormLocals({
          values,
          lists,
          user: req.user
        }));
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/biblioteca-defecte/cazuri',
    requireAuth,
    async (req, res, next) => {
      const values = libraryCaseValues(req.body);
      const errors = validateLibraryCase(values);
      if (errors.length) {
        if (jsonRequested(req)) {
          return res.status(400).json({ errors });
        }
        const lists = await structureLists();
        return res.status(400).render(
          'biblioteca-caz-form',
          caseFormLocals({
            values,
            errors,
            lists,
            user: req.user
          })
        );
      }

      const client = await pool.connect();
      let open = false;
      try {
        await client.query('BEGIN');
        open = true;
        await validateBrand(client, values.marca_id);
        const familyId = await resolveFamily(
          client,
          values,
          req.user.id
        );
        const modelId = await resolveModel(client, {
          values,
          familyId,
          userId: req.user.id
        });
        const inserted = await client.query(`
          INSERT INTO crm.biblioteca_cazuri (
            model_id,
            titlu,
            simptom,
            defect_reclamat,
            manifestare,
            diagnostic,
            cauza_identificata,
            solutie,
            masuratori,
            componente_schimbate,
            valori_componente,
            firmware_folosit,
            cod_placa_baza,
            cod_sursa,
            cod_tcon,
            cod_panou,
            cod_sasiu,
            alte_coduri,
            dificultate,
            rezultat,
            status_verificare,
            observatii,
            creat_de_user_id,
            actualizat_de_user_id,
            arhivat_la
          )
          VALUES (
            $1,
            ${caseInsertValues(values)
              .map((_value, index) => `$${index + 2}`)
              .join(', ')},
            $23,
            $23,
            CASE WHEN $22 = 'arhivat' THEN NOW() ELSE NULL END
          )
          RETURNING id
        `, [
          modelId,
          ...caseInsertValues(values),
          req.user.id
        ]);
        const caseId = inserted.rows[0].id;
        await audit(client, {
          entity: 'caz',
          entityId: caseId,
          action: 'creare',
          userId: req.user.id,
          details: { model_id: modelId }
        });
        await client.query('COMMIT');
        open = false;
        const url = `/biblioteca-defecte/cazuri/${caseId}`;
        if (jsonRequested(req)) {
          return res.status(201).json({ ok: true, caseId, url });
        }
        return res.redirect(`${url}?creat=1`);
      } catch (error) {
        if (open) await client.query('ROLLBACK').catch(() => {});
        return handleExpectedError(req, res, next, error);
      } finally {
        client.release();
      }
    }
  );

  app.get(
    '/biblioteca-defecte/cazuri/:id',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = positiveLibraryId(req.params.id);
        if (!id) return renderLibraryError(res, 404, 'Cazul nu există.');
        const [caseRow, attachments] = await Promise.all([
          libraryCase(id),
          libraryAttachments(id)
        ]);
        if (!caseRow) {
          return renderLibraryError(res, 404, 'Cazul nu există.');
        }
        res.render('biblioteca-caz', {
          caseRow,
          attachments,
          difficulties: libraryDifficulties,
          results: libraryResults,
          verificationStatuses: libraryVerificationStatuses,
          formatBytes: formatLibraryBytes,
          isAdmin: isLibraryAdmin(req.user),
          messages: {
            created: req.query.creat === '1',
            updated: req.query.actualizat === '1',
            uploaded: req.query.incarcat === '1',
            removed: req.query.atasament_sters === '1',
            archived: req.query.arhivat === '1',
            restored: req.query.restaurat === '1'
          },
          active: 'biblioteca-defecte'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/biblioteca-defecte/cazuri/:id/editare',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = positiveLibraryId(req.params.id);
        const [row, lists] = await Promise.all([
          id ? libraryCase(id) : Promise.resolve(null),
          structureLists()
        ]);
        if (!row) return renderLibraryError(res, 404, 'Cazul nu există.');
        const values = libraryCaseValues({
          ...row,
          marca_id: row.marca_id,
          familie_id: row.familie_id,
          model: row.model,
          model_descriere: row.model_descriere
        });
        res.render('biblioteca-caz-form', caseFormLocals({
          values,
          mode: 'edit',
          caseId: id,
          lists,
          user: req.user
        }));
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/biblioteca-defecte/cazuri/:id/editare',
    requireAuth,
    async (req, res, next) => {
      const id = positiveLibraryId(req.params.id);
      const values = libraryCaseValues(req.body);
      const errors = validateLibraryCase(values);
      if (!id) return renderLibraryError(res, 404, 'Cazul nu există.');
      if (errors.length) {
        if (jsonRequested(req)) {
          return res.status(400).json({ errors });
        }
        const lists = await structureLists();
        return res.status(400).render(
          'biblioteca-caz-form',
          caseFormLocals({
            values,
            errors,
            mode: 'edit',
            caseId: id,
            lists,
            user: req.user
          })
        );
      }

      const client = await pool.connect();
      let open = false;
      try {
        await client.query('BEGIN');
        open = true;
        const locked = await client.query(`
          SELECT id, model_id
          FROM crm.biblioteca_cazuri
          WHERE id = $1
            AND sters_la IS NULL
          FOR UPDATE
        `, [id]);
        if (!locked.rowCount) {
          const error = new Error('Cazul nu există.');
          error.status = 404;
          throw error;
        }
        await validateBrand(client, values.marca_id);
        const familyId = await resolveFamily(
          client,
          values,
          req.user.id
        );
        const modelId = await resolveModel(client, {
          values,
          familyId,
          userId: req.user.id
        });
        await client.query(`
          UPDATE crm.biblioteca_cazuri
          SET
            model_id = $2,
            titlu = $3,
            simptom = $4,
            defect_reclamat = $5,
            manifestare = $6,
            diagnostic = $7,
            cauza_identificata = $8,
            solutie = $9,
            masuratori = $10,
            componente_schimbate = $11,
            valori_componente = $12,
            firmware_folosit = $13,
            cod_placa_baza = $14,
            cod_sursa = $15,
            cod_tcon = $16,
            cod_panou = $17,
            cod_sasiu = $18,
            alte_coduri = $19,
            dificultate = $20,
            rezultat = $21,
            status_verificare = $22::text,
            observatii = $23,
            actualizat_de_user_id = $24,
            updated_at = NOW(),
            arhivat_la = CASE
              WHEN $22::text = 'arhivat'
                THEN COALESCE(arhivat_la, NOW())
              ELSE NULL
            END
          WHERE id = $1
        `, [id, modelId, ...caseInsertValues(values), req.user.id]);
        await audit(client, {
          entity: 'caz',
          entityId: id,
          action: 'editare',
          userId: req.user.id,
          details: {
            model_id_vechi: locked.rows[0].model_id,
            model_id_nou: modelId
          }
        });
        await client.query('COMMIT');
        open = false;
        const url = `/biblioteca-defecte/cazuri/${id}`;
        if (jsonRequested(req)) {
          return res.json({ ok: true, caseId: id, url });
        }
        return res.redirect(`${url}?actualizat=1`);
      } catch (error) {
        if (open) await client.query('ROLLBACK').catch(() => {});
        return handleExpectedError(req, res, next, error);
      } finally {
        client.release();
      }
    }
  );

  app.post(
    '/biblioteca-defecte/cazuri/:id/arhiveaza',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = positiveLibraryId(req.params.id);
        if (!id) return renderLibraryError(res, 404, 'Cazul nu există.');
        const updated = await query(`
          UPDATE crm.biblioteca_cazuri
          SET
            status_verificare = 'arhivat',
            arhivat_la = COALESCE(arhivat_la, NOW()),
            actualizat_de_user_id = $2,
            updated_at = NOW()
          WHERE id = $1
            AND sters_la IS NULL
          RETURNING id
        `, [id, req.user.id]);
        if (!updated.rowCount) {
          return renderLibraryError(res, 404, 'Cazul nu există.');
        }
        await audit(query, {
          entity: 'caz',
          entityId: id,
          action: 'arhivare',
          userId: req.user.id
        });
        res.redirect(`/biblioteca-defecte/cazuri/${id}?arhivat=1`);
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/biblioteca-defecte/cazuri/:id/restaureaza',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = positiveLibraryId(req.params.id);
        if (!id) return renderLibraryError(res, 404, 'Cazul nu există.');
        const updated = await query(`
          UPDATE crm.biblioteca_cazuri
          SET
            status_verificare = 'caz_intern',
            arhivat_la = NULL,
            actualizat_de_user_id = $2,
            updated_at = NOW()
          WHERE id = $1
            AND sters_la IS NULL
          RETURNING id
        `, [id, req.user.id]);
        if (!updated.rowCount) {
          return renderLibraryError(res, 404, 'Cazul nu există.');
        }
        await audit(query, {
          entity: 'caz',
          entityId: id,
          action: 'restaurare',
          userId: req.user.id
        });
        res.redirect(`/biblioteca-defecte/cazuri/${id}?restaurat=1`);
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/biblioteca-defecte/cazuri/:id/sterge',
    requireAuth,
    libraryAdminOnly(async (req, res, next) => {
      try {
        const id = positiveLibraryId(req.params.id);
        if (!id) return renderLibraryError(res, 404, 'Cazul nu există.');
        const updated = await query(`
          UPDATE crm.biblioteca_cazuri
          SET
            sters_la = NOW(),
            sters_de_user_id = $2,
            actualizat_de_user_id = $2,
            updated_at = NOW()
          WHERE id = $1
            AND sters_la IS NULL
          RETURNING model_id
        `, [id, req.user.id]);
        if (!updated.rowCount) {
          return renderLibraryError(res, 404, 'Cazul nu există.');
        }
        await audit(query, {
          entity: 'caz',
          entityId: id,
          action: 'stergere_logica',
          userId: req.user.id
        });
        res.redirect(
          `/biblioteca-defecte/modele/${updated.rows[0].model_id}?sters=1`
        );
      } catch (error) {
        next(error);
      }
    })
  );

  app.post(
    '/biblioteca-defecte/cazuri/:id/atasamente',
    requireAuth,
    async (req, res, next) => {
      const caseId = positiveLibraryId(req.params.id);
      if (!caseId) {
        return res.status(404).json({ error: 'Cazul nu există.' });
      }
      let upload;
      let finalized;
      const client = await pool.connect();
      let open = false;
      try {
        upload = await receiveLibraryUpload(req);
        await client.query('BEGIN');
        open = true;
        const locked = await client.query(`
          SELECT id
          FROM crm.biblioteca_cazuri
          WHERE id = $1
            AND sters_la IS NULL
          FOR UPDATE
        `, [caseId]);
        if (!locked.rowCount) {
          const error = new Error('Cazul nu există.');
          error.status = 404;
          throw error;
        }
        const totals = await client.query(`
          SELECT
            COUNT(*)::integer AS file_count,
            COALESCE(SUM(dimensiune_bytes), 0)::bigint AS total_bytes
          FROM crm.biblioteca_atasamente
          WHERE caz_id = $1
            AND sters_la IS NULL
        `, [caseId]);
        const count = Number(totals.rows[0].file_count);
        const bytes = Number(totals.rows[0].total_bytes);
        if (count + 1 > upload.limits.filesPerCase) {
          const error = new Error(
            `Un caz poate avea maximum ${upload.limits.filesPerCase} fișiere active.`
          );
          error.status = 413;
          throw error;
        }
        if (bytes + upload.size > upload.limits.caseBytes) {
          const error = new Error(
            'Atașamentele active ale cazului depășesc limita totală de 200 MB.'
          );
          error.status = 413;
          throw error;
        }
        finalized = await finalizeLibraryUpload({
          upload,
          caseId
        });
        const inserted = await client.query(`
          INSERT INTO crm.biblioteca_atasamente (
            caz_id,
            tip,
            nume_original,
            nume_stocat,
            cale_relativa,
            thumbnail_cale_relativa,
            mime_type,
            dimensiune_bytes,
            sha256,
            descriere,
            incarcat_de_user_id
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            NULLIF($10, ''),
            $11
          )
          RETURNING id
        `, [
          caseId,
          upload.detected.kind,
          upload.originalName,
          path.basename(finalized.relativePath),
          finalized.relativePath,
          finalized.thumbnailRelativePath,
          upload.detected.mime,
          upload.size,
          upload.sha256,
          upload.description,
          req.user.id
        ]);
        await audit(client, {
          entity: 'atasament',
          entityId: inserted.rows[0].id,
          action: 'incarcare',
          userId: req.user.id,
          details: {
            caz_id: caseId,
            mime_type: upload.detected.mime,
            dimensiune_bytes: upload.size,
            sha256: upload.sha256
          }
        });
        await client.query(`
          UPDATE crm.biblioteca_cazuri
          SET
            actualizat_de_user_id = $2,
            updated_at = NOW()
          WHERE id = $1
        `, [caseId, req.user.id]);
        await client.query('COMMIT');
        open = false;
        res.status(201).json({
          ok: true,
          attachmentId: inserted.rows[0].id,
          url:
            `/biblioteca-defecte/cazuri/${caseId}` +
            '?incarcat=1#atasamente'
        });
      } catch (error) {
        if (open) await client.query('ROLLBACK').catch(() => {});
        await cleanupLibraryUpload(upload, finalized);
        if (error?.status) {
          return res.status(error.status).json({ error: error.message });
        }
        next(error);
      } finally {
        client.release();
      }
    }
  );

  app.get(
    '/biblioteca-defecte/cazuri/:id/atasamente/:attachmentId',
    requireAuth,
    async (req, res, next) => {
      try {
        const caseId = positiveLibraryId(req.params.id);
        const attachmentId = positiveLibraryId(req.params.attachmentId);
        if (!caseId || !attachmentId) {
          return renderLibraryError(res, 404, 'Fișierul nu există.');
        }
        const result = await query(`
          SELECT
            a.nume_original,
            a.cale_relativa,
            a.thumbnail_cale_relativa,
            a.mime_type,
            a.tip
          FROM crm.biblioteca_atasamente a
          JOIN crm.biblioteca_cazuri c
            ON c.id = a.caz_id
          WHERE a.id = $1
            AND a.caz_id = $2
            AND a.sters_la IS NULL
            AND c.sters_la IS NULL
        `, [attachmentId, caseId]);
        if (!result.rowCount) {
          return renderLibraryError(res, 404, 'Fișierul nu există.');
        }
        const attachment = result.rows[0];
        const thumbnail = req.query.thumb === '1' &&
          attachment.tip === 'imagine' &&
          attachment.thumbnail_cale_relativa;
        const filePath = resolveLibraryStoredPath(
          thumbnail
            ? attachment.thumbnail_cale_relativa
            : attachment.cale_relativa
        );
        if (!filePath) {
          return renderLibraryError(res, 404, 'Fișierul nu există.');
        }
        await fs.access(filePath);
        const download = req.query.download === '1';
        res.set({
          'Content-Type': thumbnail
            ? 'image/webp'
            : attachment.mime_type,
          'Content-Disposition': libraryContentDisposition(
            download ? 'attachment' : 'inline',
            attachment.nume_original
          ),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=3600'
        });
        return res.sendFile(filePath);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return renderLibraryError(
            res,
            404,
            'Fișierul lipsește din stocarea persistentă.'
          );
        }
        next(error);
      }
    }
  );

  app.post(
    '/biblioteca-defecte/cazuri/:id/atasamente/:attachmentId/sterge',
    requireAuth,
    async (req, res, next) => {
      try {
        const caseId = positiveLibraryId(req.params.id);
        const attachmentId = positiveLibraryId(req.params.attachmentId);
        if (!caseId || !attachmentId) {
          return renderLibraryError(res, 404, 'Fișierul nu există.');
        }
        const updated = await query(`
          UPDATE crm.biblioteca_atasamente
          SET
            sters_la = NOW(),
            sters_de_user_id = $3
          WHERE id = $1
            AND caz_id = $2
            AND sters_la IS NULL
          RETURNING id
        `, [attachmentId, caseId, req.user.id]);
        if (!updated.rowCount) {
          return renderLibraryError(res, 404, 'Fișierul nu există.');
        }
        await audit(query, {
          entity: 'atasament',
          entityId: attachmentId,
          action: 'stergere_logica',
          userId: req.user.id,
          details: { caz_id: caseId }
        });
        res.redirect(
          `/biblioteca-defecte/cazuri/${caseId}` +
          '?atasament_sters=1#atasamente'
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/biblioteca-defecte/administrare',
    requireAuth,
    libraryAdminOnly(async (req, res, next) => {
      try {
        const lists = await structureLists();
        res.render('biblioteca-administrare', {
          ...lists,
          success: cleanLibraryText(req.query.success, 40),
          error: cleanLibraryText(req.query.error, 80),
          active: 'biblioteca-defecte'
        });
      } catch (error) {
        next(error);
      }
    })
  );

  app.post(
    '/biblioteca-defecte/administrare/marci',
    requireAuth,
    libraryAdminOnly(async (req, res, next) => {
      const name = cleanLibraryText(req.body.nume, 80)
        .replace(/\s+/g, ' ');
      if (!name) {
        return res.redirect(
          '/biblioteca-defecte/administrare?error=marca_goala'
        );
      }
      const client = await pool.connect();
      let open = false;
      try {
        await client.query('BEGIN');
        open = true;
        const normalized = normalizeLibraryKey(name, 80);
        const existing = await client.query(`
          SELECT id
          FROM crm.biblioteca_marci
          WHERE nume_normalizat = $1
        `, [normalized]);
        if (existing.rowCount) {
          await client.query('ROLLBACK');
          open = false;
          return res.redirect(
            '/biblioteca-defecte/administrare?error=marca_existenta'
          );
        }
        const slug = await uniqueSlug(client, {
          table: 'biblioteca_marci',
          base: name
        });
        const inserted = await client.query(`
          INSERT INTO crm.biblioteca_marci (
            nume,
            nume_normalizat,
            slug,
            ordine
          )
          VALUES ($1, $2, $3, 500)
          RETURNING id
        `, [name, normalized, slug]);
        await audit(client, {
          entity: 'marca',
          entityId: inserted.rows[0].id,
          action: 'creare',
          userId: req.user.id
        });
        await client.query('COMMIT');
        open = false;
        res.redirect(
          '/biblioteca-defecte/administrare?success=marca_creata'
        );
      } catch (error) {
        if (open) await client.query('ROLLBACK').catch(() => {});
        next(error);
      } finally {
        client.release();
      }
    })
  );

  app.post(
    '/biblioteca-defecte/administrare/marci/:id',
    requireAuth,
    libraryAdminOnly(async (req, res, next) => {
      const id = positiveLibraryId(req.params.id);
      const name = cleanLibraryText(req.body.nume, 80)
        .replace(/\s+/g, ' ');
      if (!id || !name) {
        return res.redirect(
          '/biblioteca-defecte/administrare?error=marca_invalida'
        );
      }
      const client = await pool.connect();
      let open = false;
      try {
        await client.query('BEGIN');
        open = true;
        const slug = await uniqueSlug(client, {
          table: 'biblioteca_marci',
          base: name,
          excludedId: id
        });
        const updated = await client.query(`
          UPDATE crm.biblioteca_marci
          SET
            nume = $2,
            nume_normalizat = $3,
            slug = $4,
            updated_at = NOW()
          WHERE id = $1
          RETURNING id
        `, [id, name, normalizeLibraryKey(name, 80), slug]);
        if (!updated.rowCount) {
          const error = new Error('Marca nu există.');
          error.status = 404;
          throw error;
        }
        await audit(client, {
          entity: 'marca',
          entityId: id,
          action: 'editare',
          userId: req.user.id
        });
        await client.query('COMMIT');
        open = false;
        res.redirect(
          '/biblioteca-defecte/administrare?success=marca_actualizata'
        );
      } catch (error) {
        if (open) await client.query('ROLLBACK').catch(() => {});
        if (error?.code === '23505') {
          return res.redirect(
            '/biblioteca-defecte/administrare?error=marca_existenta'
          );
        }
        return handleExpectedError(req, res, next, error);
      } finally {
        client.release();
      }
    })
  );

  app.post(
    '/biblioteca-defecte/administrare/marci/:id/status',
    requireAuth,
    libraryAdminOnly(async (req, res, next) => {
      try {
        const id = positiveLibraryId(req.params.id);
        const active = req.body.activa === '1';
        if (!id) {
          return res.redirect(
            '/biblioteca-defecte/administrare?error=marca_invalida'
          );
        }
        const updated = await query(`
          UPDATE crm.biblioteca_marci
          SET activa = $2, updated_at = NOW()
          WHERE id = $1
          RETURNING id
        `, [id, active]);
        if (!updated.rowCount) {
          return renderLibraryError(res, 404, 'Marca nu există.');
        }
        await audit(query, {
          entity: 'marca',
          entityId: id,
          action: active ? 'activare' : 'dezactivare',
          userId: req.user.id
        });
        res.redirect(
          '/biblioteca-defecte/administrare?success=marca_status'
        );
      } catch (error) {
        next(error);
      }
    })
  );

  app.post(
    '/biblioteca-defecte/administrare/familii',
    requireAuth,
    libraryAdminOnly(async (req, res, next) => {
      const brandId = positiveLibraryId(req.body.marca_id);
      const name = cleanLibraryText(req.body.nume, 100)
        .replace(/\s+/g, ' ');
      if (!brandId || !name) {
        return res.redirect(
          '/biblioteca-defecte/administrare?error=familie_invalida'
        );
      }
      const client = await pool.connect();
      let open = false;
      try {
        await client.query('BEGIN');
        open = true;
        await validateBrand(client, brandId);
        const normalized = normalizeLibraryKey(name, 100);
        const existing = await client.query(`
          SELECT id
          FROM crm.biblioteca_familii
          WHERE marca_id = $1
            AND nume_normalizat = $2
        `, [brandId, normalized]);
        if (existing.rowCount) {
          await client.query('ROLLBACK');
          open = false;
          return res.redirect(
            '/biblioteca-defecte/administrare?error=familie_existenta'
          );
        }
        const slug = await uniqueSlug(client, {
          table: 'biblioteca_familii',
          base: name,
          brandId
        });
        const inserted = await client.query(`
          INSERT INTO crm.biblioteca_familii (
            marca_id,
            nume,
            nume_normalizat,
            slug,
            ordine
          )
          VALUES ($1, $2, $3, $4, 500)
          RETURNING id
        `, [brandId, name, normalized, slug]);
        await audit(client, {
          entity: 'familie',
          entityId: inserted.rows[0].id,
          action: 'creare',
          userId: req.user.id,
          details: { marca_id: brandId }
        });
        await client.query('COMMIT');
        open = false;
        res.redirect(
          '/biblioteca-defecte/administrare?success=familie_creata'
        );
      } catch (error) {
        if (open) await client.query('ROLLBACK').catch(() => {});
        return handleExpectedError(req, res, next, error);
      } finally {
        client.release();
      }
    })
  );

  app.post(
    '/biblioteca-defecte/administrare/familii/:id',
    requireAuth,
    libraryAdminOnly(async (req, res, next) => {
      const id = positiveLibraryId(req.params.id);
      const name = cleanLibraryText(req.body.nume, 100)
        .replace(/\s+/g, ' ');
      if (!id || !name) {
        return res.redirect(
          '/biblioteca-defecte/administrare?error=familie_invalida'
        );
      }
      const client = await pool.connect();
      let open = false;
      try {
        await client.query('BEGIN');
        open = true;
        const current = await client.query(`
          SELECT marca_id
          FROM crm.biblioteca_familii
          WHERE id = $1
          FOR UPDATE
        `, [id]);
        if (!current.rowCount) {
          const error = new Error('Familia nu există.');
          error.status = 404;
          throw error;
        }
        const brandId = current.rows[0].marca_id;
        const slug = await uniqueSlug(client, {
          table: 'biblioteca_familii',
          base: name,
          brandId,
          excludedId: id
        });
        await client.query(`
          UPDATE crm.biblioteca_familii
          SET
            nume = $2,
            nume_normalizat = $3,
            slug = $4,
            updated_at = NOW()
          WHERE id = $1
        `, [id, name, normalizeLibraryKey(name, 100), slug]);
        await audit(client, {
          entity: 'familie',
          entityId: id,
          action: 'editare',
          userId: req.user.id
        });
        await client.query('COMMIT');
        open = false;
        res.redirect(
          '/biblioteca-defecte/administrare?success=familie_actualizata'
        );
      } catch (error) {
        if (open) await client.query('ROLLBACK').catch(() => {});
        if (error?.code === '23505') {
          return res.redirect(
            '/biblioteca-defecte/administrare?error=familie_existenta'
          );
        }
        return handleExpectedError(req, res, next, error);
      } finally {
        client.release();
      }
    })
  );

  app.post(
    '/biblioteca-defecte/administrare/familii/:id/status',
    requireAuth,
    libraryAdminOnly(async (req, res, next) => {
      try {
        const id = positiveLibraryId(req.params.id);
        const active = req.body.activa === '1';
        if (!id) {
          return res.redirect(
            '/biblioteca-defecte/administrare?error=familie_invalida'
          );
        }
        const updated = await query(`
          UPDATE crm.biblioteca_familii
          SET activa = $2, updated_at = NOW()
          WHERE id = $1
          RETURNING id
        `, [id, active]);
        if (!updated.rowCount) {
          return renderLibraryError(res, 404, 'Familia nu există.');
        }
        await audit(query, {
          entity: 'familie',
          entityId: id,
          action: active ? 'activare' : 'dezactivare',
          userId: req.user.id
        });
        res.redirect(
          '/biblioteca-defecte/administrare?success=familie_status'
        );
      } catch (error) {
        next(error);
      }
    })
  );
}

export const defectLibraryInternals = {
  caseSearchSql,
  escapeLike,
  sortSql
};
