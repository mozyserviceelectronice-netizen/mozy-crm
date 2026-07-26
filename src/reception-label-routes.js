import QRCode from 'qrcode';
import { query } from './db.js';

function publicBaseUrl() {
  return String(
    process.env.CRM_PUBLIC_URL ||
      'https://crm.reparatii-televizoare.com'
  ).replace(/\/+$/, '');
}

export function registerReceptionLabelRoutes(app, requireAuth) {
  app.get(
    '/receptie/:id/eticheta',
    requireAuth,
    async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(404).send('Recepție inexistentă');
        }

        const result = await query(`
          SELECT
            r.id,
            r.numar_receptie,
            r.data_primire,
            r.defect_reclamat,
            r.este_test,
            c.telefon,
            e.tip_echipament,
            e.marca,
            e.model
          FROM crm.receptii_atelier r
          JOIN crm.clienti c ON c.id = r.client_id
          JOIN crm.echipamente_atelier e ON e.id = r.echipament_id
          WHERE r.id = $1
          LIMIT 1
        `, [id]);

        if (!result.rowCount) {
          return res.status(404).send('Recepție inexistentă');
        }

        const reception = result.rows[0];
        const qrDataUrl = await QRCode.toDataURL(
          `${publicBaseUrl()}/receptie/${id}`,
          {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 320
          }
        );

        res.set('Cache-Control', 'private, no-store');
        res.render('receptie-eticheta', {
          reception,
          qrDataUrl
        });
      } catch (error) {
        next(error);
      }
    }
  );
}
