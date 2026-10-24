import { db } from '../config/database.js';
import { ingredientLotRepository } from './ingredient-lot.repository.js';
import { createNotification } from '../utils/notify.js';

/**
 * Traçabilité aval / amont et rappel produit (mig 316).
 *
 * Aval (lot ingrédient → clients) :
 *   lot → plans qui l'ont consommé (production_lot_usage, au niveau du PLAN)
 *       → semi-finis produits dans ces plans puis consommés par d'autres plans
 *       → lignes de plan → lots produits finis → magasins, ventes, pertes, reste.
 * La consommation n'étant pas tracée par ligne de plan, la ligne est « certaine »
 * si sa recette contient l'ingrédient (directement ou via une base), « possible »
 * sinon : même production, composition non prouvée. Un rappel prend les deux.
 */

export type Certainty = 'certain' | 'possible';

const MAX_DEPTH = 4;

/** Recettes contenant l'ingrédient, directement ou via des bases (récursif). */
async function recipesContaining(ingredientId: string): Promise<Set<string>> {
  const { rows } = await db.query(
    `WITH RECURSIVE r(recipe_id) AS (
       SELECT recipe_id FROM recipe_ingredients WHERE ingredient_id = $1
       UNION
       SELECT recipe_id FROM recipe_components WHERE source_ingredient_id = $1
       UNION
       SELECT rc.recipe_id FROM recipe_components rc JOIN r ON rc.source_recipe_id = r.recipe_id
     )
     SELECT DISTINCT recipe_id FROM r`,
    [ingredientId],
  );
  return new Set(rows.map(r => r.recipe_id as string));
}

/** Arbre des ingrédients d'une recette (récursif) : pour l'amont. */
async function ingredientsOfRecipe(recipeId: string): Promise<Set<string>> {
  const { rows } = await db.query(
    `WITH RECURSIVE r(recipe_id) AS (
       SELECT $1::uuid
       UNION
       SELECT rc.source_recipe_id FROM recipe_components rc JOIN r ON rc.recipe_id = r.recipe_id
        WHERE rc.source_recipe_id IS NOT NULL
     )
     SELECT ri.ingredient_id FROM recipe_ingredients ri JOIN r ON r.recipe_id = ri.recipe_id
     UNION
     SELECT rc.source_ingredient_id FROM recipe_components rc JOIN r ON r.recipe_id = rc.recipe_id
      WHERE rc.source_ingredient_id IS NOT NULL`,
    [recipeId],
  );
  return new Set(rows.map(r => r.ingredient_id as string));
}

async function productLotsDetail(where: string, params: unknown[]) {
  const { rows } = await db.query(
    `SELECT pl.id, pl.lot_number, pl.product_id, p.name AS product_name, pl.store_id, st.name AS store_name,
            pl.production_plan_id, pl.plan_item_id, pl.produced_at, pl.expires_at::text, pl.status,
            pl.quantity_total::float, pl.sold_qty::float, pl.wasted_qty::float, pl.recycled_qty::float,
            (pl.backroom_qty + pl.vitrine_qty)::float AS remaining_qty,
            COALESCE(m.sales_count, 0)::int AS sales_count, m.first_sale_at, m.last_sale_at,
            COALESCE(m.sale_qty_traced, 0)::float AS sale_qty_traced
       FROM product_lots pl
       JOIN products p ON p.id = pl.product_id
       LEFT JOIN stores st ON st.id = pl.store_id
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT ref_id) AS sales_count, MIN(created_at) AS first_sale_at, MAX(created_at) AS last_sale_at,
                SUM(quantity) AS sale_qty_traced
           FROM product_lot_movements WHERE product_lot_id = pl.id AND kind = 'sale'
       ) m ON true
      WHERE ${where}
      ORDER BY pl.produced_at`,
    params,
  );
  return rows;
}

export const traceabilityRepository = {
  /** Recherche de lots par numéro (interne ou fournisseur) ou par article. */
  async search(q: string) {
    const like = `%${q.trim()}%`;
    const [ing, prod] = await Promise.all([
      db.query(
        `SELECT il.id, 'ingredient_lot' AS kind, il.lot_number, il.supplier_lot_number, i.name AS item_name,
                s.name AS supplier_name, il.received_at, il.expiration_date::text, il.status
           FROM ingredient_lots il
           JOIN ingredients i ON i.id = il.ingredient_id
           LEFT JOIN suppliers s ON s.id = il.supplier_id
          WHERE il.lot_number ILIKE $1 OR il.supplier_lot_number ILIKE $1 OR i.name ILIKE $1
          ORDER BY il.received_at DESC NULLS LAST LIMIT 30`,
        [like],
      ),
      db.query(
        `SELECT pl.id, 'product_lot' AS kind, pl.lot_number, NULL AS supplier_lot_number, p.name AS item_name,
                st.name AS supplier_name, pl.produced_at AS received_at, pl.expires_at::text AS expiration_date, pl.status
           FROM product_lots pl
           JOIN products p ON p.id = pl.product_id
           LEFT JOIN stores st ON st.id = pl.store_id
          WHERE pl.lot_number ILIKE $1 OR p.name ILIKE $1
          ORDER BY pl.produced_at DESC LIMIT 30`,
        [like],
      ),
    ]);
    return [...ing.rows, ...prod.rows];
  },

  /** Aval d'un lot ingrédient : jusqu'aux magasins et aux ventes. */
  async forward(ingredientLotId: string) {
    const { rows: lotRows } = await db.query(
      `SELECT il.id, il.lot_number, il.supplier_lot_number, il.ingredient_id, i.name AS ingredient_name, i.unit,
              s.name AS supplier_name, il.received_at, il.expiration_date::text, il.status,
              il.quantity_received::float, il.quantity_remaining::float, rv.voucher_number
         FROM ingredient_lots il
         JOIN ingredients i ON i.id = il.ingredient_id
         LEFT JOIN suppliers s ON s.id = il.supplier_id
         LEFT JOIN reception_voucher_items rvi ON rvi.id = il.reception_voucher_item_id
         LEFT JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
        WHERE il.id = $1`,
      [ingredientLotId],
    );
    const lot = lotRows[0];
    if (!lot) return null;

    const contaminated = await recipesContaining(lot.ingredient_id);

    // Plans touchés : consommation directe, puis via les semi-finis qu'ils ont produits.
    const { rows: direct } = await db.query(
      `SELECT production_plan_id AS plan_id, SUM(quantity_used)::float AS qty
         FROM production_lot_usage WHERE ingredient_lot_id = $1 GROUP BY 1`,
      [ingredientLotId],
    );
    const planQty = new Map<string, number>(direct.map(r => [r.plan_id, r.qty]));
    const planDepth = new Map<string, number>(direct.map(r => [r.plan_id, 0]));
    const semiLots: Record<string, any>[] = [];
    let frontier = [...planQty.keys()];
    for (let depth = 1; depth <= MAX_DEPTH && frontier.length; depth++) {
      const { rows } = await db.query(
        `SELECT sl.id, sl.lot_number, sl.recipe_id, r.name AS recipe_name, sl.production_plan_id, sl.plan_item_id,
                sl.quantity_produced::float, sl.quantity_remaining::float, sl.unit, sl.status, sl.store_id,
                sl.expires_at, u.parent_plan_id, u.quantity::float AS used_qty
           FROM semi_finished_lots sl
           JOIN recipes r ON r.id = sl.recipe_id
           LEFT JOIN semi_finished_lot_usage u ON u.semi_finished_lot_id = sl.id
          WHERE sl.production_plan_id = ANY($1::uuid[])`,
        [frontier],
      );
      const next: string[] = [];
      for (const r of rows) {
        // Un semi-fini dont la recette ne contient pas l'ingrédient n'est pas un vecteur.
        if (!contaminated.has(r.recipe_id)) continue;
        if (!semiLots.some(s => s.id === r.id)) semiLots.push({ ...r, depth });
        if (r.parent_plan_id && !planDepth.has(r.parent_plan_id)) {
          planDepth.set(r.parent_plan_id, depth);
          next.push(r.parent_plan_id);
        }
      }
      frontier = next;
    }
    const planIds = [...planDepth.keys()];

    const { rows: plans } = planIds.length ? await db.query(
      `SELECT pp.id, pp.plan_date::text, pp.status, pp.store_id, st.name AS store_name
         FROM production_plans pp LEFT JOIN stores st ON st.id = pp.store_id
        WHERE pp.id = ANY($1::uuid[]) ORDER BY pp.plan_date`,
      [planIds],
    ) : { rows: [] };

    const { rows: items } = planIds.length ? await db.query(
      `SELECT ppi.id, ppi.plan_id, ppi.product_id, p.name AS product_name, ppi.base_recipe_id,
              COALESCE(rp.id, ppi.base_recipe_id) AS recipe_id,
              ppi.planned_quantity, ppi.actual_quantity::float, ppi.status
         FROM production_plan_items ppi
         LEFT JOIN products p ON p.id = ppi.product_id
         LEFT JOIN recipes rp ON rp.product_id = ppi.product_id
        WHERE ppi.plan_id = ANY($1::uuid[])`,
      [planIds],
    ) : { rows: [] };
    const itemCertainty = new Map<string, Certainty>(items.map(i => [i.id, i.recipe_id && contaminated.has(i.recipe_id) ? 'certain' : 'possible']));

    const productLots = planIds.length
      ? await productLotsDetail(`pl.production_plan_id = ANY($1::uuid[])`, [planIds])
      : [];
    // Lot sans ligne de plan (anciens lots) : certitude par la recette du produit.
    const productRecipe = new Map(items.filter(i => i.product_id).map(i => [i.product_id as string, i.recipe_id as string | null]));
    const lots = productLots.map(l => ({
      ...l,
      certainty: (l.plan_item_id ? itemCertainty.get(l.plan_item_id) : undefined)
        ?? (productRecipe.get(l.product_id) && contaminated.has(productRecipe.get(l.product_id)!) ? 'certain' : 'possible') as Certainty,
    }));

    // Synthèse par magasin.
    const byStore = new Map<string, { store_name: string; lots: number; sold: number; remaining: number; wasted: number }>();
    for (const l of lots) {
      const k = l.store_name ?? '—';
      const cur = byStore.get(k) ?? { store_name: k, lots: 0, sold: 0, remaining: 0, wasted: 0 };
      cur.lots++; cur.sold += l.sold_qty; cur.remaining += l.remaining_qty; cur.wasted += l.wasted_qty + l.recycled_qty;
      byStore.set(k, cur);
    }

    return {
      lot,
      plans: plans.map(p => ({ ...p, qty_used: planQty.get(p.id) ?? null, depth: planDepth.get(p.id) ?? 0 })),
      items: items.map(i => ({ ...i, certainty: itemCertainty.get(i.id) })),
      semiLots,
      productLots: lots,
      byStore: [...byStore.values()],
      // Mouvements tracés à partir de la mig 316 seulement.
      traceStart: (await db.query(`SELECT MIN(created_at) AS t FROM product_lot_movements`)).rows[0]?.t ?? null,
    };
  },

  /** Ventes tracées d'un lot produit (ticket par ticket). */
  async lotSales(productLotId: string) {
    const { rows } = await db.query(
      `SELECT m.created_at, m.quantity::float, s.id AS sale_id, s.sale_number, s.total::float,
              c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone
         FROM product_lot_movements m
         LEFT JOIN sales s ON s.id = m.ref_id
         LEFT JOIN customers c ON c.id = s.customer_id
        WHERE m.product_lot_id = $1 AND m.kind = 'sale'
        ORDER BY m.created_at`,
      [productLotId],
    );
    return rows;
  },

  /** Amont d'un lot produit fini : ingrédients et lots fournisseurs utilisés. */
  async backward(productLotId: string) {
    const [lot] = await productLotsDetail(`pl.id = $1`, [productLotId]);
    if (!lot) return null;
    const { rows: rec } = await db.query(
      `SELECT COALESCE(rp.id, ppi.base_recipe_id) AS recipe_id
         FROM product_lots pl
         LEFT JOIN production_plan_items ppi ON ppi.id = pl.plan_item_id
         LEFT JOIN recipes rp ON rp.product_id = pl.product_id
        WHERE pl.id = $1`,
      [productLotId],
    );
    const recipeIngredients = rec[0]?.recipe_id ? await ingredientsOfRecipe(rec[0].recipe_id) : new Set<string>();

    // Plans d'origine : le plan du lot + les plans des semi-finis consommés (récursif).
    const plans = new Map<string, number>();
    let frontier = lot.production_plan_id ? [lot.production_plan_id as string] : [];
    frontier.forEach(p => plans.set(p, 0));
    for (let depth = 1; depth <= MAX_DEPTH && frontier.length; depth++) {
      const { rows } = await db.query(
        `SELECT DISTINCT sl.production_plan_id FROM semi_finished_lot_usage u
           JOIN semi_finished_lots sl ON sl.id = u.semi_finished_lot_id
          WHERE u.parent_plan_id = ANY($1::uuid[]) AND sl.production_plan_id IS NOT NULL`,
        [frontier],
      );
      frontier = rows.map(r => r.production_plan_id).filter((p: string) => !plans.has(p));
      frontier.forEach(p => plans.set(p, depth));
    }

    const { rows: ingredientLots } = plans.size ? await db.query(
      `SELECT il.id, il.lot_number, il.supplier_lot_number, i.id AS ingredient_id, i.name AS ingredient_name, i.unit,
              s.name AS supplier_name, il.expiration_date::text, il.received_at, il.status,
              u.production_plan_id, SUM(u.quantity_used)::float AS qty_used
         FROM production_lot_usage u
         JOIN ingredient_lots il ON il.id = u.ingredient_lot_id
         JOIN ingredients i ON i.id = il.ingredient_id
         LEFT JOIN suppliers s ON s.id = il.supplier_id
        WHERE u.production_plan_id = ANY($1::uuid[])
        GROUP BY il.id, i.id, s.name, u.production_plan_id
        ORDER BY i.name`,
      [[...plans.keys()]],
    ) : { rows: [] };

    return {
      lot,
      ingredientLots: ingredientLots.map(l => ({
        ...l,
        depth: plans.get(l.production_plan_id) ?? 0,
        certainty: (recipeIngredients.has(l.ingredient_id) ? 'certain' : 'possible') as Certainty,
      })),
    };
  },

  // ─── Rappels ──────────────────────────────────────────────────────────

  async createRecall(p: { originKind: 'ingredient_lot' | 'product_lot'; originId: string; reason: string; storeId: string | null; userId: string }) {
    type Item = { kind: 'ingredient_lot' | 'product_lot' | 'semi_finished_lot'; lot_id: string; label: string; lot_number: string | null;
      store_id: string | null; certainty: Certainty; total: number | null; sold: number | null; remaining: number | null; unit: string | null; status: string };
    const items: Item[] = [];
    let originLabel: string;

    if (p.originKind === 'ingredient_lot') {
      const t = await this.forward(p.originId);
      if (!t) return null;
      originLabel = `${t.lot.ingredient_name} — lot ${t.lot.lot_number}${t.lot.supplier_lot_number ? ` (fournisseur ${t.lot.supplier_lot_number})` : ''}`;
      items.push({ kind: 'ingredient_lot', lot_id: t.lot.id, label: t.lot.ingredient_name, lot_number: t.lot.lot_number, store_id: null,
        certainty: 'certain', total: t.lot.quantity_received, sold: null, remaining: t.lot.quantity_remaining, unit: t.lot.unit, status: t.lot.status });
      for (const s of t.semiLots) {
        items.push({ kind: 'semi_finished_lot', lot_id: s.id, label: s.recipe_name, lot_number: s.lot_number, store_id: s.store_id,
          certainty: 'certain', total: s.quantity_produced, sold: null, remaining: s.quantity_remaining, unit: s.unit, status: s.status });
      }
      for (const l of t.productLots) {
        items.push({ kind: 'product_lot', lot_id: l.id, label: l.product_name, lot_number: l.lot_number, store_id: l.store_id,
          certainty: l.certainty, total: l.quantity_total, sold: l.sold_qty, remaining: l.remaining_qty, unit: 'u', status: l.status });
      }
    } else {
      const [l] = await productLotsDetail(`pl.id = $1`, [p.originId]);
      if (!l) return null;
      originLabel = `${l.product_name} — lot ${l.lot_number}`;
      items.push({ kind: 'product_lot', lot_id: l.id, label: l.product_name, lot_number: l.lot_number, store_id: l.store_id,
        certainty: 'certain', total: l.quantity_total, sold: l.sold_qty, remaining: l.remaining_qty, unit: 'u', status: l.status });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows: seq } = await client.query(
        `SELECT COUNT(*)::int + 1 AS n FROM product_recalls WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())`,
      );
      const reference = `RAP-${new Date().getFullYear()}-${String(seq[0].n).padStart(3, '0')}`;
      const { rows } = await client.query(
        `INSERT INTO product_recalls (reference, store_id, origin_kind, origin_id, origin_label, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [reference, p.storeId, p.originKind, p.originId, originLabel, p.reason, p.userId],
      );
      const recall = rows[0];
      for (const it of items) {
        await client.query(
          `INSERT INTO product_recall_items
             (recall_id, item_kind, lot_id, label, lot_number, store_id, certainty, qty_total, qty_sold, qty_remaining, unit, previous_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT DO NOTHING`,
          [recall.id, it.kind, it.lot_id, it.label, it.lot_number, it.store_id, it.certainty, it.total, it.sold, it.remaining, it.unit, it.status],
        );
      }
      await client.query('COMMIT');
      return recall;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async listRecalls(storeId: string | null) {
    const { rows } = await db.query(
      `SELECT r.*, (SELECT COUNT(*) FROM product_recall_items i WHERE i.recall_id = r.id)::int AS items_count,
              COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS created_by_name
         FROM product_recalls r LEFT JOIN users u ON u.id = r.created_by
        WHERE ($1::uuid IS NULL OR r.store_id IS NULL OR r.store_id = $1::uuid)
        ORDER BY r.created_at DESC LIMIT 200`,
      [storeId],
    );
    return rows;
  },

  /** Détail avec les quantités ACTUELLES (le périmètre est figé, les stocks évoluent). */
  async getRecall(id: string) {
    const { rows } = await db.query(
      `SELECT r.*,
              COALESCE(NULLIF(TRIM(cu.first_name || ' ' || cu.last_name), ''), cu.email) AS created_by_name,
              COALESCE(NULLIF(TRIM(bu.first_name || ' ' || bu.last_name), ''), bu.email) AS blocked_by_name,
              COALESCE(NULLIF(TRIM(xu.first_name || ' ' || xu.last_name), ''), xu.email) AS closed_by_name
         FROM product_recalls r
         LEFT JOIN users cu ON cu.id = r.created_by
         LEFT JOIN users bu ON bu.id = r.blocked_by
         LEFT JOIN users xu ON xu.id = r.closed_by
        WHERE r.id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    const { rows: items } = await db.query(
      `SELECT i.*, st.name AS store_name,
              CASE i.item_kind
                WHEN 'ingredient_lot' THEN (SELECT quantity_remaining FROM ingredient_lots WHERE id = i.lot_id)
                WHEN 'semi_finished_lot' THEN (SELECT quantity_remaining FROM semi_finished_lots WHERE id = i.lot_id)
                ELSE (SELECT backroom_qty + vitrine_qty FROM product_lots WHERE id = i.lot_id)
              END::float AS current_remaining,
              CASE i.item_kind
                WHEN 'ingredient_lot' THEN (SELECT status FROM ingredient_lots WHERE id = i.lot_id)
                WHEN 'semi_finished_lot' THEN (SELECT status FROM semi_finished_lots WHERE id = i.lot_id)
                ELSE (SELECT status FROM product_lots WHERE id = i.lot_id)
              END AS current_status,
              CASE WHEN i.item_kind = 'product_lot'
                   THEN (SELECT COUNT(DISTINCT ref_id) FROM product_lot_movements WHERE product_lot_id = i.lot_id AND kind = 'sale')
              END::int AS sales_count
         FROM product_recall_items i LEFT JOIN stores st ON st.id = i.store_id
        WHERE i.recall_id = $1
        ORDER BY CASE i.item_kind WHEN 'ingredient_lot' THEN 0 WHEN 'semi_finished_lot' THEN 1 ELSE 2 END, i.certainty, i.label`,
      [id],
    );
    return { ...rows[0], items };
  },

  /**
   * Blocage : lots ingrédients en quarantaine, semi-finis et lots produits en
   * 'recalled' (hors FEFO : plus vendus ni mis en vitrine). Alerte gérants et boutiques.
   */
  async blockRecall(id: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT * FROM product_recalls WHERE id = $1 FOR UPDATE`, [id]);
      const recall = rows[0];
      if (!recall) return null;
      if (recall.status !== 'open') throw Object.assign(new Error('Rappel déjà bloqué ou clôturé'), { statusCode: 409 });
      const { rows: items } = await client.query(`SELECT * FROM product_recall_items WHERE recall_id = $1`, [id]);
      for (const it of items) {
        if (it.item_kind === 'ingredient_lot') {
          await ingredientLotRepository.quarantine(it.lot_id, userId, `rappel ${recall.reference}`, client);
        } else if (it.item_kind === 'semi_finished_lot') {
          await client.query(`UPDATE semi_finished_lots SET status = 'recalled' WHERE id = $1 AND status IN ('active', 'expired')`, [it.lot_id]);
        } else {
          await client.query(
            `UPDATE product_lots SET status = 'recalled', notes = concat_ws(E'\\n', NULLIF(notes, ''), 'Rappel ' || $2::text), updated_at = NOW()
              WHERE id = $1 AND status IN ('active', 'expired')`,
            [it.lot_id, recall.reference],
          );
        }
      }
      await client.query(
        `UPDATE product_recalls SET status = 'blocked', blocked_by = $2, blocked_at = NOW() WHERE id = $1`, [id, userId],
      );
      await client.query('COMMIT');

      const stores = [...new Set(items.filter(i => i.store_id).map(i => i.store_id as string))];
      for (const targetRole of ['manager', 'admin', 'saleswoman', 'cashier']) {
        for (const storeId of stores.length ? stores : [undefined]) {
          await createNotification({
            targetRole, storeId, type: 'product_recall', title: `Rappel ${recall.reference}`,
            message: `Retirer immédiatement de la vente : ${recall.origin_label}. Motif : ${recall.reason}`,
            referenceType: 'product_recall', referenceId: id, createdBy: userId,
          });
        }
      }
      return this.getRecall(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async setDisposition(recallId: string, itemId: string, disposition: string | null, note: string | null) {
    const { rows } = await db.query(
      `UPDATE product_recall_items i SET disposition = $3, disposition_note = $4
         FROM product_recalls r
        WHERE i.id = $2 AND i.recall_id = $1 AND r.id = i.recall_id AND r.status <> 'closed'
        RETURNING i.*`,
      [recallId, itemId, disposition, note],
    );
    return rows[0] ?? null;
  },

  async closeRecall(id: string, note: string, userId: string) {
    const { rows: pending } = await db.query(
      `SELECT COUNT(*)::int AS n FROM product_recall_items WHERE recall_id = $1 AND disposition IS NULL`, [id],
    );
    if (pending[0].n > 0) throw Object.assign(new Error(`${pending[0].n} lot(s) sans destination renseignée`), { statusCode: 409 });
    const { rows } = await db.query(
      `UPDATE product_recalls SET status = 'closed', closed_by = $2, closed_at = NOW(), closing_note = $3
        WHERE id = $1 AND status = 'blocked' RETURNING id`,
      [id, userId, note],
    );
    return rows[0] ? this.getRecall(id) : null;
  },
};
