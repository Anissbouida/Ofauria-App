/**
 * Audit production pâtissière 2026-11 — lot 2 (fabrication par fournées entières, mig 662).
 *
 * C-04 : 130 tranches d'un cadre de 48 → 3 cadres, 144 prévues, 130 demandées, besoins pour
 *        3 cadres ; règle « partiel » : rien ne change.
 * C-05 : le plan de semi-fini se lance à la fournée de la base.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, setComposition, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Audit pâtisserie — lot 2 fournées entières', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let chocolat: string;
  let lait: string;
  let creme: string;      // base au kilo, fournée de 2,9 kg
  let opera: string;      // produit
  let operaRecipe: string;
  let operaFormat: string;
  const planIds: string[] = [];
  const recipeIds: string[] = [];
  const productIds: string[] = [];
  const p = () => testPool();

  async function newPlan(qty: number, withFormat = false) {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [withFormat
        ? { productId: opera, plannedQuantity: qty, formats: [{ formatId: operaFormat, plannedQuantity: qty }] }
        : { productId: opera, plannedQuantity: qty }],
    });
    planIds.push(plan.id);
    return plan;
  }
  const itemOf = async (planId: string) =>
    (await p().query(`SELECT planned_quantity, requested_quantity, nb_contenants, format_id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0];

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    chocolat = await createIngredient(fx, { name: 'Chocolat a2', unit: 'kg', unitCost: 80 });
    lait = await createIngredient(fx, { name: 'Lait a2', unit: 'kg', unitCost: 8 });
    await createLot(fx, { ingredientId: chocolat, lotNumber: 'CA2', pesage: 500, expiresInDays: 90, unitCost: 80 });
    await createLot(fx, { ingredientId: lait, lotNumber: 'LA2', pesage: 500, expiresInDays: 30, unitCost: 8 });

    // Base « crème » : une fournée = 2,9 kg, faite de 2,9 kg de lait.
    creme = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout)
       VALUES ($1, true, NULL, 2.9, 'kg', 'compose') RETURNING id`, [`Crème a2 ${RUN}`])).rows[0].id;
    recipeIds.push(creme);
    await setComposition(creme, { ingredients: [{ ingredientId: lait, quantity: 2.9, unit: 'kg' }] });
    await p().query(
      `UPDATE recipe_formats SET rendement_unite = 'kg', rendement_kg = 2.9 WHERE recipe_id = $1 AND is_default`, [creme]);

    // Opéra : un cadre = 48 tranches, 2,4 kg de chocolat + 2,4 kg de crème par cadre.
    opera = (await p().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 25, 'jour', 'unit') RETURNING id`,
      [`Opéra a2 ${RUN}`, `opera-a2-${RUN}`])).rows[0].id;
    productIds.push(opera);
    operaRecipe = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout, compo_par_piece)
       VALUES ($1, false, $2, 48, 'unit', 'compose', false) RETURNING id`, [`Fiche opéra a2 ${RUN}`, opera])).rows[0].id;
    recipeIds.push(operaRecipe);
    await setComposition(operaRecipe, {
      ingredients: [{ ingredientId: chocolat, quantity: 2.4, unit: 'kg' }],
      subRecipes: [{ subRecipeId: creme, quantity: 2.4 }],
    });
    operaFormat = (await p().query(
      `UPDATE recipe_formats SET nb_par_defaut = 48 WHERE recipe_id = $1 AND is_default RETURNING id`, [operaRecipe])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    for (const rid of recipeIds) {
      await p().query(`DELETE FROM semi_finished_lot_usage WHERE semi_finished_lot_id IN (SELECT id FROM semi_finished_lots WHERE recipe_id = $1)`, [rid]).catch(() => undefined);
      await p().query(`DELETE FROM semi_finished_lots WHERE recipe_id = $1`, [rid]).catch(() => undefined);
      await p().query(`DELETE FROM semi_finished_transactions WHERE recipe_id = $1`, [rid]).catch(() => undefined);
      await p().query(`DELETE FROM semi_finished_stock WHERE recipe_id = $1`, [rid]).catch(() => undefined);
      await p().query(`DELETE FROM production_plan_dependencies WHERE sub_recipe_id = $1`, [rid]).catch(() => undefined);
    }
    await p().query(`DELETE FROM production_plans WHERE store_id = $1 AND is_semi_finished_plan = true`, [fx.storeId]).catch(() => undefined);
    fx.ids.plans.push(...planIds);
    fx.ids.recipes.push(...recipeIds);
    fx.ids.products.push(...productIds);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('règle « partiel » (défaut) : 130 tranches restent 130, aucun ajustement', async () => {
    const plan = await newPlan(130);
    const it = await itemOf(plan.id);
    expect(num(it.planned_quantity)).toBe(130);
    expect(it.requested_quantity).toBeNull();
    expect(it.nb_contenants).toBeNull();
    expect(plan.lot_adjustments).toEqual([]);
  });

  it('C-04 : fournées entières → 3 cadres, 144 prévues, 130 demandées', async () => {
    await p().query(`UPDATE recipe_formats SET lot_rule = 'entier' WHERE id = $1`, [operaFormat]);
    const plan = await newPlan(130);
    const it = await itemOf(plan.id);
    expect(num(it.planned_quantity)).toBe(144);
    expect(num(it.requested_quantity)).toBe(130);
    expect(it.nb_contenants).toBe(3);
    expect(plan.lot_adjustments).toEqual([
      { productId: opera, formatId: null, requested: 130, planned: 144, batches: 3, surplus: 14, overMax: false },
    ]);
  });

  it('C-04 : même résultat quand l\'écran envoie le format ; les besoins couvrent 3 cadres', async () => {
    const plan = await newPlan(130, true);
    const it = await itemOf(plan.id);
    expect(num(it.planned_quantity)).toBe(144);
    expect(it.nb_contenants).toBe(3);
    expect(it.format_id).toBe(operaFormat);

    await repos.productionRepository.confirm(plan.id, fx.userId);
    const need = (await p().query(
      `SELECT needed_quantity FROM production_ingredient_needs WHERE plan_id = $1 AND ingredient_id = $2`, [plan.id, chocolat])).rows[0];
    expect(num(need.needed_quantity)).toBeCloseTo(7.2, 3); // 3 cadres × 2,4 kg, et non 2,708 × 2,4 = 6,5
  });

  it('C-05 : sans règle sur la base, le plan de semi-fini reste arrondi au kilo (7,2 → 8 kg)', async () => {
    const planId = planIds[planIds.length - 1];
    const dep = (await p().query(
      `SELECT d.quantity_to_produce, i.planned_quantity, i.nb_contenants
         FROM production_plan_dependencies d JOIN production_plan_items i ON i.plan_id = d.dependency_plan_id
        WHERE d.parent_plan_id = $1`, [planId])).rows[0];
    expect(num(dep.quantity_to_produce)).toBeCloseTo(7.2, 3);
    expect(num(dep.planned_quantity)).toBe(8);
    expect(dep.nb_contenants).toBeNull();
  });

  it('C-05 : base en fournées entières → 3 fournées de 2,9 kg = 8,7 kg', async () => {
    await p().query(`UPDATE recipe_formats SET lot_rule = 'entier' WHERE recipe_id = $1 AND is_default`, [creme]);
    const plan = await newPlan(130);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    const dep = (await p().query(
      `SELECT d.quantity_to_produce, i.planned_quantity, i.requested_quantity, i.nb_contenants
         FROM production_plan_dependencies d JOIN production_plan_items i ON i.plan_id = d.dependency_plan_id
        WHERE d.parent_plan_id = $1`, [plan.id])).rows[0];
    expect(num(dep.quantity_to_produce)).toBeCloseTo(7.2, 3);
    // Lot 4 (C-06) : le plan de crème du plan précédent, encore en brouillon le même jour, est
    // partagé — 7,2 + 7,2 = 14,4 kg demandés, 5 fournées de 2,9 kg = 14,5 kg.
    expect(num(dep.requested_quantity)).toBeCloseTo(14.4, 3);
    expect(num(dep.planned_quantity)).toBeCloseTo(14.5, 3);
    expect(dep.nb_contenants).toBe(5);
  });

  it('modifier les lignes d\'un brouillon réapplique la règle', async () => {
    const plan = await newPlan(48);
    const res = await repos.productionRepository.updateItems(plan.id, [{ productId: opera, plannedQuantity: 50 }]);
    const it = await itemOf(plan.id);
    expect(num(it.planned_quantity)).toBe(96);
    expect(num(it.requested_quantity)).toBe(50);
    expect(it.nb_contenants).toBe(2);
    expect(res.lotAdjustments).toHaveLength(1);
  });

  it('fiche › ingrédients à plat : préparations de base consommées, avec leur stock', async () => {
    const { recipeRepository } = await import('../../repositories/recipe.repository.js');
    // 1,5 kg de crème en stock dans l'établissement du test.
    await p().query(
      `INSERT INTO semi_finished_stock (recipe_id, store_id, quantity_available, unit) VALUES ($1, $2, 1.5, 'kg')
       ON CONFLICT (recipe_id, store_id) DO UPDATE SET quantity_available = 1.5`, [creme, fx.storeId]);
    const res = await recipeRepository.getExplosion(operaRecipe, fx.storeId);
    // La fiche opéra consomme 2,4 kg de crème par cadre : c'est la base qui sort du stock,
    // pas le lait qu'elle contient (qui reste listé dans les matières à plat).
    expect(res.bases).toEqual([{ recipe_id: creme, name: expect.stringContaining('Crème a2'), unit: 'kg', qty: 2.4, stock: 1.5 }]);
    // Matières : le chocolat est saisi sur la fiche (sorti à cette production) ; le lait n'est
    // que dans la crème (déjà sorti à sa fabrication) — part directe nulle.
    const line = (id: string) => res.lines.find(l => l.ingredient_id === id) as { total_qty: number; direct_qty?: number };
    expect(line(chocolat).direct_qty).toBeCloseTo(2.4, 3);
    expect(line(lait).direct_qty).toBe(0);
    expect(line(lait).total_qty).toBeCloseTo(2.4, 3);
    // Un autre établissement ne voit pas ce stock.
    const other = await recipeRepository.getExplosion(operaRecipe, '00000000-0000-0000-0000-000000000001');
    expect(other.bases[0].stock).toBe(0);
    await p().query(`UPDATE semi_finished_stock SET quantity_available = 0 WHERE recipe_id = $1`, [creme]);
  });

  it('C-23 : dupliquer un format garde le rendement au kilo et la règle de lot', async () => {
    const { recipeComponentRepository } = await import('../../repositories/recipe-component.repository.js');
    const src = (await p().query(
      `UPDATE recipe_formats SET lot_min = 1, lot_max = 4 WHERE recipe_id = $1 AND is_default RETURNING id`, [creme])).rows[0].id;
    const contenant = (await p().query(
      `INSERT INTO production_contenants (nom, type_production, unite_lancement, quantite_theorique)
       VALUES ($1, 1, 'kg_pate', 10) RETURNING id`, [`Cuve a2 ${RUN}`])).rows[0].id;
    const copy = await recipeComponentRepository.duplicateFormat(creme, src, contenant, fx.userId);
    expect(copy).not.toBeNull();
    const f = (await p().query(
      `SELECT rendement_unite, rendement_kg, lot_rule, lot_min, lot_max,
              (SELECT count(*)::int FROM recipe_format_components c WHERE c.format_id = rf.id) AS lignes
         FROM recipe_formats rf WHERE recipe_id = $1 AND contenant_id = $2`, [creme, contenant])).rows[0];
    expect(f.rendement_unite).toBe('kg');           // avant : redevenait « unit »
    expect(num(f.rendement_kg)).toBeCloseTo(2.9, 3);
    expect(f.lot_rule).toBe('entier');
    expect(num(f.lot_min)).toBe(1);
    expect(num(f.lot_max)).toBe(4);
    expect(f.lignes).toBe(1);
    await p().query(`UPDATE recipe_formats SET lot_min = NULL, lot_max = NULL WHERE recipe_id = $1`, [creme]);
    await p().query(`UPDATE recipe_formats SET is_active = false WHERE recipe_id = $1 AND contenant_id = $2`, [creme, contenant]);
  });

  it('maximum de fournées dépassé : la quantité n\'est pas écrêtée, l\'ajustement le signale', async () => {
    await p().query(`UPDATE recipe_formats SET lot_max = 2 WHERE id = $1`, [operaFormat]);
    const plan = await newPlan(130);
    expect(num((await itemOf(plan.id)).planned_quantity)).toBe(144);
    expect(plan.lot_adjustments[0].overMax).toBe(true);
    await p().query(`UPDATE recipe_formats SET lot_max = NULL WHERE id = $1`, [operaFormat]);
  });
});
