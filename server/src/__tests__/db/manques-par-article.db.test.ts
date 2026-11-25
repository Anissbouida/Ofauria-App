/**
 * Mig 664 — une matière manquante au bon de sortie ne bloque plus tout le plan.
 *
 * Plan : A (beurre + farine), B (farine seule). Le beurre est en rupture.
 *  - le magasinier remet le bon « avec manquants », le chef l'accepte ;
 *  - A passe en liste d'attente avec son manque de beurre, B démarre et se produit ;
 *  - restaurer A sans stock : refusé, A reste en attente ;
 *  - le beurre arrive : restaurer A sort le beurre pour A (mouvement, lot, coût) ;
 *  - variante « produire sans » sur un second plan : le manque est levé sans sortie.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, setComposition, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Matières non livrées par article (mig 664)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let beurre: string;
  let farine: string;
  let prodA: string;
  let prodB: string;
  const p = () => testPool();

  async function product(tag: string, lines: { ingredientId: string; quantity: number }[]) {
    const id = (await p().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 10, 'jour', 'unit') RETURNING id`,
      [`Man ${tag} ${RUN}`, `man-${tag}-${RUN}`])).rows[0].id;
    fx.ids.products.push(id);
    const rec = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout, compo_par_piece)
       VALUES ($1, false, $2, 1, 'unit', 'compose', true) RETURNING id`, [`Fiche man ${tag} ${RUN}`, id])).rows[0].id;
    fx.ids.recipes.push(rec);
    await setComposition(rec, { ingredients: lines.map(l => ({ ...l, unit: 'kg' })) });
    return id;
  }

  /** Plan A + B confirmé, bon remis avec manquants et accepté. Retourne le plan et ses lignes. */
  async function planWithMissingButter() {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: prodA, plannedQuantity: 10 }, { productId: prodB, plannedQuantity: 10 }],
    });
    fx.ids.plans.push(plan.id);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
    await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
    const weighable = fresh.lines.filter((l: Record<string, unknown>) => l.status !== 'rupture' && num(l.allocated_quantity) > 0);
    await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, weighable.map((l: Record<string, unknown>) => (
      { ligneId: l.id as string, actualQuantity: num(l.allocated_quantity), source: 'manual' as const })));
    await repos.bonSortieRepository.markAsReady(bon.id, fx.userId, { withMissing: true });
    await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);
    const items = (await p().query(`SELECT id, product_id, waiting_status FROM production_plan_items WHERE plan_id = $1`, [plan.id])).rows;
    return { planId: plan.id as string, a: items.find(i => i.product_id === prodA), b: items.find(i => i.product_id === prodB) };
  }

  const stockOf = async (ing: string) =>
    num((await p().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [ing, fx.storeId])).rows[0]?.current_quantity);

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    beurre = await createIngredient(fx, { name: 'Beurre man', unit: 'kg', unitCost: 80 });
    farine = await createIngredient(fx, { name: 'Farine man', unit: 'kg', unitCost: 5 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'FMAN', pesage: 50, expiresInDays: 90, unitCost: 5 });
    // Aucun beurre en stock : rupture.
    prodA = await product('A', [{ ingredientId: beurre, quantity: 0.1 }, { ingredientId: farine, quantity: 0.2 }]);
    prodB = await product('B', [{ ingredientId: farine, quantity: 0.3 }]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('bon accepté avec le beurre manquant : A attend, B démarre et se produit', async () => {
    const { planId, a, b } = await planWithMissingButter();
    expect(a.waiting_status).toBe('waiting');
    expect(b.waiting_status).toBeNull();
    const sh = (await p().query(
      `SELECT plan_item_id, ingredient_id, missing_qty, status FROM production_item_shortages WHERE plan_id = $1`, [planId])).rows;
    expect(sh).toHaveLength(1);
    expect(sh[0].plan_item_id).toBe(a.id);
    expect(sh[0].ingredient_id).toBe(beurre);
    expect(num(sh[0].missing_qty)).toBeCloseTo(1, 3);

    await repos.productionRepository.start(planId, fx.userId);
    const res = await repos.productionRepository.produceItems(planId, [{ planItemId: b.id, actualQuantity: 10 }], fx.userId, fx.storeId);
    expect(res.autoCompleted).toBe(false);   // A reste à produire
    // Produire A tant qu'il attend : ignoré (la ligne n'est pas produite).
    await repos.productionRepository.produceItems(planId, [{ planItemId: a.id, actualQuantity: 10 }], fx.userId, fx.storeId).catch(() => undefined);
    const aRow = (await p().query(`SELECT status FROM production_plan_items WHERE id = $1`, [a.id])).rows[0];
    expect(aRow.status).toBe('pending');

    // Restaurer sans beurre en stock : refusé, A reste en attente.
    const r1 = await repos.productionRepository.restoreFromWaiting(planId, [a.id], { userId: fx.userId });
    expect(r1.warnings.join(' ')).toMatch(/Beurre man/);
    expect((await p().query(`SELECT waiting_status FROM production_plan_items WHERE id = $1`, [a.id])).rows[0].waiting_status).toBe('waiting');

    // Le beurre arrive : restaurer A sort le beurre pour A.
    await createLot(fx, { ingredientId: beurre, lotNumber: 'BMAN', pesage: 5, expiresInDays: 30, unitCost: 80 });
    const before = await stockOf(beurre);
    const r2 = await repos.productionRepository.restoreFromWaiting(planId, [a.id], { userId: fx.userId });
    expect(r2.warnings).toHaveLength(0);
    expect(await stockOf(beurre)).toBeCloseTo(before - 1, 3);
    const usage = (await p().query(
      `SELECT plan_item_id, SUM(quantity_used)::float8 AS q FROM production_lot_usage
        WHERE production_plan_id = $1 AND ingredient_id = $2 GROUP BY 1`, [planId, beurre])).rows;
    expect(usage).toEqual([{ plan_item_id: a.id, q: 1 }]);
    expect((await p().query(`SELECT status FROM production_item_shortages WHERE plan_item_id = $1`, [a.id])).rows[0].status).toBe('issued');

    // A se produit ensuite et termine le plan ; le beurre n'est pas sorti une seconde fois.
    const res2 = await repos.productionRepository.produceItems(planId, [{ planItemId: a.id, actualQuantity: 10 }], fx.userId, fx.storeId);
    expect(res2.autoCompleted).toBe(true);
    expect(await stockOf(beurre)).toBeCloseTo(before - 1, 3);
  });

  it('« produire sans » : le manque est levé sans sortie de matière', async () => {
    await p().query(`UPDATE ingredient_lots SET status = 'depleted' WHERE ingredient_id = $1`, [beurre]);
    await p().query(`UPDATE inventory SET current_quantity = 0 WHERE ingredient_id = $1`, [beurre]);
    const { planId, a } = await planWithMissingButter();
    expect(a.waiting_status).toBe('waiting');
    const r = await repos.productionRepository.restoreFromWaiting(planId, [a.id], { userId: fx.userId, waiveMissing: true });
    expect(r.warnings).toHaveLength(0);
    expect((await p().query(`SELECT waiting_status FROM production_plan_items WHERE id = $1`, [a.id])).rows[0].waiting_status).toBe('restored');
    expect((await p().query(`SELECT status FROM production_item_shortages WHERE plan_item_id = $1`, [a.id])).rows[0].status).toBe('waived');
    const out = (await p().query(
      `SELECT COUNT(*)::int n FROM inventory_transactions WHERE production_plan_id = $1 AND ingredient_id = $2`, [planId, beurre])).rows[0].n;
    expect(out).toBe(0);
  });

  it('annuler un article en attente ferme son manque', async () => {
    const { planId, a } = await planWithMissingButter();
    await repos.productionRepository.cancelItems(planId, [a.id], 'test');
    expect((await p().query(`SELECT status FROM production_item_shortages WHERE plan_item_id = $1`, [a.id])).rows[0].status).toBe('cancelled');
  });
});
