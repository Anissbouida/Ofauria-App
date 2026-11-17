/**
 * M4-06 — co-produits déclarés (mig 564).
 * Cadre de tranches, coût complet 2 par pièce équivalente. Sortie déclarée : 40 tranches
 * (principal), 1 entremets = 8 pièces (co-produit), 3 chutes valorisées 1,5 (sous-produit
 * déclaré sur la fiche).
 *  - quantité produite = 48 pièces équivalentes (les chutes n'y entrent pas) ;
 *  - chaque sortie a son lot ;
 *  - coût : 96 au total, 4,5 de chutes déduits au prorata (tranches 76,25, entremets 15,25) ;
 *  - sans sous-produit, la vue v2 rend exactement les coûts de la vue 397 (coupe inchangée).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, num, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Co-produits déclarés (M4-06)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let outs: typeof import('../../repositories/recipe-output.repository.js')['recipeOutputRepository'];
  let fx: Fixtures; let slice: { productId: string; recipeId: string }; let cake: string; let scraps: string; let planId: string; let itemId: string;
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    repos = await importRepositories();
    outs = (await import('../../repositories/recipe-output.repository.js')).recipeOutputRepository;
    fx = await createBaseFixtures();
    slice = await createProductWithRecipe(fx, { name: 'Tranche M406', price: 3, ingredients: [] });
    cake = (await createProductWithRecipe(fx, { name: 'Entremets M406', price: 25, ingredients: [] })).productId;
    scraps = (await createProductWithRecipe(fx, { name: 'Chutes M406', price: 2, ingredients: [] })).productId;
    await outs.upsert(slice.recipeId, { productId: scraps, outputType: 'sous_produit', fixedUnitValue: 1.5 });
    await outs.upsert(slice.recipeId, { productId: cake, outputType: 'co_produit', equivPieces: 8 });
    const pl = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId: slice.productId, plannedQuantity: 50 }] });
    planId = pl.id; fx.ids.plans.push(planId);
    itemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0].id;
    await repos.productionRepository.confirm(planId, fx.userId);
    await repos.productionRepository.start(planId, fx.userId);
    // Coût complet figé par pièce équivalente (donnée du test : fiche sans ingrédient).
    await p().query(`UPDATE production_plan_items SET theo_cout_complet_u = 2 WHERE id = $1`, [itemId]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('les sorties déclarées sont proposées sur la ligne', async () => {
    const plan = await repos.productionRepository.findById(planId);
    const item = (plan as { items: Record<string, any>[] }).items[0];
    expect(item.declared_outputs.map((d: Record<string, unknown>) => d.output_type).sort()).toEqual(['co_produit', 'sous_produit']);
    await expect(outs.upsert(slice.recipeId, { productId: slice.productId, outputType: 'co_produit', equivPieces: 2 })).rejects.toThrow(/sortie principale/);
  });

  it('déclaration : 48 pièces équivalentes, un lot par sortie, coût réparti avec déduction du sous-produit', async () => {
    await repos.productionRepository.produceItems(planId, [{ planItemId: itemId, actualQuantity: 0, outputs: [
      { quantity: 40 },
      { productId: cake, equivPieces: 8, quantity: 1 },
      { productId: scraps, quantity: 3, outputType: 'sous_produit' },
    ] }], fx.userId, fx.storeId);
    expect(num((await p().query(`SELECT actual_quantity FROM production_plan_items WHERE id = $1`, [itemId])).rows[0].actual_quantity)).toBeCloseTo(48, 3);
    const rows = (await p().query(`SELECT output_type, product_lot_id, fixed_unit_value FROM production_item_outputs WHERE plan_item_id = $1 ORDER BY output_type`, [itemId])).rows;
    expect(rows.map(r => r.output_type)).toEqual(['co_produit', 'principal', 'sous_produit']);
    expect(rows.every(r => r.product_lot_id)).toBe(true);
    expect(num(rows[2].fixed_unit_value)).toBeCloseTo(1.5, 4);
    const cost = (await p().query(`SELECT output_type, cost_share, unit_cost FROM v_production_output_cost_v2 WHERE plan_item_id = $1 ORDER BY output_type`, [itemId])).rows;
    expect(cost.map(c => num(c.cost_share))).toEqual([15.25, 76.25, 4.5]);
    expect(cost.reduce((t, c) => t + num(c.cost_share), 0)).toBeCloseTo(96, 2);
  });

  it('sans sous-produit, v2 = vue de coupe 397', async () => {
    const diff = (await p().query(
      `SELECT count(*)::int AS n FROM v_production_output_cost v1 JOIN v_production_output_cost_v2 v2 USING (output_id)
        WHERE v2.fixed_deduction = 0 AND (v1.cost_share IS DISTINCT FROM v2.cost_share OR v1.unit_cost IS DISTINCT FROM v2.unit_cost)`)).rows[0].n;
    expect(diff).toBe(0);
  });
});
