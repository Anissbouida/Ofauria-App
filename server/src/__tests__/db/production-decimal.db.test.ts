/**
 * Quantités de production décimales (mig 512, plan Production générique P3).
 * Un plan de 12,5 se planifie (besoins 6,25 kg), se prélève, se lance, se produit à
 * 12,25 : stock, lot et rendement gardent les décimales, et l'API rend des NOMBRES
 * (pas du texte), comme avant pour les entiers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Production — quantités décimales', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let farineId: string; let productId: string;
  let planId: string; let planItemId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine déc', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: farineId, lotNumber: 'DEC', pesage: 50, expiresInDays: 30, unitCost: 10 });
    productId = (await createProductWithRecipe(fx, {
      name: 'Pâte au kilo', price: 3, shelfLifeDays: null,
      ingredients: [{ ingredientId: farineId, quantity: 0.5, unit: 'kg' }],
    })).productId;
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('un plan de 12,5 se crée et se relit en nombre décimal', async () => {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 12.5 }],
    });
    planId = plan.id; fx.ids.plans.push(planId);
    const detail = await repos.productionRepository.findById(planId);
    const item = (detail!.items as Record<string, unknown>[])[0];
    planItemId = item.id as string;
    expect(item.planned_quantity).toBe(12.5);          // un nombre, pas « 12.500 »
    expect(typeof item.planned_quantity).toBe('number');
  });

  it('confirm : besoins 12,5 × 0,5 kg = 6,25 kg', async () => {
    const { warnings } = await repos.productionRepository.confirm(planId, fx.userId);
    expect(warnings).toEqual([]);
    const needs = await testPool().query(`SELECT needed_quantity FROM production_ingredient_needs WHERE plan_id = $1 AND ingredient_id = $2`, [planId, farineId]);
    expect(num(needs.rows[0].needed_quantity)).toBeCloseTo(6.25, 3);
  });

  it('prélèvement puis production de 12,25 : stock, lot et rendement décimaux', async () => {
    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(planId))[0];
    const line = fresh.lines.find((l: Record<string, unknown>) => l.ingredient_id === farineId);
    await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, [
      { ligneId: line.id as string, actualQuantity: num(line.allocated_quantity), source: 'manual' },
    ]);
    await repos.bonSortieRepository.markAsReady(bon.id, fx.userId);
    await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);

    await repos.productionRepository.start(planId, fx.userId);
    await repos.productionRepository.produceItems(planId, [{ planItemId, actualQuantity: 12.25 }], fx.userId, fx.storeId);

    const item = await testPool().query(`SELECT actual_quantity FROM production_plan_items WHERE id = $1`, [planItemId]);
    expect(item.rows[0].actual_quantity).toBe(12.25);
    const stock = await testPool().query(`SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId]);
    expect(num(stock.rows[0].stock_quantity)).toBeCloseTo(12.25, 3);
    const lot = await testPool().query(`SELECT quantity_total FROM product_lots WHERE production_plan_id = $1`, [planId]);
    expect(num(lot.rows[0].quantity_total)).toBeCloseTo(12.25, 3);
    const rendement = await testPool().query(
      `SELECT planned_quantity, actual_quantity FROM v_plan_item_rendement WHERE plan_item_id = $1`, [planItemId]);
    expect(rendement.rows[0].planned_quantity).toBe(12.5);
    expect(rendement.rows[0].actual_quantity).toBe(12.25);
  });
});
