/**
 * Mig 672 — préparations de base consommées, rattachées à l'article du plan parent.
 *
 * Plan parent : A (0,5 kg de crème/pièce), B (0,1 kg/pièce), C (sans crème), 10 de chaque.
 * Besoin en crème : 5 kg pour A, 1 kg pour B. 2 kg en stock, le reste fabriqué par le plan fils.
 *  - réservation sur stock et part du plan fils : partagées 5/6 – 1/6 entre A et B, rien pour C ;
 *  - coût réel : la crème est mesurée par article ;
 *  - traçabilité du lot de lait (dans la crème) : C n'est pas touché.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, setComposition, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Préparations de base par article (mig 672)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let lait: string;
  let laitLot: string;
  let sucre: string;
  let creme: string;
  let planId: string;
  let childId: string;
  const ids: Record<string, string> = {};
  const p = () => testPool();

  async function product(tag: string, cremeKg: number | null) {
    const id = (await p().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 10, 'jour', 'unit') RETURNING id`,
      [`Prep ${tag} ${RUN}`, `prep-${tag}-${RUN}`])).rows[0].id;
    fx.ids.products.push(id);
    const rec = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout, compo_par_piece)
       VALUES ($1, false, $2, 1, 'unit', 'compose', true) RETURNING id`, [`Fiche prep ${tag} ${RUN}`, id])).rows[0].id;
    fx.ids.recipes.push(rec);
    if (cremeKg) await p().query(`INSERT INTO recipe_components (recipe_id, source_recipe_id, quantite, unite, role) VALUES ($1, $2, $3, 'kg', 'base')`, [rec, creme, cremeKg]);
    await p().query(`INSERT INTO recipe_components (recipe_id, source_ingredient_id, quantite, unite, role) VALUES ($1, $2, 0.01, 'kg', 'ingredient')`, [rec, sucre]);
    return id;
  }

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    lait = await createIngredient(fx, { name: 'Lait prep', unit: 'kg', unitCost: 10 });
    sucre = await createIngredient(fx, { name: 'Sucre prep', unit: 'kg', unitCost: 6 });
    laitLot = await createLot(fx, { ingredientId: lait, lotNumber: 'LPREP', pesage: 100, expiresInDays: 20, unitCost: 10 });
    await createLot(fx, { ingredientId: sucre, lotNumber: 'SPREP', pesage: 10, expiresInDays: 365, unitCost: 6 });
    creme = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout)
       VALUES ($1, true, NULL, 1, 'kg', 'ratio_poids') RETURNING id`, [`Crème prep ${RUN}`])).rows[0].id;
    fx.ids.recipes.push(creme);
    await setComposition(creme, { ingredients: [{ ingredientId: lait, quantity: 1, unit: 'kg' }] });
    // 2 kg de crème en stock (lot fait d'un lot de lait antérieur, sans lien de traçabilité ici).
    await p().query(`INSERT INTO semi_finished_stock (recipe_id, store_id, quantity_available, unit) VALUES ($1, $2, 2, 'kg')`, [creme, fx.storeId]);
    await p().query(
      `INSERT INTO semi_finished_lots (recipe_id, store_id, lot_number, quantity_produced, quantity_remaining, unit, produced_at, status)
       VALUES ($1, $2, $3, 2, 2, 'kg', NOW(), 'active')`, [creme, fx.storeId, `SF-PREP-${RUN}`]);

    ids.A = await product('A', 0.5);
    ids.B = await product('B', 0.1);
    ids.C = await product('C', null);
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: ['A', 'B', 'C'].map(k => ({ productId: ids[k], plannedQuantity: 10 })),
    });
    planId = plan.id;
    fx.ids.plans.push(planId);
    for (const r of (await p().query(`SELECT id, product_id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows) {
      for (const k of ['A', 'B', 'C']) if (r.product_id === ids[k]) ids[`item${k}`] = r.id;
    }
    await repos.productionRepository.confirm(planId, fx.userId);
    childId = (await p().query(
      `SELECT dependency_plan_id FROM production_plan_dependencies WHERE parent_plan_id = $1 AND sub_recipe_id = $2`, [planId, creme])).rows[0].dependency_plan_id;
    fx.ids.plans.push(childId);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM semi_finished_lot_usage WHERE semi_finished_lot_id IN (SELECT id FROM semi_finished_lots WHERE recipe_id = $1)`, [creme]).catch(() => undefined);
    await p().query(`DELETE FROM semi_finished_lots WHERE recipe_id = $1`, [creme]).catch(() => undefined);
    await p().query(`DELETE FROM semi_finished_transactions WHERE recipe_id = $1`, [creme]).catch(() => undefined);
    await p().query(`DELETE FROM semi_finished_stock WHERE recipe_id = $1`, [creme]).catch(() => undefined);
    await p().query(`DELETE FROM production_plan_dependencies WHERE sub_recipe_id = $1`, [creme]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_components WHERE source_recipe_id = $1`, [creme]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const usageByItem = async () => new Map<string | null, number>((await p().query(
    `SELECT parent_plan_item_id AS item, SUM(quantity)::float8 AS q FROM semi_finished_lot_usage
      WHERE parent_plan_id = $1 AND released_at IS NULL GROUP BY 1`, [planId])).rows.map(r => [r.item, Number(r.q)]));

  it('réservation sur stock : partagée entre A et B au prorata de leur besoin, rien pour C', async () => {
    const dep = (await p().query(`SELECT item_shares FROM production_plan_dependencies WHERE parent_plan_id = $1`, [planId])).rows[0];
    expect(dep.item_shares[ids.itemA]).toBeCloseTo(5, 3);
    expect(dep.item_shares[ids.itemB]).toBeCloseTo(1, 3);
    expect(dep.item_shares[ids.itemC]).toBeUndefined();
    const u = await usageByItem();
    expect(u.get(ids.itemA)).toBeCloseTo(2 * 5 / 6, 3);
    expect(u.get(ids.itemB)).toBeCloseTo(2 * 1 / 6, 3);
    expect(u.has(ids.itemC)).toBe(false);
    expect(u.has(null)).toBe(false);
  });

  it('plan fils produit : sa part est imputée à A et B, au total 5 kg et 1 kg', async () => {
    const item = (await p().query(`SELECT id, planned_quantity FROM production_plan_items WHERE plan_id = $1`, [childId])).rows[0];
    await repos.productionRepository.confirm(childId, fx.userId);
    await repos.productionRepository.start(childId, fx.userId);
    await repos.productionRepository.produceItems(childId, [{ planItemId: item.id, actualQuantity: num(item.planned_quantity) }], fx.userId, fx.storeId);
    const u = await usageByItem();
    expect(u.get(ids.itemA)).toBeCloseTo(5, 3);
    expect(u.get(ids.itemB)).toBeCloseTo(1, 3);
    expect(u.has(ids.itemC)).toBe(false);
  });

  it('coût réel : la crème est mesurée par article', async () => {
    const { productionCoutRepository } = await import('../../repositories/production-cout.repository.js');
    const cost = await productionCoutRepository.computePlanCost(planId);
    const line = cost.detailMatieres.find(d => d.ingredient_id === `semi:${creme}`)!;
    expect(line).toBeDefined();
    const a = line.by_item?.[ids.itemA] ?? 0;
    const b = line.by_item?.[ids.itemB] ?? 0;
    expect(a).toBeGreaterThan(0);
    expect(a / (a + b)).toBeCloseTo(5 / 6, 2);
    expect(line.by_item?.[ids.itemC]).toBeUndefined();
  });

  it('traçabilité aval du lait (fabriqué dans la crème) : C n\'est pas touché', async () => {
    const { traceabilityRepository } = await import('../../repositories/traceability.repository.js');
    const t = await traceabilityRepository.forward(laitLot);
    const parentItems = t!.items.filter(i => i.plan_id === planId).map(i => i.id);
    expect(parentItems).toEqual(expect.arrayContaining([ids.itemA, ids.itemB]));
    expect(parentItems).not.toContain(ids.itemC);
    expect(t!.excludedItems.map(i => i.id)).toContain(ids.itemC);
  });
});
