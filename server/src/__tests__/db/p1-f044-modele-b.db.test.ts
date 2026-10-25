/**
 * F-044 (modèle B) — Semi-finis équilibrés.
 *
 * Avant : le BSI du parent aplatissait la base (pâte) en matières ET un plan fils
 * produisait la pâte → matières comptées deux fois, pâte accumulée.
 *
 * Après :
 *  - le BSI du parent n'inclut QUE les ingrédients directs (pas les matières de
 *    la base, qui a une dépendance) ;
 *  - le plan fils consomme SES propres matières à la production ;
 *  - la part `toProduce` produite par le fils est imputée au parent (pas
 *    d'accumulation de stock semi-fini).
 *
 * Scénario : Baguette = 0,5 kg de Pâte (base) + 0,01 kg de Sel (direct). Pâte =
 * 1 kg de Farine / kg. Plan de 10 Baguettes.
 *   besoin pâte = 5 kg → 5 kg de Farine, consommés UNE fois par le plan fils.
 *   Sel au BSI parent = 0,1 kg. Farine absente du BSI parent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Production — semi-finis modèle B (F-044)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let farineId: string; let selId: string;
  let pateRecipeId: string; let baguetteId: string; let baguetteRecipeId: string;
  let parentPlanId: string;
  let farineBefore: number;

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    const p = testPool();

    farineId = await createIngredient(fx, { name: 'Farine b', unit: 'kg', unitCost: 5 });
    selId = await createIngredient(fx, { name: 'Sel b', unit: 'kg', unitCost: 2 });
    await createLot(fx, { ingredientId: farineId, lotNumber: 'FAR', pesage: 100, expiresInDays: 60, unitCost: 5 });
    await createLot(fx, { ingredientId: selId, lotNumber: 'SEL', pesage: 10, expiresInDays: 365, unitCost: 2 });

    // Base « Pâte » : 1 kg de Farine par kg produit.
    const pate = await p.query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout)
       VALUES ($1, true, NULL, 1, 'kg', 'ratio_poids') RETURNING id`,
      [`Pate b ${RUN}`]
    );
    pateRecipeId = pate.rows[0].id;
    fx.ids.recipes.push(pateRecipeId);
    await p.query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 1, 'kg')`, [pateRecipeId, farineId]);

    // Produit « Baguette » + recette : 0,5 kg de Pâte (base) + 0,01 kg de Sel (direct).
    const prod = await p.query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 3, 'jour', 'unit') RETURNING id`,
      [`Baguette b ${RUN}`, `baguette-b-${RUN}`]
    );
    baguetteId = prod.rows[0].id;
    fx.ids.products.push(baguetteId);
    const brec = await p.query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout)
       VALUES ($1, false, $2, 1, 'unit', 'ratio_poids') RETURNING id`,
      [`Rec Baguette b ${RUN}`, baguetteId]
    );
    baguetteRecipeId = brec.rows[0].id;
    fx.ids.recipes.push(baguetteRecipeId);
    await p.query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 0.01, 'kg')`, [baguetteRecipeId, selId]);
    await p.query(`INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, 0.5)`, [baguetteRecipeId, pateRecipeId]);

    const inv = await p.query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId]);
    farineBefore = num(inv.rows[0]?.current_quantity);
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    // Plans fils + dépendances + semi-finis liés au scénario.
    await p.query(`DELETE FROM semi_finished_lot_usage WHERE semi_finished_lot_id IN (SELECT id FROM semi_finished_lots WHERE recipe_id = $1)`, [pateRecipeId]).catch(() => undefined);
    await p.query(`DELETE FROM semi_finished_lots WHERE recipe_id = $1`, [pateRecipeId]).catch(() => undefined);
    await p.query(`DELETE FROM semi_finished_transactions WHERE recipe_id = $1`, [pateRecipeId]).catch(() => undefined);
    await p.query(`DELETE FROM semi_finished_stock WHERE recipe_id = $1`, [pateRecipeId]).catch(() => undefined);
    await p.query(`DELETE FROM production_plan_dependencies WHERE sub_recipe_id = $1`, [pateRecipeId]).catch(() => undefined);
    await p.query(`DELETE FROM recipe_sub_recipes WHERE recipe_id = $1`, [baguetteRecipeId]).catch(() => undefined);
    // Plans fils (is_semi_finished_plan) du store créés par la détection.
    await p.query(`DELETE FROM production_plan_items WHERE base_recipe_id = $1`, [pateRecipeId]).catch(() => undefined);
    await p.query(`DELETE FROM production_plans WHERE store_id = $1 AND is_semi_finished_plan = true`, [fx.storeId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('confirm parent : BSI/besoins = Sel seul, Farine (base) EXCLUE, dépendance créée', async () => {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: baguetteId, plannedQuantity: 10 }],
    });
    parentPlanId = plan.id; fx.ids.plans.push(parentPlanId);
    await repos.productionRepository.confirm(parentPlanId, fx.userId);

    const needs = await testPool().query(`SELECT ingredient_id, needed_quantity FROM production_ingredient_needs WHERE plan_id = $1`, [parentPlanId]);
    const ids = needs.rows.map((r) => r.ingredient_id);
    expect(ids).toContain(selId);           // ingrédient direct présent
    expect(ids).not.toContain(farineId);    // matière de la base : EXCLUE (plus de double comptage)

    // Dépendance + plan fils créés pour la pâte.
    const dep = await testPool().query(
      `SELECT dependency_plan_id, quantity_to_produce FROM production_plan_dependencies WHERE parent_plan_id = $1 AND sub_recipe_id = $2`,
      [parentPlanId, pateRecipeId]
    );
    expect(dep.rows).toHaveLength(1);
    expect(num(dep.rows[0].quantity_to_produce)).toBeCloseTo(5, 3);   // 10 × 0,5 kg
    expect(dep.rows[0].dependency_plan_id).toBeTruthy();
  });

  it('production du plan fils : Farine consommée UNE fois (5 kg), pâte imputée au parent, pas d\'accumulation', async () => {
    const dep = await testPool().query(
      `SELECT dependency_plan_id FROM production_plan_dependencies WHERE parent_plan_id = $1 AND sub_recipe_id = $2`,
      [parentPlanId, pateRecipeId]
    );
    const childPlanId = dep.rows[0].dependency_plan_id as string;
    const childItem = await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [childPlanId]);
    const childItemId = childItem.rows[0].id as string;

    // Cycle de vie du plan fils : confirm (pas de BSI, pas de détection récursive) -> start -> produceItems.
    await repos.productionRepository.confirm(childPlanId, fx.userId);
    await repos.productionRepository.start(childPlanId, fx.userId);
    await repos.productionRepository.produceItems(childPlanId, [{ planItemId: childItemId, actualQuantity: 5 }], fx.userId, fx.storeId);

    // Farine consommée UNE seule fois (par le fils), pas deux.
    const inv = await testPool().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId]);
    expect(num(inv.rows[0].current_quantity)).toBeCloseTo(farineBefore - 5, 2);

    // Stock semi-fini : 5 produits − 5 imputés au parent = 0 (pas d'accumulation fantôme).
    const sf = await testPool().query(`SELECT COALESCE(SUM(quantity_available),0) AS q FROM semi_finished_stock WHERE recipe_id = $1 AND store_id = $2`, [pateRecipeId, fx.storeId]);
    expect(num(sf.rows[0].q)).toBeCloseTo(0, 2);

    // La pâte a bien été imputée au plan PARENT (traçabilité).
    const usage = await testPool().query(
      `SELECT COALESCE(SUM(quantity),0) AS q FROM semi_finished_lot_usage u
         JOIN semi_finished_lots l ON l.id = u.semi_finished_lot_id
        WHERE l.recipe_id = $1 AND u.parent_plan_id = $2`,
      [pateRecipeId, parentPlanId]
    );
    expect(num(usage.rows[0].q)).toBeCloseTo(5, 2);
  });
});
