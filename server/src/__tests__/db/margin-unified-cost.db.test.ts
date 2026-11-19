/**
 * G0-23 — les rapports de marge lisent le coût unifié du plan (computePlanCost → cout_total)
 * et sa répartition entre articles (allocate, clé de la politique), mig 598.
 *
 * Plan terminé le 2027-10-15, clé « poids » :
 *   A : 10 pièces de 0,1 kg = 1 kg   |   B : 5 pièces de 0,4 kg = 2 kg   → parts 1/3 et 2/3
 *   matières 10 kg × 10 DH = 100 ; four 60 min × 30 DH/h = 30 ; charges 40 % × 100 = 40
 *   cout_total = 100 + 30 + 40 = 170
 * Coût unifié par pièce :  A = 170 × 1/3 / 10 = 5,6667   B = 170 × 2/3 / 5 = 22,6667
 * Matière par pièce (rapports « coût matière ») : A = 100 × 1/3 / 10 = 3,3333 ; B = 100 × 2/3 / 5 = 13,3333
 *   (avant : prorata des quantités 10/15 et 5/15 → A = B = 6,6667, la pièce de 0,4 kg
 *    coûtait autant que celle de 0,1 kg).
 * Ventes du jour : 4 A à 5 DH (20) et 2 B à 20 DH (40).
 *   coût matière vendu = 4 × 3,3333 + 2 × 13,3333 = 13,33 + 26,67 = 40,00
 *   coût total du rapport = matière 40 + énergie 30 + charges 40 = 110 (pertes jamais ajoutées)
 * Parts manuelles 25 % / 75 % : lot A = 170 × 0,25 / 10 = 4,25.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

const num = (v: unknown) => parseFloat(String(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

describe.skipIf(!hasTestDb)('Rapports de marge sur le coût unifié (G0-23)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let cout: typeof import('../../repositories/production-cout.repository.js')['productionCoutRepository'];
  let reports: typeof import('../../controllers/reports.controller.js')['reportsController'];
  let setPolicy: typeof import('../../services/policies.js')['setPolicy'];
  let fx: Fixtures;
  let planId: string, itemA: string, itemB: string, productA: string, productB: string, lotA: string, equipementId: string;
  let previous: Record<string, unknown>;
  const p = () => testPool();
  const call = async (fn: (req: never, res: never) => Promise<void>, query: Record<string, string>) => {
    let out: { data: Record<string, any> } | undefined;
    await fn({ query, user: { storeId: fx.storeId } } as never, { json: (d: typeof out) => { out = d; }, status() { return this; } } as never);
    return out!.data;
  };
  const period = { startDate: '2027-10-15', endDate: '2027-10-15' };

  beforeAll(async () => {
    repos = await importRepositories();
    cout = (await import('../../repositories/production-cout.repository.js')).productionCoutRepository;
    reports = (await import('../../controllers/reports.controller.js')).reportsController;
    setPolicy = (await import('../../services/policies.js')).setPolicy;
    fx = await createBaseFixtures();
    previous = (await p().query(`SELECT production_charges_method, production_charges_fixes_pct FROM company_settings WHERE id = 1`)).rows[0];
    await p().query(`UPDATE company_settings SET production_charges_method = 'rate', production_charges_fixes_pct = 0.40 WHERE id = 1`);
    await setPolicy('production.cost_allocation_key', 'store', fx.storeId, { key: 'poids' }, fx.userId);

    const flour = await createIngredient(fx, { name: 'Farine G023M', unit: 'kg', unitCost: 10 });
    const a = await createProductWithRecipe(fx, { name: 'Apain G023M', price: 5, ingredients: [{ ingredientId: flour, quantity: 0.05, unit: 'kg' }] });
    const b = await createProductWithRecipe(fx, { name: 'Bgateau G023M', price: 20, ingredients: [{ ingredientId: flour, quantity: 0.2, unit: 'kg' }] });
    productA = a.productId; productB = b.productId;
    await p().query(`UPDATE recipes SET piece_weight_kg = 0.1 WHERE id = $1`, [a.recipeId]);
    await p().query(`UPDATE recipes SET piece_weight_kg = 0.4 WHERE id = $1`, [b.recipeId]);

    planId = (await p().query(
      `INSERT INTO production_plans (plan_date, type, status, created_by, store_id, completed_at)
       VALUES ('2027-10-15', 'daily', 'completed', $1, $2, '2027-10-15 12:00+00') RETURNING id`, [fx.userId, fx.storeId])).rows[0].id;
    fx.ids.plans.push(planId);
    const item = async (productId: string, q: number) => (await p().query(
      `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, actual_quantity, status)
       VALUES ($1, $2, $3, $3, 'produced') RETURNING id`, [planId, productId, q])).rows[0].id as string;
    itemA = await item(productA, 10);
    itemB = await item(productB, 5);
    await p().query(
      `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, production_plan_id, store_id) VALUES ($1, 'production', -10, $2, $3)`,
      [flour, planId, fx.storeId]);
    equipementId = (await p().query(
      `INSERT INTO production_equipements (nom, type, cout_horaire) VALUES ($1, 'four', 30) RETURNING id`, [`Four G023M ${RUN}`])).rows[0].id;
    await p().query(
      `INSERT INTO production_equipement_usage (plan_id, equipement_id, debut, duree_minutes, cout_horaire_snapshot) VALUES ($1, $2, now(), 60, 30)`,
      [planId, equipementId]);
    lotA = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, vitrine_qty, produced_at, expires_at, status, production_plan_id, plan_item_id)
       VALUES ($1, $2, $3, 10, 10, NOW(), CURRENT_DATE + 3, 'active', $4, $5) RETURNING id`,
      [productA, fx.storeId, `G023M-${RUN}`.slice(0, 40), planId, itemA])).rows[0].id;

    const saleId = (await p().query(
      `INSERT INTO sales (sale_number, user_id, store_id, subtotal, total, payment_method, created_at, paid_at)
       VALUES ($1, $2, $3, 60, 60, 'cash', '2027-10-15 12:30+00', '2027-10-15 12:30+00') RETURNING id`,
      [`G23${RUN}`.slice(0, 20), fx.userId, fx.storeId])).rows[0].id;
    await p().query(`INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 4, 5, 20), ($1, $3, 2, 20, 40)`,
      [saleId, productA, productB]);
  }, 120_000);

  afterAll(async () => {
    if (previous) await p().query(`UPDATE company_settings SET production_charges_method = $1, production_charges_fixes_pct = $2 WHERE id = 1`,
      [previous.production_charges_method, previous.production_charges_fixes_pct]).catch(() => undefined);
    await p().query(`DELETE FROM policy_values WHERE scope_type = 'store' AND scope_id = $1`, [fx?.storeId]).catch(() => undefined);
    await p().query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1)`, [fx?.storeId]).catch(() => undefined);
    await p().query(`DELETE FROM sales WHERE store_id = $1`, [fx?.storeId]).catch(() => undefined);
    await p().query(`DELETE FROM production_cout_reel WHERE plan_id = $1`, [planId]).catch(() => undefined);
    await p().query(`DELETE FROM production_equipement_usage WHERE plan_id = $1`, [planId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM production_equipements WHERE id = $1`, [equipementId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('plan non chiffré depuis la mig 598 : ancien prorata des quantités, à l\'identique', async () => {
    await cout.calculateAndSave(planId, fx.userId);
    await p().query(`UPDATE production_cout_reel SET detail_repartition = NULL WHERE plan_id = $1`, [planId]);
    const shares = (await p().query(`SELECT plan_item_id, share::float8 AS s, unified FROM v_plan_item_cost_share WHERE plan_id = $1`, [planId])).rows;
    expect(Object.fromEntries(shares.map(r => [r.plan_item_id, r4(r.s)]))).toEqual({ [itemA]: r4(10 / 15), [itemB]: r4(5 / 15) });
    expect(shares.every(r => r.unified === false)).toBe(true);
    const me = await call(reports.menuEngineering.bind(reports) as never, period);
    const a = me.items.find((i: { product_id: string }) => i.product_id === productA);
    expect(r4(num(a.unit_food_cost))).toBe(6.6667);              // 100 × 10/15 / 10
    // Lot : l'ancienne règle de la mig 452 (fn_plan_item_unit_cost) reste appliquée.
    const lot = (await p().query(`SELECT unit_cost::float8 AS u, fn_plan_item_unit_cost($2, $3)::float8 AS old FROM product_lots WHERE id = $1`, [lotA, itemA, productA])).rows[0];
    expect(lot.u).toBe(lot.old);
  });

  it('coût unifié : la répartition de la fiche du plan est enregistrée et lue par les rapports', async () => {
    const saved = await cout.calculateAndSave(planId, fx.userId);
    expect(num(saved.cout_total)).toBe(170);
    expect(saved.detail_repartition).toMatchObject({ key: 'poids', applied: 'poids' });
    const fiche = await cout.computePlanCost(planId);
    const byItem = Object.fromEntries(fiche.allocation.items.map(i => [i.plan_item_id, i.cost]));
    expect(byItem).toEqual({ [itemA]: 56.67, [itemB]: 113.33 });

    // Menu engineering : coût matière par pièce = part de l'article dans les matières du plan.
    const me = await call(reports.menuEngineering.bind(reports) as never, period);
    const row = (id: string) => me.items.find((i: { product_id: string }) => i.product_id === id);
    expect(r4(num(row(productA).unit_food_cost))).toBe(3.3333);
    expect(r4(num(row(productB).unit_food_cost))).toBe(13.3333);
    expect(row(productA).cost_from_production).toBe(true);

    // Synthèse des coûts : mêmes termes que cout_total, pertes non ajoutées.
    const cs = await call(reports.costSummary.bind(reports) as never, period);
    expect(r2(cs.foodCost)).toBe(40);                         // 13,33 + 26,67
    expect({ e: cs.energyCost, c: cs.chargesCost, em: cs.packagingCost, st: cs.subcontractingCost, l: cs.laborCost })
      .toEqual({ e: 30, c: 40, em: 0, st: 0, l: 0 });
    expect(r2(cs.totalCost)).toBe(110);
    expect(cs.netSales).toBe(60);

    // Coût par produit (production) : la somme des parts égale le coût du plan.
    const byProduct = await cout.getByProduct(fx.storeId, '2027-10-01', '2027-10-31');
    expect(Object.fromEntries(byProduct.map(r => [r.product_id, num(r.total_revient)]))).toEqual({ [productA]: 56.67, [productB]: 113.33 });

    // Coût du lot (marges de gestion, coût figé sur la vente) : le même que la fiche.
    const lot = (await p().query(`SELECT unit_cost::float8 AS u FROM product_lots WHERE id = $1`, [lotA])).rows[0];
    expect(lot.u).toBe(5.6667);                               // 170 × 1/3 / 10
  });

  it('parts manuelles saisies : la répartition enregistrée et le coût du lot suivent', async () => {
    await setPolicy('production.cost_allocation_key', 'store', fx.storeId, { key: 'manuelle' }, fx.userId);
    await cout.setCostShares(planId, [{ planItemId: itemA, pct: 25 }, { planItemId: itemB, pct: 75 }]);
    const row = (await p().query(`SELECT detail_repartition FROM production_cout_reel WHERE plan_id = $1`, [planId])).rows[0];
    expect(row.detail_repartition).toMatchObject({ applied: 'manuelle' });
    const lot = (await p().query(`SELECT unit_cost::float8 AS u FROM product_lots WHERE id = $1`, [lotA])).rows[0];
    expect(lot.u).toBe(4.25);                                 // 170 × 25 % / 10
  });
});
