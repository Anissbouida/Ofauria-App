import { db } from '../config/database.js';

export const recipeRepository = {
  async findAll() {
    const result = await db.query(
      `SELECT r.*, p.name as product_name, p.image_url as product_image, p.price as product_price
       FROM recipes r LEFT JOIN products p ON p.id = r.product_id ORDER BY r.name`
    );
    return result.rows;
  },

  async findById(id: string) {
    const recipeResult = await db.query(
      `SELECT r.*, p.name as product_name, p.price as product_price
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

    return { ...recipeResult.rows[0], ingredients: ingredientsResult.rows };
  },

  async create(data: {
    productId: string; name: string; instructions?: string; yieldQuantity?: number;
    ingredients: { ingredientId: string; quantity: number }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Calculate total cost
      let totalCost = 0;
      for (const ing of data.ingredients) {
        const ingResult = await client.query('SELECT unit_cost FROM ingredients WHERE id = $1', [ing.ingredientId]);
        if (ingResult.rows[0]) {
          totalCost += parseFloat(ingResult.rows[0].unit_cost) * ing.quantity;
        }
      }

      const recipeResult = await client.query(
        `INSERT INTO recipes (product_id, name, instructions, yield_quantity, total_cost)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [data.productId, data.name, data.instructions || null, data.yieldQuantity || 1, totalCost]
      );

      for (const ing of data.ingredients) {
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity) VALUES ($1, $2, $3)`,
          [recipeResult.rows[0].id, ing.ingredientId, ing.quantity]
        );
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
    name: string; instructions?: string; yieldQuantity?: number;
    ingredients: { ingredientId: string; quantity: number }[];
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

      await client.query(
        `UPDATE recipes SET name = $1, instructions = $2, yield_quantity = $3, total_cost = $4, updated_at = NOW()
         WHERE id = $5`,
        [data.name, data.instructions || null, data.yieldQuantity || 1, totalCost, id]
      );

      await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [id]);

      for (const ing of data.ingredients) {
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity) VALUES ($1, $2, $3)`,
          [id, ing.ingredientId, ing.quantity]
        );
      }

      await client.query('COMMIT');

      return this.findById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async delete(id: string) {
    await db.query('DELETE FROM recipes WHERE id = $1', [id]);
  },
};
