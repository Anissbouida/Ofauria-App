/**
 * M9 — nomenclature fantôme (mig 588). Même scénario que le modèle B (Baguette = 0,5 kg de
 * Pâte de base + Sel), mais la Pâte est marquée fantôme :
 *  - à la confirmation : aucune dépendance ni ordre de semi-fini, aucune réservation ;
 *  - les besoins de l'ordre parent contiennent la Farine de la Pâte (5 kg pour 10 baguettes) ;
 *  - à la déclaration, la Farine est déduite directement du stock ;
 *  - fantôme refusé sur une fiche qui n'est pas une base (contrainte).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, setComposition, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Nomenclature fantôme (M9)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let farineId: string; let selId: string; let pateRecipeId: string; let baguetteId: string; let baguetteRecipeId: string;
  const p = () => testPool();
  const farine = async () => num((await p().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId])).rows[0]?.current_quantity);

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine ph', unit: 'kg', unitCost: 5 });
    selId = await createIngredient(fx, { name: 'Sel ph', unit: 'kg', unitCost: 2 });
    await createLot(fx, { ingredientId: farineId, lotNumber: 'FARPH', pesage: 100, expiresInDays: 60, unitCost: 5 });
    await createLot(fx, { ingredientId: selId, lotNumber: 'SELPH', pesage: 10, expiresInDays: 365, unitCost: 2 });
    pateRecipeId = (await p().query(
      `INSERT INTO recipes (name, is_base, is_phantom, product_id, yield_quantity, yield_unit, mode_cout)
       VALUES ($1, true, true, NULL, 1, 'kg', 'ratio_poids') RETURNING id`, [`Pate ph ${RUN}`])).rows[0].id;
    fx.ids.recipes.push(pateRecipeId);
    await setComposition(pateRecipeId, { ingredients: [{ ingredientId: farineId, quantity: 1, unit: 'kg' }] });
    baguetteId = (await p().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 3, 'jour', 'unit') RETURNING id`,
      [`Baguette ph ${RUN}`, `baguette-ph-${RUN}`.toLowerCase()])).rows[0].id;
    fx.ids.products.push(baguetteId);
    baguetteRecipeId = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout)
       VALUES ($1, false, $2, 1, 'unit', 'ratio_poids') RETURNING id`, [`Rec Baguette ph ${RUN}`, baguetteId])).rows[0].id;
    fx.ids.recipes.push(baguetteRecipeId);
    await setComposition(baguetteRecipeId, {
      ingredients: [{ ingredientId: selId, quantity: 0.01, unit: 'kg' }],
      subRecipes: [{ subRecipeId: pateRecipeId, quantity: 0.5 }],
    });
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM production_plan_dependencies WHERE sub_recipe_id = $1`, [pateRecipeId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('confirmation : pas d\'ordre de semi-fini, la Farine de la base est dans les besoins du parent', async () => {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: baguetteId, plannedQuantity: 10 }],
    });
    fx.ids.plans.push(plan.id);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM production_plan_dependencies WHERE parent_plan_id = $1`, [plan.id])).rows[0].n).toBe(0);
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM semi_finished_transactions WHERE recipe_id = $1`, [pateRecipeId])).rows[0].n).toBe(0);
    const needs = Object.fromEntries((await p().query(
      `SELECT ingredient_id, SUM(needed_quantity)::float8 AS q FROM production_ingredient_needs WHERE plan_id = $1 GROUP BY ingredient_id`, [plan.id])).rows
      .map(r => [r.ingredient_id, r.q]));
    expect(needs[farineId]).toBeCloseTo(5, 3);   // 10 × 0,5 kg de Pâte × 1 kg de Farine
    expect(needs[selId]).toBeCloseTo(0.1, 3);
  });

  it('fantôme réservé aux préparations de base', async () => {
    await expect(p().query(`UPDATE recipes SET is_phantom = true WHERE id = $1`, [baguetteRecipeId])).rejects.toThrow(/chk_recipes_phantom_base/);
  });

  it('déclaration : la Farine de la base fantôme est déduite directement', async () => {
    // Type sans bon de sortie pour déclarer directement (le parcours du bon n'est pas l'objet du test).
    const direct = (await p().query(
      `INSERT INTO production_order_types (code, label, requires_bon_sortie, requires_weighing, consumption_mode)
       VALUES ($1, 'Direct fantôme', false, false, 'a_la_declaration') RETURNING id`, [`PH_${RUN}`.slice(0, 30)])).rows[0].id;
    try {
      const plan = await repos.productionRepository.create({
        planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId: baguetteId, plannedQuantity: 4 }], orderTypeId: direct,
      });
      fx.ids.plans.push(plan.id);
      await repos.productionRepository.confirm(plan.id, fx.userId);
      await repos.productionRepository.start(plan.id, fx.userId);
      const before = await farine();
      const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [plan.id])).rows[0].id;
      await repos.productionRepository.complete(plan.id, [{ planItemId: item, actualQuantity: 4 }], fx.userId, fx.storeId);
      expect(before - await farine()).toBeCloseTo(2, 3); // 4 × 0,5 kg
    } finally {
      await p().query(`DELETE FROM production_plans WHERE order_type_id = $1 AND status <> 'completed'`, [direct]).catch(() => undefined);
    }
  });
});
