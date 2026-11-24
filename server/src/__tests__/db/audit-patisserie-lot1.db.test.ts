/**
 * Audit production pâtissière 2026-11 — lot 1 (intégrité).
 *
 * C-01 : un plan clos par la déclaration du dernier article a son coût réel.
 * C-02 : le retour en brouillon rend les semi-finis réservés, annule le plan fils non lancé,
 *        et la confirmation suivante redimensionne le plan fils ; la suppression rend aussi.
 * C-03 : la clôture manuelle refuse une préparation de base non déclarée.
 * C-12 : une réception de transfert ne se rejoue pas.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, setComposition, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Audit pâtisserie — lot 1 intégrité', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let farine: string;
  let sel: string;
  let base: string;
  let prod: string;
  const planIds: string[] = [];
  const recipeIds: string[] = [];
  const productIds: string[] = [];
  const p = () => testPool();

  const sfStock = async () =>
    num((await p().query(`SELECT COALESCE(SUM(quantity_available),0) q FROM semi_finished_stock WHERE recipe_id = $1 AND store_id = $2`, [base, fx.storeId])).rows[0].q);
  const sfLots = async () =>
    num((await p().query(`SELECT COALESCE(SUM(quantity_remaining),0) q FROM semi_finished_lots WHERE recipe_id = $1 AND store_id = $2 AND status = 'active'`, [base, fx.storeId])).rows[0].q);
  const deps = async (planId: string) =>
    (await p().query(
      `SELECT d.status, d.quantity_from_stock, d.quantity_to_produce, d.dependency_plan_id, c.status AS child_status,
              (SELECT planned_quantity FROM production_plan_items WHERE plan_id = d.dependency_plan_id LIMIT 1) AS child_qty
         FROM production_plan_dependencies d LEFT JOIN production_plans c ON c.id = d.dependency_plan_id
        WHERE d.parent_plan_id = $1 ORDER BY d.created_at`, [planId])).rows;

  async function newPlan(qty: number): Promise<string> {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: prod, plannedQuantity: qty }],
    });
    planIds.push(plan.id);
    return plan.id;
  }

  /** Parcours du bon de sortie jusqu'à l'acceptation par le chef (matières livrées). */
  async function deliverBon(planId: string) {
    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    if (!bon) return;
    await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(planId))[0];
    await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, fresh.lines.map((l: Record<string, unknown>) => (
      { ligneId: l.id as string, actualQuantity: num(l.allocated_quantity), source: 'manual' as const })));
    await repos.bonSortieRepository.markAsReady(bon.id, fx.userId);
    await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);
  }

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    farine = await createIngredient(fx, { name: 'Farine a1', unit: 'kg', unitCost: 5 });
    sel = await createIngredient(fx, { name: 'Sel a1', unit: 'kg', unitCost: 2 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'FA1', pesage: 200, expiresInDays: 60, unitCost: 5 });
    await createLot(fx, { ingredientId: sel, lotNumber: 'SA1', pesage: 20, expiresInDays: 365, unitCost: 2 });

    base = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout)
       VALUES ($1, true, NULL, 1, 'kg', 'ratio_poids') RETURNING id`, [`Base a1 ${RUN}`])).rows[0].id;
    recipeIds.push(base);
    await setComposition(base, { ingredients: [{ ingredientId: farine, quantity: 1, unit: 'kg' }] });

    prod = (await p().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 10, 'jour', 'unit') RETURNING id`,
      [`Prod a1 ${RUN}`, `prod-a1-${RUN}`])).rows[0].id;
    productIds.push(prod);
    const rec = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout, compo_par_piece)
       VALUES ($1, false, $2, 1, 'unit', 'compose', true) RETURNING id`, [`Rec a1 ${RUN}`, prod])).rows[0].id;
    recipeIds.push(rec);
    // 0,5 kg de base + 10 g de sel par pièce.
    await p().query(`INSERT INTO recipe_components (recipe_id, source_recipe_id, quantite, unite, role) VALUES ($1, $2, 0.5, 'kg', 'base')`, [rec, base]);
    await p().query(`INSERT INTO recipe_components (recipe_id, source_ingredient_id, quantite, unite, role) VALUES ($1, $2, 0.01, 'kg', 'ingredient')`, [rec, sel]);

    // 2 kg de base en stock, avec leur lot.
    await p().query(`INSERT INTO semi_finished_stock (recipe_id, store_id, quantity_available, unit) VALUES ($1, $2, 2, 'kg')`, [base, fx.storeId]);
    await p().query(
      `INSERT INTO semi_finished_lots (recipe_id, store_id, lot_number, quantity_produced, quantity_remaining, unit, produced_at, status)
       VALUES ($1, $2, $3, 2, 2, 'kg', NOW(), 'active')`, [base, fx.storeId, `SF-A1-${RUN}`]);
  }, 60_000);

  afterAll(async () => {
    for (const rid of recipeIds) {
      await p().query(`DELETE FROM semi_finished_lot_usage WHERE semi_finished_lot_id IN (SELECT id FROM semi_finished_lots WHERE recipe_id = $1)`, [rid]).catch(() => undefined);
      await p().query(`DELETE FROM semi_finished_lots WHERE recipe_id = $1`, [rid]).catch(() => undefined);
      await p().query(`DELETE FROM semi_finished_transactions WHERE recipe_id = $1`, [rid]).catch(() => undefined);
      await p().query(`DELETE FROM semi_finished_stock WHERE recipe_id = $1`, [rid]).catch(() => undefined);
      await p().query(`DELETE FROM production_plan_dependencies WHERE sub_recipe_id = $1`, [rid]).catch(() => undefined);
      await p().query(`DELETE FROM recipe_components WHERE recipe_id = $1 OR source_recipe_id = $1`, [rid]).catch(() => undefined);
    }
    await p().query(`DELETE FROM production_cout_reel WHERE plan_id = ANY($1::uuid[])`, [planIds]).catch(() => undefined);
    await p().query(`DELETE FROM production_plans WHERE store_id = $1 AND is_semi_finished_plan = true`, [fx.storeId]).catch(() => undefined);
    fx.ids.plans.push(...planIds);
    fx.ids.recipes.push(...recipeIds);
    fx.ids.products.push(...productIds);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('C-02 : retour en brouillon → semi-finis rendus, plan fils annulé, puis redimensionné à la reconfirmation', async () => {
    const planId = await newPlan(10); // besoin 5 kg : 2 du stock, 3 à produire
    await repos.productionRepository.confirm(planId, fx.userId);

    let d = await deps(planId);
    expect(d).toHaveLength(1);
    expect(d[0].status).toBe('pending');
    expect(num(d[0].quantity_from_stock)).toBeCloseTo(2, 3);
    expect(num(d[0].quantity_to_produce)).toBeCloseTo(3, 3);
    expect(await sfStock()).toBeCloseTo(0, 3);
    const firstChild = d[0].dependency_plan_id as string;

    // Type d'ordre sans bon de sortie : le plan reste « confirmé », seul statut d'où
    // le retour en brouillon est proposé.
    await p().query(`UPDATE production_plans SET status = 'confirmed' WHERE id = $1`, [planId]);
    await repos.productionRepository.revertToDraft(planId, fx.userId);

    // La part prise sur le stock d'une dépendance EN ATTENTE est rendue (stock et lot).
    expect(await sfStock()).toBeCloseTo(2, 3);
    expect(await sfLots()).toBeCloseTo(2, 3);
    const child = await p().query(`SELECT status FROM production_plans WHERE id = $1`, [firstChild]);
    expect(child.rows[0].status).toBe('cancelled');

    // Le chef double la quantité, puis reconfirme : la détection est rejouée.
    await p().query(`UPDATE production_plan_items SET planned_quantity = 20 WHERE plan_id = $1`, [planId]);
    await repos.productionRepository.confirm(planId, fx.userId);

    d = await deps(planId);
    expect(d).toHaveLength(1);
    expect(num(d[0].quantity_from_stock)).toBeCloseTo(2, 3);
    expect(num(d[0].quantity_to_produce)).toBeCloseTo(8, 3); // 10 kg − 2 kg, et non plus 3
    expect(d[0].dependency_plan_id).not.toBe(firstChild);
    expect(num(d[0].child_qty)).toBeGreaterThanOrEqual(8);

    // La base n'est toujours pas développée en matières dans les besoins du parent.
    const needs = (await p().query(`SELECT ingredient_id FROM production_ingredient_needs WHERE plan_id = $1`, [planId])).rows.map(r => r.ingredient_id);
    expect(needs).toContain(sel);
    expect(needs).not.toContain(farine);
  });

  it('C-02 : la relance (plan avec bon de sortie) redimensionne aussi le plan fils', async () => {
    const planId = planIds[0]; // 20 pièces : 2 kg du stock, 8 kg à produire
    await p().query(`UPDATE production_plan_items SET planned_quantity = 6 WHERE plan_id = $1`, [planId]);
    await repos.productionRepository.relaunch(planId, fx.userId);
    const d = await deps(planId);
    expect(d).toHaveLength(1);
    expect(num(d[0].quantity_from_stock)).toBeCloseTo(2, 3);
    expect(num(d[0].quantity_to_produce)).toBeCloseTo(1, 3); // 3 kg − 2 kg
    const live = await p().query(
      `SELECT COUNT(*)::int n FROM production_plans WHERE store_id = $1 AND is_semi_finished_plan AND status <> 'cancelled'`, [fx.storeId]);
    expect(live.rows[0].n).toBe(1); // l'ancien plan fils (8 kg) est annulé
  });

  it('C-02 : supprimer le plan après retour en brouillon ne fait pas disparaître le stock de base', async () => {
    const planId = planIds[0];
    await p().query(`UPDATE production_plans SET status = 'confirmed' WHERE id = $1`, [planId]);
    await repos.productionRepository.revertToDraft(planId, fx.userId);
    expect(await sfStock()).toBeCloseTo(2, 3);
    await repos.productionRepository.remove(planId);
    expect(await sfStock()).toBeCloseTo(2, 3);
    expect(await sfLots()).toBeCloseTo(2, 3);
  });

  it('C-02 : supprimer un plan qui détient encore une réservation la rend', async () => {
    // État laissé par l'ancien code : brouillon avec une dépendance active et 2 kg réservés.
    const planId = await newPlan(10);
    await repos.productionRepository.confirm(planId, fx.userId);
    expect(await sfStock()).toBeCloseTo(0, 3);
    await p().query(`UPDATE production_plans SET status = 'draft' WHERE id = $1`, [planId]);
    await repos.productionRepository.remove(planId);
    expect(await sfStock()).toBeCloseTo(2, 3);
    expect(await sfLots()).toBeCloseTo(2, 3);
  });

  it('C-03 : la clôture manuelle refuse une préparation de base non déclarée', async () => {
    const planId = await newPlan(10);
    await repos.productionRepository.confirm(planId, fx.userId);
    const d = await deps(planId);
    const childId = d[0].dependency_plan_id as string;
    const item = (await p().query(`SELECT id, planned_quantity FROM production_plan_items WHERE plan_id = $1`, [childId])).rows[0];
    await repos.productionRepository.confirm(childId, fx.userId);
    await repos.productionRepository.start(childId, fx.userId);

    await expect(repos.productionRepository.complete(
      childId, [{ planItemId: item.id, actualQuantity: num(item.planned_quantity) }], fx.userId, fx.storeId,
    )).rejects.toThrow(/préparation de base/);

    // Rien n'a bougé : la ligne n'est pas « produite », le plan reste en cours.
    const after = (await p().query(`SELECT status FROM production_plan_items WHERE id = $1`, [item.id])).rows[0];
    expect(after.status).not.toBe('produced');

    // La déclaration, elle, entre la base en stock et lève la dépendance.
    await repos.productionRepository.produceItems(childId, [{ planItemId: item.id, actualQuantity: num(item.planned_quantity) }], fx.userId, fx.storeId);
    const dAfter = await deps(planId);
    expect(dAfter[0].status).toBe('fulfilled');
  });

  it('C-01 : le dernier article déclaré termine le plan ET calcule son coût réel', async () => {
    const { declareProduction } = await import('../../services/production-declaration.js');
    // Le plan parent du test précédent : sa base est produite, il reste à le déclarer.
    const planId = planIds[planIds.length - 1];
    const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0];
    await deliverBon(planId);
    await repos.productionRepository.start(planId, fx.userId);

    const res = await declareProduction(planId, { items: [{ planItemId: item.id, actualQuantity: 10 }] }, { userId: fx.userId, storeId: fx.storeId });
    expect(res.autoCompleted).toBe(true);

    const cost = await p().query(`SELECT 1 FROM production_cout_reel WHERE plan_id = $1`, [planId]);
    expect(cost.rows.length).toBeGreaterThan(0);
  });

  it('C-12 : une réception de transfert ne se rejoue pas', async () => {
    const planId = planIds[planIds.length - 1];
    const item = (await p().query(`SELECT id, product_id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0];
    const tr = (await p().query(
      `INSERT INTO production_transfers (plan_id, store_id, transferred_by) VALUES ($1, $2, $3) RETURNING id`,
      [planId, fx.storeId, fx.userId])).rows[0].id;
    const ti = (await p().query(
      `INSERT INTO production_transfer_items (transfer_id, plan_item_id, product_id, product_name, transferred_quantity)
       VALUES ($1, $2, $3, 'Prod a1', 10) RETURNING id`, [tr, item.id, item.product_id])).rows[0].id;

    const stock = async () =>
      num((await p().query(`SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [item.product_id, fx.storeId])).rows[0]?.stock_quantity);
    const before = await stock();

    await repos.productionRepository.confirmTransferReception(tr, [{ itemId: ti, qtyReceived: 8 }], fx.userId);
    expect(await stock()).toBeCloseTo(before - 2, 3);

    await expect(repos.productionRepository.confirmTransferReception(tr, [{ itemId: ti, qtyReceived: 8 }], fx.userId))
      .rejects.toThrow(/déjà été réceptionné/);
    expect(await stock()).toBeCloseTo(before - 2, 3);

    await p().query(`DELETE FROM production_transfers WHERE id = $1`, [tr]).catch(() => undefined);
  });
});
