import { db } from '../config/database.js';

/**
 * Non-conformités structurées (M7-05) : rattachements (lot, fournisseur, ordre, inspection,
 * réclamation), cause du référentiel nc_causes, décision sur le lot, actions correctives et
 * préventives avec vérification d'efficacité, tableau de bord.
 * La décision « détruit » envoie le lot aux pertes au coût de revient ; « accepté » libère un
 * lot retenu ; « retour fournisseur » bloque le lot de matière (le retour lui-même passe par
 * le module Achats).
 */
export type LotDecision = 'accepte' | 'retouche' | 'declasse' | 'detruit' | 'retour_fournisseur';
export type NcDetails = {
  causeCode?: string | null; supplierId?: string | null; productLotId?: string | null; ingredientLotId?: string | null;
  planId?: string | null; complaintId?: string | null;
};
const DETAIL_COLUMNS: [keyof NcDetails, string][] = [
  ['causeCode', 'cause_code'], ['supplierId', 'supplier_id'], ['productLotId', 'product_lot_id'],
  ['ingredientLotId', 'ingredient_lot_id'], ['planId', 'plan_id'], ['complaintId', 'complaint_id'],
];

export const nonconformityRepository = {
  async get(id: string) {
    const nc = (await db.query(
      `SELECT nc.*, ce.label AS cause_label, s.name AS supplier_name, pl.lot_number AS product_lot_number, il.lot_number AS ingredient_lot_number
         FROM quality_nonconformities nc
         LEFT JOIN ref_entries ce ON ce.table_id = 'nc_causes' AND ce.code = nc.cause_code
         LEFT JOIN suppliers s ON s.id = nc.supplier_id
         LEFT JOIN product_lots pl ON pl.id = nc.product_lot_id
         LEFT JOIN ingredient_lots il ON il.id = nc.ingredient_lot_id
        WHERE nc.id = $1`, [id])).rows[0];
    if (!nc) return null;
    const actions = (await db.query(
      `SELECT a.*, u.first_name || ' ' || u.last_name AS responsible_name,
              (a.status <> 'faite' AND a.due_date IS NOT NULL AND a.due_date < CURRENT_DATE) AS overdue
         FROM quality_nc_actions a LEFT JOIN users u ON u.id = a.responsible_id WHERE a.nc_id = $1 ORDER BY a.created_at`, [id])).rows;
    return { ...nc, actions };
  },

  async setDetails(id: string, d: NcDetails) {
    const sets: string[] = []; const vals: unknown[] = [id];
    for (const [key, col] of DETAIL_COLUMNS) {
      if (d[key] !== undefined) { vals.push(d[key]); sets.push(`${col} = $${vals.length}`); }
    }
    if (d.causeCode) {
      const ok = (await db.query(`SELECT 1 FROM ref_entries WHERE table_id = 'nc_causes' AND code = $1 AND is_active`, [d.causeCode])).rows[0];
      if (!ok) throw Object.assign(new Error(`Cause inconnue : ${d.causeCode}`), { statusCode: 400 });
    }
    if (sets.length) await db.query(`UPDATE quality_nonconformities SET ${sets.join(', ')} WHERE id = $1`, vals);
    return this.get(id);
  },

  async decideLot(id: string, decision: LotDecision, userId: string, note?: string | null) {
    const nc = (await db.query(`SELECT id, product_lot_id, ingredient_lot_id, lot_decision, title FROM quality_nonconformities WHERE id = $1`, [id])).rows[0];
    if (!nc) throw Object.assign(new Error('Non-conformité introuvable'), { statusCode: 404 });
    if (!nc.product_lot_id && !nc.ingredient_lot_id) throw Object.assign(new Error('Aucun lot rattaché à cette non-conformité'), { statusCode: 400 });
    if (nc.lot_decision) throw Object.assign(new Error('Décision déjà prise sur ce lot'), { statusCode: 409 });
    const motif = `Non-conformité : ${nc.title}${note ? ` — ${note}` : ''}`;
    if (decision === 'detruit') {
      if (nc.product_lot_id) {
        const { productLotRepository } = await import('./product-lot.repository.js');
        await productLotRepository.sendToLosses(nc.product_lot_id, 'quarantine_failed', userId, motif);
      } else {
        const { ingredientLotRepository } = await import('./ingredient-lot.repository.js');
        await ingredientLotRepository.sendToLosses(nc.ingredient_lot_id, 'qualite_non_conforme', userId, motif);
      }
    } else if (decision === 'accepte' && nc.product_lot_id) {
      await db.query(
        `UPDATE product_lots SET status = 'active', released_by = $2, released_at = NOW(), release_note = $3, updated_at = NOW()
          WHERE id = $1 AND status = 'pending_release'`, [nc.product_lot_id, userId, `Accepté sur dérogation — ${motif}`]);
    } else if (decision === 'accepte' && nc.ingredient_lot_id) {
      await db.query(`UPDATE ingredient_lots SET status = 'active' WHERE id = $1 AND status IN ('blocked', 'quarantine')`, [nc.ingredient_lot_id]);
    } else if (decision === 'retour_fournisseur' && nc.ingredient_lot_id) {
      await db.query(`UPDATE ingredient_lots SET status = 'blocked' WHERE id = $1 AND status IN ('active', 'quarantine')`, [nc.ingredient_lot_id]);
    }
    await db.query(
      `UPDATE quality_nonconformities SET lot_decision = $2, lot_decided_by = $3, lot_decided_at = NOW() WHERE id = $1`, [id, decision, userId]);
    return this.get(id);
  },

  async addAction(ncId: string, a: { actionType: 'corrective' | 'preventive'; description: string; responsibleId?: string | null; dueDate?: string | null }, userId: string) {
    return (await db.query(
      `INSERT INTO quality_nc_actions (nc_id, action_type, description, responsible_id, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5::date, $6) RETURNING *`,
      [ncId, a.actionType, a.description.trim(), a.responsibleId ?? null, a.dueDate ?? null, userId])).rows[0];
  },

  async updateAction(actionId: string, a: { status?: 'a_faire' | 'en_cours' | 'faite'; effectivenessResult?: 'efficace' | 'inefficace' | null; effectivenessNote?: string | null }) {
    const cur = (await db.query(`SELECT * FROM quality_nc_actions WHERE id = $1`, [actionId])).rows[0];
    if (!cur) return null;
    if (a.effectivenessResult && (a.status ?? cur.status) !== 'faite') {
      throw Object.assign(new Error('L\'efficacité se vérifie sur une action faite'), { statusCode: 400 });
    }
    return (await db.query(
      `UPDATE quality_nc_actions SET status = $2::text,
              done_at = CASE WHEN $2::text = 'faite' THEN COALESCE(done_at, NOW()) ELSE NULL END,
              effectiveness_result = COALESCE($3::text, effectiveness_result),
              effectiveness_note = COALESCE($4::text, effectiveness_note),
              effectiveness_checked_at = CASE WHEN $3::text IS NOT NULL THEN CURRENT_DATE ELSE effectiveness_checked_at END
        WHERE id = $1 RETURNING *`,
      [actionId, a.status ?? cur.status, a.effectivenessResult ?? null, a.effectivenessNote ?? null])).rows[0];
  },

  /** Tableau de bord : par cause, par fournisseur, délai moyen de clôture, actions en retard. */
  async dashboard(storeId: string | null) {
    const scope = `($1::uuid IS NULL OR nc.store_id IS NULL OR nc.store_id = $1)`;
    const [byCause, bySupplier, totals, overdue] = await Promise.all([
      db.query(
        `SELECT COALESCE(ce.label, 'Non renseignée') AS label, COUNT(*)::int AS count
           FROM quality_nonconformities nc LEFT JOIN ref_entries ce ON ce.table_id = 'nc_causes' AND ce.code = nc.cause_code
          WHERE ${scope} GROUP BY 1 ORDER BY 2 DESC`, [storeId]),
      db.query(
        `SELECT s.name AS label, COUNT(*)::int AS count FROM quality_nonconformities nc JOIN suppliers s ON s.id = nc.supplier_id
          WHERE ${scope} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [storeId]),
      db.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status <> 'closed')::int AS open,
                ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - detected_on::timestamptz)) / 86400) FILTER (WHERE closed_at IS NOT NULL)::numeric, 1)::float8 AS avg_close_days
           FROM quality_nonconformities nc WHERE ${scope}`, [storeId]),
      db.query(
        `SELECT a.id, a.description, a.due_date, a.action_type, nc.title AS nc_title, nc.id AS nc_id
           FROM quality_nc_actions a JOIN quality_nonconformities nc ON nc.id = a.nc_id
          WHERE ${scope} AND a.status <> 'faite' AND a.due_date < CURRENT_DATE ORDER BY a.due_date`, [storeId]),
    ]);
    return { by_cause: byCause.rows, by_supplier: bySupplier.rows, ...totals.rows[0], overdue_actions: overdue.rows };
  },
};
