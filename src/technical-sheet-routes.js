import { query } from './db.js';

function money(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function text(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit);
}

export function registerTechnicalSheetRoutes(app, { requireAuth }) {
  app.get('/api/receptie/:id/fisa-tehnica', requireAuth, async (req, res, next) => {
    try {
      const receptieId = Number(req.params.id);
      if (!Number.isInteger(receptieId) || receptieId < 1) return res.status(404).json({ error: 'Recepție inexistentă.' });
      const sheet = await query(`
        SELECT ft.*, r.echipament_id
        FROM crm.fise_tehnice_interne ft
        JOIN crm.receptii_atelier r ON r.id = ft.receptie_id
        WHERE ft.receptie_id = $1
      `, [receptieId]);
      const reception = await query('SELECT echipament_id FROM crm.receptii_atelier WHERE id = $1', [receptieId]);
      if (!reception.rowCount) return res.status(404).json({ error: 'Recepție inexistentă.' });
      const parts = sheet.rowCount ? await query(`
        SELECT id, denumire, cod_piesa, cantitate, cost_unitar, cost_total
        FROM crm.fisa_tehnica_piese WHERE fisa_tehnica_id = $1 ORDER BY id
      `, [sheet.rows[0].id]) : { rows: [] };
      const history = await query(`
        SELECT ft.id, r.id AS receptie_id, r.numar_receptie, r.data_primire,
               ft.diagnostic, ft.defect_confirmat, ft.solutie_aplicata, ft.total_piese,
               ft.valoare_lucrare, ft.profit_brut
        FROM crm.fise_tehnice_interne ft
        JOIN crm.receptii_atelier r ON r.id = ft.receptie_id
        WHERE r.echipament_id = $1 AND r.id <> $2
        ORDER BY ft.updated_at DESC, ft.id DESC LIMIT 20
      `, [reception.rows[0].echipament_id, receptieId]);
      res.json({ sheet: sheet.rows[0] || null, parts: parts.rows, history: history.rows });
    } catch (error) { next(error); }
  });

  app.post('/receptie/:id/fisa-tehnica', requireAuth, async (req, res, next) => {
    try {
      const receptieId = Number(req.params.id);
      if (!Number.isInteger(receptieId) || receptieId < 1) return res.status(404).send('Recepție inexistentă');
      const reception = await query('SELECT id FROM crm.receptii_atelier WHERE id = $1', [receptieId]);
      if (!reception.rowCount) return res.status(404).send('Recepție inexistentă');
      const totalPiese = money(req.body.total_piese);
      const valoareLucrare = money(req.body.valoare_lucrare);
      const costDeplasare = money(req.body.cost_deplasare);
      const alteCosturi = money(req.body.alte_costuri);
      const profitBrut = valoareLucrare - totalPiese - costDeplasare - alteCosturi;
      await query(`
        INSERT INTO crm.fise_tehnice_interne (
          receptie_id, diagnostic, defect_confirmat, solutie_aplicata, coduri_placi,
          timp_lucru_minute, total_piese, valoare_lucrare, cost_deplasare, alte_costuri, profit_brut
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (receptie_id) DO UPDATE SET
          diagnostic = EXCLUDED.diagnostic, defect_confirmat = EXCLUDED.defect_confirmat,
          solutie_aplicata = EXCLUDED.solutie_aplicata, coduri_placi = EXCLUDED.coduri_placi,
          timp_lucru_minute = EXCLUDED.timp_lucru_minute, total_piese = EXCLUDED.total_piese,
          valoare_lucrare = EXCLUDED.valoare_lucrare, cost_deplasare = EXCLUDED.cost_deplasare,
          alte_costuri = EXCLUDED.alte_costuri, profit_brut = EXCLUDED.profit_brut, updated_at = NOW()
      `, [receptieId, text(req.body.diagnostic), text(req.body.defect_confirmat), text(req.body.solutie_aplicata), text(req.body.coduri_placi), Math.max(0, Math.floor(money(req.body.timp_lucru_minute))), totalPiese, valoareLucrare, costDeplasare, alteCosturi, profitBrut]);
      res.redirect(`/receptie/${receptieId}#fisa-tehnica-interna`);
    } catch (error) { next(error); }
  });
}
