import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

import { query } from './db.js';
import {
  addClientToCrmWhatsAppList,
  addLocalConversationLabel,
  buildWhatsAppOrganizerUrl,
  createCrmWhatsAppList,
  getWhatsAppOrganizerForClient,
  listCrmWhatsAppLists,
  listOrganizedConversations,
  listWhatsAppLabels,
  normalizeConversationScope,
  normalizeCrmListId,
  normalizeWhatsAppLabelId,
  removeClientFromCrmWhatsAppList,
  removeLocalConversationLabel,
  setLocalConversationArchived,
  whatsappOrganizerState
} from './whatsapp-organizer.js';
import {
  absoluteProfilePhotoPath,
  scheduleProfilePhotoRefresh
} from './whatsapp-assets.js';

// WHATSAPP_ORGANIZER_V1
// WHATSAPP_ASSETS_LISTS_V1
import {
  absoluteWhatsAppMediaPath,
  whatsappMediaContentType,
  whatsappMediaDownloadName
} from './whatsapp-media.js';
import {
  getWhatsAppGroupInfo,
  sendWhatsAppMedia,
  sendWhatsAppText
} from './evolution-whatsapp.js';

const activeServiceStatuses = [
  'noua',
  'in_asteptare',
  'confirmata',
  'in_lucru'
];

function integerId(value) {
  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0
    ? id
    : null;
}

function searchText(value) {
  return String(value || '')
    .trim()
    .slice(0, 100);
}

function escapeLike(value) {
  return String(value || '')
    .replace(/[\\%_]/g, '\\$&');
}

function messageText(value) {
  const text = String(value || '').trim();

  if (!text || text.length > 4096) {
    return null;
  }

  return text;
}


const outgoingMediaTypes = Object.freeze({
  'image/jpeg': {
    type: 'image',
    extension: '.jpg',
    limit: 15 * 1024 * 1024
  },
  'image/png': {
    type: 'image',
    extension: '.png',
    limit: 15 * 1024 * 1024
  },
  'image/webp': {
    type: 'image',
    extension: '.webp',
    limit: 15 * 1024 * 1024
  },
  'image/gif': {
    type: 'image',
    extension: '.gif',
    limit: 15 * 1024 * 1024
  },
  'audio/ogg': {
    type: 'audio',
    extension: '.ogg',
    limit: 25 * 1024 * 1024
  },
  'audio/opus': {
    type: 'audio',
    extension: '.opus',
    limit: 25 * 1024 * 1024
  },
  'audio/mpeg': {
    type: 'audio',
    extension: '.mp3',
    limit: 25 * 1024 * 1024
  },
  'audio/mp4': {
    type: 'audio',
    extension: '.m4a',
    limit: 25 * 1024 * 1024
  },
  'audio/wav': {
    type: 'audio',
    extension: '.wav',
    limit: 25 * 1024 * 1024
  },
  'video/mp4': {
    type: 'video',
    extension: '.mp4',
    limit: 50 * 1024 * 1024
  },
  'video/3gpp': {
    type: 'video',
    extension: '.3gp',
    limit: 50 * 1024 * 1024
  },
  'application/pdf': {
    type: 'document',
    extension: '.pdf',
    limit: 25 * 1024 * 1024
  },
  'application/msword': {
    type: 'document',
    extension: '.doc',
    limit: 25 * 1024 * 1024
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    type: 'document',
    extension: '.docx',
    limit: 25 * 1024 * 1024
  },
  'application/vnd.ms-excel': {
    type: 'document',
    extension: '.xls',
    limit: 25 * 1024 * 1024
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    type: 'document',
    extension: '.xlsx',
    limit: 25 * 1024 * 1024
  },
  'text/plain': {
    type: 'document',
    extension: '.txt',
    limit: 10 * 1024 * 1024
  },
  'application/zip': {
    type: 'document',
    extension: '.zip',
    limit: 25 * 1024 * 1024
  }
});

function normalizedMime(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function safeUploadName(value, extension) {
  const original = path.basename(
    String(value || `atasament${extension}`)
  );

  const cleaned = original
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .slice(0, 160);

  if (!cleaned) {
    return `atasament${extension}`;
  }

  return path.extname(cleaned)
    ? cleaned
    : `${cleaned}${extension}`;
}

function safeMessageId(value) {
  const id = String(value || '').trim();

  return id
    ? id.slice(0, 200)
    : null;
}

function redirectUrl({
  clientId,
  q = '',
  sent = '',
  error = ''
}) {
  const params = new URLSearchParams();

  if (clientId) {
    params.set('client', String(clientId));
  }

  if (q) {
    params.set('q', q);
  }

  if (sent) {
    params.set('sent', sent);
  }

  if (error) {
    params.set('error', error);
  }

  return `/conversatii?${params.toString()}`;
}


async function syncWhatsAppGroupNames() {
  const result = await query(`
    SELECT
      id,
      telefon,
      whatsapp_jid
    FROM crm.clienti
    WHERE tip_conversatie = 'grup'
      AND (
        whatsapp_nume_sync_at IS NULL
        OR whatsapp_nume_sync_at <
          CURRENT_TIMESTAMP - INTERVAL '12 hours'
        OR nume IS NULL
        OR BTRIM(nume) = ''
        OR nume = 'Grup WhatsApp'
      )
    ORDER BY
      whatsapp_nume_sync_at ASC NULLS FIRST,
      id ASC
    LIMIT 20
  `);

  for (const row of result.rows) {
    const digits = String(row.telefon || '')
      .replace(/\D/g, '');

    const jid =
      String(row.whatsapp_jid || '').trim() ||
      `${digits}@g.us`;

    try {
      const info = await getWhatsAppGroupInfo(jid);

      await query(`
        UPDATE crm.clienti
        SET
          nume = $1,
          whatsapp_jid = $2,
          tip_conversatie = 'grup',
          whatsapp_nume_sync_at =
            CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [
        info.subject,
        info.jid,
        row.id
      ]);
    } catch (error) {
      console.error(
        'Nu s-a putut sincroniza numele grupului WhatsApp:',
        {
          clientId: row.id,
          jid,
          error: error?.message || String(error)
        }
      );
    }
  }
}

async function conversationList(q) {
  const pattern = `%${escapeLike(q)}%`;

  return query(`
    SELECT *
    FROM (
      SELECT DISTINCT ON (cv.client_id)
        cv.id,
        cv.client_id,
        cv.directie,
        cv.tip,
        cv.mesaj,
        cv.media_url,
        cv.necesita_raspuns,
        cv.este_citit,
        cv.created_at,
        c.nume,
        c.telefon,
        c.tip_conversatie,
        c.whatsapp_jid,
        c.client_dificil,
        (
          SELECT COUNT(*)::INTEGER
          FROM crm.conversatii unread
          WHERE unread.client_id = cv.client_id
            AND unread.directie = 'incoming'
            AND unread.este_citit = FALSE
        ) AS necitite
      FROM crm.conversatii cv
      JOIN crm.clienti c
        ON c.id = cv.client_id
      WHERE (
        $1 = ''
        OR COALESCE(c.nume, '') ILIKE $2 ESCAPE '\\'
        OR COALESCE(c.telefon, '') ILIKE $2 ESCAPE '\\'
      )
      ORDER BY
        cv.client_id,
        cv.created_at DESC,
        cv.id DESC
    ) latest
    ORDER BY
      CASE
        WHEN latest.necesita_raspuns THEN 0
        ELSE 1
      END,
      latest.created_at DESC,
      latest.id DESC
    LIMIT 200
  `, [q, pattern]);
}

async function clientDetails(clientId) {
  return query(`
    SELECT
      c.id,
      c.nume,
      c.telefon,
      c.tip_conversatie,
      c.whatsapp_jid,
      c.email,
      c.adresa,
        c.notite_whatsapp,
      c.client_dificil,
      (
        SELECT f.id
        FROM crm.fise_service f
        WHERE f.client_id = c.id
          AND f.status = ANY($2::TEXT[])
        ORDER BY
          f.updated_at DESC NULLS LAST,
          f.id DESC
        LIMIT 1
      ) AS fisa_activa_id,
      (
        SELECT f.status
        FROM crm.fise_service f
        WHERE f.client_id = c.id
          AND f.status = ANY($2::TEXT[])
        ORDER BY
          f.updated_at DESC NULLS LAST,
          f.id DESC
        LIMIT 1
      ) AS fisa_activa_status,
      (
        SELECT p.id
        FROM whatsapp.contacte wc
        JOIN whatsapp.programari p
          ON p.contact_id = wc.id
        WHERE wc.telefon = c.telefon
          AND p.status <> 'anulata'
          AND p.programare_tehnician_id IS NULL
          AND COALESCE(
            (
              p.rezultat_ai #>>
              '{control,propune_programare}'
            )::boolean,
            (
              p.rezultat_ai ->
              'propune_programare'
            )::boolean,
            false
          ) = TRUE
        ORDER BY
          p.updated_at DESC,
          p.id DESC
        LIMIT 1
      ) AS whatsapp_programare_draft_id
    FROM crm.clienti c
    WHERE c.id = $1
  `, [clientId, activeServiceStatuses]);
}

async function clientMessages(clientId) {
  return query(`
    SELECT
      recent.id,
      recent.directie,
      recent.tip,
      recent.mesaj,
      recent.media_url,
      recent.message_id,
      recent.este_citit,
      recent.necesita_raspuns,
      recent.created_at,
      recovery.status AS media_recovery_status,
      recovery.last_error AS media_recovery_error
    FROM (
      SELECT
        id,
        directie,
        tip,
        mesaj,
        media_url,
        message_id,
        este_citit,
        necesita_raspuns,
        created_at
      FROM crm.conversatii
      WHERE client_id = $1
      ORDER BY
        created_at DESC,
        id DESC
      LIMIT 500
    ) recent
    LEFT JOIN crm.whatsapp_media_recovery recovery
      ON recovery.conversation_id = recent.id
    ORDER BY
      recent.created_at ASC,
      recent.id ASC
  `, [clientId]);
}

async function whatsappLiveState() {
  return query(`
    SELECT
      COALESCE(MAX(id), 0)::BIGINT
        AS latest_message_id,
      COUNT(*)::BIGINT
        AS message_total
    FROM crm.conversatii
  `);
}

export function registerWhatsAppCrmRoutes(
  app,
  requireAuth
) {
  app.get(
    '/conversatii/stare-live',
    requireAuth,
    async (_req, res, next) => {
      try {
        const [
          result,
          organizerState
        ] = await Promise.all([
          whatsappLiveState(),
          whatsappOrganizerState()
        ]);

        const row = result.rows[0] || {};

        res.set(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, max-age=0'
        );

        return res.json({
          latestMessageId: Number(
            row.latest_message_id || 0
          ),
          messageTotal: Number(
            row.message_total || 0
          ),
          syncRevision: Number(
            organizerState.revision || 0
          )
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/conversatii/marcheaza-tot-citit',
    requireAuth,
    async (req, res, next) => {
      try {
        await query(`
          UPDATE crm.conversatii
          SET este_citit = TRUE
          WHERE directie = 'incoming'
            AND este_citit = FALSE
        `);

        await query(`
          UPDATE whatsapp.mesaje
          SET este_citit = TRUE
          WHERE directie = 'incoming'
            AND este_citit = FALSE
        `).catch(error => {
          /*
           * Unele instalări mai vechi nu au coloana
           * este_citit în whatsapp.mesaje.
           * crm.conversatii rămâne sursa interfeței web.
           */
          if (error?.code !== '42703') {
            throw error;
          }
        });

        return res.redirect('/conversatii?read_all=1');
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/conversatii',
    requireAuth,
    async (req, res, next) => {
      try {
        const q = searchText(req.query.q);
        const scope = normalizeConversationScope(
          req.query.scope
        );
        const labelId = normalizeWhatsAppLabelId(
          req.query.label
        );
        const listId = normalizeCrmListId(
          req.query.list
        );

        scheduleProfilePhotoRefresh();
        await syncWhatsAppGroupNames();

        const requestedClientId = integerId(
          req.query.client
        );

        const [
          listResult,
          liveStateResult,
          allLabels,
          allCrmLists,
          organizerState
        ] = await Promise.all([
          listOrganizedConversations(
            q,
            scope,
            labelId,
            listId
          ),
          whatsappLiveState(),
          listWhatsAppLabels(),
          listCrmWhatsAppLists(),
          whatsappOrganizerState()
        ]);

        const liveState =
          liveStateResult.rows[0] || {};

        const conversationRows =
          Array.isArray(listResult?.rows)
            ? listResult.rows
            : [];

        let selectedClientId = requestedClientId;

        /*
         * Selecția trebuie să aparțină filtrului curent.
         * Pentru o listă goală nu încărcăm niciun client.
         */
        if (!conversationRows.length) {
          selectedClientId = null;
        } else {
          const selectedExists =
            selectedClientId &&
            conversationRows.some(row =>
              Number(row.client_id) ===
              Number(selectedClientId)
            );

          if (!selectedExists) {
            selectedClientId = Number(
              conversationRows[0].client_id
            );
          }
        }

        let client = null;
        let messages = [];

        if (selectedClientId) {
          const detailsResult = await clientDetails(
            selectedClientId
          );

          if (detailsResult.rowCount) {
            const organizer =
              await getWhatsAppOrganizerForClient(
                selectedClientId
              );

            client = {
              ...detailsResult.rows[0],
              ...organizer
            };

            await query(`
              UPDATE crm.conversatii
              SET este_citit = TRUE
              WHERE client_id = $1
                AND directie = 'incoming'
                AND este_citit = FALSE
            `, [selectedClientId]);

            const messagesResult = await clientMessages(
              selectedClientId
            );

            messages = messagesResult.rows;
          }
        }

        res.render('conversatii', {
            noteSaved: req.query.note_saved === '1',
          
            readAll: req.query.read_all === '1',
          rows: conversationRows,
          currentClient: client,
          messages,
          selectedClientId,
          q,
          scope,
          labelId,
          listId,
          allLabels,
          allCrmLists,
          organizerSaved:
            req.query.organizer_saved === '1',
          sent: req.query.sent === '1',
          errorCode: String(req.query.error || ''),
          latestMessageId: Number(
            liveState.latest_message_id || 0
          ),
          messageTotal: Number(
            liveState.message_total || 0
          ),
          syncRevision: Number(
            organizerState.revision || 0
          ),
          active: 'conversatii'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/conversatii/:clientId/notite',
    requireAuth,
    async (req, res, next) => {
      try {
        const clientId = integerId(req.params.clientId);
        const q = searchText(req.body.q);
        const notes = String(
          req.body.notite_whatsapp || ''
        )
          .trim()
          .slice(0, 4000);

        if (!clientId) {
          return res.status(400).render('error', {
            message: 'Clientul selectat nu este valid.',
            active: 'conversatii'
          });
        }

        const result = await query(`
          UPDATE crm.clienti
          SET
            notite_whatsapp = NULLIF($2, ''),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING id
        `, [clientId, notes]);

        if (!result.rowCount) {
          return res.status(404).render('error', {
            message: 'Clientul nu a fost găsit.',
            active: 'conversatii'
          });
        }

        const params = new URLSearchParams({
          client: String(clientId),
          note_saved: '1'
        });

        if (q) {
          params.set('q', q);
        }

        return res.redirect(
          `/conversatii?${params.toString()}`
        );
      } catch (error) {
        next(error);
      }
    }
  );


  app.post(
    '/conversatii/:clientId/arhivare-locala',
    requireAuth,
    async (req, res, next) => {
      try {
        const clientId = integerId(
          req.params.clientId
        );

        if (!clientId) {
          return res.status(400).send(
            'Client nevalid'
          );
        }

        const archived =
          String(req.body.archived || '') === '1';

        await setLocalConversationArchived(
          clientId,
          archived
        );

        return res.redirect(
          buildWhatsAppOrganizerUrl({
            q: searchText(req.body.q),
            scope: normalizeConversationScope(
              req.body.scope
            ),
            labelId: normalizeWhatsAppLabelId(
              req.body.label
            ),
            listId: normalizeCrmListId(
              req.body.list
            ),
            saved: true
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/conversatii/:clientId/eticheta-adauga',
    requireAuth,
    async (req, res, next) => {
      try {
        const clientId = integerId(
          req.params.clientId
        );

        if (!clientId) {
          return res.status(400).send(
            'Client nevalid'
          );
        }

        await addLocalConversationLabel(
          clientId,
          req.body.label_id
        );

        return res.redirect(
          buildWhatsAppOrganizerUrl({
            clientId,
            q: searchText(req.body.q),
            scope: normalizeConversationScope(
              req.body.scope
            ),
            labelId: normalizeWhatsAppLabelId(
              req.body.label
            ),
            listId: normalizeCrmListId(
              req.body.list
            ),
            saved: true
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/conversatii/:clientId/eticheta-elimina',
    requireAuth,
    async (req, res, next) => {
      try {
        const clientId = integerId(
          req.params.clientId
        );

        if (!clientId) {
          return res.status(400).send(
            'Client nevalid'
          );
        }

        await removeLocalConversationLabel(
          clientId,
          req.body.label_id
        );

        return res.redirect(
          buildWhatsAppOrganizerUrl({
            clientId,
            q: searchText(req.body.q),
            scope: normalizeConversationScope(
              req.body.scope
            ),
            labelId: normalizeWhatsAppLabelId(
              req.body.label
            ),
            listId: normalizeCrmListId(
              req.body.list
            ),
            saved: true
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );


  app.post(
    '/conversatii/liste-creeaza',
    requireAuth,
    async (req, res, next) => {
      try {
        const clientId = integerId(
          req.body.client_id
        );

        const list = await createCrmWhatsAppList(
          req.body.name
        );

        if (clientId) {
          await addClientToCrmWhatsAppList(
            clientId,
            list.id
          );
        }

        return res.redirect(
          buildWhatsAppOrganizerUrl({
            clientId,
            q: searchText(req.body.q),
            scope: normalizeConversationScope(
              req.body.scope
            ),
            labelId: normalizeWhatsAppLabelId(
              req.body.label
            ),
            listId: normalizeCrmListId(
              req.body.list
            ),
            saved: true
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/conversatii/:clientId/lista-adauga',
    requireAuth,
    async (req, res, next) => {
      try {
        const clientId = integerId(
          req.params.clientId
        );

        if (!clientId) {
          return res.status(400).send(
            'Client nevalid'
          );
        }

        await addClientToCrmWhatsAppList(
          clientId,
          req.body.list_id
        );

        return res.redirect(
          buildWhatsAppOrganizerUrl({
            clientId,
            q: searchText(req.body.q),
            scope: normalizeConversationScope(
              req.body.scope
            ),
            labelId: normalizeWhatsAppLabelId(
              req.body.label
            ),
            listId: normalizeCrmListId(
              req.body.list
            ),
            saved: true
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/conversatii/:clientId/lista-elimina',
    requireAuth,
    async (req, res, next) => {
      try {
        const clientId = integerId(
          req.params.clientId
        );

        if (!clientId) {
          return res.status(400).send(
            'Client nevalid'
          );
        }

        await removeClientFromCrmWhatsAppList(
          clientId,
          req.body.list_id
        );

        return res.redirect(
          buildWhatsAppOrganizerUrl({
            clientId,
            q: searchText(req.body.q),
            scope: normalizeConversationScope(
              req.body.scope
            ),
            labelId: normalizeWhatsAppLabelId(
              req.body.label
            ),
            listId: normalizeCrmListId(
              req.body.list
            ),
            saved: true
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/conversatii/avatar/:clientId',
    requireAuth,
    async (req, res, next) => {
      try {
        const clientId = integerId(
          req.params.clientId
        );

        if (!clientId) {
          return res.status(404).send(
            'Avatar inexistent'
          );
        }

        const result = await query(`
          SELECT
            file_path,
            content_type,
            status,
            updated_at
          FROM crm.whatsapp_profile_photos
          WHERE client_id = $1
            AND status = 'ok'
            AND file_path IS NOT NULL
          LIMIT 1
        `, [clientId]);

        if (!result.rowCount) {
          return res.status(404).send(
            'Avatar inexistent'
          );
        }

        const record = result.rows[0];
        const filePath = absoluteProfilePhotoPath(
          record.file_path
        );

        if (!filePath) {
          return res.status(404).send(
            'Avatar inexistent'
          );
        }

        await fs.access(filePath);

        res.type(
          record.content_type ||
          'image/jpeg'
        );

        res.set(
          'Cache-Control',
          'private, max-age=86400'
        );

        res.set(
          'X-Content-Type-Options',
          'nosniff'
        );

        return res.sendFile(filePath);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return res.status(404).send(
            'Avatar inexistent'
          );
        }

        next(error);
      }
    }
  );

  app.get(
    '/conversatii/media/:conversationId',
    requireAuth,
    async (req, res, next) => {
      try {
        const conversationId = integerId(
          req.params.conversationId
        );

        if (!conversationId) {
          return res.status(404).send(
            'Fișier inexistent'
          );
        }

        const result = await query(`
          SELECT
            tip,
            media_url
          FROM crm.conversatii
          WHERE id = $1
            AND media_url IS NOT NULL
          LIMIT 1
        `, [conversationId]);

        if (!result.rowCount) {
          return res.status(404).send(
            'Fișier inexistent'
          );
        }

        const record = result.rows[0];
        const filePath = absoluteWhatsAppMediaPath(
          record.media_url
        );

        if (!filePath) {
          return res.status(404).send(
            'Fișier inexistent'
          );
        }

        await fs.access(filePath);

        const fileName = whatsappMediaDownloadName(
          record.media_url
        );

        res.type(
          whatsappMediaContentType(record.media_url)
        );

        res.set(
          'Cache-Control',
          'private, max-age=3600'
        );

        res.set(
          'X-Content-Type-Options',
          'nosniff'
        );

        if (record.tip === 'document') {
          return res.download(filePath, fileName);
        }

        res.set(
          'Content-Disposition',
          `inline; filename="${path.basename(fileName)
            .replace(/["\\]/g, '_')}"`
        );

        return res.sendFile(filePath);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return res.status(404).send(
            'Fișier inexistent'
          );
        }

        next(error);
      }
    }
  );

  app.post(
    '/conversatii/:clientId/trimite-media',
    requireAuth,
    express.raw({
      type: 'application/octet-stream',
      limit: '50mb'
    }),
    async (req, res) => {
      const clientId = integerId(req.params.clientId);
      const q = String(req.query.q || '').trim();

      try {
        if (!clientId) {
          return res.status(404).json({
            ok: false,
            error: 'Client inexistent'
          });
        }

        const clientResult = await query(`
          SELECT id, telefon
          FROM crm.clienti
          WHERE id = $1
        `, [clientId]);

        if (!clientResult.rowCount) {
          return res.status(404).json({
            ok: false,
            error: 'Client inexistent'
          });
        }

        const client = clientResult.rows[0];

        if (!client.telefon) {
          return res.status(400).json({
            ok: false,
            error: 'Clientul nu are număr de telefon.'
          });
        }

        const mime = normalizedMime(
          req.get('X-Mozy-Mimetype')
        );

        const settings = outgoingMediaTypes[mime];

        if (!settings) {
          return res.status(415).json({
            ok: false,
            error: 'Tipul fișierului nu este permis.'
          });
        }

        const bytes = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(req.body || '');

        if (!bytes.length) {
          return res.status(400).json({
            ok: false,
            error: 'Fișierul este gol.'
          });
        }

        if (bytes.length > settings.limit) {
          return res.status(413).json({
            ok: false,
            error: 'Fișierul depășește dimensiunea permisă.'
          });
        }

        const fileName = safeUploadName(
          decodeURIComponent(
            String(req.get('X-Mozy-Filename') || '')
          ),
          settings.extension
        );

        const caption = decodeURIComponent(
          String(req.get('X-Mozy-Caption') || '')
        ).trim().slice(0, 1024);

        const sent = await sendWhatsAppMedia({
          number: client.telefon,
          bytes,
          mimetype: mime,
          mediaType: settings.type,
          fileName,
          caption
        });

        const storedName = [
          sent?.messageId || `crm-${crypto.randomUUID()}`,
          '-',
          crypto.randomUUID(),
          '-',
          fileName
        ].join('');

        const relativePath =
          `whatsapp-media/${storedName}`;

        const finalPath = absoluteWhatsAppMediaPath(
          relativePath
        );

        if (!finalPath) {
          throw new Error(
            'Calea locală pentru media nu este validă.'
          );
        }

        await fs.mkdir(path.dirname(finalPath), {
          recursive: true,
          mode: 0o750
        });

        await fs.writeFile(finalPath, bytes, {
          mode: 0o640,
          flag: 'wx'
        });

        const evolutionMessageId = safeMessageId(
          sent?.messageId
        );

        const localMessageId =
          evolutionMessageId ||
          `crm-${crypto.randomUUID()}`;

        const inserted = await query(`
          INSERT INTO crm.conversatii (
            client_id,
            directie,
            tip,
            mesaj,
            media_url,
            message_id,
            este_citit,
            necesita_raspuns,
            alerta_trimisa,
            created_at
          )
          VALUES (
            $1,
            'outgoing',
            $2,
            NULLIF($3, ''),
            $4,
            $5,
            TRUE,
            FALSE,
            FALSE,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (message_id)
          DO UPDATE SET
            tip = EXCLUDED.tip,
            mesaj = COALESCE(
              NULLIF(EXCLUDED.mesaj, ''),
              crm.conversatii.mesaj
            ),
            media_url = EXCLUDED.media_url,
            este_citit = TRUE,
            necesita_raspuns = FALSE,
            alerta_trimisa = FALSE
          RETURNING id
        `, [
          clientId,
          settings.type,
          caption,
          relativePath,
          localMessageId
        ]);

        await query(`
          UPDATE crm.conversatii
          SET
            necesita_raspuns = FALSE,
            alerta_trimisa = FALSE,
            este_citit = TRUE
          WHERE client_id = $1
            AND directie = 'incoming'
        `, [clientId]);

        return res.status(201).json({
          ok: true,
          conversationId: inserted.rows[0].id,
          redirect: redirectUrl({
            clientId,
            q,
            sent: '1'
          })
        });
      } catch (error) {
        console.error(
          'Eroare trimitere media WhatsApp CRM:',
          error
        );

        return res.status(500).json({
          ok: false,
          error: String(
            error?.message ||
            'Fișierul nu a putut fi trimis.'
          ).slice(0, 500)
        });
      }
    }
  );

  app.post(
    '/conversatii/:clientId/trimite',
    requireAuth,
    async (req, res, next) => {
      const clientId = integerId(
        req.params.clientId
      );

      const q = searchText(req.body.q);
      const text = messageText(req.body.mesaj);

      if (!clientId) {
        return res.status(404).send(
          'Client inexistent'
        );
      }

      if (!text) {
        return res.redirect(
          redirectUrl({
            clientId,
            q,
            error: 'mesaj_invalid'
          })
        );
      }

      try {
        const clientResult = await query(`
          SELECT id, telefon
          FROM crm.clienti
          WHERE id = $1
        `, [clientId]);

        if (!clientResult.rowCount) {
          return res.status(404).send(
            'Client inexistent'
          );
        }

        const client = clientResult.rows[0];

        if (!client.telefon) {
          return res.redirect(
            redirectUrl({
              clientId,
              q,
              error: 'telefon_lipsa'
            })
          );
        }

        const sent = await sendWhatsAppText({
          number: client.telefon,
          text
        });

        const evolutionMessageId = safeMessageId(
          sent?.messageId
        );

        /*
         * Salvăm imediat mesajul pentru ca operatorul să îl vadă.
         * Când Evolution furnizează ID, protecția UNIQUE previne
         * dublarea la procesarea ulterioară a webhook-ului.
         */
        if (evolutionMessageId) {
          await query(`
            INSERT INTO crm.conversatii (
              client_id,
              directie,
              tip,
              mesaj,
              message_id,
              este_citit,
              necesita_raspuns,
              alerta_trimisa,
              created_at
            )
            VALUES (
              $1,
              'outgoing',
              'text',
              $2,
              $3,
              TRUE,
              FALSE,
              FALSE,
              CURRENT_TIMESTAMP
            )
            ON CONFLICT (message_id)
            DO NOTHING
          `, [
            clientId,
            text,
            evolutionMessageId
          ]);
        } else {
          /*
           * ID local temporar. Prefixul îl separă de ID-urile
           * Evolution și evită coliziunile.
           */
          await query(`
            INSERT INTO crm.conversatii (
              client_id,
              directie,
              tip,
              mesaj,
              message_id,
              este_citit,
              necesita_raspuns,
              alerta_trimisa,
              created_at
            )
            VALUES (
              $1,
              'outgoing',
              'text',
              $2,
              $3,
              TRUE,
              FALSE,
              FALSE,
              CURRENT_TIMESTAMP
            )
          `, [
            clientId,
            text,
            `crm-${crypto.randomUUID()}`
          ]);
        }

        await query(`
          UPDATE crm.conversatii
          SET
            necesita_raspuns = FALSE,
            alerta_trimisa = FALSE,
            este_citit = TRUE
          WHERE client_id = $1
            AND directie = 'incoming'
        `, [clientId]);

        return res.redirect(
          redirectUrl({
            clientId,
            q,
            sent: '1'
          })
        );
      } catch (error) {
        console.error(
          'Eroare trimitere WhatsApp CRM:',
          error
        );

        return res.redirect(
          redirectUrl({
            clientId,
            q,
            error: 'trimitere'
          })
        );
      }
    }
  );
}
