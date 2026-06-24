import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { capitalizeFirst } from '../utils/text.js';

/**
 * Packaging items — emballages : caissettes, boites, sachets, etiquettes, films...
 *
 * Modele dedie, separe des ingredients alimentaires :
 *   - Pas de lots ni DLC (pas pertinent pour les emballages)
 *   - Pas de FEFO (pas de chrono d'expiration)
 *   - Stock simple par store (packaging_store_stock)
 *   - Mouvements traces dans packaging_stock_transactions (journal flat)
 *   - Cout integre a recipe.total_cost via recipe_packaging
 */

export interface PackagingItem {
  id: string;
  name: string;
  format: string | null;
  unit: string;
  unit_cost: number;
  supplier: string | null;
  category: string;
  is_recyclable: boolean;
  is_compostable: boolean;
  is_food_safe: boolean;
  is_active: boolean;
  notes: string | null;
}

export const packagingItemRepository = {

  // ─── CRUD ─────────────────────────────────────────────────────────────
  async findAll(params: { search?: string; category?: string; categoryId?: string; storeId?: string; activeOnly?: boolean }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.activeOnly !== false) conditions.push(`pi.is_active = true`);
    if (params.search) { conditions.push(`pi.name ILIKE $${i++}`); values.push(`%${params.search}%`); }
    if (params.category) { conditions.push(`pi.category = $${i++}`); values.push(params.category); }
    // Categorie referentiel (expense_categories) : filtre sur la feuille choisie.
    if (params.categoryId) { conditions.push(`pi.category_id = $${i++}`); values.push(params.categoryId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const storeJoin = params.storeId
      ? `LEFT JOIN packaging_store_stock pss ON pss.packaging_id = pi.id AND pss.store_id = $${i++}`
      : '';
    if (params.storeId) values.push(params.storeId);
    const stockCols = params.storeId
      ? `COALESCE(pss.stock_quantity, 0) as stock_quantity, COALESCE(pss.stock_min_threshold, 0) as stock_min_threshold,`
      : '';
    const result = await db.query(
      `SELECT pi.*, ${stockCols} ec.name as category_name
       FROM packaging_items pi
       LEFT JOIN expense_categories ec ON ec.id = pi.category_id
       ${storeJoin}
       ${where}
       ORDER BY ec.name NULLS LAST, pi.name`,
      values
    );
    return result.rows;
  },

  async findById(id: string, storeId?: string) {
    const params: unknown[] = [id];
    let storeJoin = '';
    let stockCols = '';
    if (storeId) {
      params.push(storeId);
      storeJoin = `LEFT JOIN packaging_store_stock pss ON pss.packaging_id = pi.id AND pss.store_id = $2`;
      stockCols = `, COALESCE(pss.stock_quantity, 0) as stock_quantity, COALESCE(pss.stock_min_threshold, 0) as stock_min_threshold`;
    }
    const result = await db.query(
      `SELECT pi.* ${stockCols}, ec.name as category_name
       FROM packaging_items pi
       LEFT JOIN expense_categories ec ON ec.id = pi.category_id
       ${storeJoin}
       WHERE pi.id = $1`,
      params
    );
    return result.rows[0] || null;
  },

  async create(data: {
    name: string; format?: string | null; unit?: string; unit_cost?: number;
    supplier?: string | null; category?: string; category_id?: string | null;
    is_recyclable?: boolean; is_compostable?: boolean; is_food_safe?: boolean;
    notes?: string | null;
  }) {
    const result = await db.query(
      `INSERT INTO packaging_items
         (name, format, unit, unit_cost, supplier, category, category_id,
          is_recyclable, is_compostable, is_food_safe, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        capitalizeFirst(data.name), data.format ?? null,
        data.unit ?? 'piece', data.unit_cost ?? 0,
        data.supplier ?? null, data.category ?? 'autre', data.category_id ?? null,
        data.is_recyclable ?? false, data.is_compostable ?? false,
        data.is_food_safe ?? true, data.notes ?? null,
      ]
    );
    return result.rows[0];
  },

  async update(id: string, data: Record<string, unknown>) {
    const allowed = ['name','format','unit','unit_cost','supplier','category','category_id',
                      'is_recyclable','is_compostable','is_food_safe','is_active','notes'];
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const k of allowed) {
      if (data[k] !== undefined) {
        // Nom toujours capitalise (1re lettre en majuscule) cote Economat.
        const val = k === 'name' ? capitalizeFirst(data[k] as string) : data[k];
        fields.push(`${k} = $${i++}`); values.push(val);
      }
    }
    if (fields.length === 0) return this.findById(id);
    fields.push(`updated_at = NOW()`);
    values.push(id);
    const result = await db.query(
      `UPDATE packaging_items SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  async remove(id: string) {
    // Soft delete : passe is_active=false
    await db.query(`UPDATE packaging_items SET is_active = false, updated_at = NOW() WHERE id = $1`, [id]);
  },

  // ─── Stock multi-store ────────────────────────────────────────────────
  async getStock(packagingId: string, storeId: string): Promise<number> {
    const result = await db.query(
      `SELECT stock_quantity FROM packaging_store_stock WHERE packaging_id = $1 AND store_id = $2`,
      [packagingId, storeId]
    );
    return parseFloat(result.rows[0]?.stock_quantity ?? 0);
  },

  /** Ajuste le stock + cree une transaction. Use case generique. */
  async adjustStock(
    client: PoolClient | typeof db,
    data: {
      packagingId: string; storeId: string;
      change: number;  // positif = reception, negatif = consommation
      type: 'reception' | 'consumption' | 'adjustment' | 'waste' | 'restock';
      referenceId?: string | null; referenceType?: string | null;
      unitCost?: number | null;
      note?: string;
      performedBy?: string;
    }
  ): Promise<number> {
    // Upsert + decrement avec lock implicite (ON CONFLICT pour atomique)
    const result = await client.query(
      `INSERT INTO packaging_store_stock (packaging_id, store_id, stock_quantity)
       VALUES ($1, $2, GREATEST($3::numeric, 0))
       ON CONFLICT (packaging_id, store_id)
       DO UPDATE SET stock_quantity = GREATEST(packaging_store_stock.stock_quantity + $3::numeric, 0),
                     updated_at = NOW()
       RETURNING stock_quantity`,
      [data.packagingId, data.storeId, data.change]
    );
    const newStock = parseFloat(result.rows[0].stock_quantity);

    await client.query(
      `INSERT INTO packaging_stock_transactions
         (packaging_id, store_id, type, quantity_change, stock_after,
          reference_id, reference_type, unit_cost, note, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        data.packagingId, data.storeId, data.type, data.change, newStock,
        data.referenceId ?? null, data.referenceType ?? null,
        data.unitCost ?? null, data.note ?? null, data.performedBy ?? null,
      ]
    );
    return newStock;
  },

  /** Reception multi-emballages d'un coup (depuis bon de commande typiquement). */
  async receiveBatch(
    client: PoolClient,
    storeId: string,
    items: { packagingId: string; quantity: number; unitCost?: number }[],
    referenceId?: string | null,
    referenceType?: string | null,
    performedBy?: string
  ) {
    for (const it of items) {
      await this.adjustStock(client, {
        packagingId: it.packagingId,
        storeId,
        change: it.quantity,
        type: 'reception',
        referenceId,
        referenceType,
        unitCost: it.unitCost ?? null,
        performedBy,
      });
      // Met a jour le prix unitaire du catalogue si reception avec un prix
      if (it.unitCost && it.unitCost > 0) {
        await client.query(
          `UPDATE packaging_items SET unit_cost = $1, updated_at = NOW() WHERE id = $2`,
          [it.unitCost, it.packagingId]
        );
      }
    }
  },

  // ─── Liens recettes ──────────────────────────────────────────────────
  async findByRecipe(recipeId: string) {
    const result = await db.query(
      `SELECT rp.*, pi.name as packaging_name, pi.format, pi.unit_cost,
              COALESCE(rp.unit, pi.unit) as unit, pi.unit as base_unit, pi.category
       FROM recipe_packaging rp
       JOIN packaging_items pi ON pi.id = rp.packaging_id
       WHERE rp.recipe_id = $1
       ORDER BY pi.name`,
      [recipeId]
    );
    return result.rows;
  },

  async upsertRecipeLinks(
    client: PoolClient,
    recipeId: string,
    items: { packagingId: string; quantity: number; unit?: string | null; notes?: string | null }[]
  ) {
    // Strategie : DELETE + INSERT (consistant avec recipe_ingredients)
    await client.query(`DELETE FROM recipe_packaging WHERE recipe_id = $1`, [recipeId]);
    for (const it of items) {
      await client.query(
        `INSERT INTO recipe_packaging (recipe_id, packaging_id, quantity, unit, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [recipeId, it.packagingId, it.quantity, it.unit ?? null, it.notes ?? null]
      );
    }
  },

  /** Calcule le cout emballages total d'une recette (somme qty * unit_cost). */
  async computeRecipePackagingCost(client: PoolClient | typeof db, recipeId: string): Promise<number> {
    const result = await client.query(
      `SELECT COALESCE(SUM(rp.quantity * pi.unit_cost), 0) as total_cost
       FROM recipe_packaging rp
       JOIN packaging_items pi ON pi.id = rp.packaging_id
       WHERE rp.recipe_id = $1`,
      [recipeId]
    );
    return parseFloat(result.rows[0].total_cost);
  },

  /** Recettes qui utilisent un packaging (utile pour cascade prix). */
  async findRecipesByPackaging(packagingId: string): Promise<string[]> {
    const result = await db.query(
      `SELECT DISTINCT recipe_id FROM recipe_packaging WHERE packaging_id = $1`,
      [packagingId]
    );
    return result.rows.map(r => r.recipe_id);
  },
};
