/**
 * M4-02 — version de nomenclature figée sur l'ordre (mig 560).
 *  - à la confirmation, la ligne d'ordre reçoit la version active de sa fiche ;
 *  - la fiche passe en version 2 : l'ordre garde les besoins de la version 1 et affiche
 *    qu'une version plus récente existe ;
 *  - une fiche modifiée sans nouvelle version active est signalée à la confirmation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures, num, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Version figée sur l\'ordre (M4-02)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let bom: typeof import('../../repositories/bom-version.repository.js')['bomVersionRepository'];
  let fx: Fixtures; let recipeId: string; let productId: string; let flour: string; let planId: string;
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);
  const newPlan = async () => {
    const plan = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 10 }] });
    fx.ids.plans.push(plan.id);
    return plan.id as string;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    bom = (await import('../../repositories/bom-version.repository.js')).bomVersionRepository;
    fx = await createBaseFixtures();
    flour = await createIngredient(fx, { name: 'Farine M402', unit: 'kg', unitCost: 8 });
    await createLot(fx, { ingredientId: flour, lotNumber: 'M402', pesage: 100, expiresInDays: 30, unitCost: 8 });
    const pr = await createProductWithRecipe(fx, { name: 'Pain M402', price: 3, ingredients: [{ ingredientId: flour, quantity: 0.5, unit: 'kg' }] });
    recipeId = pr.recipeId; productId = pr.productId;
    await bom.activate(recipeId, { reason: 'Version 1' }, fx.userId);
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE production_plan_items SET bom_version_id = NULL WHERE plan_id = ANY($1::uuid[])`, [fx?.ids.plans ?? []]).catch(() => undefined);
    await p().query(`DELETE FROM bom_versions WHERE recipe_id = $1`, [recipeId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('confirmation : version 1 sur la ligne, besoins de la version 1', async () => {
    planId = await newPlan();
    const { warnings } = await repos.productionRepository.confirm(planId, fx.userId);
    expect(warnings.join(' ')).not.toMatch(/sans nouvelle version/);
    const item = (await p().query(`SELECT b.version_no FROM production_plan_items ppi JOIN bom_versions b ON b.id = ppi.bom_version_id WHERE ppi.plan_id = $1`, [planId])).rows[0];
    expect(item.version_no).toBe(1);
    expect(num((await p().query(`SELECT needed_quantity FROM production_ingredient_needs WHERE plan_id = $1 AND ingredient_id = $2`, [planId, flour])).rows[0].needed_quantity)).toBeCloseTo(5, 3);
  });

  it('fiche passée en version 2 : l\'ordre garde la version 1 et le signale', async () => {
    await p().query(`UPDATE recipe_ingredients SET quantity = 0.6 WHERE recipe_id = $1`, [recipeId]);
    await bom.activate(recipeId, { reason: 'Version 2' }, fx.userId);
    expect(num((await p().query(`SELECT needed_quantity FROM production_ingredient_needs WHERE plan_id = $1 AND ingredient_id = $2`, [planId, flour])).rows[0].needed_quantity)).toBeCloseTo(5, 3);
    const plan = await repos.productionRepository.findById(planId);
    expect(plan!.items[0]).toMatchObject({ bom_version_no: 1, bom_active_version_no: 2 });
  });

  it('fiche modifiée sans activation : signalée à la confirmation', async () => {
    await p().query(`UPDATE recipe_ingredients SET quantity = 0.7 WHERE recipe_id = $1`, [recipeId]);
    const id = await newPlan();
    const { warnings } = await repos.productionRepository.confirm(id, fx.userId);
    expect(warnings.join(' ')).toMatch(/sans nouvelle version active : .*Pain M402/);
  });
});
