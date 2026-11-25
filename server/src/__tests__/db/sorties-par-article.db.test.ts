/**
 * Mig 663 — sorties de matière rattachées à l'article de l'ordre.
 *
 * Un plan avec deux articles : A (beurre + farine) et B (farine seule).
 *  - besoins enregistrés par ligne ;
 *  - bon de sortie : chaque lot sorti est porté par les lignes qui en ont besoin, au prorata ;
 *    le beurre n'est rattaché qu'à A ;
 *  - coût réel : le beurre est compté entièrement dans A, mesuré sur ses sorties ;
 *  - traçabilité et rappel du lot de beurre : B n'est pas touché.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, setComposition, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Sorties de matière par article (mig 663)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let beurre: string;
  let farine: string;
  let beurreLot: string;
  let prodA: string;
  let prodB: string;
  let planId: string;
  let itemA: string;
  let itemB: string;
  const p = () => testPool();

  async function product(tag: string, lines: { ingredientId: string; quantity: number }[]) {
    const id = (await p().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 10, 'jour', 'unit') RETURNING id`,
      [`Art ${tag} ${RUN}`, `art-${tag}-${RUN}`])).rows[0].id;
    fx.ids.products.push(id);
    const rec = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout, compo_par_piece)
       VALUES ($1, false, $2, 1, 'unit', 'compose', true) RETURNING id`, [`Fiche ${tag} ${RUN}`, id])).rows[0].id;
    fx.ids.recipes.push(rec);
    await setComposition(rec, { ingredients: lines.map(l => ({ ...l, unit: 'kg' })) });
    return id;
  }

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    beurre = await createIngredient(fx, { name: 'Beurre spa', unit: 'kg', unitCost: 80 });
    farine = await createIngredient(fx, { name: 'Farine spa', unit: 'kg', unitCost: 5 });
    beurreLot = await createLot(fx, { ingredientId: beurre, lotNumber: 'BSPA', pesage: 50, expiresInDays: 30, unitCost: 80 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'FSPA', pesage: 50, expiresInDays: 90, unitCost: 5 });
    prodA = await product('A', [{ ingredientId: beurre, quantity: 0.1 }, { ingredientId: farine, quantity: 0.2 }]);
    prodB = await product('B', [{ ingredientId: farine, quantity: 0.3 }]);

    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: prodA, plannedQuantity: 10 }, { productId: prodB, plannedQuantity: 10 }],
    });
    planId = plan.id;
    fx.ids.plans.push(planId);
    const items = (await p().query(`SELECT id, product_id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows;
    itemA = items.find(i => i.product_id === prodA).id;
    itemB = items.find(i => i.product_id === prodB).id;
    await repos.productionRepository.confirm(planId, fx.userId);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM production_cout_reel WHERE plan_id = $1`, [planId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('besoins enregistrés par ligne de plan', async () => {
    const rows = (await p().query(
      `SELECT plan_item_id, ingredient_id, needed_quantity FROM production_ingredient_needs WHERE plan_id = $1`, [planId])).rows;
    const of = (item: string, ing: string) => num(rows.find(r => r.plan_item_id === item && r.ingredient_id === ing)?.needed_quantity);
    expect(of(itemA, beurre)).toBeCloseTo(1, 3);
    expect(of(itemA, farine)).toBeCloseTo(2, 3);
    expect(of(itemB, farine)).toBeCloseTo(3, 3);
    expect(rows.some(r => r.plan_item_id === itemB && r.ingredient_id === beurre)).toBe(false);
  });

  it('bon de sortie : chaque lot sorti est porté par les lignes qui en ont besoin', async () => {
    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(planId))[0];
    await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, fresh.lines.map((l: Record<string, unknown>) => (
      { ligneId: l.id as string, actualQuantity: num(l.allocated_quantity), source: 'manual' as const })));
    await repos.bonSortieRepository.markAsReady(bon.id, fx.userId);
    await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);

    const usage = (await p().query(
      `SELECT ingredient_id, plan_item_id, SUM(quantity_used)::float8 AS q FROM production_lot_usage
        WHERE production_plan_id = $1 GROUP BY 1, 2`, [planId])).rows;
    const of = (item: string | null, ing: string) => num(usage.find(r => r.plan_item_id === item && r.ingredient_id === ing)?.q);
    expect(of(itemA, beurre)).toBeCloseTo(1, 3);
    expect(of(itemB, beurre)).toBe(0);
    expect(of(itemA, farine)).toBeCloseTo(2, 3);   // 5 kg de farine : 2 pour A, 3 pour B
    expect(of(itemB, farine)).toBeCloseTo(3, 3);
    expect(usage.some(r => r.plan_item_id === null)).toBe(false);
  });

  it('coût réel : chaque article porte ce qu\'il a sorti (le beurre entièrement dans A)', async () => {
    const { productionCoutRepository } = await import('../../repositories/production-cout.repository.js');
    const { planItemCosts } = await import('../../services/plan-item-costs.js');
    await repos.productionRepository.start(planId, fx.userId);
    await repos.productionRepository.produceItems(planId, [
      { planItemId: itemA, actualQuantity: 10 }, { planItemId: itemB, actualQuantity: 10 }], fx.userId, fx.storeId);
    const cost = await productionCoutRepository.computePlanCost(planId);
    const beurreLine = cost.detailMatieres.find(d => d.ingredient_id === beurre)!;
    expect(beurreLine.by_item?.[itemA]).toBeCloseTo(80, 2);   // 1 kg × 80 DH
    expect(beurreLine.by_item?.[itemB]).toBeUndefined();
    const farineLine = cost.detailMatieres.find(d => d.ingredient_id === farine)!;
    expect(farineLine.by_item?.[itemA]).toBeCloseTo(10, 2);   // 2 kg × 5 DH
    expect(farineLine.by_item?.[itemB]).toBeCloseTo(15, 2);   // 3 kg × 5 DH

    // Coût par article : la mesure, pas une clé de répartition.
    const ic = await planItemCosts(planId, {
      detailMatieres: cost.detailMatieres, emballages: 0, energie: 0, sousTraitance: 0,
      mo: { timedByItem: new Map(), stdByItem: new Map() }, machineByItem: new Map(),
      analytic: { lines: [], directLines: [] } as never,
    });
    expect(ic.items.find(i => i.plan_item_id === itemA)!.matieres).toBeCloseTo(90, 2);
    expect(ic.items.find(i => i.plan_item_id === itemB)!.matieres).toBeCloseTo(15, 2);
  });

  it('traçabilité aval du lot de beurre : l\'article B n\'est pas touché', async () => {
    const { traceabilityRepository } = await import('../../repositories/traceability.repository.js');
    const t = await traceabilityRepository.forward(beurreLot);
    expect(t).not.toBeNull();
    const ids = t!.items.map(i => i.id);
    expect(ids).toContain(itemA);
    expect(ids).not.toContain(itemB);
    expect(t!.items.find(i => i.id === itemA)!.certainty).toBe('certain');
    expect(t!.excludedItems.map(i => i.id)).toContain(itemB);
    expect(t!.productLots.some(l => l.plan_item_id === itemB)).toBe(false);
    expect(t!.productLots.some(l => l.plan_item_id === itemA)).toBe(true);
  });

  it('rappel du lot de beurre : seules les fournées de A', async () => {
    const { recallRepository } = await import('../../repositories/recall.repository.js');
    const r = await recallRepository.recallFromIngredientLot(beurreLot);
    const plan = r!.root.plans.find(x => x.productionPlanId === planId)!;
    expect(plan.batches.map(b => b.productId)).toEqual([prodA]);
  });
});
