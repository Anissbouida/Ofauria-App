import { db, withTransaction } from '../config/database.js';
import type { PoolClient } from 'pg';
import { applyStockOut } from '../services/stock-anomaly.js';
import { ingredientLotRepository } from './ingredient-lot.repository.js';
import { collectIngredientNeedsForUnits } from './recipe-composition.helper.js';
import { bomVersionRepository } from './bom-version.repository.js';

/**
 * Consommation des matières d'un ordre (M6-01).
 * - Mode « manuel » du type d'ordre : aucune sortie automatique ; les sorties se saisissent
 *   ici, rattachées à l'ordre (stock, mouvement, lots FEFO), avec la même politique de stock
 *   négatif que les autres sorties.
 * - Écart théorique / réel : la nomenclature appliquée aux quantités produites, comparée
 *   aux sorties réellement enregistrées sur l'ordre (bon de sortie, déclaration ou manuel).
 */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const productionConsumptionRepository = {
  async manualIssue(planId: string, input: { ingredientId: string; quantity: number; note?: string | null }, userId: string) {
    return withTransaction(async () => {
      const plan = (await db.query(
        `SELECT pp.id, pp.store_id, pp.status, t.consumption_mode FROM production_plans pp
           LEFT JOIN production_order_types t ON t.id = pp.order_type_id WHERE pp.id = $1`, [planId])).rows[0];
      if (!plan) throw new Error('Ordre introuvable');
      if (plan.consumption_mode !== 'manuel') throw new Error('Sorties manuelles réservées aux types d\'ordre en consommation manuelle');
      if (!['confirmed', 'in_progress', 'awaiting_ingredients', 'completed'].includes(plan.status)) throw new Error(`Ordre au statut « ${plan.status} » : sortie impossible`);
      const client = await db.getClient() as PoolClient;
      try {
        const ing = (await client.query(`SELECT name FROM ingredients WHERE id = $1`, [input.ingredientId])).rows[0];
        if (!ing) throw new Error('Matière introuvable');
        const stock = (await client.query(
          `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND ($2::uuid IS NULL OR store_id = $2) FOR UPDATE`,
          [input.ingredientId, plan.store_id])).rows[0];
        const available = stock ? Number(stock.current_quantity) : 0;
        await applyStockOut(client, { kind: 'ingredient', itemId: input.ingredientId, storeId: plan.store_id ?? null,
          requested: input.quantity, available, origin: { type: 'production_plan', id: planId }, userId, label: `${ing.name} (sortie manuelle)` });
        await client.query(
          `UPDATE inventory SET current_quantity = GREATEST(current_quantity - $1::numeric, 0), updated_at = NOW()
            WHERE ingredient_id = $2 AND ($3::uuid IS NULL OR store_id = $3)`, [input.quantity, input.ingredientId, plan.store_id]);
        const tx = (await client.query(
          `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, production_plan_id, store_id)
           VALUES ($1, 'production', $2, $3, $4, $5, $6) RETURNING id`,
          [input.ingredientId, -input.quantity, input.note?.trim() || 'Sortie manuelle sur ordre', userId, planId, plan.store_id])).rows[0];
        const lots = Math.min(input.quantity, available) > 0
          ? await ingredientLotRepository.consumeFEFO(client, input.ingredientId, Math.min(input.quantity, available), planId, plan.store_id ?? undefined)
          : [];
        return { transaction_id: tx.id as string, lots };
      } finally { client.release(); }
    });
  },

  /** Théorique (nomenclature × quantité produite, fiche de la ligne) contre réel (sorties de l'ordre). */
  async variance(planId: string) {
    const items = (await db.query(
      `SELECT ppi.id, ppi.product_id, ppi.format_id, ppi.actual_quantity, ppi.alt_recipe_id,
              COALESCE(ppi.alt_recipe_id, (SELECT r.id FROM recipes r WHERE r.product_id = ppi.product_id LIMIT 1)) AS recipe_id
         FROM production_plan_items ppi WHERE ppi.plan_id = $1 AND ppi.actual_quantity > 0`, [planId])).rows;
    const theo = new Map<string, number>();
    // M4-02 : théorique sur la version de nomenclature en vigueur à la date du plan, dans une
    // transaction en lecture annulée (le rejeu des versions se fait dans un point de sauvegarde).
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const planDay = (await client.query(`SELECT plan_date::text AS d FROM production_plans WHERE id = $1`, [planId])).rows[0]?.d as string | undefined;
      const roots = items.map(it => it.recipe_id as string).filter(Boolean);
      const run = async () => {
        for (const it of items) {
          if (!it.recipe_id) continue;
          await collectIngredientNeedsForUnits(client as never, it.recipe_id, Number(it.actual_quantity),
            (id, q) => theo.set(id, (theo.get(id) ?? 0) + q), { formatId: it.format_id ?? null });
        }
      };
      if (planDay) await bomVersionRepository.withVersionsInForce(client, roots, planDay, run); else await run();
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    const real = new Map<string, number>((await db.query(
      `SELECT ingredient_id, -SUM(quantity_change) AS q FROM inventory_transactions
        WHERE production_plan_id = $1 AND type = 'production' GROUP BY ingredient_id`, [planId])).rows
      .map(r => [r.ingredient_id as string, Number(r.q)]));
    const ids = [...new Set([...theo.keys(), ...real.keys()])];
    if (!ids.length) return [];
    const names = new Map((await db.query(`SELECT id, name, unit FROM ingredients WHERE id = ANY($1::uuid[])`, [ids])).rows.map(r => [r.id, r]));
    return ids.map(id => {
      const t = r3(theo.get(id) ?? 0); const a = r3(real.get(id) ?? 0);
      return { ingredient_id: id, name: names.get(id)?.name ?? id, unit: names.get(id)?.unit ?? '', theoretical: t, actual: a,
        variance: r3(a - t), variance_pct: t > 0 ? Math.round((a - t) / t * 1000) / 10 : null };
    }).sort((x, y) => Math.abs(y.variance) - Math.abs(x.variance));
  },
};
