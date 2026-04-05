import { db } from '../config/database.js';

export const recipeRepository = {
  async findAll() {
    const result = await db.query(
      `SELECT r.*, r.is_base, p.name as product_name, p.image_url as product_image, p.price as product_price
       FROM recipes r LEFT JOIN products p ON p.id = r.product_id ORDER BY r.is_base DESC, r.name`
    );
    return result.rows;
  },

  async findById(id: string) {
    const recipeResult = await db.query(
      `SELECT r.*, r.is_base, p.name as product_name, p.price as product_price
       FROM recipes r LEFT JOIN products p ON p.id = r.product_id WHERE r.id = $1`,
      [id]
    );
    if (!recipeResult.rows[0]) return null;

    const ingredientsResult = await db.query(
      `SELECT ri.*, ing.name as ingredient_name, ing.unit, ing.unit_cost
       FROM recipe_ingredients ri JOIN ingredients ing ON ing.id = ri.ingredient_id
       WHERE ri.recipe_id = $1`,
      [id]
    );

    // Fetch sub-recipes
    const subRecipesResult = await db.query(
      `SELECT rsr.id, rsr.sub_recipe_id, rsr.quantity,
              sr.name as sub_recipe_name, sr.yield_quantity as sub_yield_quantity,
              sr.total_cost as sub_total_cost
       FROM recipe_sub_recipes rsr
       JOIN recipes sr ON sr.id = rsr.sub_recipe_id
       WHERE rsr.recipe_id = $1`,
      [id]
    );

    return {
      ...recipeResult.rows[0],
      ingredients: ingredientsResult.rows,
      sub_recipes: subRecipesResult.rows,
    };
  },

  /** List only base recipes (for sub-recipe picker) */
  async findBaseRecipes() {
    const result = await db.query(
      `SELECT id, name, yield_quantity, total_cost FROM recipes WHERE is_base = true ORDER BY name`
    );
    return result.rows;
  },

  async create(data: {
    productId?: string; name: string; instructions?: string; yieldQuantity?: number; isBase?: boolean;
    ingredients: { ingredientId: string; quantity: number }[];
    subRecipes?: { subRecipeId: string; quantity: number }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Calculate ingredient cost
      let totalCost = 0;
      for (const ing of data.ingredients) {
        const ingResult = await client.query('SELECT unit_cost FROM ingredients WHERE id = $1', [ing.ingredientId]);
        if (ingResult.rows[0]) {
          totalCost += parseFloat(ingResult.rows[0].unit_cost) * ing.quantity;
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

      const recipeResult = await client.query(
        `INSERT INTO recipes (product_id, name, instructions, yield_quantity, total_cost, is_base)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [data.productId || null, data.name, data.instructions || null, data.yieldQuantity || 1, totalCost, data.isBase || false]
      );

      const recipeId = recipeResult.rows[0].id;

      for (const ing of data.ingredients) {
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity) VALUES ($1, $2, $3)`,
          [recipeId, ing.ingredientId, ing.quantity]
        );
      }

      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          await client.query(
            `INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, $3)`,
            [recipeId, sr.subRecipeId, sr.quantity]
          );
        }
      }

      await client.query('COMMIT');
      return recipeResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async update(id: string, data: {
    name: string; instructions?: string; yieldQuantity?: number; isBase?: boolean;
    ingredients: { ingredientId: string; quantity: number }[];
    subRecipes?: { subRecipeId: string; quantity: number }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      let totalCost = 0;
      for (const ing of data.ingredients) {
        const ingResult = await client.query('SELECT unit_cost FROM ingredients WHERE id = $1', [ing.ingredientId]);
        if (ingResult.rows[0]) {
          totalCost += parseFloat(ingResult.rows[0].unit_cost) * ing.quantity;
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

      await client.query(
        `UPDATE recipes SET name = $1, instructions = $2, yield_quantity = $3, total_cost = $4, is_base = $5, updated_at = NOW()
         WHERE id = $6`,
        [data.name, data.instructions || null, data.yieldQuantity || 1, totalCost, data.isBase || false, id]
      );

      // Re-insert ingredients
      await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [id]);
      for (const ing of data.ingredients) {
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity) VALUES ($1, $2, $3)`,
          [id, ing.ingredientId, ing.quantity]
        );
      }

      // Re-insert sub-recipes
      await client.query('DELETE FROM recipe_sub_recipes WHERE recipe_id = $1', [id]);
      if (data.subRecipes && data.subRecipes.length > 0) {
        for (const sr of data.subRecipes) {
          await client.query(
            `INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, $3)`,
            [id, sr.subRecipeId, sr.quantity]
          );
        }
      }

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

  /** When a base recipe cost changes, update all parent recipes that use it */
  async recalcParents(subRecipeId: string) {
    const parents = await db.query(
      `SELECT DISTINCT recipe_id FROM recipe_sub_recipes WHERE sub_recipe_id = $1`,
      [subRecipeId]
    );
    for (const row of parents.rows) {
      const recipe = await this.findById(row.recipe_id);
      if (!recipe) continue;

      let totalCost = 0;
      for (const ing of recipe.ingredients) {
        totalCost += parseFloat(ing.quantity) * parseFloat(ing.unit_cost || '0');
      }
      for (const sr of recipe.sub_recipes) {
        const costPerUnit = parseFloat(sr.sub_total_cost) / (sr.sub_yield_quantity || 1);
        totalCost += costPerUnit * parseFloat(sr.quantity);
      }

      await db.query('UPDATE recipes SET total_cost = $1, updated_at = NOW() WHERE id = $2', [totalCost, row.recipe_id]);
    }
  },

  async delete(id: string) {
    await db.query('DELETE FROM recipes WHERE id = $1', [id]);
  },
};
