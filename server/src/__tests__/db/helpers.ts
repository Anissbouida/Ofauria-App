/**
 * Socle des tests d'INTEGRATION sur une vraie base Postgres migree.
 *
 * Pre-requis : TEST_DATABASE_URL pointe vers une base jetable creee par
 * `server/scripts/test-db-setup.sh` (Postgres Homebrew local, 292 migrations).
 * Sans cette variable, les suites `*.db.test.ts` sont ignorees (skipIf).
 *
 * Les repositories lisent env.DATABASE_URL a l'import : on positionne les
 * variables AVANT tout import dynamique (voir importRepositories).
 */
import pg from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasTestDb = Boolean(TEST_DATABASE_URL);

let pool: pg.Pool | null = null;

/** Pool dedie aux tests (fixtures, assertions). */
export function testPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
  return pool;
}

export async function closeTestPool() {
  if (pool) { await pool.end(); pool = null; }
}

/** Charge les repositories metier sur la base de test (env posee avant l'import). */
export async function importRepositories() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
  const [production, bonSortie, database] = await Promise.all([
    import('../../repositories/production.repository.js'),
    import('../../repositories/bon-sortie.repository.js'),
    import('../../config/database.js'),
  ]);
  return {
    productionRepository: production.productionRepository,
    bonSortieRepository: bonSortie.bonSortieRepository,
    db: database.db,
  };
}

/** Suffixe unique par run pour ne jamais collisionner avec une autre execution. */
export const RUN = Date.now().toString(36);

export interface Fixtures {
  storeId: string;
  userId: string;
  ids: { ingredients: string[]; products: string[]; recipes: string[]; plans: string[] };
}

export async function createBaseFixtures(): Promise<Fixtures> {
  const p = testPool();
  const store = await p.query(
    `INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Magasin test ${RUN}`]
  );
  const user = await p.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
     VALUES ($1, 'x', 'Test', 'Chef', 'admin', $2) RETURNING id`,
    [`chef-${RUN}@test.local`, store.rows[0].id]
  );
  return {
    storeId: store.rows[0].id,
    userId: user.rows[0].id,
    ids: { ingredients: [], products: [], recipes: [], plans: [] },
  };
}

export async function createIngredient(fx: Fixtures, data: {
  name: string; unit: string; unitCost: number; densite?: number | null; allergens?: string[];
}): Promise<string> {
  const r = await testPool().query(
    `INSERT INTO ingredients (name, unit, unit_cost, densite_kg_l, allergens, category)
     VALUES ($1, $2, $3, $4, $5, 'autre') RETURNING id`,
    [`${data.name} ${RUN}`, data.unit, data.unitCost, data.densite ?? null, data.allergens ?? []]
  );
  fx.ids.ingredients.push(r.rows[0].id);
  return r.rows[0].id;
}

/** Lot matiere : le trigger mig 114 synchronise `inventory` a partir des lots. */
export async function createLot(fx: Fixtures, data: {
  ingredientId: string; lotNumber: string; pesage: number; economat?: number;
  expiresInDays: number; unitCost?: number; status?: string;
}): Promise<string> {
  const total = data.pesage + (data.economat ?? 0);
  const r = await testPool().query(
    `INSERT INTO ingredient_lots
       (ingredient_id, lot_number, quantity_received, quantity_remaining, unit_cost,
        expiration_date, store_id, status, economat_quantity, pesage_quantity, first_opened_at)
     VALUES ($1, $2, $3::numeric, $3::numeric, $4, CURRENT_DATE + $5::int, $6, $7, $8::numeric, $9::numeric, CASE WHEN $9::numeric > 0 THEN NOW() ELSE NULL END)
     RETURNING id`,
    [data.ingredientId, `${data.lotNumber}-${RUN}`, total, data.unitCost ?? null,
     data.expiresInDays, fx.storeId, data.status ?? 'active', data.economat ?? 0, data.pesage]
  );
  return r.rows[0].id;
}

export async function createProductWithRecipe(fx: Fixtures, data: {
  name: string; price: number; shelfLifeDays?: number | null;
  ingredients: { ingredientId: string; quantity: number; unit?: string }[];
  yieldQuantity?: number;
}): Promise<{ productId: string; recipeId: string }> {
  const p = testPool();
  const slug = `${data.name.toLowerCase().replace(/\s+/g, '-')}-${RUN}`;
  const prod = await p.query(
    `INSERT INTO products (name, slug, price, shelf_life_days, sale_type)
     VALUES ($1, $2, $3, $4, 'jour') RETURNING id`,
    [`${data.name} ${RUN}`, slug, data.price, data.shelfLifeDays ?? null]
  );
  const productId = prod.rows[0].id;
  const rec = await p.query(
    `INSERT INTO recipes (product_id, name, yield_quantity, yield_unit, mode_cout)
     VALUES ($1, $2, $3, 'unit', 'ratio_poids') RETURNING id`,
    [productId, `Recette ${data.name} ${RUN}`, data.yieldQuantity ?? 1]
  );
  const recipeId = rec.rows[0].id;
  for (const ing of data.ingredients) {
    await p.query(
      `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, $3, $4)`,
      [recipeId, ing.ingredientId, ing.quantity, ing.unit ?? null]
    );
  }
  fx.ids.products.push(productId);
  fx.ids.recipes.push(recipeId);
  return { productId, recipeId };
}

/** Nettoyage best-effort, dans l'ordre des dependances. La base est jetable : une erreur n'est pas bloquante. */
export async function cleanupFixtures(fx: Fixtures) {
  const p = testPool();
  const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
  for (const planId of fx.ids.plans) {
    await run(`DELETE FROM production_lot_usage WHERE production_plan_id = $1`, [planId]);
    await run(`DELETE FROM production_plans WHERE id = $1`, [planId]);
  }
  await run(`DELETE FROM sale_item_lots WHERE product_lot_id IN (SELECT id FROM product_lots WHERE store_id = $1)`, [fx.storeId]);
  await run(`DELETE FROM product_lots WHERE store_id = $1`, [fx.storeId]);
  await run(`DELETE FROM product_display_tracking WHERE store_id = $1`, [fx.storeId]);
  await run(`DELETE FROM product_stock_transactions WHERE store_id = $1`, [fx.storeId]);
  await run(`DELETE FROM product_store_stock WHERE store_id = $1`, [fx.storeId]);
  await run(`DELETE FROM inventory_transactions WHERE store_id = $1 OR ingredient_id = ANY($2)`, [fx.storeId, fx.ids.ingredients]);
  await run(`DELETE FROM ingredient_lots WHERE store_id = $1`, [fx.storeId]);
  await run(`DELETE FROM inventory WHERE store_id = $1 OR ingredient_id = ANY($2)`, [fx.storeId, fx.ids.ingredients]);
  await run(`DELETE FROM recipes WHERE id = ANY($1)`, [fx.ids.recipes]);
  await run(`DELETE FROM products WHERE id = ANY($1)`, [fx.ids.products]);
  await run(`DELETE FROM ingredients WHERE id = ANY($1)`, [fx.ids.ingredients]);
  await run(`DELETE FROM notifications WHERE store_id = $1`, [fx.storeId]);
  await run(`DELETE FROM users WHERE id = $1`, [fx.userId]);
  await run(`DELETE FROM stores WHERE id = $1`, [fx.storeId]);
}

export const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
