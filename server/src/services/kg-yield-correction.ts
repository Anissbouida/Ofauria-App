/**
 * Correction des sorties de matières des plans semi-finis au kilo (2026-11-24).
 *
 * POURQUOI
 *   Jusqu'au correctif de getCompositionForNeeds (même date), une fiche dont le format est
 *   au kilo (mig 613 : rendement_unite = 'kg') était divisée par nb_par_defaut au lieu de
 *   rendement_kg. « Bassine 5 kg » qui rend 2,9 kg : 7 kg de crème pâtissière comptaient
 *   1,4 fournée au lieu de 2,41, et la production n'a sorti du stock que 58 % des matières.
 *
 * CE QUE FAIT LA CORRECTION
 *   Pour chaque plan semi-fini produit dont la recette est au kilo, recalcule les sorties
 *   comme la production les fait aujourd'hui (même helper, version de nomenclature en vigueur
 *   à la date du plan, bases servies par un plan fils sautées), les compare aux sorties
 *   enregistrées (inventory_transactions type 'production' du plan) et sort le complément :
 *   inventaire, mouvement 'production' rattaché au plan, lots en FEFO — les mêmes gestes que
 *   la production. Le mouvement porte la mention CORRECTION_NOTE : un plan déjà corrigé est
 *   ignoré (rejouable sans double sortie).
 *
 * LIMITES
 *   - les lots consommés sont ceux disponibles AUJOURD'HUI (FEFO), pas ceux du jour du plan ;
 *   - un stock insuffisant est sorti jusqu'à zéro et le manque est signalé, sans écriture de
 *     manque (la politique de stock négatif ne s'applique pas à une régularisation) ;
 *   - les plans parents (produits finis) ne sont pas concernés : leurs formats sont en pièces,
 *     et les bases qu'ils emploient étaient déjà comptées sur leur rendement kilo.
 */
import type { PoolClient } from 'pg';
import { collectIngredientNeedsForUnits } from '../repositories/recipe-composition.helper.js';
import { bomVersionRepository } from '../repositories/bom-version.repository.js';
import { ingredientLotRepository } from '../repositories/ingredient-lot.repository.js';

export const CORRECTION_NOTE = 'Correction rendement kilo (mig 613)';
const EPS = 0.0005;

export interface KgCorrectionLine {
  ingredientId: string; ingredientName: string; unit: string;
  recorded: number; expected: number; delta: number; stock: number; unitCost: number;
}
export interface KgCorrectionPlan {
  planId: string; ofNumber: string | null; planDate: string; storeId: string | null;
  recipeId: string; recipeName: string; producedQty: number; yieldUnit: string;
  divisorOld: number; divisorNew: number; lines: KgCorrectionLine[];
}

type Q = Pick<PoolClient, 'query'>;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Plans semi-finis produits, recette au kilo dont nb_par_defaut ≠ rendement_kg, pas encore corrigés. */
async function candidates(client: Q) {
  return (await client.query(
    `SELECT pp.id AS plan_id, pp.of_number, pp.plan_date::text AS plan_date, pp.store_id,
            ppi.base_recipe_id AS recipe_id, ppi.format_id, r.name AS recipe_name, r.yield_unit,
            SUM(ppi.actual_quantity)::numeric AS produced,
            f.nb_par_defaut, f.rendement_kg
       FROM production_plans pp
       JOIN production_plan_items ppi ON ppi.plan_id = pp.id
       JOIN recipes r ON r.id = ppi.base_recipe_id
       JOIN LATERAL (
         SELECT rf.nb_par_defaut, rf.rendement_kg, rf.rendement_unite FROM recipe_formats rf
          WHERE (ppi.format_id IS NOT NULL AND rf.id = ppi.format_id)
             OR (ppi.format_id IS NULL AND rf.recipe_id = r.id AND rf.is_active = true)
          ORDER BY rf.is_default DESC, rf.ordre LIMIT 1
       ) f ON true
      WHERE pp.is_semi_finished_plan = true
        AND ppi.product_id IS NULL AND ppi.actual_quantity > 0 AND ppi.status IN ('produced', 'completed')
        AND r.compo_par_piece IS NOT TRUE
        AND f.rendement_unite = 'kg' AND f.rendement_kg > 0 AND f.nb_par_defaut IS DISTINCT FROM f.rendement_kg
        AND COALESCE(pp.exec_snapshot->'order_type'->>'consumption_mode',
                     (SELECT t.consumption_mode FROM production_order_types t WHERE t.id = pp.order_type_id), '') <> 'manuel'
        AND NOT EXISTS (SELECT 1 FROM inventory_transactions it
                         WHERE it.production_plan_id = pp.id AND it.note LIKE $1)
      GROUP BY pp.id, ppi.base_recipe_id, ppi.format_id, r.name, r.yield_unit, f.nb_par_defaut, f.rendement_kg
      ORDER BY pp.plan_date, pp.of_number`, [`${CORRECTION_NOTE}%`])).rows;
}

/**
 * Calcule les compléments à sortir, sans rien écrire (transaction annulée : le rejeu des
 * versions de nomenclature passe par des points de sauvegarde).
 */
export async function planKgYieldCorrections(client: PoolClient): Promise<KgCorrectionPlan[]> {
  const out: KgCorrectionPlan[] = [];
  await client.query('BEGIN');
  try {
    for (const c of await candidates(client)) {
      // Comme la production : les bases ayant une dépendance sur ce plan sont servies ailleurs.
      const skip = new Set((await client.query(
        `SELECT sub_recipe_id FROM production_plan_dependencies WHERE parent_plan_id = $1`, [c.plan_id])).rows
        .map(r => r.sub_recipe_id as string));
      const expected = new Map<string, number>();
      const run = () => collectIngredientNeedsForUnits(client as never, c.recipe_id, Number(c.produced),
        (id, q) => expected.set(id, (expected.get(id) ?? 0) + q),
        { formatId: c.format_id ?? null, skipSubRecipe: id => skip.has(id) });
      await bomVersionRepository.withVersionsInForce(client, [c.recipe_id], c.plan_date, run);

      const recorded = new Map<string, number>((await client.query(
        `SELECT ingredient_id, -SUM(quantity_change)::numeric AS q FROM inventory_transactions
          WHERE production_plan_id = $1 AND type = 'production' GROUP BY ingredient_id`, [c.plan_id])).rows
        .map(r => [r.ingredient_id as string, Number(r.q)]));
      const ids = [...expected.keys()];
      if (!ids.length) continue;
      const info = new Map((await client.query(
        `SELECT i.id, i.name, i.unit, COALESCE(i.unit_cost, 0) AS unit_cost,
                COALESCE((SELECT SUM(inv.current_quantity) FROM inventory inv
                           WHERE inv.ingredient_id = i.id AND ($2::uuid IS NULL OR inv.store_id = $2)), 0) AS stock
           FROM ingredients i WHERE i.id = ANY($1::uuid[])`, [ids, c.store_id])).rows.map(r => [r.id, r]));
      const lines: KgCorrectionLine[] = ids.map(id => {
        const exp = r3(expected.get(id) ?? 0); const rec = r3(recorded.get(id) ?? 0);
        const i = info.get(id);
        return { ingredientId: id, ingredientName: i?.name ?? id, unit: i?.unit ?? '', recorded: rec, expected: exp,
          delta: r3(exp - rec), stock: Number(i?.stock ?? 0), unitCost: Number(i?.unit_cost ?? 0) };
      }).filter(l => l.delta > EPS).sort((a, b) => a.ingredientName.localeCompare(b.ingredientName, 'fr'));
      if (!lines.length) continue;
      out.push({ planId: c.plan_id, ofNumber: c.of_number, planDate: c.plan_date, storeId: c.store_id,
        recipeId: c.recipe_id, recipeName: c.recipe_name, producedQty: Number(c.produced), yieldUnit: c.yield_unit ?? 'kg',
        divisorOld: Number(c.nb_par_defaut), divisorNew: Number(c.rendement_kg), lines });
    }
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
  }
  return out;
}

/** Sort les compléments calculés, un plan par transaction. Retourne les manques de stock. */
export async function applyKgYieldCorrections(client: PoolClient, plans: KgCorrectionPlan[], userId: string | null) {
  const shortages: { planId: string; ingredientName: string; missing: number; unit: string }[] = [];
  for (const p of plans) {
    await client.query('BEGIN');
    try {
      for (const l of p.lines) {
        const storeParams = p.storeId ? [p.storeId] : [];
        const lock = await client.query(
          `SELECT current_quantity FROM inventory WHERE ingredient_id = $1${p.storeId ? ' AND store_id = $2' : ''} FOR UPDATE`,
          [l.ingredientId, ...storeParams]);
        const current = lock.rows[0] ? Number(lock.rows[0].current_quantity) : 0;
        const available = Math.min(l.delta, Math.max(current, 0));
        if (current < l.delta) shortages.push({ planId: p.planId, ingredientName: l.ingredientName, missing: r3(l.delta - Math.max(current, 0)), unit: l.unit });
        await client.query(
          `UPDATE inventory SET current_quantity = GREATEST(current_quantity - $1, 0), updated_at = NOW()
            WHERE ingredient_id = $2${p.storeId ? ' AND store_id = $3' : ''}`, [l.delta, l.ingredientId, ...storeParams]);
        await client.query(
          `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, production_plan_id, store_id)
           VALUES ($1, 'production', $2, $3, $4, $5, $6)`,
          [l.ingredientId, -l.delta,
           `${CORRECTION_NOTE} — ${p.recipeName} ${p.producedQty} ${p.yieldUnit} : fournée de ${p.divisorNew} au lieu de ${p.divisorOld}`,
           userId, p.planId, p.storeId]);
        if (available > 0) await ingredientLotRepository.consumeFEFO(client, l.ingredientId, available, p.planId, p.storeId ?? undefined);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }
  return shortages;
}
