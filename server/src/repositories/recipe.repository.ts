import { db } from '../config/database.js';

// Unit conversion factors to a common base (kg for weight, l for volume)
const UNIT_TO_BASE: Record<string, { base: string; factor: number }> = {
  kg:   { base: 'kg', factor: 1 },
  g:    { base: 'kg', factor: 0.001 },
  l:    { base: 'l',  factor: 1 },
  ml:   { base: 'l',  factor: 0.001 },
  unit: { base: 'unit', factor: 1 },
};

/**
 * Convert quantity from one unit to another.
 * Returns the conversion factor: qty_in_fromUnit * factor = qty_in_toUnit
 * Returns 1 if units are incompatible (no conversion possible).
 */
function unitConversionFactor(fromUnit: string, toUnit: string): number {
  if (fromUnit === toUnit) return 1;
  const from = UNIT_TO_BASE[fromUnit];
  const to = UNIT_TO_BASE[toUnit];
  if (!from || !to || from.base !== to.base) return 1; // incompatible units
  return from.factor / to.factor;
}

export const recipeRepository = {
  async findAll() {
    // total_cost est recalcule a la volee pour ne pas dependre de la valeur stockee
    // qui peut etre obsolete (recettes creees avant l'ajout de la conversion d'unite).
    //
    // Strategie : on calcule d'abord le cout "direct" de chaque recette (ingredients +
    // emballages), puis les sous-recettes referencent ce cout direct au lieu du total_cost
    // stocke. Ca corrige la cascade : si Biscuit a un total_cost stocke faux, le parent
    // OFAURIA qui l'utilise comme sous-recette reflete quand meme le bon cout.
    //
    // Supporte 1 niveau de nesting (sous-recette plate). Pour les niveaux plus profonds
    // il faudrait un CTE recursif.
    const result = await db.query(
      `WITH ingredient_costs AS (
         SELECT ri.recipe_id, SUM(
           ri.quantity * COALESCE(ing.unit_cost, 0) *
           CASE
             WHEN COALESCE(ri.unit, ing.unit) = 'g'  AND ing.unit = 'kg' THEN 0.001
             WHEN COALESCE(ri.unit, ing.unit) = 'kg' AND ing.unit = 'g'  THEN 1000
             WHEN COALESCE(ri.unit, ing.unit) = 'ml' AND ing.unit = 'l'  THEN 0.001
             WHEN COALESCE(ri.unit, ing.unit) = 'l'  AND ing.unit = 'ml' THEN 1000
             ELSE 1
           END
         ) AS cost
         FROM recipe_ingredients ri JOIN ingredients ing ON ing.id = ri.ingredient_id
         GROUP BY ri.recipe_id
       ),
       packaging_costs AS (
         SELECT rp.recipe_id, SUM(rp.quantity * COALESCE(pi.unit_cost, 0)) AS cost
         FROM recipe_packaging rp JOIN packaging_items pi ON pi.id = rp.packaging_id
         GROUP BY rp.recipe_id
       ),
       -- Cout direct de chaque recette = ingredients + emballages (sans sous-recettes).
       -- Utilise ensuite comme source de verite pour le cout d'une sous-recette referencee.
       direct_costs AS (
         SELECT r.id, r.yield_quantity,
                (COALESCE(ic.cost, 0) + COALESCE(pkc.cost, 0)) AS cost
         FROM recipes r
         LEFT JOIN ingredient_costs ic ON ic.recipe_id = r.id
         LEFT JOIN packaging_costs pkc ON pkc.recipe_id = r.id
       ),
       sub_recipe_costs AS (
         SELECT rsr.recipe_id,
                SUM(rsr.quantity * COALESCE(dc.cost, 0) / NULLIF(dc.yield_quantity, 0)) AS cost
         FROM recipe_sub_recipes rsr
         JOIN direct_costs dc ON dc.id = rsr.sub_recipe_id
         GROUP BY rsr.recipe_id
       )
       SELECT r.id, r.name, r.is_base, r.product_id, r.contenant_id, r.instructions,
              r.yield_quantity, r.yield_unit, r.margin_multiplier, r.etapes,
              r.created_at, r.updated_at,
              (COALESCE(ic.cost, 0) + COALESCE(src.cost, 0) + COALESCE(pkc.cost, 0)) AS total_cost,
              p.name as product_name, p.image_url as product_image, p.price as product_price,
              pc.nom as contenant_nom, pc.type_production as contenant_type,
              pc.quantite_theorique as contenant_quantite_theorique,
              pc.pertes_fixes as contenant_pertes_fixes,
              pc.unite_lancement as contenant_unite_lancement,
              pc.poids_kg as contenant_poids_kg
       FROM recipes r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN production_contenants pc ON pc.id = r.contenant_id
       LEFT JOIN ingredient_costs ic ON ic.recipe_id = r.id
       LEFT JOIN sub_recipe_costs src ON src.recipe_id = r.id
       LEFT JOIN packaging_costs pkc ON pkc.recipe_id = r.id
       ORDER BY r.is_base DESC, r.name`
    );
    return result.rows;
  },

  async findById(id: string) {
    const recipeResult = await db.query(
      `SELECT r.*, r.is_base, p.name as product_name, p.price as product_price,
              pc.nom as contenant_nom, pc.type_production as contenant_type, pc.quantite_theorique as contenant_quantite_theorique,
              pc.pertes_fixes as contenant_pertes_fixes, pc.unite_lancement as contenant_unite_lancement, pc.poids_kg as contenant_poids_kg
       FROM recipes r LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN production_contenants pc ON pc.id = r.contenant_id
       WHERE r.id = $1`,
      [id]
    );
    if (!recipeResult.rows[0]) return null;

    const ingredientsResult = await db.query(
      `SELECT ri.*, ing.name as ingredient_name, COALESCE(ri.unit, ing.unit) as unit, ing.unit as ingredient_base_unit, ing.unit_cost
       FROM recipe_ingredients ri JOIN ingredients ing ON ing.id = ri.ingredient_id
       WHERE ri.recipe_id = $1`,
      [id]
    );

    // Fetch sub-recipes — sub_total_cost est recalcule a la volee depuis les ingredients
    // de la sous-recette (avec conversion d'unite g/kg, ml/l) pour ne pas refleter une
    // valeur stockee obsolete. La sous-recette ne peut elle-meme avoir de sous-recettes
    // dans la pratique (preparations de base = leaf nodes), donc ingredients + emballages
    // suffit.
    const subRecipesResult = await db.query(
      `SELECT rsr.id, rsr.sub_recipe_id, rsr.quantity,
              sr.name as sub_recipe_name, sr.yield_quantity as sub_yield_quantity,
              sr.yield_unit as sub_yield_unit,
              (
                COALESCE((
                  SELECT SUM(
                    ri.quantity * COALESCE(ing.unit_cost, 0) *
                    CASE
                      WHEN COALESCE(ri.unit, ing.unit) = 'g'  AND ing.unit = 'kg' THEN 0.001
                      WHEN COALESCE(ri.unit, ing.unit) = 'kg' AND ing.unit = 'g'  THEN 1000
                      WHEN COALESCE(ri.unit, ing.unit) = 'ml' AND ing.unit = 'l'  THEN 0.001
                      WHEN COALESCE(ri.unit, ing.unit) = 'l'  AND ing.unit = 'ml' THEN 1000
                      ELSE 1
                    END
                  )
                  FROM recipe_ingredients ri JOIN ingredients ing ON ing.id = ri.ingredient_id
                  WHERE ri.recipe_id = sr.id
                ), 0)
                +
                COALESCE((
                  SELECT SUM(rp.quantity * COALESCE(pi.unit_cost, 0))
                  FROM recipe_packaging rp JOIN packaging_items pi ON pi.id = rp.packaging_id
                  WHERE rp.recipe_id = sr.id
                ), 0)
              ) AS sub_total_cost
       FROM recipe_sub_recipes rsr
       JOIN recipes sr ON sr.id = rsr.sub_recipe_id
       WHERE rsr.recipe_id = $1`,
      [id]
    );

    // Fetch packaging
    const packagingResult = await db.query(
      `SELECT rp.id, rp.packaging_id, rp.quantity, rp.unit, rp.notes,
              pi.name as packaging_name, pi.format, pi.unit_cost, pi.unit as base_unit, pi.category
       FROM recipe_packaging rp
       JOIN packaging_items pi ON pi.id = rp.packaging_id
       WHERE rp.recipe_id = $1`,
      [id]
    );

    return {
      ...recipeResult.rows[0],
      ingredients: ingredientsResult.rows,
      sub_recipes: subRecipesResult.rows,
      packaging: packagingResult.rows,
    };
  },

  /** Find recipe by product ID (with ingredients & sub-recipes & packaging) */
  async findByProductId(productId: string) {
    const recipeResult = await db.query(
      `SELECT r.*, r.is_base, p.name as product_name, p.price as product_price
       FROM recipes r LEFT JOIN products p ON p.id = r.product_id WHERE r.product_id = $1`,
      [productId]
    );
    if (!recipeResult.rows[0]) return null;

    const recipeId = recipeResult.rows[0].id;
    const ingredientsResult = await db.query(
      `SELECT ri.*, ing.name as ingredient_name, COALESCE(ri.unit, ing.unit) as unit, ing.unit as ingredient_base_unit, ing.unit_cost
       FROM recipe_ingredients ri JOIN ingredients ing ON ing.id = ri.ingredient_id
       WHERE ri.recipe_id = $1`,
      [recipeId]
    );
    const subRecipesResult = await db.query(
      `SELECT rsr.id, rsr.sub_recipe_id, rsr.quantity,
              sr.name as sub_recipe_name, sr.yield_quantity as sub_yield_quantity,
              sr.yield_unit as sub_yield_unit, sr.total_cost as sub_total_cost
       FROM recipe_sub_recipes rsr
       JOIN recipes sr ON sr.id = rsr.sub_recipe_id
       WHERE rsr.recipe_id = $1`,
      [recipeId]
    );
    const packagingResult = await db.query(
      `SELECT rp.id, rp.packaging_id, rp.quantity, rp.unit, rp.notes,
              pi.name as packaging_name, pi.format, pi.unit_cost, pi.unit as base_unit, pi.category
       FROM recipe_packaging rp
       JOIN packaging_items pi ON pi.id = rp.packaging_id
       WHERE rp.recipe_id = $1`,
      [recipeId]
    );

    return {
      ...recipeResult.rows[0],
      ingredients: ingredientsResult.rows,
      sub_recipes: subRecipesResult.rows,
      packaging: packagingResult.rows,
    };
  },

  /** List only base recipes (for sub-recipe picker) */
  async findBaseRecipes() {
    const result = await db.query(
      `SELECT id, name, yield_quantity, yield_unit, total_cost FROM recipes WHERE is_base = true ORDER BY name`
    );
    return result.rows;
  },

  async create(data: {
    productId?: string; name: string; instructions?: string; yieldQuantity?: number; yieldUnit?: string; isBase?: boolean;
    contenantId?: string; etapes?: unknown[]; marginMultiplier?: number; salePrice?: number | null;
    ingredients: { ingredientId: string; quantity: number; unit?: string | null }[];
    subRecipes?: { subRecipeId: string; quantity: number }[];
    packaging?: { packagingId: string; quantity: number; unit?: string | null }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Calculate ingredient cost (with unit conversion)
      let totalCost = 0;
      for (const ing of data.ingredients) {
        const ingResult = await client.query('SELECT unit_cost, unit FROM ingredients WHERE id = $1', [ing.ingredientId]);
        if (ingResult.rows[0]) {
          const ingBaseUnit = ingResult.rows[0].unit;
          const recipeUnit = ing.unit || ingBaseUnit;
          // Convert recipe quantity to ingredient base unit for cost calculation
          const factor = unitConversionFactor(recipeUnit, ingBaseUnit);
          totalCost += parseFloat(ingResult.rows[0].unit_cost) * ing.quantity * factor;
        }
      }

      // Calculate sub-recipe cost
      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          const srResult = await client.query(
            'SELECT total_cost, yield_quantity FROM recipes WHERE id = $1', [sr.subRecipeId]
          );
          if (srResult.rows[0]) {
            const costPerUnit = parseFloat(srResult.rows[0].total_cost) / (srResult.rows[0].yield_quantity || 1);
            totalCost += costPerUnit * sr.quantity;
          }
        }
      }

      // Calculate packaging cost (emballages)
      if (data.packaging && data.packaging.length > 0) {
        for (const pk of data.packaging) {
          const pkResult = await client.query('SELECT unit_cost FROM packaging_items WHERE id = $1', [pk.packagingId]);
          if (pkResult.rows[0]) {
            totalCost += parseFloat(pkResult.rows[0].unit_cost) * pk.quantity;
          }
        }
      }

      const margin = data.marginMultiplier && data.marginMultiplier > 0 ? data.marginMultiplier : 3;
      const recipeResult = await client.query(
        `INSERT INTO recipes (product_id, name, instructions, yield_quantity, yield_unit, total_cost, is_base, contenant_id, etapes, margin_multiplier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [data.productId || null, data.name, data.instructions || null, data.yieldQuantity || 1, data.yieldUnit || 'unit', totalCost, data.isBase || false, data.contenantId || null, JSON.stringify(data.etapes || []), margin]
      );

      const recipeId = recipeResult.rows[0].id;

      for (const ing of data.ingredients) {
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
          [recipeId, ing.ingredientId, ing.quantity, ing.unit || null]
        );
      }

      // Cycle detection for sub-recipes
      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          const hasCycle = await this.detectCycle(sr.subRecipeId, recipeId, client);
          if (hasCycle) {
            throw new Error(`Référence circulaire détectée: la sous-recette créerait un cycle`);
          }
        }
      }

      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          await client.query(
            `INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, $3)`,
            [recipeId, sr.subRecipeId, sr.quantity]
          );
        }
      }

      // Insert recipe_packaging links
      if (data.packaging && data.packaging.length > 0) {
        for (const pk of data.packaging) {
          await client.query(
            `INSERT INTO recipe_packaging (recipe_id, packaging_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
            [recipeId, pk.packagingId, pk.quantity, pk.unit ?? null]
          );
        }
      }

      await this.syncProductPrice(client, data.productId || null, totalCost, data.yieldQuantity || 1, margin, data.salePrice ?? null);

      await client.query('COMMIT');
      return recipeResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Sync linked product cost_price + price.
   *  If `overridePrice` is provided (manual entry), use it as-is for `products.price`.
   *  Otherwise compute price = cost_per_unit * marginMultiplier.
   */
  async syncProductPrice(executor: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, productId: string | null, totalCost: number, yieldQuantity: number, marginMultiplier: number, overridePrice: number | null = null) {
    if (!productId || yieldQuantity <= 0) return;
    const costPerUnit = totalCost / yieldQuantity;
    const price = overridePrice !== null && overridePrice >= 0
      ? overridePrice
      : costPerUnit * marginMultiplier;
    await executor.query(
      `UPDATE products SET cost_price = $1, price = $2, updated_at = NOW() WHERE id = $3`,
      [costPerUnit, price, productId]
    );
  },

  async update(id: string, data: {
    name: string; instructions?: string; yieldQuantity?: number; yieldUnit?: string; isBase?: boolean;
    contenantId?: string; etapes?: unknown[]; marginMultiplier?: number; salePrice?: number | null;
    ingredients: { ingredientId: string; quantity: number; unit?: string | null }[];
    subRecipes?: { subRecipeId: string; quantity: number }[];
    packaging?: { packagingId: string; quantity: number; unit?: string | null }[];
    changedBy?: string; changeNote?: string;
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Snapshot current state for versioning
      const currentRecipe = await this.findById(id);
      if (currentRecipe) {
        const versionNumResult = await client.query(
          `SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM recipe_versions WHERE recipe_id = $1`,
          [id]
        );
        const nextVersion = versionNumResult.rows[0].next_version;

        await client.query(
          `INSERT INTO recipe_versions (recipe_id, version_number, name, instructions, yield_quantity, yield_unit, total_cost, is_base, ingredients, sub_recipes, changed_by, change_note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            nextVersion,
            currentRecipe.name,
            currentRecipe.instructions,
            currentRecipe.yield_quantity,
            currentRecipe.yield_unit || 'unit',
            currentRecipe.total_cost,
            currentRecipe.is_base,
            JSON.stringify(currentRecipe.ingredients),
            JSON.stringify(currentRecipe.sub_recipes),
            data.changedBy || null,
            data.changeNote || null,
          ]
        );
      }

      let totalCost = 0;
      for (const ing of data.ingredients) {
        const ingResult = await client.query('SELECT unit_cost, unit FROM ingredients WHERE id = $1', [ing.ingredientId]);
        if (ingResult.rows[0]) {
          const ingBaseUnit = ingResult.rows[0].unit;
          const recipeUnit = ing.unit || ingBaseUnit;
          const factor = unitConversionFactor(recipeUnit, ingBaseUnit);
          totalCost += parseFloat(ingResult.rows[0].unit_cost) * ing.quantity * factor;
        }
      }

      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          const srResult = await client.query(
            'SELECT total_cost, yield_quantity FROM recipes WHERE id = $1', [sr.subRecipeId]
          );
          if (srResult.rows[0]) {
            const costPerUnit = parseFloat(srResult.rows[0].total_cost) / (srResult.rows[0].yield_quantity || 1);
            totalCost += costPerUnit * sr.quantity;
          }
        }
      }

      // Cout emballages
      if (data.packaging && data.packaging.length > 0) {
        for (const pk of data.packaging) {
          const pkResult = await client.query('SELECT unit_cost FROM packaging_items WHERE id = $1', [pk.packagingId]);
          if (pkResult.rows[0]) {
            totalCost += parseFloat(pkResult.rows[0].unit_cost) * pk.quantity;
          }
        }
      }

      const margin = data.marginMultiplier && data.marginMultiplier > 0
        ? data.marginMultiplier
        : parseFloat(currentRecipe?.margin_multiplier || '3');
      await client.query(
        `UPDATE recipes SET name = $1, instructions = $2, yield_quantity = $3, yield_unit = $4, total_cost = $5, is_base = $6, contenant_id = $7, etapes = $8, margin_multiplier = $9, updated_at = NOW()
         WHERE id = $10`,
        [data.name, data.instructions || null, data.yieldQuantity || 1, data.yieldUnit || 'unit', totalCost, data.isBase || false, data.contenantId || null, JSON.stringify(data.etapes || []), margin, id]
      );

      // Re-insert ingredients
      await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [id]);
      for (const ing of data.ingredients) {
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
          [id, ing.ingredientId, ing.quantity, ing.unit || null]
        );
      }

      // Re-insert sub-recipes
      await client.query('DELETE FROM recipe_sub_recipes WHERE recipe_id = $1', [id]);

      // Cycle detection for sub-recipes — pass the transaction client so the check
      // sees the DELETE above (old sub-recipe edges must not count against the new ones).
      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          const hasCycle = await this.detectCycle(sr.subRecipeId, id, client);
          if (hasCycle) {
            throw new Error(`Référence circulaire détectée: la sous-recette créerait un cycle`);
          }
        }
      }

      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          await client.query(
            `INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, $3)`,
            [id, sr.subRecipeId, sr.quantity]
          );
        }
      }

      // Re-insert recipe_packaging
      await client.query('DELETE FROM recipe_packaging WHERE recipe_id = $1', [id]);
      if (data.packaging && data.packaging.length > 0) {
        for (const pk of data.packaging) {
          await client.query(
            `INSERT INTO recipe_packaging (recipe_id, packaging_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
            [id, pk.packagingId, pk.quantity, pk.unit ?? null]
          );
        }
      }

      await this.syncProductPrice(client, currentRecipe?.product_id || null, totalCost, data.yieldQuantity || 1, margin, data.salePrice ?? null);

      await client.query('COMMIT');

      // Recalculate cost of parent recipes that use this one as sub-recipe
      await this.recalcParents(id);

      return this.findById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Compute cost (ingredients + sub-recipes + packaging) for a recipe.
   *  Centralise la formule pour eviter qu'elle drifte entre create / update / cascade. */
  async computeFullCost(recipeId: string): Promise<number> {
    // Ingredients cost
    const ingResult = await db.query(
      `SELECT ri.quantity, ri.unit, ing.unit_cost, ing.unit as base_unit
       FROM recipe_ingredients ri
       JOIN ingredients ing ON ing.id = ri.ingredient_id
       WHERE ri.recipe_id = $1`,
      [recipeId]
    );
    let total = 0;
    for (const r of ingResult.rows) {
      const factor = unitConversionFactor(r.unit || r.base_unit, r.base_unit);
      total += parseFloat(r.quantity) * parseFloat(r.unit_cost || '0') * factor;
    }
    // Sub-recipes
    const srResult = await db.query(
      `SELECT rsr.quantity, r2.total_cost, r2.yield_quantity
       FROM recipe_sub_recipes rsr
       JOIN recipes r2 ON r2.id = rsr.sub_recipe_id
       WHERE rsr.recipe_id = $1`,
      [recipeId]
    );
    for (const r of srResult.rows) {
      const costPerUnit = parseFloat(r.total_cost) / (parseFloat(r.yield_quantity) || 1);
      total += costPerUnit * parseFloat(r.quantity);
    }
    // Packaging
    const pkResult = await db.query(
      `SELECT rp.quantity, pi.unit_cost
       FROM recipe_packaging rp
       JOIN packaging_items pi ON pi.id = rp.packaging_id
       WHERE rp.recipe_id = $1`,
      [recipeId]
    );
    for (const r of pkResult.rows) {
      total += parseFloat(r.quantity) * parseFloat(r.unit_cost || '0');
    }
    return total;
  },

  /** When a packaging price changes, propagate to all recipes using it + their products */
  async recalcOnPackagingChange(packagingId: string) {
    const recipes = await db.query(
      `SELECT DISTINCT recipe_id FROM recipe_packaging WHERE packaging_id = $1`,
      [packagingId]
    );
    for (const row of recipes.rows) {
      const totalCost = await this.computeFullCost(row.recipe_id);
      await db.query('UPDATE recipes SET total_cost = $1, updated_at = NOW() WHERE id = $2', [totalCost, row.recipe_id]);
      const recipe = await this.findById(row.recipe_id);
      if (!recipe) continue;
      const margin = parseFloat(recipe.margin_multiplier || '3');
      const yieldQty = parseFloat(recipe.yield_quantity || '1');
      await this.syncProductPrice(db, recipe.product_id || null, totalCost, yieldQty, margin);
      // Cascade aux parents (si cette recette est utilisee comme sous-recette)
      await this.recalcParents(row.recipe_id);
    }
  },

  /** When a base recipe cost changes, update all parent recipes that use it (recursive) */
  async recalcParents(subRecipeId: string, visited = new Set<string>()) {
    if (visited.has(subRecipeId)) return; // prevent infinite loop
    visited.add(subRecipeId);

    const parents = await db.query(
      `SELECT DISTINCT recipe_id FROM recipe_sub_recipes WHERE sub_recipe_id = $1`,
      [subRecipeId]
    );
    for (const row of parents.rows) {
      const recipe = await this.findById(row.recipe_id);
      if (!recipe) continue;

      // Utilise le helper centralise (inclut packaging)
      const totalCost = await this.computeFullCost(row.recipe_id);

      await db.query('UPDATE recipes SET total_cost = $1, updated_at = NOW() WHERE id = $2', [totalCost, row.recipe_id]);

      const margin = parseFloat(recipe.margin_multiplier || '3');
      const yieldQty = parseFloat(recipe.yield_quantity || '1');
      await this.syncProductPrice(db, recipe.product_id || null, totalCost, yieldQty, margin);

      // Recurse up to grandparents
      await this.recalcParents(row.recipe_id, visited);
    }
  },

  async findVersions(recipeId: string) {
    const result = await db.query(
      `SELECT rv.*, u.first_name || ' ' || u.last_name as changed_by_name
       FROM recipe_versions rv
       LEFT JOIN users u ON u.id = rv.changed_by
       WHERE rv.recipe_id = $1
       ORDER BY rv.version_number DESC`,
      [recipeId]
    );
    return result.rows;
  },

  async detectCycle(recipeId: string, subRecipeId: string, client?: { query: typeof db.query }): Promise<boolean> {
    // Check if adding subRecipeId as a sub-recipe of recipeId would create a cycle.
    // Walks the sub-recipe tree starting from subRecipeId; if recipeId appears in that
    // descendant chain, adding the edge recipeId -> subRecipeId would close a loop.
    // Accepts an optional transaction client so the check sees uncommitted DELETEs
    // performed earlier in the same update transaction.
    const runner = client ?? db;
    const result = await runner.query(
      `WITH RECURSIVE chain AS (
         SELECT sub_recipe_id FROM recipe_sub_recipes WHERE recipe_id = $1
         UNION ALL
         SELECT rsr.sub_recipe_id
         FROM recipe_sub_recipes rsr
         JOIN chain c ON c.sub_recipe_id = rsr.recipe_id
       )
       SELECT 1 FROM chain WHERE sub_recipe_id = $2 LIMIT 1`,
      [subRecipeId, recipeId]
    );
    return result.rows.length > 0;
  },

  async delete(id: string) {
    await db.query('DELETE FROM recipes WHERE id = $1', [id]);
  },
};
