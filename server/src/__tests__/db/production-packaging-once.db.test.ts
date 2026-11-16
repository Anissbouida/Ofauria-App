/**
 * G0-22 — emballages consommés une seule fois par produceItems.
 * Un plan de 100 pièces avec 1 emballage par pièce consomme 100 emballages, pas 200 ;
 * un seul mouvement d'emballage par article du plan ; complete() ne reconsomme pas un
 * plan déjà produit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

const num = (v: unknown) => parseFloat(String(v));

describe.skipIf(!hasTestDb)('Production — emballages consommés une fois (G0-22)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let packagingId: string, planId: string, planItemId: string;
  const p = () => testPool();
  const stock = async () => num((await p().query(
    `SELECT stock_quantity FROM packaging_store_stock WHERE packaging_id = $1 AND store_id = $2`, [packagingId, fx.storeId])).rows[0].stock_quantity);
  const moves = async () => (await p().query(
    `SELECT quantity_change::float8 AS q, note FROM packaging_stock_transactions
      WHERE packaging_id = $1 AND reference_id = $2 AND type = 'consumption' ORDER BY created_at`, [packagingId, planId])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    const pr = await createProductWithRecipe(fx, { name: 'Coffret G022', price: 3, shelfLifeDays: null, ingredients: [] });
    packagingId = (await p().query(
      `INSERT INTO packaging_items (name, unit, unit_cost, category) VALUES ($1, 'piece', 0.2, 'autre') RETURNING id`, [`Boîte G022 ${RUN}`])).rows[0].id;
    await p().query(`INSERT INTO packaging_store_stock (packaging_id, store_id, stock_quantity) VALUES ($1, $2, 500)`, [packagingId, fx.storeId]);
    await p().query(`INSERT INTO recipe_packaging (recipe_id, packaging_id, quantity) VALUES ($1, $2, 1)`, [pr.recipeId, packagingId]);

    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: pr.productId, plannedQuantity: 100 }],
    });
    planId = plan.id; fx.ids.plans.push(planId);
    await repos.productionRepository.confirm(planId, fx.userId);
    planItemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0].id;
    // Recette sans matière propre (produit assemblé à partir de bases) : le plan n'a aucun
    // besoin matière, donc pas de bon de sortie, et c'est produceItems qui consomme les
    // emballages. Avec un bon de sortie, ils sortent au prélèvement et ce bloc est sauté.
    await repos.productionRepository.start(planId, fx.userId);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM recipe_packaging WHERE packaging_id = $1`, [packagingId]).catch(() => undefined);
    await p().query(`DELETE FROM packaging_stock_transactions WHERE packaging_id = $1`, [packagingId]).catch(() => undefined);
    await p().query(`DELETE FROM packaging_store_stock WHERE packaging_id = $1`, [packagingId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM packaging_items WHERE id = $1`, [packagingId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('100 pièces, 1 emballage par pièce : 100 emballages consommés, un seul mouvement', async () => {
    await repos.productionRepository.produceItems(planId, [{ planItemId, actualQuantity: 100 }], fx.userId, fx.storeId);
    expect(await stock()).toBe(400);
    const m = await moves();
    expect(m).toHaveLength(1);
    expect(m[0].q).toBe(-100);
    expect(m[0].note).toMatch(/^Production: /);
  }, 60_000);

  it('le plan déjà produit ne reconsomme rien à la clôture', async () => {
    const status = (await p().query(`SELECT status FROM production_plans WHERE id = $1`, [planId])).rows[0].status;
    if (status === 'in_progress') {
      await repos.productionRepository.complete(planId, [{ planItemId, actualQuantity: 100 }], fx.userId, fx.storeId);
    }
    expect(await stock()).toBe(400);
    expect(await moves()).toHaveLength(1);
  }, 60_000);
});
