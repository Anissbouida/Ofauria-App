import { db, withTransaction } from '../config/database.js';
import { getParameter } from '../services/module-parameters.service.js';

/**
 * Points de commande et stocks de sécurité (G5-02, mig 550).
 *
 * Le point de commande est inventory.minimum_threshold (le seuil d'alerte, lu par les
 * alertes et par « À commander »). Calcul :
 *   consommation moyenne/jour = sorties (usage, production) des N derniers jours / N
 *   stock de sécurité (mode calculé) = consommation moyenne × jours de sécurité
 *   point de commande = consommation moyenne × délai du fournisseur + stock de sécurité
 * Délai : fournisseur préféré de l'article (supplier_items), sinon le plus court des
 * fournisseurs non bloqués, sinon le délai par défaut.
 * recalculate() met à jour les articles en mode calculé et pose une PROPOSITION sur les
 * articles en mode manuel (jamais appliquée sans validation).
 */
type Params = { usage_days: number; default_lead_days: number; safety_days: number };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

async function params(): Promise<Params> {
  const p = await getParameter<Partial<Params>>('stock.replenishment');
  return { usage_days: Number(p?.usage_days) || 56, default_lead_days: Number(p?.default_lead_days ?? 2), safety_days: Number(p?.safety_days ?? 1) };
}

/** Lignes d'inventaire avec consommation moyenne et délai fournisseur. */
async function computeRows(storeId: string | null | undefined, p: Params) {
  return (await db.query(
    `WITH usage AS (
       SELECT t.ingredient_id, t.store_id, -SUM(t.quantity_change) / $2::numeric AS avg
         FROM inventory_transactions t
        WHERE t.quantity_change < 0 AND t.type IN ('usage', 'production')
          AND t.created_at >= now() - make_interval(days => $2::int)
        GROUP BY t.ingredient_id, t.store_id
     ), lead AS (
       SELECT si.purchasable_id AS ingredient_id,
              COALESCE(MAX(si.lead_time_days) FILTER (WHERE si.is_preferred), MIN(si.lead_time_days)) AS days
         FROM supplier_items si
        WHERE si.purchasable_kind = 'ingredient' AND NOT si.is_blocked AND si.lead_time_days IS NOT NULL
        GROUP BY si.purchasable_id
     )
     SELECT i.id, i.ingredient_id, g.name AS ingredient_name, g.unit, i.store_id,
            i.current_quantity::float8 AS current_quantity, i.minimum_threshold::float8 AS reorder_point,
            i.safety_stock::float8 AS safety_stock, i.max_stock::float8 AS max_stock, i.replenish_mode,
            COALESCE(u.avg, 0)::float8 AS avg_daily_usage,
            COALESCE(l.days, $3::int) AS lead_days, (l.days IS NOT NULL) AS lead_from_supplier,
            i.proposed_reorder_point::float8 AS proposed_reorder_point, i.proposed_safety_stock::float8 AS proposed_safety_stock,
            i.proposed_at
       FROM inventory i
       JOIN ingredients g ON g.id = i.ingredient_id
       LEFT JOIN usage u ON u.ingredient_id = i.ingredient_id AND u.store_id IS NOT DISTINCT FROM i.store_id
       LEFT JOIN lead l ON l.ingredient_id = i.ingredient_id
      WHERE ($1::uuid IS NULL OR i.store_id = $1::uuid)
      ORDER BY g.name`, [storeId ?? null, p.usage_days, p.default_lead_days])).rows as Array<{
        id: string; ingredient_id: string; ingredient_name: string; unit: string; store_id: string | null;
        current_quantity: number; reorder_point: number; safety_stock: number; max_stock: number | null;
        replenish_mode: 'manuel' | 'calcule'; avg_daily_usage: number; lead_days: number; lead_from_supplier: boolean;
        proposed_reorder_point: number | null; proposed_safety_stock: number | null; proposed_at: string | null;
      }>;
}

function propose(r: { avg_daily_usage: number; lead_days: number; safety_stock: number; replenish_mode: string }, p: Params) {
  const safety = r.replenish_mode === 'calcule' ? round3(r.avg_daily_usage * p.safety_days) : r.safety_stock;
  return { safety, reorderPoint: round3(r.avg_daily_usage * r.lead_days + safety) };
}

export const reorderPointRepository = {
  async list(storeId?: string | null) {
    const p = await params();
    const rows = await computeRows(storeId, p);
    return {
      params: p,
      rows: rows.map(r => {
        const live = propose(r, p);
        return { ...r, live_reorder_point: live.reorderPoint, live_safety_stock: live.safety,
                 below: r.reorder_point > 0 && r.current_quantity <= r.reorder_point };
      }),
    };
  },

  /** Recalcul (tâche hebdomadaire) : applique en mode calculé, propose en mode manuel. */
  async recalculate(storeId?: string | null): Promise<{ applied: number; proposed: number }> {
    const p = await params();
    const rows = await computeRows(storeId, p);
    let applied = 0; let proposed = 0;
    await withTransaction(async () => {
      for (const r of rows) {
        const { safety, reorderPoint } = propose(r, p);
        if (r.replenish_mode === 'calcule') {
          await db.query(
            `UPDATE inventory SET avg_daily_usage = $2, safety_stock = $3, minimum_threshold = $4,
                    max_stock = CASE WHEN max_stock IS NOT NULL AND max_stock < $4 THEN $4 ELSE max_stock END,
                    proposed_reorder_point = $4, proposed_safety_stock = $3, proposed_at = now(), updated_at = now()
              WHERE id = $1`, [r.id, r.avg_daily_usage, safety, reorderPoint]);
          applied++;
        } else {
          await db.query(
            `UPDATE inventory SET avg_daily_usage = $2, proposed_reorder_point = $3, proposed_safety_stock = $4, proposed_at = now()
              WHERE id = $1`, [r.id, r.avg_daily_usage, reorderPoint, round3(r.avg_daily_usage * p.safety_days)]);
          if (Math.abs(reorderPoint - r.reorder_point) > 0.0005) proposed++;
        }
      }
    });
    return { applied, proposed };
  },

  /** Valide la proposition du dernier recalcul pour les lignes choisies. */
  async applyProposals(ids: string[]): Promise<number> {
    const r = await db.query(
      `UPDATE inventory
          SET minimum_threshold = proposed_reorder_point,
              safety_stock = COALESCE(proposed_safety_stock, safety_stock),
              max_stock = CASE WHEN max_stock IS NOT NULL AND max_stock < proposed_reorder_point THEN proposed_reorder_point ELSE max_stock END,
              updated_at = now()
        WHERE id = ANY($1::uuid[]) AND proposed_reorder_point IS NOT NULL`, [ids]);
    return r.rowCount ?? 0;
  },

  async update(id: string, data: { reorderPoint?: number; safetyStock?: number; maxStock?: number | null; mode?: 'manuel' | 'calcule' }) {
    const r = await db.query(
      `UPDATE inventory
          SET minimum_threshold = COALESCE($2::numeric, minimum_threshold),
              safety_stock = COALESCE($3::numeric, safety_stock),
              max_stock = CASE WHEN $4::boolean THEN $5::numeric ELSE max_stock END,
              replenish_mode = COALESCE($6, replenish_mode),
              updated_at = now()
        WHERE id = $1
        RETURNING id, minimum_threshold::float8 AS reorder_point, safety_stock::float8 AS safety_stock,
                  max_stock::float8 AS max_stock, replenish_mode`,
      [id, data.reorderPoint ?? null, data.safetyStock ?? null, data.maxStock !== undefined, data.maxStock ?? null, data.mode ?? null]);
    if (!r.rows[0]) throw new Error('Ligne de stock introuvable');
    return r.rows[0];
  },
};
