import { db, withTransaction } from '../config/database.js';

/**
 * Fusion de deux fiches du même ingrédient (G2-03, mig 539).
 *
 * `source` est la fiche en trop, `target` la fiche gardée. Dans UNE transaction :
 *   1. chaque référence à la source est repointée vers la cible (toutes les clés étrangères
 *      vers ingredients sont découvertes dans le catalogue de la base : une table ajoutée
 *      plus tard est couverte sans toucher à ce code) ;
 *   2. là où la cible existe déjà au même endroit, les quantités s'additionnent : ligne de
 *      recette de même unité, stock d'un établissement, ligne d'un inventaire physique ;
 *   3. le coût de la cible devient la moyenne des deux coûts pondérée par les stocks ;
 *   4. la fiche source est archivée dans ingredient_merges (ligne entière + décompte),
 *      puis retirée de ingredients.
 * Si une étape échoue, rien n'est modifié.
 *
 * Garde : les deux fiches doivent avoir la MÊME unité. Les quantités des lots, des
 * mouvements et des documents sont exprimées dans l'unité de la fiche ; fusionner un
 * ingrédient au kilo avec un ingrédient à l'unité les rendrait fausses. Dans ce cas il
 * faut d'abord corriger l'unité de la fiche en trop.
 *
 * Analogie Oracle : un MERGE de doublons de tiers — on met à jour les clés étrangères
 * des tables filles, puis on supprime la ligne mère en double, le tout avant le COMMIT.
 */

type Ingredient = { id: string; name: string; unit: string; unit_cost: string | null };
type Ref = { table: string; column: string };

export type MergeImpact = {
  /** Lignes repointées par table (nom de la table → nombre). */
  tables: Record<string, number>;
  recipes: number;
  lots: number;
  purchaseOrders: number;
  /** Stock additionné par établissement. */
  stock: { storeId: string; storeName: string; source: number; target: number }[];
  unitCostBefore: number;
  unitCostAfter: number;
};

export type MergePreview = {
  source: Ingredient; target: Ingredient;
  /** Motif de refus ; null si la fusion est possible. */
  blocker: string | null;
  impact: MergeImpact;
};

// Tables où un simple changement d'identifiant violerait une contrainte d'unicité : traitées à part.
const SPECIAL = new Set(['recipe_ingredients', 'product_recycle_destinations', 'stock_count_lines', 'inventory']);
// Colonnes qui portent un identifiant d'ingrédient sans clé étrangère déclarée.
const UNDECLARED: Ref[] = [
  { table: 'bsi_weighing_history', column: 'ingredient_id' },
  { table: 'unsold_decisions', column: 'recycle_ingredient_id' },
];

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const sameUnit = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Toutes les colonnes qui référencent ingredients.id (catalogue de la base + colonnes non déclarées). */
async function references(): Promise<Ref[]> {
  const fk = (await db.query(
    `SELECT c.conrelid::regclass::text AS "table", a.attname AS "column"
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'ingredients'::regclass
      ORDER BY 1, 2`)).rows as Ref[];
  const extra: Ref[] = [];
  for (const r of UNDECLARED) {
    const ok = (await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [r.table, r.column])).rows.length > 0;
    if (ok && !fk.some(f => f.table === r.table && f.column === r.column)) extra.push(r);
  }
  return [...fk, ...extra];
}

async function load(id: string, lock = false): Promise<Ingredient | null> {
  return (await db.query(`SELECT id, name, unit, unit_cost FROM ingredients WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0] ?? null;
}

async function impactOf(source: Ingredient, target: Ingredient): Promise<MergeImpact> {
  const tables: Record<string, number> = {};
  for (const r of await references()) {
    const n = (await db.query(`SELECT COUNT(*)::int AS n FROM ${ident(r.table)} WHERE ${ident(r.column)} = $1`, [source.id])).rows[0].n as number;
    if (n > 0) tables[r.table] = (tables[r.table] ?? 0) + n;
  }
  const recipes = (await db.query(
    `SELECT COUNT(DISTINCT recipe_id)::int AS n FROM (
       SELECT recipe_id FROM recipe_ingredients WHERE ingredient_id = $1
       UNION SELECT recipe_id FROM recipe_components WHERE source_ingredient_id = $1
       UNION SELECT rf.recipe_id FROM recipe_format_components c JOIN recipe_formats rf ON rf.id = c.format_id WHERE c.source_ingredient_id = $1
     ) x`, [source.id])).rows[0].n as number;
  const purchaseOrders = (await db.query(
    `SELECT COUNT(DISTINCT purchase_order_id)::int AS n FROM purchase_order_items WHERE ingredient_id = $1`, [source.id])).rows[0].n as number;
  const stock = (await db.query(
    `SELECT s.id AS "storeId", s.name AS "storeName",
            COALESCE(SUM(inv.current_quantity) FILTER (WHERE inv.ingredient_id = $1), 0)::float AS source,
            COALESCE(SUM(inv.current_quantity) FILTER (WHERE inv.ingredient_id = $2), 0)::float AS target
       FROM inventory inv JOIN stores s ON s.id = inv.store_id
      WHERE inv.ingredient_id IN ($1, $2)
      GROUP BY s.id, s.name ORDER BY s.name`, [source.id, target.id])).rows as MergeImpact['stock'];

  // Coût moyen pondéré par les stocks. Sans stock des deux côtés : le coût de la cible,
  // ou celui de la source si la cible n'en a pas.
  const qs = stock.reduce((t, x) => t + Math.max(0, x.source), 0);
  const qt = stock.reduce((t, x) => t + Math.max(0, x.target), 0);
  const cs = num(source.unit_cost), ct = num(target.unit_cost);
  let after = ct > 0 ? ct : cs;
  if (qs + qt > 0 && cs > 0 && ct > 0) after = (qs * cs + qt * ct) / (qs + qt);
  return {
    tables, recipes, lots: tables.ingredient_lots ?? 0, purchaseOrders, stock,
    unitCostBefore: ct, unitCostAfter: Math.round(after * 10000) / 10000,
  };
}

function blockerOf(source: Ingredient | null, target: Ingredient | null, sourceId: string, targetId: string): string | null {
  if (sourceId === targetId) return 'Choisissez deux fiches différentes';
  if (!source) return 'Fiche à fusionner introuvable';
  if (!target) return 'Fiche à garder introuvable';
  if (!sameUnit(source.unit, target.unit)) {
    return `Les deux fiches n'ont pas la même unité (« ${source.name} » en ${source.unit}, « ${target.name} » en ${target.unit}). `
      + 'Corrigez d\'abord l\'unité de la fiche à fusionner : les quantités de ses lots et de ses documents sont exprimées dans cette unité.';
  }
  return null;
}

export const ingredientMergeRepository = {
  /** Ce que ferait la fusion, sans rien écrire. */
  async preview(sourceId: string, targetId: string): Promise<MergePreview | { error: string }> {
    const [source, target] = await Promise.all([load(sourceId), load(targetId)]);
    if (!source || !target || sourceId === targetId) return { error: blockerOf(source, target, sourceId, targetId)! };
    return { source, target, blocker: blockerOf(source, target, sourceId, targetId), impact: await impactOf(source, target) };
  },

  /** Fusionne `sourceId` dans `targetId`. Tout ou rien. */
  async merge(sourceId: string, targetId: string, userId: string): Promise<{ error: string } | { mergeId: string; impact: MergeImpact }> {
    if (sourceId === targetId) return { error: 'Choisissez deux fiches différentes' };
    return withTransaction(async () => {
      await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      // Verrou dans l'ordre des identifiants : deux fusions croisées ne s'interbloquent pas.
      const [first, second] = [sourceId, targetId].sort();
      await load(first, true); await load(second, true);
      const [source, target] = await Promise.all([load(sourceId), load(targetId)]);
      const blocker = blockerOf(source, target, sourceId, targetId);
      if (blocker || !source || !target) return { error: blocker ?? 'Fiche introuvable' };

      const impact = await impactOf(source, target);
      const snapshot = (await db.query(`SELECT to_jsonb(i) AS row FROM ingredients i WHERE i.id = $1`, [sourceId])).rows[0].row;
      const stockBefore = (await db.query(
        `SELECT store_id, ingredient_id, current_quantity, minimum_threshold FROM inventory WHERE ingredient_id IN ($1, $2)`,
        [sourceId, targetId])).rows;

      // 1. Lignes de recette : même recette et même unité → les quantités s'additionnent.
      const lines = (await db.query(
        `SELECT id, recipe_id, quantity, COALESCE(unit, '') AS unit FROM recipe_ingredients WHERE ingredient_id = $1`, [sourceId])).rows;
      for (const l of lines) {
        const twin = (await db.query(
          `SELECT id FROM recipe_ingredients WHERE recipe_id = $1 AND ingredient_id = $2 AND COALESCE(unit, '') = $3 ORDER BY id LIMIT 1`,
          [l.recipe_id, targetId, l.unit])).rows[0];
        if (twin) {
          await db.query(`DELETE FROM recipe_ingredients WHERE id = $1`, [l.id]);
          await db.query(`UPDATE recipe_ingredients SET quantity = quantity + $2::numeric WHERE id = $1`, [twin.id, l.quantity]);
        } else {
          await db.query(`UPDATE recipe_ingredients SET ingredient_id = $2 WHERE id = $1`, [l.id, targetId]);
        }
      }

      // 2. Destinations de recyclage : une seule par produit et par ingrédient.
      await db.query(
        `DELETE FROM product_recycle_destinations s
          WHERE s.ingredient_id = $1
            AND EXISTS (SELECT 1 FROM product_recycle_destinations t WHERE t.product_id = s.product_id AND t.ingredient_id = $2)`,
        [sourceId, targetId]);
      await db.query(`UPDATE product_recycle_destinations SET ingredient_id = $2 WHERE ingredient_id = $1`, [sourceId, targetId]);

      // 3. Inventaires physiques : les deux fiches comptées dans le même inventaire → une ligne, quantités additionnées.
      const add = (col: string) => `${col} = CASE WHEN t.${col} IS NULL AND s.${col} IS NULL THEN NULL ELSE COALESCE(t.${col}, 0) + COALESCE(s.${col}, 0) END`;
      await db.query(
        `UPDATE stock_count_lines t
            SET ${['theoretical_at_start', 'theoretical_at_count', 'counted_qty', 'applied_qty', 'applied_value'].map(add).join(', ')}
           FROM stock_count_lines s
          WHERE s.ingredient_id = $1 AND t.ingredient_id = $2 AND t.count_id = s.count_id`, [sourceId, targetId]);
      await db.query(
        `DELETE FROM stock_count_lines s
          WHERE s.ingredient_id = $1
            AND EXISTS (SELECT 1 FROM stock_count_lines t WHERE t.count_id = s.count_id AND t.ingredient_id = $2)`,
        [sourceId, targetId]);
      await db.query(`UPDATE stock_count_lines SET ingredient_id = $2 WHERE ingredient_id = $1`, [sourceId, targetId]);

      // 4. Toutes les autres références (lots, mouvements, bons de commande, réceptions, factures…).
      //    Le changement d'ingrédient d'un lot resynchronise le stock des deux fiches (trigger).
      for (const r of await references()) {
        if (SPECIAL.has(r.table)) continue;
        await db.query(`UPDATE ${ident(r.table)} SET ${ident(r.column)} = $2 WHERE ${ident(r.column)} = $1`, [sourceId, targetId]);
      }

      // 5. Stock par établissement : somme des deux fiches d'avant la fusion, seuil le plus haut.
      await db.query(`DELETE FROM inventory WHERE ingredient_id = $1`, [sourceId]);
      const stores = [...new Set(stockBefore.map(r => r.store_id as string))];
      for (const storeId of stores) {
        const rows = stockBefore.filter(r => r.store_id === storeId);
        const qty = rows.reduce((t, r) => t + num(r.current_quantity), 0);
        const threshold = Math.max(...rows.map(r => num(r.minimum_threshold)));
        await db.query(
          `INSERT INTO inventory (ingredient_id, store_id, current_quantity, minimum_threshold)
           VALUES ($1, $2, $3::numeric, $4::numeric)
           ON CONFLICT (store_id, ingredient_id) DO UPDATE
             SET current_quantity = EXCLUDED.current_quantity, minimum_threshold = EXCLUDED.minimum_threshold, updated_at = now()`,
          [targetId, storeId, qty, threshold]);
      }

      // 6. Coût moyen pondéré de la fiche gardée.
      if (impact.unitCostAfter !== impact.unitCostBefore) {
        await db.query(`UPDATE ingredients SET unit_cost = $2::numeric WHERE id = $1`, [targetId, impact.unitCostAfter]);
      }

      // 7. Archive de la fiche retirée, puis retrait.
      const mergeId = (await db.query(
        `INSERT INTO ingredient_merges (source_id, source_name, target_id, source_snapshot, impact, unit_cost_before, unit_cost_after, merged_by)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::numeric, $7::numeric, $8) RETURNING id`,
        [sourceId, source.name, targetId, JSON.stringify(snapshot), JSON.stringify(impact), impact.unitCostBefore, impact.unitCostAfter, userId])).rows[0].id as string;
      await db.query(`DELETE FROM ingredients WHERE id = $1`, [sourceId]);
      return { mergeId, impact };
    });
  },

  /** Dernières fusions (journal). */
  async history(limit = 50) {
    return (await db.query(
      `SELECT m.id, m.source_id, m.source_name, m.target_id, t.name AS target_name, m.impact,
              m.unit_cost_before, m.unit_cost_after, m.merged_at,
              NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS merged_by_name
         FROM ingredient_merges m
         JOIN ingredients t ON t.id = m.target_id
         LEFT JOIN users u ON u.id = m.merged_by
        ORDER BY m.merged_at DESC LIMIT $1`, [limit])).rows;
  },
};
