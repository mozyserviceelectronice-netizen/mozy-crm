import { pool } from './db.js';
import { sendWhatsAppText } from './evolution-whatsapp.js';

const ADVISORY_LOCK_ID = 728451907;
const alertThresholds = [3, 5, 6, 7];

function receptionAlertRecipients() {
  const configured = process.env.RECEPTION_ALERT_WHATSAPP_NUMBERS ||
    process.env.RECEPTION_ALERT_WHATSAPP_NUMBER ||
    '40771559501,40721341491';

  return [...new Set(
    configured
      .split(',')
      .map((number) => number.replace(/\D/g, ''))
      .filter((number) => /^\d{8,15}$/.test(number))
  )];
}

function alertMessage(reception, day) {
  const number = reception.numar_receptie || `#${reception.id}`;
  const equipment = [
    reception.tip_echipament,
    reception.marca,
    reception.model
  ].filter(Boolean).join(' ');
  const details = equipment ? ` – ${equipment}` : '';
  const messages = {
    3:
      `ATENȚIONARE – Ziua 3\nFișa ${number}${details} nu este finalizată. Verifică stadiul lucrării și actualizează statusul dacă este necesar.`,
    5:
      `ALERTĂ – Ziua 5\nFișa ${number}${details} nu este finalizată. Au rămas maximum 2 zile până la termenul intern. Este necesară prioritizarea lucrării.`,
    6:
      `ALERTĂ URGENTĂ – Ziua 6\nFișa ${number}${details} nu este finalizată. Termenul intern expiră mâine. Verifică și soluționează cu prioritate.`,
    7:
      `ALERTĂ CRITICĂ – Ziua 7\nFișa ${number}${details} trebuie să aibă statusul FINALIZAT astăzi. Termenul intern maxim a fost atins. Este necesară intervenție imediată.`
  };

  return messages[day];
}

function errorMessage(error) {
  return String(
    error?.response?.data?.message ||
    error?.message ||
    'Eroare WhatsApp necunoscută'
  ).slice(0, 1000);
}

export async function processReceptionDeadlineAlerts() {
  const database = await pool.connect();
  let lockAcquired = false;

  try {
    const lock = await database.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [ADVISORY_LOCK_ID]
    );
    lockAcquired = Boolean(lock.rows[0]?.acquired);

    if (!lockAcquired) {
      return;
    }

    const candidates = await database.query(`
      SELECT
        r.id,
        r.numar_receptie,
        r.data_primire,
        r.status,
        (
          (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bucharest')::date -
          r.data_primire
        )::integer AS zile,
        e.tip_echipament,
        e.marca,
        e.model
      FROM crm.receptii_atelier r
      JOIN crm.echipamente_atelier e ON e.id = r.echipament_id
      WHERE r.alerte_active = TRUE
        AND r.este_test = FALSE
        AND r.status NOT IN ('finalizat', 'predat', 'anulat')
        AND (
          (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bucharest')::date -
          r.data_primire
        )::integer = ANY($1::integer[])
        AND NOT EXISTS (
          SELECT 1
          FROM crm.receptie_alerte_termen a
          WHERE a.receptie_id = r.id
            AND a.prag_zile =
              (
                (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bucharest')::date -
                r.data_primire
              )::integer
            AND a.trimisa_la IS NOT NULL
        )
      ORDER BY r.id
    `, [alertThresholds]);

    const recipients = receptionAlertRecipients();
    if (recipients.length === 0) {
      throw new Error('Nu este configurat niciun destinatar valid pentru alertele de recepție');
    }

    for (const reception of candidates.rows) {
      const day = Number(reception.zile);

      try {
        const sentMessages = [];
        for (const number of recipients) {
          const sent = await sendWhatsAppText({
            number,
            text: alertMessage(reception, day)
          });
          sentMessages.push(sent.messageId);
        }

        await database.query(`
          INSERT INTO crm.receptie_alerte_termen (
            receptie_id,
            prag_zile,
            trimisa_la,
            whatsapp_message_id,
            ultima_eroare
          )
          VALUES ($1, $2, NOW(), $3, NULL)
          ON CONFLICT (receptie_id, prag_zile)
          DO UPDATE SET
            trimisa_la = EXCLUDED.trimisa_la,
            whatsapp_message_id = EXCLUDED.whatsapp_message_id,
            ultima_eroare = NULL,
            updated_at = NOW()
        `, [reception.id, day, sentMessages.join(',')]);
      } catch (error) {
        await database.query(`
          INSERT INTO crm.receptie_alerte_termen (
            receptie_id,
            prag_zile,
            ultima_incercare_la,
            ultima_eroare
          )
          VALUES ($1, $2, NOW(), $3)
          ON CONFLICT (receptie_id, prag_zile)
          DO UPDATE SET
            ultima_incercare_la = NOW(),
            ultima_eroare = EXCLUDED.ultima_eroare,
            updated_at = NOW()
        `, [reception.id, day, errorMessage(error)]);
      }
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: 'reception_deadline_alert_error',
      error_name: String(error?.name || 'Error'),
      message: String(error?.message || error).slice(0, 500)
    }));
  } finally {
    if (lockAcquired) {
      await database.query(
        'SELECT pg_advisory_unlock($1)',
        [ADVISORY_LOCK_ID]
      ).catch(() => {});
    }
    database.release();
  }
}
