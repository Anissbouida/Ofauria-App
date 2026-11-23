/**
 * M4-04 — plusieurs nomenclatures par article (mig 562).
 * Produit P : fiche par défaut (0,5 kg de farine) et fiche alternative (0,3 kg).
 *  - getRecipeFor rend la fiche par défaut ; la liste montre les deux ;
 *  - ordre sans choix : besoins de la fiche par défaut ;
 *  - ordre avec l'alternative choisie au lancement : besoins de l'alternative ;
 *  - le coût catalogue (v_recipe_total_cost_v2 par produit) reste celui de la fiche par défaut ;
 *  - une fiche d'un autre produit ne peut pas être choisie.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures, num, RUN, setComposition, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Plusieurs nomenclatures par article (M4-04)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let rf: typeof import('../../services/recipe-for.js');
  let fx: Fixtures; let productId: string; let defaultRecipe: string; let altRecipe: string; let flour: string; let other: string;
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);
  const plan = async () => {
    const pl = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 10 }] });
    fx.ids.plans.push(pl.id);
    return { planId: pl.id as string, itemId: (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [pl.id])).rows[0].id as string };
  };
  const flourNeed = async (planId: string) => num((await p().query(`SELECT needed_quantity FROM production_ingredient_needs WHERE plan_id = $1 AND ingredient_id = $2`, [planId, flour])).rows[0]?.needed_quantity);

  beforeAll(async () => {
    repos = await importRepositories();
    rf = await import('../../services/recipe-for.js');
    fx = await createBaseFixtures();
    flour = await createIngredient(fx, { name: 'Farine M404', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: flour, lotNumber: 'M404', pesage: 100, expiresInDays: 30, unitCost: 10 });
    const d = await createProductWithRecipe(fx, { name: 'Pain M404', price: 3, ingredients: [{ ingredientId: flour, quantity: 0.5, unit: 'kg' }] });
    productId = d.productId; defaultRecipe = d.recipeId;
    const o = await createProductWithRecipe(fx, { name: 'Autre M404', price: 3, ingredients: [{ ingredientId: flour, quantity: 0.1, unit: 'kg' }] });
    other = o.recipeId;
    altRecipe = (await p().query(`INSERT INTO recipes (name, yield_quantity, yield_unit) VALUES ($1, 1, 'unit') RETURNING id`, [`Pain M404 alternative ${RUN}`])).rows[0].id;
    fx.ids.recipes.push(altRecipe);
    await setComposition(altRecipe, { ingredients: [{ ingredientId: flour, quantity: 0.3, unit: 'kg' }] });
    await rf.setAlternative(altRecipe, productId, 'alternative');
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE production_plan_items SET alt_recipe_id = NULL WHERE alt_recipe_id = $1`, [altRecipe]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('fiche par défaut et liste des nomenclatures', async () => {
    expect((await rf.getRecipeFor(productId))?.id).toBe(defaultRecipe);
    expect((await rf.getRecipeFor(productId, { usage: 'alternative' }))?.id).toBe(altRecipe);
    expect((await rf.recipesForProduct(productId)).map(r => [r.id, r.is_default])).toEqual([[defaultRecipe, true], [altRecipe, false]]);
  });

  it('sans choix : besoins de la fiche par défaut ; avec l\'alternative : besoins de l\'alternative', async () => {
    const a = await plan();
    await repos.productionRepository.confirm(a.planId, fx.userId);
    expect(await flourNeed(a.planId)).toBeCloseTo(5, 3);
    const b = await plan();
    await repos.productionRepository.setItemRecipe(b.planId, b.itemId, altRecipe);
    await repos.productionRepository.confirm(b.planId, fx.userId);
    expect(await flourNeed(b.planId)).toBeCloseTo(3, 3);
  });

  it('coût catalogue : fiche par défaut ; une fiche d\'un autre produit est refusée', async () => {
    const cost = (await p().query(`SELECT v.total_cost FROM recipes r JOIN v_recipe_total_cost_v2 v ON v.id = r.id WHERE r.product_id = $1`, [productId])).rows;
    expect(cost).toHaveLength(1);
    expect(num(cost[0].total_cost)).toBeCloseTo(5, 2);
    const c = await plan();
    await expect(repos.productionRepository.setItemRecipe(c.planId, c.itemId, other)).rejects.toThrow(/pas une nomenclature de ce produit/);
    await expect(rf.setAlternative(defaultRecipe, productId, 'alternative')).rejects.toThrow(/fiche par défaut/);
  });

  it('coût prévu d\'un ordre fait sur l\'alternative : 10 × 0,3 kg × 10 = 30, pas 50', async () => {
    const { productionCoutRepository: pc } = await import('../../repositories/production-cout.repository.js');
    const d = await plan();
    await repos.productionRepository.setItemRecipe(d.planId, d.itemId, altRecipe);
    await repos.productionRepository.confirm(d.planId, fx.userId);
    expect((await pc.computePlanCost(d.planId)).coutPrevu).toBeCloseTo(30, 2);
    const e = await plan();
    await repos.productionRepository.confirm(e.planId, fx.userId);
    expect((await pc.computePlanCost(e.planId)).coutPrevu).toBeCloseTo(50, 2);
  });

  it('l\'alternative devient la fiche par défaut, l\'ancienne devient une alternative', async () => {
    const { recipeRepository } = await import('../../repositories/recipe.repository.js');
    await expect(recipeRepository.makeDefaultRecipe(defaultRecipe)).rejects.toThrow(/pas une nomenclature supplémentaire/);
    await recipeRepository.makeDefaultRecipe(altRecipe);
    expect((await rf.getRecipeFor(productId))?.id).toBe(altRecipe);
    expect((await rf.recipesForProduct(productId)).map(r => [r.id, r.is_default, r.usage])).toEqual([[altRecipe, true, 'fabrication'], [defaultRecipe, false, 'alternative']]);
    const f = await plan();
    await repos.productionRepository.confirm(f.planId, fx.userId);
    expect(await flourNeed(f.planId)).toBeCloseTo(3, 3);
    await recipeRepository.makeDefaultRecipe(defaultRecipe); // retour à l'état initial
    expect((await rf.getRecipeFor(productId))?.id).toBe(defaultRecipe);
  });
});
