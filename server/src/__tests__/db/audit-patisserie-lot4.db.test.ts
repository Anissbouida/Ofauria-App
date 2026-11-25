/**
 * Audit production pâtissière 2026-11 — lot 4 (préparations de base).
 *
 * C-10 : un lot de préparation fabriqué reçoit sa date limite (mig 673) ; un lot périmé
 *        n'est plus réservé.
 * C-06 : deux plans du même jour qui ont besoin de la même crème partagent un seul plan de
 *        crème ; retirer un des plans le ramène au besoin de l'autre ; produit, chaque plan
 *        parent reçoit sa part.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, setComposition, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Audit pâtisserie — lot 4 préparations de base', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let lait: string;
  let creme: string;
  let prod: string;
  const p = () => testPool();
  const day = new Date().toISOString().slice(0, 10);

  async function newPlan(qty: number) {
    const plan = await repos.productionRepository.create({
      planDate: day, type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: prod, plannedQuantity: qty }],
    });
    fx.ids.plans.push(plan.id);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    return plan.id as string;
  }
  const childOf = async (planId: string) => (await p().query(
    `SELECT d.dependency_plan_id AS id, d.quantity_to_produce, d.quantity_from_stock,
            (SELECT planned_quantity FROM production_plan_items WHERE plan_id = d.dependency_plan_id LIMIT 1) AS planned
       FROM production_plan_dependencies d WHERE d.parent_plan_id = $1 AND d.status <> 'cancelled'`, [planId])).rows[0];

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    lait = await createIngredient(fx, { name: 'Lait l4', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: lait, lotNumber: 'LL4', pesage: 200, expiresInDays: 20, unitCost: 10 });
    creme = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout, conservation_heures)
       VALUES ($1, true, NULL, 1, 'kg', 'ratio_poids', 48) RETURNING id`, [`Crème l4 ${RUN}`])).rows[0].id;
    fx.ids.recipes.push(creme);
    await setComposition(creme, { ingredients: [{ ingredientId: lait, quantity: 1, unit: 'kg' }] });
    prod = (await p().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 10, 'jour', 'unit') RETURNING id`,
      [`Chou l4 ${RUN}`, `chou-l4-${RUN}`])).rows[0].id;
    fx.ids.products.push(prod);
    const rec = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout, compo_par_piece)
       VALUES ($1, false, $2, 1, 'unit', 'compose', true) RETURNING id`, [`Fiche chou l4 ${RUN}`, prod])).rows[0].id;
    fx.ids.recipes.push(rec);
    await p().query(`INSERT INTO recipe_components (recipe_id, source_recipe_id, quantite, unite, role) VALUES ($1, $2, 0.1, 'kg', 'base')`, [rec, creme]);
    // Un lot de crème périmé (2 kg) : il ne doit pas être réservé.
    await p().query(`INSERT INTO semi_finished_stock (recipe_id, store_id, quantity_available, unit) VALUES ($1, $2, 2, 'kg')`, [creme, fx.storeId]);
    await p().query(
      `INSERT INTO semi_finished_lots (recipe_id, store_id, lot_number, quantity_produced, quantity_remaining, unit, produced_at, expires_at, status)
       VALUES ($1, $2, $3, 2, 2, 'kg', NOW() - interval '3 days', NOW() - interval '1 day', 'active')`, [creme, fx.storeId, `SF-OLD-${RUN}`]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM semi_finished_lot_usage WHERE semi_finished_lot_id IN (SELECT id FROM semi_finished_lots WHERE recipe_id = $1)`, [creme]).catch(() => undefined);
    await p().query(`DELETE FROM semi_finished_lots WHERE recipe_id = $1`, [creme]).catch(() => undefined);
    await p().query(`DELETE FROM semi_finished_transactions WHERE recipe_id = $1`, [creme]).catch(() => undefined);
    await p().query(`DELETE FROM semi_finished_stock WHERE recipe_id = $1`, [creme]).catch(() => undefined);
    await p().query(`DELETE FROM production_plan_dependencies WHERE sub_recipe_id = $1`, [creme]).catch(() => undefined);
    await p().query(`DELETE FROM production_plans WHERE store_id = $1 AND is_semi_finished_plan = true`, [fx.storeId]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_components WHERE source_recipe_id = $1`, [creme]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  let plan1: string;
  let plan2: string;
  let child: string;

  it('C-10 : le lot périmé n\'est pas réservé ; C-06 : deux plans du jour partagent un plan de crème', async () => {
    plan1 = await newPlan(20);   // 2 kg de crème
    const c1 = await childOf(plan1);
    expect(num(c1.quantity_from_stock)).toBe(0);     // le lot périmé ne compte pas
    expect(num(c1.quantity_to_produce)).toBeCloseTo(2, 3);
    child = c1.id;
    expect(num(c1.planned)).toBe(2);

    plan2 = await newPlan(30);   // 3 kg de plus
    const c2 = await childOf(plan2);
    expect(c2.id).toBe(child);                       // même plan de crème
    expect(num((await childOf(plan1)).planned)).toBe(5);
    const nbChildren = (await p().query(
      `SELECT COUNT(*)::int n FROM production_plans WHERE store_id = $1 AND is_semi_finished_plan AND status <> 'cancelled'`, [fx.storeId])).rows[0].n;
    expect(nbChildren).toBe(1);
  });

  it('C-06 : retirer un des plans ramène le plan de crème au besoin de l\'autre', async () => {
    await p().query(`UPDATE production_plans SET status = 'confirmed' WHERE id = $1`, [plan2]);
    await repos.productionRepository.revertToDraft(plan2, fx.userId);
    const planned = (await p().query(`SELECT planned_quantity FROM production_plan_items WHERE plan_id = $1`, [child])).rows[0].planned_quantity;
    expect(num(planned)).toBe(2);
    const st = (await p().query(`SELECT status FROM production_plans WHERE id = $1`, [child])).rows[0].status;
    expect(st).toBe('draft');                        // toujours utile au plan 1
    // Le plan 2 revient : il rejoint le même plan de crème.
    await repos.productionRepository.confirm(plan2, fx.userId);
    expect((await childOf(plan2)).id).toBe(child);
    expect(num((await p().query(`SELECT planned_quantity FROM production_plan_items WHERE plan_id = $1`, [child])).rows[0].planned_quantity)).toBe(5);
  });

  it('C-06 + C-10 : produit, chaque plan reçoit sa part et le lot porte sa date limite', async () => {
    const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [child])).rows[0];
    await repos.productionRepository.confirm(child, fx.userId);
    await repos.productionRepository.start(child, fx.userId);
    await repos.productionRepository.produceItems(child, [{ planItemId: item.id, actualQuantity: 5 }], fx.userId, fx.storeId);
    const used = new Map((await p().query(
      `SELECT parent_plan_id, SUM(quantity)::float8 q FROM semi_finished_lot_usage u
         JOIN semi_finished_lots l ON l.id = u.semi_finished_lot_id
        WHERE l.production_plan_id = $1 GROUP BY 1`, [child])).rows.map(r => [r.parent_plan_id, Number(r.q)]));
    expect(used.get(plan1)).toBeCloseTo(2, 3);
    expect(used.get(plan2)).toBeCloseTo(3, 3);
    const lot = (await p().query(
      `SELECT EXTRACT(EPOCH FROM (expires_at - produced_at)) / 3600 AS h FROM semi_finished_lots WHERE production_plan_id = $1`, [child])).rows[0];
    expect(Math.round(Number(lot.h))).toBe(48);
    const deps = (await p().query(
      `SELECT status FROM production_plan_dependencies WHERE dependency_plan_id = $1 AND status <> 'cancelled'`, [child])).rows;
    expect(deps.every(d => d.status === 'fulfilled')).toBe(true);
  });
});
