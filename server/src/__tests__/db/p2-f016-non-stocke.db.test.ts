/**
 * F-016 — Les ingredients non stockes (eau au robinet) sont exclus des besoins.
 *
 * Avant : « Eau » etant un ingredient stocke, chaque plan generait une ligne BSI
 * en RUPTURE et « A commander » proposait d'en acheter. Avec le drapeau
 * ingredients.non_stocke (mig 347), ces ingredients ne deviennent plus un besoin
 * de production : pas de ligne production_ingredient_needs, donc pas de ligne BSI.
 *
 * Recette : 0,5 kg de farine (stockee) + 0,2 l d'eau (non stockee).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures,
  type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Besoins — ingredient non stocke exclu (F-016)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let farineId: string; let eauId: string;
  let productId: string; let planId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine f016', unit: 'kg', unitCost: 10 });
    eauId = await createIngredient(fx, { name: 'Eau f016', unit: 'l', unitCost: 0 });
    // Marque l'eau comme non stockee (equivalent du backfill mig 347).
    await testPool().query(`UPDATE ingredients SET non_stocke = true WHERE id = $1`, [eauId]);
    const pr = await createProductWithRecipe(fx, {
      name: 'Pain f016', price: 3, shelfLifeDays: null,
      ingredients: [
        { ingredientId: farineId, quantity: 0.5, unit: 'kg' },
        { ingredientId: eauId, quantity: 0.2, unit: 'l' },
      ],
    });
    productId = pr.productId;
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('confirm : besoins sur la farine, aucun besoin sur l eau non stockee', async () => {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 10 }],
    });
    planId = plan.id; fx.ids.plans.push(planId);
    await repos.productionRepository.confirm(planId, fx.userId);

    const needs = await testPool().query(
      `SELECT ingredient_id FROM production_ingredient_needs WHERE plan_id = $1`, [planId]
    );
    const ids = needs.rows.map((r) => r.ingredient_id);
    expect(ids).toContain(farineId);
    expect(ids).not.toContain(eauId);
  });

  it('le BSI genere ne contient aucune ligne pour l eau', async () => {
    const bons = await repos.bonSortieRepository.findByPlan(planId);
    expect(bons).toHaveLength(1);
    const eauLines = bons[0].lines.filter((l: Record<string, unknown>) => l.ingredient_id === eauId);
    expect(eauLines).toHaveLength(0);
    // La farine, elle, est bien presente.
    const farineLines = bons[0].lines.filter((l: Record<string, unknown>) => l.ingredient_id === farineId);
    expect(farineLines.length).toBeGreaterThan(0);
  });
});
