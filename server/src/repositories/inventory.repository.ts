import { db } from '../config/database.js';
import { recipeRepository } from './recipe.repository.js';

export const inventoryRepository = {
  async findAll(storeId?: string) {
    const where = storeId ? 'WHERE inv.store_id = $1' : '';
    const lotStoreFilter = storeId ? 'AND store_id = $1' : '';
    const txStoreFilter = storeId ? 'AND store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `WITH lot_stats AS (
         SELECT ingredient_id,
                COALESCE(SUM(economat_quantity), 0) as economat_quantity,
                COALESCE(SUM(pesage_quantity), 0) as pesage_quantity,
                COUNT(*) FILTER (WHERE quantity_remaining > 0) as active_lots_count,
                COUNT(*) FILTER (WHERE economat_quantity > 0) as economat_lots_count,
                COUNT(*) FILTER (WHERE pesage_quantity > 0) as pesage_lots_count,
                MIN(expiration_date) FILTER (WHERE quantity_remaining > 0 AND expiration_date IS NOT NULL) as nearest_dlc,
                MIN(expiration_date) FILTER (WHERE pesage_quantity > 0) as pesage_nearest_dlc,
                COUNT(*) FILTER (WHERE quantity_remaining > 0 AND expiration_date < CURRENT_DATE) as expired_lots_count,
                COUNT(*) FILTER (WHERE quantity_remaining > 0 AND expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) as expiring_soon_count,
                string_agg(DISTINCT supplier_lot_number, ', ' ORDER BY supplier_lot_number)
                  FILTER (WHERE quantity_remaining > 0 AND supplier_lot_number IS NOT NULL) as active_lot_numbers
         FROM ingredient_lots
         WHERE status = 'active' ${lotStoreFilter}
         GROUP BY ingredient_id
       ),
       consumption_stats AS (
         SELECT ingredient_id,
                COALESCE(ABS(SUM(quantity_change)) / NULLIF(GREATEST(
                  EXTRACT(DAY FROM (NOW() - MIN(created_at)))::int, 1
                ), 0), 0) as avg_daily_consumption
         FROM inventory_transactions
         WHERE quantity_change < 0
           AND created_at >= NOW() - INTERVAL '30 days'
           ${txStoreFilter}
         GROUP BY ingredient_id
       )
       SELECT inv.*, ing.name as ingredient_name, ing.unit, ing.unit_cost, ing.supplier, ing.category,
              ing.container_size,
              COALESCE(ls.economat_quantity, 0) as economat_quantity,
              COALESCE(ls.pesage_quantity, 0) as pesage_quantity,
              COALESCE(ls.active_lots_count, 0) as active_lots_count,
              COALESCE(ls.economat_lots_count, 0) as economat_lots_count,
              COALESCE(ls.pesage_lots_count, 0) as pesage_lots_count,
              ls.nearest_dlc,
              ls.pesage_nearest_dlc,
              COALESCE(ls.expired_lots_count, 0) as expired_lots_count,
              COALESCE(ls.expiring_soon_count, 0) as expiring_soon_count,
              ls.active_lot_numbers,
              COALESCE(cs.avg_daily_consumption, 0) as avg_daily_consumption
       FROM inventory inv
       JOIN ingredients ing ON ing.id = inv.ingredient_id
       LEFT JOIN lot_stats ls ON ls.ingredient_id = inv.ingredient_id
       LEFT JOIN consumption_stats cs ON cs.ingredient_id = inv.ingredient_id
       ${where}
       ORDER BY ing.category, ing.name`,
      params
    );
    return result.rows;
  },

  async findAlerts(storeId?: string) {
    const storeFilter = storeId ? ' AND inv.store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `SELECT inv.*, ing.name as ingredient_name, ing.unit, ing.category
       FROM inventory inv JOIN ingredients ing ON ing.id = inv.ingredient_id
       WHERE inv.current_quantity <= inv.minimum_threshold${storeFilter}
       ORDER BY (inv.current_quantity / NULLIF(inv.minimum_threshold, 0))`,
      params
    );
    return result.rows;
  },

  async restock(ingredientId: string, quantity: number, performedBy: string, note?: string, storeId?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const storeFilter = storeId ? ' AND store_id = $3' : '';
      const updateParams: unknown[] = [quantity, ingredientId];
      if (storeId) updateParams.push(storeId);
      await client.query(
        `UPDATE inventory SET current_quantity = current_quantity + $1, last_restocked_at = NOW(), updated_at = NOW()
         WHERE ingredient_id = $2${storeFilter}`,
        updateParams
      );
      await client.query(
        `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id)
         VALUES ($1, 'restock', $2, $3, $4, $5)`,
        [ingredientId, quantity, note || null, performedBy, storeId || null]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Consommation matieres par periode (admin/gerant).
   *
   * Source : inventory_transactions outflows (quantity_change < 0). Couvre
   * tous les motifs de sortie de stock :
   *   - 'usage' / 'production' : matieres consommees en production
   *   - 'waste' : pertes / dlc / casse
   *   - 'adjustment' : ajustements manuels (inventaire physique, correction)
   *
   * On exclut les types 'restock' (entree) et les adjustments POSITIFS
   * (entrees ponctuelles, ex : retour fournisseur).
   *
   * Cout : qty_sortie x ingredients.unit_cost (cout courant). Si tu changes
   * le prix d'un ingredient, l'historique sera reevalue au cout actuel —
   * acceptable pour un suivi tresorerie sur un mois donne, mais pas pour
   * une compta TVA stricte. Pour ca il faudrait stocker le cout au moment
   * de la transaction (cf. production_lot_usage qui le fait par lot).
   *
   * Retourne des lignes (ingredient_id, type) — le frontend agrege/groupe.
   */
  async findMaterialConsumption(params: { dateFrom?: string; dateTo?: string; storeId?: string }) {
    const conditions: string[] = [
      `it.type IN ('usage', 'production', 'waste', 'adjustment')`,
      `it.quantity_change < 0`,
    ];
    const values: unknown[] = [];
    let i = 1;
    if (params.storeId) { conditions.push(`it.store_id = $${i++}`); values.push(params.storeId); }
    if (params.dateFrom) { conditions.push(`it.created_at::date >= $${i++}::date`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`it.created_at::date <= $${i++}::date`); values.push(params.dateTo); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await db.query(
      `SELECT
         ing.id                                        AS ingredient_id,
         ing.name                                      AS ingredient_name,
         ing.unit                                      AS ingredient_unit,
         ing.category                                  AS ingredient_category,
         ing.unit_cost                                 AS unit_cost,
         it.type                                       AS movement_type,
         COUNT(*)::int                                 AS transaction_count,
         COALESCE(SUM(ABS(it.quantity_change)), 0)     AS qty_consumed,
         ROUND(
           (COALESCE(SUM(ABS(it.quantity_change)), 0) * COALESCE(ing.unit_cost, 0))::numeric,
           2
         )                                             AS cost_consumed,
         MIN(it.created_at)                            AS first_movement_at,
         MAX(it.created_at)                            AS last_movement_at
       FROM inventory_transactions it
       JOIN ingredients ing ON ing.id = it.ingredient_id
       ${where}
       GROUP BY ing.id, ing.name, ing.unit, ing.category, ing.unit_cost, it.type
       ORDER BY cost_consumed DESC, ing.name`,
      values
    );
    return result.rows;
  },

  async getTransactions(ingredientId?: string, limit = 50, storeId?: string) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (ingredientId) { conditions.push(`it.ingredient_id = $${idx++}`); values.push(ingredientId); }
    if (storeId) { conditions.push(`it.store_id = $${idx++}`); values.push(storeId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit);
    const result = await db.query(
      `SELECT it.*, ing.name as ingredient_name, ing.unit as ingredient_unit,
              u.first_name as performed_by_first, u.last_name as performed_by_last, u.role as performed_by_role,
              COALESCE(u.first_name || ' ' || u.last_name, 'Système') as performed_by_name
       FROM inventory_transactions it
       JOIN ingredients ing ON ing.id = it.ingredient_id
       LEFT JOIN users u ON u.id = it.performed_by
       ${where}
       ORDER BY it.created_at DESC
       LIMIT $${idx}`,
      values
    );
    return result.rows;
  },
};

export const ingredientRepository = {
  async findAll() {
    const result = await db.query('SELECT * FROM ingredients ORDER BY name');
    return result.rows;
  },

  async findById(id: string) {
    const result = await db.query('SELECT * FROM ingredients WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data: { name: string; unit: string; unitCost: number; supplier?: string; allergens?: string[]; category?: string; storeId?: string | null }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO ingredients (name, unit, unit_cost, supplier, allergens, category) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [data.name, data.unit, data.unitCost, data.supplier || null, data.allergens || [], data.category || 'autre']
      );
      // Create inventory entry, scoped to the current store (multi-store).
      // Sans store_id, le listing (WHERE inv.store_id = $1) ne montre pas
      // l'ingredient pour les users avec un storeId. Le trigger
      // trg_inventory_sync_lots corrigerait au premier restock mais on ne
      // peut pas compter dessus (un ingredient sans stock initial reste invisible).
      await client.query(
        `INSERT INTO inventory (ingredient_id, store_id) VALUES ($1, $2)`,
        [result.rows[0].id, data.storeId || null]
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      name: 'name', unit: 'unit', unitCost: 'unit_cost', supplier: 'supplier', allergens: 'allergens', category: 'category',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return this.findById(id);
    values.push(id);
    const result = await db.query(`UPDATE ingredients SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);

    // When unit cost changes, cascade product price (price-only — recipe total_cost
    // n'est plus stocke ; il est calcule a la volee via v_recipe_total_cost).
    if (data.unitCost !== undefined) {
      const recipes = await db.query(
        `SELECT DISTINCT recipe_id FROM recipe_ingredients WHERE ingredient_id = $1`,
        [id]
      );
      for (const row of recipes.rows) {
        const recipe = await recipeRepository.findById(row.recipe_id);
        if (!recipe) continue;
        // findById renvoie total_cost depuis la vue : a jour automatiquement.
        const totalCost = parseFloat(recipe.total_cost || '0');
        const margin = parseFloat(recipe.margin_multiplier || '3');
        const yieldQty = parseFloat(recipe.yield_quantity || '1');
        const yieldUnit = recipe.yield_unit || 'unit';
        const pieceWeightKg = recipe.piece_weight_kg !== null && recipe.piece_weight_kg !== undefined
          ? parseFloat(recipe.piece_weight_kg as string) : null;
        await recipeRepository.syncProductPrice(db, recipe.product_id || null, totalCost, yieldQty, yieldUnit, pieceWeightKg, margin);
        // Cascade up to parent recipes (also syncs their product price via recalcParents)
        await recipeRepository.recalcParents(row.recipe_id);
      }
    }

    return result.rows[0];
  },

  /**
   * Suppression d'un ingredient. La table `ingredients` est referencee par
   * de nombreuses autres tables (la plupart sans `ON DELETE CASCADE`). On bloque
   * si l'ingredient est utilise dans une recette (rupture metier). Le stock
   * restant ne bloque PAS quand `force=true` — il est jete et trace via
   * inventory_transactions type='waste' pour audit ONSSA.
   */
  async delete(id: string, opts: { force?: boolean } = {}): Promise<{ ok: true; wastedQty?: number } | { ok: false; reason: string; activeStock?: number }> {
    // 1) Bloquant : recettes utilisant l'ingredient (suppression casserait les recettes)
    const recipeUses = await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(string_agg(DISTINCT r.name, ', ' ORDER BY r.name), '') AS names
       FROM recipe_ingredients ri JOIN recipes r ON r.id = ri.recipe_id
       WHERE ri.ingredient_id = $1`,
      [id]
    );
    const recipeCount = recipeUses.rows[0]?.n ?? 0;
    if (recipeCount > 0) {
      const names = String(recipeUses.rows[0]?.names || '').split(', ').filter(Boolean).slice(0, 3).join(', ');
      const suffix = recipeCount > 3 ? `… (${recipeCount} au total)` : '';
      return {
        ok: false,
        reason: `Ingredient utilise dans ${recipeCount} recette(s) : ${names}${suffix}. Retirez-le de ces recettes avant suppression.`,
      };
    }

    // 2) Stock actif : bloque seulement si force=false. En mode force, le stock
    // sera jete et trace plus bas comme 'waste' pour preserver l'audit ONSSA.
    const activeStock = await db.query(
      `SELECT COALESCE(SUM(economat_quantity + pesage_quantity), 0)::numeric AS qty
       FROM ingredient_lots WHERE ingredient_id = $1 AND status = 'active'`,
      [id]
    );
    const qty = parseFloat(activeStock.rows[0]?.qty || '0') || 0;
    if (qty > 0.0001 && !opts.force) {
      return {
        ok: false,
        reason: `Stock actif restant (${qty.toFixed(2)}). Videz/jetez le stock avant suppression.`,
        activeStock: qty,
      };
    }

    // 2) Cascade manuelle des historiques dans une transaction
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      // Desactive le trigger trg_inventory_sync_lots le temps de la transaction.
      // Sinon, le CASCADE de DELETE FROM ingredients vers ingredient_lots fait fire
      // le trigger par ligne, qui tente INSERT/UPDATE sur inventory avec un
      // ingredient_id en train d'etre supprime -> FK violation. La table inventory
      // est de toute facon supprimee dans cette transaction, donc le sync est inutile.
      // session_replication_role = replica saute tous les triggers user pour cette
      // session — ne requiert pas superuser sur PG >= 9.5.
      await client.query(`SET LOCAL session_replication_role = replica`);

      // Cascade manuelle pour les tables qui referencent ingredients(id) SANS ON DELETE CASCADE.
      // Les tables qui CASCADE (ingredient_lots, purchase_requests, unsold_extras,
      // semi_fini_storages, etc.) sont nettoyees automatiquement par PG via la cle etrangere.
      await client.query(`DELETE FROM inventory_transactions WHERE ingredient_id = $1`, [id]);
      await client.query(`DELETE FROM inventory WHERE ingredient_id = $1`, [id]);
      await client.query(`DELETE FROM production_ingredient_needs WHERE ingredient_id = $1`, [id]);
      await client.query(`DELETE FROM production_bons_sortie_lignes WHERE ingredient_id = $1`, [id]);
      await client.query(`DELETE FROM reception_voucher_items WHERE ingredient_id = $1`, [id]);
      await client.query(`DELETE FROM purchase_order_items WHERE ingredient_id = $1`, [id]);
      // invoice_items.ingredient_id est nullable (migration 055) → on conserve la ligne
      await client.query(`UPDATE invoice_items SET ingredient_id = NULL WHERE ingredient_id = $1`, [id]);
      // products.recycle_ingredient_id est nullable (migration 052) → on conserve le produit
      await client.query(`UPDATE products SET recycle_ingredient_id = NULL WHERE recycle_ingredient_id = $1`, [id]);

      const del = await client.query(`DELETE FROM ingredients WHERE id = $1 RETURNING id`, [id]);
      if (del.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'Ingredient introuvable' };
      }
      // session_replication_role est automatiquement reset au COMMIT (SET LOCAL).
      await client.query('COMMIT');
      // En mode force, on remonte au caller la qty jetee pour message UI.
      return opts.force && qty > 0 ? { ok: true, wastedQty: qty } : { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
