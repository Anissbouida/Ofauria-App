/**
 * F-044 (modèle B) — cas limites.
 *
 * Mêmes invariants que p1-f044-modele-b : matières consommées UNE fois, base
 * imputée au parent, pas d'accumulation de semi_finished_stock.
 *
 * 1. Recette COMPOSÉE (mode_cout='compose', recipe_components) référençant une base.
 * 2. Base IMBRIQUÉE (une base dont la recette contient une autre base).
 * 3. COUPE sur un produit à base (sorties de coupe n'altèrent pas l'équilibre).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Production — semi-finis modèle B, cas limites (F-044)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  const createdPlanIds: string[] = [];
  const createdRecipeIds: string[] = [];
  const createdProductIds: string[] = [];

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    for (const rid of createdRecipeIds) {
      await p.query(`DELETE FROM semi_finished_lot_usage WHERE semi_finished_lot_id IN (SELECT id FROM semi_finished_lots WHERE recipe_id = $1)`, [rid]).catch(() => undefined);
      await p.query(`DELETE FROM semi_finished_lots WHERE recipe_id = $1`, [rid]).catch(() => undefined);
      await p.query(`DELETE FROM semi_finished_transactions WHERE recipe_id = $1`, [rid]).catch(() => undefined);
      await p.query(`DELETE FROM semi_finished_stock WHERE recipe_id = $1`, [rid]).catch(() => undefined);
      await p.query(`DELETE FROM production_plan_dependencies WHERE sub_recipe_id = $1`, [rid]).catch(() => undefined);
      await p.query(`DELETE FROM recipe_components WHERE recipe_id = $1 OR source_recipe_id = $1`, [rid]).catch(() => undefined);
      await p.query(`DELETE FROM recipe_sub_recipes WHERE recipe_id = $1 OR sub_recipe_id = $1`, [rid]).catch(() => undefined);
    }
    await p.query(`DELETE FROM production_item_outputs WHERE plan_item_id IN (SELECT id FROM production_plan_items WHERE plan_id = ANY($1::uuid[]))`, [createdPlanIds]).catch(() => undefined);
    await p.query(`DELETE FROM production_plans WHERE store_id = $1 AND is_semi_finished_plan = true`, [fx.storeId]).catch(() => undefined);
    fx.ids.plans.push(...createdPlanIds);
    fx.ids.recipes.push(...createdRecipeIds);
    fx.ids.products.push(...createdProductIds);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  /** Base simple : 1 kg d'un ingredient / kg produit. */
  async function makeBase(tag: string, ingredientId: string): Promise<string> {
    const r = await testPool().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout)
       VALUES ($1, true, NULL, 1, 'kg', 'ratio_poids') RETURNING id`,
      [`Base ${tag} ${RUN}`]
    );
    const id = r.rows[0].id;
    createdRecipeIds.push(id);
    await testPool().query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 1, 'kg')`, [id, ingredientId]);
    return id;
  }

  async function makeProduct(tag: string, price = 3): Promise<string> {
    const r = await testPool().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, $3, 'jour', 'unit') RETURNING id`,
      [`Prod ${tag} ${RUN}`, `prod-${tag}-${RUN}`, price]
    );
    createdProductIds.push(r.rows[0].id);
    return r.rows[0].id;
  }

  async function confirmPlan(productId: string, qty: number): Promise<string> {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: qty }],
    });
    createdPlanIds.push(plan.id);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    return plan.id;
  }

  async function produceChild(parentPlanId: string, baseRecipeId: string): Promise<void> {
    const dep = await testPool().query(
      `SELECT dependency_plan_id, quantity_to_produce FROM production_plan_dependencies WHERE parent_plan_id = $1 AND sub_recipe_id = $2`,
      [parentPlanId, baseRecipeId]
    );
    const childPlanId = dep.rows[0].dependency_plan_id as string;
    const toProduce = Math.ceil(num(dep.rows[0].quantity_to_produce));
    const item = await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [childPlanId]);
    await repos.productionRepository.confirm(childPlanId, fx.userId);
    await repos.productionRepository.start(childPlanId, fx.userId);
    await repos.productionRepository.produceItems(childPlanId, [{ planItemId: item.rows[0].id as string, actualQuantity: toProduce }], fx.userId, fx.storeId);
  }

  const inv = async (ingId: string) =>
    num((await testPool().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [ingId, fx.storeId])).rows[0]?.current_quantity);
  const sfStock = async (recipeId: string) =>
    num((await testPool().query(`SELECT COALESCE(SUM(quantity_available),0) q FROM semi_finished_stock WHERE recipe_id = $1 AND store_id = $2`, [recipeId, fx.storeId])).rows[0].q);
  const needsOf = async (planId: string) =>
    (await testPool().query(`SELECT ingredient_id FROM production_ingredient_needs WHERE plan_id = $1`, [planId])).rows.map((r) => r.ingredient_id);

  it('1. recette COMPOSÉE référençant une base : base exclue du BSI, imputée au parent, pas d\'accumulation', async () => {
    const farine = await createIngredient(fx, { name: 'Farine c1', unit: 'kg', unitCost: 5 });
    const sel = await createIngredient(fx, { name: 'Sel c1', unit: 'kg', unitCost: 2 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'F1', pesage: 100, expiresInDays: 60, unitCost: 5 });
    await createLot(fx, { ingredientId: sel, lotNumber: 'S1', pesage: 10, expiresInDays: 365, unitCost: 2 });
    const base = await makeBase('c1', farine);

    const prod = await makeProduct('c1');
    const rec = await testPool().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout, compo_par_piece)
       VALUES ($1, false, $2, 1, 'unit', 'compose', true) RETURNING id`,
      [`Rec compose c1 ${RUN}`, prod]
    );
    createdRecipeIds.push(rec.rows[0].id);
    // Composant base (0,5 kg de pate/piece) + composant ingredient direct (0,01 kg sel).
    await testPool().query(`INSERT INTO recipe_components (recipe_id, source_recipe_id, quantite, unite, role) VALUES ($1, $2, 0.5, 'kg', 'base')`, [rec.rows[0].id, base]);
    await testPool().query(`INSERT INTO recipe_components (recipe_id, source_ingredient_id, quantite, unite, role) VALUES ($1, $2, 0.01, 'kg', 'ingredient')`, [rec.rows[0].id, sel]);

    const farineBefore = await inv(farine);
    const planId = await confirmPlan(prod, 10);

    const needs = await needsOf(planId);
    expect(needs).toContain(sel);
    expect(needs).not.toContain(farine);
    const dep = await testPool().query(`SELECT quantity_to_produce FROM production_plan_dependencies WHERE parent_plan_id = $1 AND sub_recipe_id = $2`, [planId, base]);
    expect(dep.rows).toHaveLength(1);
    expect(num(dep.rows[0].quantity_to_produce)).toBeCloseTo(5, 2);

    await produceChild(planId, base);
    expect(await inv(farine)).toBeCloseTo(farineBefore - 5, 2);
    expect(await sfStock(base)).toBeCloseTo(0, 2);
    const usage = await testPool().query(
      `SELECT COALESCE(SUM(quantity),0) q FROM semi_finished_lot_usage u JOIN semi_finished_lots l ON l.id = u.semi_finished_lot_id WHERE l.recipe_id = $1 AND u.parent_plan_id = $2`,
      [base, planId]
    );
    expect(num(usage.rows[0].q)).toBeCloseTo(5, 2);
  });

  it('2. base IMBRIQUÉE : aucun double comptage ni accumulation, aux deux niveaux', async () => {
    const farine = await createIngredient(fx, { name: 'Farine c2', unit: 'kg', unitCost: 5 });
    const levainIng = await createIngredient(fx, { name: 'Levain-ing c2', unit: 'kg', unitCost: 3 });
    const sel = await createIngredient(fx, { name: 'Sel c2', unit: 'kg', unitCost: 2 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'F2', pesage: 100, expiresInDays: 60, unitCost: 5 });
    await createLot(fx, { ingredientId: levainIng, lotNumber: 'LV2', pesage: 100, expiresInDays: 60, unitCost: 3 });
    await createLot(fx, { ingredientId: sel, lotNumber: 'S2', pesage: 10, expiresInDays: 365, unitCost: 2 });

    // Base interne « Levain » : 1 kg de levain-ing / kg.
    const levain = await makeBase('c2-levain', levainIng);
    // Base « Pate » (legacy) : 1 kg Farine + 0,2 kg de Levain (base imbriquee) / kg.
    const pate = await testPool().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout) VALUES ($1, true, NULL, 1, 'kg', 'ratio_poids') RETURNING id`,
      [`Base c2-pate ${RUN}`]
    );
    createdRecipeIds.push(pate.rows[0].id);
    await testPool().query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 1, 'kg')`, [pate.rows[0].id, farine]);
    await testPool().query(`INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, 0.2)`, [pate.rows[0].id, levain.valueOf()]);

    // Produit « Pain » (legacy) : 0,5 kg Pate + 0,01 kg Sel / piece.
    const prod = await makeProduct('c2');
    const rec = await testPool().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout) VALUES ($1, false, $2, 1, 'unit', 'ratio_poids') RETURNING id`,
      [`Rec c2 ${RUN}`, prod]
    );
    createdRecipeIds.push(rec.rows[0].id);
    await testPool().query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 0.01, 'kg')`, [rec.rows[0].id, sel]);
    await testPool().query(`INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, 0.5)`, [rec.rows[0].id, pate.rows[0].id]);

    const farineBefore = await inv(farine);
    const levainIngBefore = await inv(levainIng);
    const planId = await confirmPlan(prod, 10);

    // Parent : BSI = Sel seul ; ni Farine ni Levain-ing (dans la base Pate).
    const needs = await needsOf(planId);
    expect(needs).toContain(sel);
    expect(needs).not.toContain(farine);
    expect(needs).not.toContain(levainIng);
    // Dependance Pate = 5 kg. Pas de dependance au niveau du parent pour Levain.
    const depPate = await testPool().query(`SELECT quantity_to_produce FROM production_plan_dependencies WHERE parent_plan_id = $1 AND sub_recipe_id = $2`, [planId, pate.rows[0].id]);
    expect(num(depPate.rows[0].quantity_to_produce)).toBeCloseTo(5, 2);

    // Produire le plan fils Pate : il consomme SES matieres (Farine 5) ET le
    // Levain aplati (0,2 x 5 = 1 kg de levain-ing), chacune UNE fois. Pas de
    // stock semi-fini Levain (pas de petit-fils), pas de Pate residuelle.
    await produceChild(planId, pate.rows[0].id);
    expect(await inv(farine)).toBeCloseTo(farineBefore - 5, 2);
    expect(await inv(levainIng)).toBeCloseTo(levainIngBefore - 1, 2);
    expect(await sfStock(pate.rows[0].id)).toBeCloseTo(0, 2);
    expect(await sfStock(levain.valueOf())).toBeCloseTo(0, 2);   // aucune accumulation sur la base interne
  });

  it('3. COUPE sur un produit à base : les sorties de coupe n\'altèrent pas l\'équilibre matières↔base', async () => {
    const farine = await createIngredient(fx, { name: 'Farine c3', unit: 'kg', unitCost: 5 });
    const sel = await createIngredient(fx, { name: 'Sel c3', unit: 'kg', unitCost: 2 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'F3', pesage: 100, expiresInDays: 60, unitCost: 5 });
    await createLot(fx, { ingredientId: sel, lotNumber: 'S3', pesage: 10, expiresInDays: 365, unitCost: 2 });
    const base = await makeBase('c3', farine);

    // Produit cadre « Tarte » (legacy) : 0,5 kg Pate + 0,01 kg Sel / piece. Sortie
    // de coupe secondaire « Part de tarte ».
    const tarte = await makeProduct('c3-tarte');
    const part = await makeProduct('c3-part');
    const rec = await testPool().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout) VALUES ($1, false, $2, 1, 'unit', 'ratio_poids') RETURNING id`,
      [`Rec c3 ${RUN}`, tarte]
    );
    createdRecipeIds.push(rec.rows[0].id);
    await testPool().query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 0.01, 'kg')`, [rec.rows[0].id, sel]);
    await testPool().query(`INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, 0.5)`, [rec.rows[0].id, base]);

    const farineBefore = await inv(farine);
    const planId = await confirmPlan(tarte, 10);

    // BSI parent = Sel seul.
    expect(await needsOf(planId)).not.toContain(farine);

    // Acceptation du BSI parent (Sel) : prise en charge -> pesee -> remise -> reception.
    const bons = await repos.bonSortieRepository.findByPlan(planId);
    const bonId = bons[0].id;
    await repos.bonSortieRepository.markAsPreparation(bonId, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    const selLine = bon.lines.find((l: Record<string, unknown>) => l.ingredient_id === sel);
    await repos.bonSortieRepository.weighLignes(bonId, fx.userId, [{ ligneId: selLine.id as string, actualQuantity: num(selLine.allocated_quantity), source: 'manual' }]);
    await repos.bonSortieRepository.markAsReady(bonId, fx.userId);
    await repos.bonSortieRepository.acceptReception(bonId, fx.userId);

    // Plan fils (Pate) produit : base consommee UNE fois, imputee au parent.
    await produceChild(planId, base);
    expect(await inv(farine)).toBeCloseTo(farineBefore - 5, 2);
    expect(await sfStock(base)).toBeCloseTo(0, 2);

    // Production du parent AVEC coupe : 10 pieces = 6 Tartes + 2 Parts (equiv 2).
    const item = await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1 AND product_id = $2`, [planId, tarte]);
    await repos.productionRepository.start(planId, fx.userId);
    await repos.productionRepository.produceItems(planId, [{
      planItemId: item.rows[0].id as string, actualQuantity: 10,
      outputs: [
        { productId: tarte, quantity: 6 },
        { productId: part, quantity: 2, equivPieces: 2 },
      ],
    }], fx.userId, fx.storeId);

    // L'equilibre base/matieres est INCHANGE par la coupe (toujours 5 kg une fois, SF 0).
    expect(await inv(farine)).toBeCloseTo(farineBefore - 5, 2);
    expect(await sfStock(base)).toBeCloseTo(0, 2);

    // Les sorties de coupe sont bien enregistrees (2 lignes).
    const outs = await testPool().query(
      `SELECT product_id, quantity FROM production_item_outputs WHERE plan_item_id = $1 ORDER BY quantity DESC`,
      [item.rows[0].id]
    );
    expect(outs.rows).toHaveLength(2);
    const byProduct = new Map(outs.rows.map((r) => [r.product_id, num(r.quantity)]));
    expect(byProduct.get(tarte)).toBeCloseTo(6, 2);
    expect(byProduct.get(part)).toBeCloseTo(2, 2);
  });
});
