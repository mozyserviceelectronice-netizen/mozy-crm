import crypto from 'node:crypto';
import { pool, query } from './db.js';
import { sendWhatsAppText } from './evolution-whatsapp.js';
import { technicianScheduleUrl } from './app-config.js';
import {
  maskPhoneNumber,
  scheduleRecipients,
  teamMemberForUsername,
  teamUserChoices,
  technicianTeam
} from './technician-team.js';
import {
  appointmentPreview,
  bucharestDate,
  calendarDays,
  dateShift,
  finalStatuses,
  formValues,
  formatDailySchedule,
  monthBounds,
  monthLabel,
  monthShift,
  nullIfEmpty,
  statusLabels,
  text,
  travelTypes,
  validDate,
  validTime,
  validateForm
} from './technician-schedule-domain.js';

function positiveInteger(value) {
  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0
    ? number
    : null;
}

function appointmentEndTime(startTime) {
  const value = String(startTime || '').slice(0, 5);

  if (!/^\\d{2}:\\d{2}$/.test(value)) {
    return '';
  }

  const [hours, minutes] = value
    .split(':')
    .map(Number);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return '';
  }

  const totalMinutes =
    ((hours * 60) + minutes + 60) % (24 * 60);

  return [
    String(Math.floor(totalMinutes / 60)).padStart(2, '0'),
    String(totalMinutes % 60).padStart(2, '0')
  ].join(':');
}

function draftObservations(draft) {
  const parts = [];

  if (draft.observatii) {
    parts.push(String(draft.observatii).trim());
  }

  parts.push(
    `Date propuse de AI din conversația WhatsApp. ` +
    `Verifică toate câmpurile înainte de salvare.`
  );

  if (draft.incredere !== null && draft.incredere !== undefined) {
    const confidence = Number(draft.incredere);

    if (Number.isFinite(confidence)) {
      parts.push(
        `Încredere AI: ${Math.round(confidence * 100)}%.`
      );
    }
  }

  return parts.filter(Boolean).join('\n');
}

async function whatsappAppointmentDraft(draftId) {
  if (!draftId) {
    return null;
  }

  const result = await query(`
    SELECT
      p.id,
      p.data_programare,
      p.ora_programare,
      p.adresa,
      p.defect_reclamat,
      p.marca,
      p.model,
      p.diagonala,
      p.observatii,
      p.status,
      p.incredere,
      wc.telefon,
      COALESCE(
        NULLIF(BTRIM(wc.nume), ''),
        NULLIF(BTRIM(c.nume), '')
      ) AS nume,
      c.adresa AS adresa_client
    FROM whatsapp.programari p
    JOIN whatsapp.contacte wc
      ON wc.id = p.contact_id
    LEFT JOIN crm.clienti c
      ON c.telefon = wc.telefon
    WHERE p.id = $1
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
    LIMIT 1
  `, [draftId]);

  return result.rows[0] || null;
}

const appointmentSelect = `
  SELECT
    p.*,
    c.telefon,
    c.nume,
    u.username AS tehnician_username,
    COALESCE(pr.preturi, '[]'::json) AS preturi
  FROM crm.programari_tehnician p
  JOIN crm.clienti c ON c.id = p.client_id
  LEFT JOIN crm.utilizatori u
    ON u.id = p.tehnician_user_id
  LEFT JOIN LATERAL (
    SELECT json_agg(
      json_build_object(
        'id', pp.id,
        'valoare', pp.valoare,
        'descriere', pp.descriere,
        'ordine', pp.ordine
      )
      ORDER BY pp.ordine, pp.id
    ) AS preturi
    FROM crm.programari_tehnician_preturi pp
    WHERE pp.programare_id = p.id
  ) pr ON TRUE
`;

function phoneHref(phone) {
  const normalized = text(phone).replace(/[^\d+]/g, '');
  return `tel:${normalized}`;
}

function mapsUrl(address) {
  return (
    'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(address)
  );
}

function wazeUrl(address) {
  return (
    'https://waze.com/ul?q=' +
    encodeURIComponent(address) +
    '&navigate=yes'
  );
}

function technicianDisplay(username) {
  return (
    teamMemberForUsername(username)?.name ||
    text(username) ||
    'Nealocat'
  );
}

function decorateAppointment(row) {
  const fullAddress = [row.adresa, row.oras]
    .filter(Boolean)
    .join(', ');
  return {
    ...row,
    fara_interval: Boolean(row.fara_interval),
    tehnician_display: technicianDisplay(
      row.tehnician_username
    ),
    phoneHref: phoneHref(row.telefon),
    mapsUrl: mapsUrl(fullAddress),
    wazeUrl: wazeUrl(fullAddress)
  };
}

function integerList(value, maximum = 100) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = [
    ...new Set(
      values
        .map(item => Number(item))
        .filter(item => Number.isInteger(item) && item > 0)
    )
  ];
  return normalized.slice(0, maximum);
}

function stringList(value) {
  return (Array.isArray(value) ? value : [value])
    .map(item => text(item))
    .filter(Boolean);
}

function scheduleListUrl(date, type = '', flag = '') {
  const params = new URLSearchParams({ data: date });
  if (travelTypes[type]) params.set('tip', type);
  if (flag) params.set(flag, '1');
  return `/tehnician/programari?${params.toString()}`;
}

async function activeTechnicianUsers() {
  const result = await query(`
    SELECT id, username
    FROM crm.utilizatori
    WHERE activ = TRUE
    ORDER BY LOWER(username), id
  `);
  return teamUserChoices(result.rows);
}

async function getAppointment(id) {
  const result = await query(`
    ${appointmentSelect}
    WHERE p.id = $1
    LIMIT 1
  `, [id]);
  return result.rows[0]
    ? decorateAppointment(result.rows[0])
    : null;
}

async function getAppointmentsForDate({
  date,
  type = '',
  ids = []
}) {
  const params = [date];
  const conditions = ['p.data_programare = $1::date'];

  if (travelTypes[type]) {
    params.push(type);
    conditions.push(`p.tip_deplasare = $${params.length}`);
  }
  if (ids.length) {
    params.push(ids);
    conditions.push(`p.id = ANY($${params.length}::bigint[])`);
  }

  const result = await query(`
    ${appointmentSelect}
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      p.fara_interval ASC,
      p.ora_programare NULLS LAST,
      p.ora_sfarsit NULLS LAST,
      p.id
  `, params);
  return result.rows.map(decorateAppointment);
}

async function loadSendHistory() {
  const operations = await query(`
    SELECT
      o.id,
      o.data_program,
      o.initiat_de_user_id,
      u.username AS initiator_username,
      o.status,
      o.dry_run,
      o.created_at,
      o.finalizat_la,
      o.numar_programari
    FROM crm.programari_tehnician_trimiteri o
    JOIN crm.utilizatori u ON u.id = o.initiat_de_user_id
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 12
  `);

  if (!operations.rowCount) return [];
  const ids = operations.rows.map(row => row.id);
  const recipients = await query(`
    SELECT
      operation_id,
      membru_nume,
      numar_normalizat,
      status,
      whatsapp_message_id,
      eroare_sigura,
      numar_incercari,
      trimis_la
    FROM crm.programari_tehnician_trimiteri_destinatari
    WHERE operation_id = ANY($1::bigint[])
    ORDER BY operation_id DESC, id
  `, [ids]);
  const byOperation = new Map();
  for (const recipient of recipients.rows) {
    const list = byOperation.get(recipient.operation_id) || [];
    list.push({
      ...recipient,
      numar_mascat: maskPhoneNumber(
        recipient.numar_normalizat
      )
    });
    byOperation.set(recipient.operation_id, list);
  }

  return operations.rows.map(operation => ({
    ...operation,
    initiator_display: technicianDisplay(
      operation.initiator_username
    ),
    recipients: byOperation.get(operation.id) || []
  }));
}

function safeSendError(error) {
  const message = text(error?.message)
    .replace(/https?:\/\/\S+/gi, '[adresă eliminată]')
    .replace(/(?:api[_ -]?key|token|secret)\s*[:=]\s*\S+/gi, '[secret eliminat]');
  return (
    message.slice(0, 500) ||
    'Trimiterea WhatsApp a eșuat.'
  );
}

async function operationResult(operationId) {
  const operation = await query(`
    SELECT
      id,
      data_program,
      status,
      dry_run,
      numar_programari,
      created_at,
      finalizat_la
    FROM crm.programari_tehnician_trimiteri
    WHERE id = $1
  `, [operationId]);
  const recipients = await query(`
    SELECT
      id,
      membru_cod,
      membru_nume,
      numar_normalizat,
      status,
      whatsapp_message_id,
      eroare_sigura,
      numar_incercari,
      trimis_la
    FROM crm.programari_tehnician_trimiteri_destinatari
    WHERE operation_id = $1
    ORDER BY id
  `, [operationId]);

  return {
    ...operation.rows[0],
    recipients: recipients.rows.map(recipient => ({
      ...recipient,
      numar_mascat: maskPhoneNumber(
        recipient.numar_normalizat
      ),
      numar_normalizat: undefined
    }))
  };
}

async function finalizeOperation(operationId) {
  await query(`
    UPDATE crm.programari_tehnician_trimiteri o
    SET
      status = CASE
        WHEN stats.total = stats.trimise THEN 'trimis'
        WHEN stats.trimise > 0 AND stats.esuate > 0 THEN 'partial'
        WHEN stats.esuate = stats.total THEN 'esuat'
        ELSE 'in_curs'
      END,
      finalizat_la = CASE
        WHEN stats.in_curs = 0 THEN NOW()
        ELSE NULL
      END,
      updated_at = NOW()
    FROM (
      SELECT
        operation_id,
        COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE status = 'trimis')::integer AS trimise,
        COUNT(*) FILTER (WHERE status = 'esuat')::integer AS esuate,
        COUNT(*) FILTER (
          WHERE status IN ('pending', 'in_curs')
        )::integer AS in_curs
      FROM crm.programari_tehnician_trimiteri_destinatari
      WHERE operation_id = $1
      GROUP BY operation_id
    ) stats
    WHERE o.id = stats.operation_id
  `, [operationId]);
}

async function sendOperationRecipients({
  operationId,
  message,
  eligibleStatuses
}) {
  const claimed = await query(`
    UPDATE crm.programari_tehnician_trimiteri_destinatari
    SET
      status = 'in_curs',
      numar_incercari = numar_incercari + 1,
      ultima_incercare_la = NOW(),
      eroare_sigura = NULL,
      updated_at = NOW()
    WHERE operation_id = $1
      AND status = ANY($2::text[])
    RETURNING *
  `, [operationId, eligibleStatuses]);

  const dryRun =
    process.env.TECHNICIAN_SCHEDULE_DRY_RUN === '1';

  for (const recipient of claimed.rows) {
    let status = 'trimis';
    let messageId = null;
    let safeError = null;
    try {
      const result = dryRun
        ? { messageId: `dry-run-${crypto.randomUUID()}` }
        : await sendWhatsAppText({
            number: recipient.numar_normalizat,
            text: message
          });
      messageId = result.messageId;
    } catch (error) {
      status = 'esuat';
      safeError = safeSendError(error);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        UPDATE crm.programari_tehnician_trimiteri_destinatari
        SET
          status = $2::varchar(20),
          whatsapp_message_id = $3,
          eroare_sigura = $4,
          trimis_la = CASE
            WHEN $2::text = 'trimis' THEN NOW()
            ELSE NULL
          END,
          updated_at = NOW()
        WHERE id = $1
      `, [recipient.id, status, messageId, safeError]);
      await client.query(`
        INSERT INTO crm.programari_tehnician_trimiteri_incercari (
          destinatar_id,
          numar_incercare,
          status,
          whatsapp_message_id,
          eroare_sigura
        )
        VALUES ($1, $2, $3, $4, $5)
      `, [
        recipient.id,
        recipient.numar_incercari,
        status,
        messageId,
        safeError
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await finalizeOperation(operationId);
  return operationResult(operationId);
}

async function savePrices(client, appointmentId, prices) {
  await client.query(`
    DELETE FROM crm.programari_tehnician_preturi
    WHERE programare_id = $1
  `, [appointmentId]);
  for (let index = 0; index < prices.length; index += 1) {
    const price = prices[index];
    await client.query(`
      INSERT INTO crm.programari_tehnician_preturi (
        programare_id,
        valoare,
        descriere,
        ordine
      )
      VALUES ($1, $2, $3, $4)
    `, [
      appointmentId,
      price.amount,
      nullIfEmpty(price.description),
      index
    ]);
  }
}

async function renderAppointmentForm({
  req,
  res,
  values,
  errors = [],
  mode = 'create',
  appointmentId = null,
  status = 200
}) {
  const technicians = await activeTechnicianUsers();
  return res.status(status).render(
    'tehnician-programare-noua',
    {
      user: req.user,
      active: 'programari-tehnician',
      values,
      travelTypes,
      technicians,
      errors,
      mode,
      appointmentId
    }
  );
}

export function registerTechnicianScheduleRoutes(
  app,
  requireAuth
) {
  app.get('/tehnician', requireAuth, (_req, res) => {
    res.redirect('/teren');
  });

  app.get(
    '/tehnician/programari',
    requireAuth,
    async (req, res, next) => {
      try {
        const today = bucharestDate();
        const requestedDate = text(req.query.data);
        const selectedDate = validDate(requestedDate)
          ? requestedDate
          : today;
        const selectedType = travelTypes[text(req.query.tip)]
          ? text(req.query.tip)
          : '';
        const bounds = monthBounds(selectedDate);
        const [appointments, monthlyCounts, sendHistory] =
          await Promise.all([
            getAppointmentsForDate({
              date: selectedDate,
              type: selectedType
            }),
            query(`
              SELECT
                data_programare::text AS data,
                COUNT(*)::integer AS total
              FROM crm.programari_tehnician
              WHERE data_programare >= $1::date
                AND data_programare < $2::date
              GROUP BY data_programare
            `, [bounds.start, bounds.end]),
            loadSendHistory()
          ]);
        const countMap = new Map(
          monthlyCounts.rows.map(row => [row.data, row.total])
        );

        res.render('tehnician-programari', {
          user: req.user,
          active: 'programari-tehnician',
          appointments,
          travelTypes,
          statusLabels,
          selectedDate,
          selectedType,
          today,
          previousDay: dateShift(selectedDate, -1),
          nextDay: dateShift(selectedDate, 1),
          previousMonth: monthShift(selectedDate, -1),
          nextMonth: monthShift(selectedDate, 1),
          monthLabel: monthLabel(selectedDate),
          calendarDays: calendarDays(
            selectedDate,
            countMap,
            today
          ),
          sendHistory,
          senderMember: teamMemberForUsername(req.user.username),
          created: req.query.created === '1',
          updated: req.query.updated === '1',
          deleted: req.query.deleted === '1'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/tehnician/programari/trimitere/preview',
    requireAuth,
    async (req, res, next) => {
      try {
        const date = text(req.query.data);
        if (!validDate(date)) {
          return res.status(400).json({
            error: 'Data programului nu este validă.'
          });
        }
        const selectedIds = integerList(req.query.appointment_ids);
        const type =
          req.query.only_current_filter === '1' &&
          travelTypes[text(req.query.tip)]
            ? text(req.query.tip)
            : '';
        const appointments =
          req.query.selection_present === '1' &&
          !selectedIds.length
            ? []
            : await getAppointmentsForDate({
                date,
                type,
                ids: selectedIds
              });
        const recipients = scheduleRecipients({
          senderUsername: req.user.username,
          selectedMemberCodes: stringList(
            req.query.recipient_members
          )
        });
        const crmUrl = technicianScheduleUrl(date);
        let message = '';
        let messageError = null;
        if (appointments.length) {
          try {
            message = formatDailySchedule({
              date,
              appointments,
              crmUrl
            });
          } catch (error) {
            messageError = safeSendError(error);
          }
        }

        return res.json({
          sender: {
            name:
              recipients.sender?.name ||
              technicianDisplay(req.user.username),
            associated: Boolean(recipients.sender)
          },
          date,
          crmUrl,
          count: appointments.length,
          technicians: [
            ...new Set(
              appointments.map(row => row.tehnician_display)
            )
          ],
          appointments: appointments.map(row => ({
            ...appointmentPreview(row),
            technicianCode:
              teamMemberForUsername(
                row.tehnician_username
              )?.code || `user-${row.tehnician_user_id || 'none'}`
          })),
          recipients: recipients.recipients.map(recipient => ({
            memberCode: recipient.memberCode,
            memberName: recipient.memberName,
            maskedNumber: maskPhoneNumber(recipient.number)
          })),
          availableRecipientMembers: recipients.sender
            ? []
            : technicianTeam().map(member => ({
                code: member.code,
                name: member.name,
                numbers: member.numbers.map(maskPhoneNumber)
              })),
          message,
          messageError
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/tehnician/programari/trimitere',
    requireAuth,
    async (req, res, next) => {
      try {
        const date = text(req.body.data);
        const appointmentIds = integerList(
          req.body.appointment_ids
        );
        const idempotencyKey = text(req.body.idempotency_key);
        if (
          !validDate(date) ||
          !appointmentIds.length ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            idempotencyKey
          )
        ) {
          return res.status(400).json({
            error: 'Selecția pentru trimitere nu este validă.'
          });
        }

        const appointments = await getAppointmentsForDate({
          date,
          ids: appointmentIds
        });
        if (appointments.length !== appointmentIds.length) {
          return res.status(400).json({
            error:
              'Una sau mai multe programări nu mai aparțin datei selectate.'
          });
        }

        const recipientSelection = scheduleRecipients({
          senderUsername: req.user.username,
          selectedMemberCodes: stringList(
            req.body.recipient_members
          )
        });
        if (!recipientSelection.recipients.length) {
          return res.status(400).json({
            error: recipientSelection.sender
              ? 'Nu există destinatari configurați.'
              : 'Selectează cel puțin un membru al echipei.'
          });
        }

        const crmUrl = technicianScheduleUrl(date);
        const message = formatDailySchedule({
          date,
          appointments,
          crmUrl
        });
        const contentHash = crypto
          .createHash('sha256')
          .update(message, 'utf8')
          .digest('hex');
        const technicianNames = [
          ...new Set(
            appointments.map(row => row.tehnician_display)
          )
        ];
        const dryRun =
          process.env.TECHNICIAN_SCHEDULE_DRY_RUN === '1';

        const client = await pool.connect();
        let operationId;
        let created = false;
        try {
          await client.query('BEGIN');
          const operation = await client.query(`
            INSERT INTO crm.programari_tehnician_trimiteri (
              idempotency_key,
              data_program,
              initiat_de_user_id,
              expeditor_membru_cod,
              tehnicieni_inclusi,
              programare_ids,
              numar_programari,
              mesaj,
              continut_sha256,
              crm_url,
              status,
              dry_run
            )
            VALUES (
              $1::uuid, $2::date, $3, $4, $5::text[],
              $6::bigint[], $7, $8, $9, $10, 'in_curs', $11
            )
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id
          `, [
            idempotencyKey,
            date,
            req.user.id,
            recipientSelection.sender?.code || null,
            technicianNames,
            appointmentIds,
            appointments.length,
            message,
            contentHash,
            crmUrl,
            dryRun
          ]);

          if (operation.rowCount) {
            operationId = operation.rows[0].id;
            created = true;
            for (const recipient of recipientSelection.recipients) {
              await client.query(`
                INSERT INTO crm.programari_tehnician_trimiteri_destinatari (
                  operation_id,
                  membru_cod,
                  membru_nume,
                  numar_normalizat
                )
                VALUES ($1, $2, $3, $4)
              `, [
                operationId,
                recipient.memberCode,
                recipient.memberName,
                recipient.number
              ]);
            }
          } else {
            const existing = await client.query(`
              SELECT id, initiat_de_user_id
              FROM crm.programari_tehnician_trimiteri
              WHERE idempotency_key = $1::uuid
            `, [idempotencyKey]);
            if (
              !existing.rowCount ||
              Number(existing.rows[0].initiat_de_user_id) !==
                Number(req.user.id)
            ) {
              await client.query('ROLLBACK');
              return res.status(409).json({
                error: 'Cheia de trimitere a fost deja utilizată.'
              });
            }
            operationId = existing.rows[0].id;
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }

        if (!created) {
          return res.json({
            duplicatePrevented: true,
            operation: await operationResult(operationId)
          });
        }

        return res.json({
          duplicatePrevented: false,
          operation: await sendOperationRecipients({
            operationId,
            message,
            eligibleStatuses: ['pending']
          })
        });
      } catch (error) {
        if (
          error.message?.includes('depășește limita') ||
          error.message?.includes('Nu există programări')
        ) {
          return res.status(400).json({
            error: safeSendError(error)
          });
        }
        next(error);
      }
    }
  );

  app.post(
    '/tehnician/programari/trimitere/:id/retry',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({
            error: 'Operațiunea nu este validă.'
          });
        }
        const operation = await query(`
          SELECT id, mesaj
          FROM crm.programari_tehnician_trimiteri
          WHERE id = $1
            AND initiat_de_user_id = $2
        `, [id, req.user.id]);
        if (!operation.rowCount) {
          return res.status(404).json({
            error:
              'Operațiunea nu există sau nu a fost inițiată de acest utilizator.'
          });
        }
        return res.json({
          operation: await sendOperationRecipients({
            operationId: id,
            message: operation.rows[0].mesaj,
            eligibleStatuses: ['esuat']
          })
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/tehnician/programari/noua',
    requireAuth,
    async (req, res, next) => {
      try {
        const requestedDate = text(req.query.data);
        const whatsappDraftId = positiveInteger(
          req.query.whatsapp_draft
        );

        const draft = whatsappDraftId
          ? await whatsappAppointmentDraft(whatsappDraftId)
          : null;

        const draftDate = draft?.data_programare
          ? String(draft.data_programare).slice(0, 10)
          : '';

        const draftStartTime = draft?.ora_programare
          ? String(draft.ora_programare).slice(0, 5)
          : '';

        const draftAddress =
          text(draft?.adresa) ||
          text(draft?.adresa_client);

        const values = formValues({}, {
          whatsapp_draft_id: whatsappDraftId
            ? String(whatsappDraftId)
            : '',
          telefon: text(draft?.telefon),
          nume: text(draft?.nume),
          tehnician_user_id: req.user.id,
          tip_deplasare: 'ridicare',
          marca: text(draft?.marca),
          model: text(draft?.model),
          defect_reclamat: text(draft?.defect_reclamat),
          oras: 'București',
          adresa: draftAddress,
          data_programare: validDate(draftDate)
            ? draftDate
            : (
              validDate(requestedDate)
                ? requestedDate
                : bucharestDate()
            ),
          fara_interval: !draftStartTime,
          ora_programare: draftStartTime,
          ora_sfarsit: appointmentEndTime(draftStartTime),
          observatii: draft
            ? draftObservations(draft)
            : '',
          garantie_luni: '6',
          priceRows: [{ amount: '', description: '' }]
        });

        return renderAppointmentForm({
          req,
          res,
          values
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/tehnician/programari/noua',
    requireAuth,
    async (req, res, next) => {
      const values = formValues(req.body);
      const validation = validateForm(values);
      try {
        const technicians = await activeTechnicianUsers();
        if (!technicians.some(
          user => user.id === validation.technicianId
        )) {
          validation.errors.push(
            'Tehnicianul selectat nu este activ.'
          );
        }
        if (validation.errors.length) {
          return renderAppointmentForm({
            req,
            res,
            values,
            errors: validation.errors,
            status: 400
          });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const clientResult = await client.query(`
            INSERT INTO crm.clienti (telefon, nume)
            VALUES ($1, $2)
            ON CONFLICT (telefon)
            DO UPDATE SET
              nume = COALESCE(EXCLUDED.nume, crm.clienti.nume),
              updated_at = NOW()
            RETURNING id
          `, [values.telefon, nullIfEmpty(values.nume)]);
          const appointment = await client.query(`
            INSERT INTO crm.programari_tehnician (
              client_id,
              tehnician_user_id,
              creat_de_user_id,
              tip_deplasare,
              marca,
              model,
              defect_reclamat,
              oras,
              adresa,
              pret_reparatie,
              cost_deplasare,
              garantie_luni,
              conditii_comerciale,
              data_programare,
              fara_interval,
              ora_programare,
              ora_sfarsit,
              observatii
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9,
              $10, $11, $12, $13, $14::date, $15,
              $16::time, $17::time, $18
            )
            RETURNING id
          `, [
            clientResult.rows[0].id,
            validation.technicianId,
            req.user.id,
            values.tip_deplasare,
            values.marca,
            nullIfEmpty(values.model),
            values.defect_reclamat,
            values.oras,
            values.adresa,
            validation.primaryPrice,
            validation.cost,
            validation.warranty,
            nullIfEmpty(values.conditii_comerciale),
            values.data_programare,
            values.fara_interval,
            validation.startTime,
            validation.endTime,
            nullIfEmpty(values.observatii)
          ]);
          await savePrices(
            client,
            appointment.rows[0].id,
            validation.prices
          );

          const whatsappDraftId = positiveInteger(
            values.whatsapp_draft_id
          );

          if (whatsappDraftId) {
            const linkedDraft = await client.query(`
              UPDATE whatsapp.programari
              SET
                programare_tehnician_id = $2,
                consumata_la = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
                AND programare_tehnician_id IS NULL
                AND status <> 'anulata'
              RETURNING id
            `, [
              whatsappDraftId,
              appointment.rows[0].id
            ]);

            if (!linkedDraft.rowCount) {
              throw new Error(
                'Draftul WhatsApp nu există, este anulat ' +
                'sau a fost deja folosit.'
              );
            }
          }

          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        return res.redirect(
          scheduleListUrl(values.data_programare, '', 'created')
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/tehnician/programari/:id/editeaza',
    requireAuth,
    async (req, res, next) => {
      try {
        const appointment = await getAppointment(
          Number(req.params.id)
        );
        if (!appointment) {
          return res.status(404).render('error', {
            message: 'Programarea nu a fost găsită.',
            active: 'programari-tehnician'
          });
        }
        const values = formValues({}, {
          ...appointment,
          data_programare: String(
            appointment.data_programare
          ).slice(0, 10),
          ora_programare: text(
            appointment.ora_programare
          ).slice(0, 5),
          ora_sfarsit: text(appointment.ora_sfarsit).slice(0, 5),
          priceRows: appointment.preturi.map(price => ({
            amount: price.valoare,
            description: price.descriere
          }))
        });
        return renderAppointmentForm({
          req,
          res,
          values,
          mode: 'edit',
          appointmentId: appointment.id
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/tehnician/programari/:id/editeaza',
    requireAuth,
    async (req, res, next) => {
      const id = Number(req.params.id);
      const values = formValues(req.body);
      const validation = validateForm(values);
      try {
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).render('error', {
            message: 'Programarea selectată nu este validă.',
            active: 'programari-tehnician'
          });
        }
        const technicians = await activeTechnicianUsers();
        if (!technicians.some(
          user => user.id === validation.technicianId
        )) {
          validation.errors.push(
            'Tehnicianul selectat nu este activ.'
          );
        }
        if (validation.errors.length) {
          return renderAppointmentForm({
            req,
            res,
            values,
            errors: validation.errors,
            mode: 'edit',
            appointmentId: id,
            status: 400
          });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const previous = await client.query(`
            SELECT *
            FROM crm.programari_tehnician
            WHERE id = $1
            FOR UPDATE
          `, [id]);
          if (!previous.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).render('error', {
              message: 'Programarea nu a fost găsită.',
              active: 'programari-tehnician'
            });
          }
          const clientResult = await client.query(`
            INSERT INTO crm.clienti (telefon, nume)
            VALUES ($1, $2)
            ON CONFLICT (telefon)
            DO UPDATE SET
              nume = COALESCE(EXCLUDED.nume, crm.clienti.nume),
              updated_at = NOW()
            RETURNING id
          `, [values.telefon, nullIfEmpty(values.nume)]);
          const updated = await client.query(`
            UPDATE crm.programari_tehnician
            SET
              client_id = $2,
              tehnician_user_id = $3,
              tip_deplasare = $4,
              marca = $5,
              model = $6,
              defect_reclamat = $7,
              oras = $8,
              adresa = $9,
              pret_reparatie = $10,
              cost_deplasare = $11,
              garantie_luni = $12,
              conditii_comerciale = $13,
              data_programare = $14::date,
              fara_interval = $15,
              ora_programare = $16::time,
              ora_sfarsit = $17::time,
              observatii = $18,
              updated_at = NOW()
            WHERE id = $1
            RETURNING *
          `, [
            id,
            clientResult.rows[0].id,
            validation.technicianId,
            values.tip_deplasare,
            values.marca,
            nullIfEmpty(values.model),
            values.defect_reclamat,
            values.oras,
            values.adresa,
            validation.primaryPrice,
            validation.cost,
            validation.warranty,
            nullIfEmpty(values.conditii_comerciale),
            values.data_programare,
            values.fara_interval,
            validation.startTime,
            validation.endTime,
            nullIfEmpty(values.observatii)
          ]);
          await savePrices(client, id, validation.prices);
          const old = previous.rows[0];
          await client.query(`
            INSERT INTO crm.programari_tehnician_istoric (
              programare_id,
              status_vechi,
              status_nou,
              observatii,
              data_veche,
              data_noua,
              ora_veche,
              ora_noua,
              ora_sfarsit_veche,
              ora_sfarsit_noua,
              schimbat_de_user_id
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11
            )
          `, [
            id,
            old.status,
            updated.rows[0].status,
            'Editare completă programare',
            old.data_programare,
            updated.rows[0].data_programare,
            old.ora_programare,
            updated.rows[0].ora_programare,
            old.ora_sfarsit,
            updated.rows[0].ora_sfarsit,
            req.user.id
          ]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        return res.redirect(
          scheduleListUrl(values.data_programare, '', 'updated')
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/tehnician/programari/:id/status',
    requireAuth,
    async (req, res, next) => {
      const id = Number(req.params.id);
      const status = text(req.body.status);
      const observations = nullIfEmpty(req.body.observatii);
      const returnType = travelTypes[text(req.body.tip)]
        ? text(req.body.tip)
        : '';

      if (
        !Number.isInteger(id) ||
        id <= 0 ||
        !finalStatuses.has(status)
      ) {
        return res.status(400).render('error', {
          message: 'Actualizarea programării nu este validă.',
          active: 'programari-tehnician'
        });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const previous = await client.query(`
          SELECT *
          FROM crm.programari_tehnician
          WHERE id = $1
          FOR UPDATE
        `, [id]);
        if (!previous.rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).render('error', {
            message: 'Programarea nu a fost găsită.',
            active: 'programari-tehnician'
          });
        }

        const row = previous.rows[0];
        await client.query(`
          UPDATE crm.programari_tehnician
          SET
            status = $2,
            observatii = COALESCE($3, observatii),
            finalizat_la = NOW(),
            updated_at = NOW()
          WHERE id = $1
        `, [id, status, observations]);
        await client.query(`
          INSERT INTO crm.programari_tehnician_istoric (
            programare_id,
            status_vechi,
            status_nou,
            observatii,
            data_veche,
            data_noua,
            ora_veche,
            ora_noua,
            ora_sfarsit_veche,
            ora_sfarsit_noua,
            schimbat_de_user_id
          )
          VALUES (
            $1, $2, $3, $4, $5, $5, $6, $6, $7, $7, $8
          )
        `, [
          id,
          row.status,
          status,
          observations,
          row.data_programare,
          row.ora_programare,
          row.ora_sfarsit,
          req.user.id
        ]);
        await client.query('COMMIT');
        return res.redirect(
          scheduleListUrl(
            String(row.data_programare).slice(0, 10),
            returnType,
            'updated'
          )
        );
      } catch (error) {
        await client.query('ROLLBACK');
        next(error);
      } finally {
        client.release();
      }
    }
  );

  app.post(
    '/tehnician/programari/:id/amana',
    requireAuth,
    async (req, res, next) => {
      const id = Number(req.params.id);
      const newDate = text(req.body.data_noua);
      const noInterval = req.body.fara_interval_nou === '1';
      const newStartTime = noInterval
        ? null
        : text(req.body.ora_inceput_noua);
      const newEndTime = noInterval
        ? null
        : text(req.body.ora_sfarsit_noua);
      const observations = nullIfEmpty(
        req.body.observatii_amanare
      );
      const returnType = travelTypes[text(req.body.tip)]
        ? text(req.body.tip)
        : '';

      if (
        !Number.isInteger(id) ||
        id <= 0 ||
        !validDate(newDate) ||
        (!noInterval && (
          !validTime(newStartTime) ||
          !validTime(newEndTime) ||
          newEndTime <= newStartTime
        ))
      ) {
        return res.status(400).render('error', {
          message:
            'Pentru amânare sunt obligatorii noua dată și un interval valid sau opțiunea fără interval.',
          active: 'programari-tehnician'
        });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const previous = await client.query(`
          SELECT *
          FROM crm.programari_tehnician
          WHERE id = $1
          FOR UPDATE
        `, [id]);
        if (!previous.rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).render('error', {
            message: 'Programarea nu a fost găsită.',
            active: 'programari-tehnician'
          });
        }

        const row = previous.rows[0];
        await client.query(`
          UPDATE crm.programari_tehnician
          SET
            status = 'amanat',
            data_programare = $2::date,
            fara_interval = $3,
            ora_programare = $4::time,
            ora_sfarsit = $5::time,
            observatii = COALESCE($6, observatii),
            finalizat_la = NULL,
            updated_at = NOW()
          WHERE id = $1
        `, [
          id,
          newDate,
          noInterval,
          newStartTime,
          newEndTime,
          observations
        ]);
        await client.query(`
          INSERT INTO crm.programari_tehnician_istoric (
            programare_id,
            status_vechi,
            status_nou,
            observatii,
            data_veche,
            data_noua,
            ora_veche,
            ora_noua,
            ora_sfarsit_veche,
            ora_sfarsit_noua,
            schimbat_de_user_id
          )
          VALUES (
            $1, $2, 'amanat', $3, $4, $5,
            $6, $7, $8, $9, $10
          )
        `, [
          id,
          row.status,
          observations,
          row.data_programare,
          newDate,
          row.ora_programare,
          newStartTime,
          row.ora_sfarsit,
          newEndTime,
          req.user.id
        ]);
        await client.query('COMMIT');
        return res.redirect(
          scheduleListUrl(newDate, returnType, 'updated')
        );
      } catch (error) {
        await client.query('ROLLBACK');
        next(error);
      } finally {
        client.release();
      }
    }
  );

  app.post(
    '/tehnician/programari/:id/sterge',
    requireAuth,
    async (req, res, next) => {
      const id = Number(req.params.id);
      const returnType = travelTypes[text(req.body.tip)]
        ? text(req.body.tip)
        : '';
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).render('error', {
          message: 'Programarea selectată nu este validă.',
          active: 'programari-tehnician'
        });
      }

      try {
        const deleted = await query(`
          DELETE FROM crm.programari_tehnician
          WHERE id = $1
          RETURNING data_programare
        `, [id]);
        if (!deleted.rowCount) {
          return res.status(404).render('error', {
            message: 'Programarea nu a fost găsită.',
            active: 'programari-tehnician'
          });
        }
        return res.redirect(
          scheduleListUrl(
            String(
              deleted.rows[0].data_programare
            ).slice(0, 10),
            returnType,
            'deleted'
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/tehnician/programari/:id',
    requireAuth,
    async (req, res, next) => {
      try {
        const appointment = await getAppointment(
          Number(req.params.id)
        );
        if (!appointment) {
          return res.status(404).render('error', {
            message: 'Programarea nu a fost găsită.',
            active: 'programari-tehnician'
          });
        }
        return res.redirect(
          scheduleListUrl(
            String(
              appointment.data_programare
            ).slice(0, 10)
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );
}
