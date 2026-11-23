/**
 * Mig 655 — moteur analytique du coût de revient (imputation rationnelle).
 *
 * Régression du constat de novembre 2026 : en « charges mensuelles », le seul plan chiffré
 * du mois recevait 100 % des charges (36 000 DH sur 1 376 pains). Ici :
 *  - un plan reçoit taux × ses unités d'œuvre, taux = charges ÷ capacité NORMALE ;
 *  - ses charges ne dépendent pas des autres plans chiffrés du mois ;
 *  - la sous-activité reste en écart de période, et imputé + écarts = charges (contrôle à 0) ;
 *  - les charges de structure sont dans le coût de revient, pas dans le coût de production.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTH = '2026-03';

describe.skipIf(!hasTestDb)('Moteur analytique du coût de revient (mig 655)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let cout: typeof import('../../repositories/production-cout.repository.js')['productionCoutRepository'];
  let engine: typeof import('../../services/cost-engine.js');
  let fx: Fixtures;
  let ingredientId: string, productId: string;
  let previousMethod: string;
  let prodCentre: { id: string; normal_capacity: number | null };
  const chargeIds: string[] = [];
  const planIds: string[] = [];
  const p = () => testPool();

  /** Plan terminé du mois avec `units` pièces et `kg` de matière à 10 DH. */
  const plan = async (day: number, units: number, kg: number) => {
    const id = (await p().query(
      `INSERT INTO production_plans (plan_date, type, status, created_by, store_id) VALUES ($1, 'daily', 'completed', $2, $3) RETURNING id`,
      [`${MONTH}-${String(day).padStart(2, '0')}`, fx.userId, fx.storeId])).rows[0].id as string;
    planIds.push(id); fx.ids.plans.push(id);
    await p().query(
      `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, actual_quantity, status) VALUES ($1, $2, $3, $3, 'produced')`,
      [id, productId, units]);
    await p().query(
      `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, production_plan_id, store_id) VALUES ($1, 'production', $2, $3, $4)`,
      [ingredientId, -kg, id, fx.storeId]);
    return id;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    ({ productionCoutRepository: cout } = await import('../../repositories/production-cout.repository.js'));
    engine = await import('../../services/cost-engine.js');
    fx = await createBaseFixtures();
    previousMethod = (await p().query(`SELECT production_charges_method AS m FROM company_settings WHERE id = 1`)).rows[0].m;
    await p().query(`UPDATE company_settings SET production_charges_method = 'analytic' WHERE id = 1`);
    ingredientId = await createIngredient(fx, { name: 'Farine ANA', unit: 'kg', unitCost: 10 });
    ({ productId } = await createProductWithRecipe(fx, { name: 'Pain ANA', price: 5, ingredients: [{ ingredientId, quantity: 0.1 }] }));
    prodCentre = (await p().query(`SELECT id, normal_capacity::float8 AS normal_capacity FROM cost_centers WHERE code = 'PROD'`)).rows[0];
    // Capacité normale : 1 000 unités par mois ; 10 000 DH de charges fixes de production propres à ce magasin.
    await p().query(`UPDATE cost_centers SET normal_capacity = 1000 WHERE id = $1`, [prodCentre.id]);
    const adm = (await p().query(`SELECT id FROM cost_centers WHERE code = 'ADM'`)).rows[0].id;
    chargeIds.push((await p().query(
      `INSERT INTO analytic_charges (label, nature, behavior, fixed_pct, assignment, cost_center_id, monthly_amount, store_id)
       VALUES ($1, 'loyer', 'fixed', 100, 'indirect', $2, 10000, $3) RETURNING id`, [`Loyer atelier ${RUN}`, prodCentre.id, fx.storeId])).rows[0].id);
    chargeIds.push((await p().query(
      `INSERT INTO analytic_charges (label, nature, behavior, fixed_pct, assignment, cost_center_id, monthly_amount, store_id)
       VALUES ($1, 'administratif', 'fixed', 100, 'indirect', $2, 2000, $3) RETURNING id`, [`Bureau ${RUN}`, adm, fx.storeId])).rows[0].id);
    // Activité du mois : 600 unités sur 1 000 de capacité normale → 40 % de sous-activité.
    await plan(5, 100, 2);
    await plan(12, 200, 4);
    await plan(20, 300, 6);
    engine.invalidateCostModel();
  }, 120_000);

  afterAll(async () => {
    if (prodCentre) await p().query(`UPDATE cost_centers SET normal_capacity = $2 WHERE id = $1`, [prodCentre.id, prodCentre.normal_capacity]).catch(() => undefined);
    if (previousMethod) await p().query(`UPDATE company_settings SET production_charges_method = $1 WHERE id = 1`, [previousMethod]).catch(() => undefined);
    await p().query(`DELETE FROM analytic_charges WHERE id = ANY($1)`, [chargeIds]).catch(() => undefined);
    await p().query(`DELETE FROM production_cout_reel WHERE plan_id = ANY($1)`, [planIds]).catch(() => undefined);
    await p().query(`DELETE FROM production_plan_items WHERE plan_id = ANY($1)`, [planIds]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('taux de production = charges du centre ÷ capacité normale (pas ÷ activité du mois)', async () => {
    const m = await engine.periodModel(fx.storeId, MONTH, { fresh: true });
    const prod = m.centres.find(c => c.code === 'PROD')!;
    expect(prod.normalCapacity).toBe(1000);
    expect(prod.capacitySource).toBe('configured');
    expect(prod.activity).toBe(600);
    expect(prod.lines.some(l => l.label.includes(`Loyer atelier ${RUN}`))).toBe(true);
    expect(r2(prod.rateFixed * 1000)).toBe(r2(prod.pool.budget.fixed));
    // 40 % des charges fixes de production restent en sous-activité.
    expect(r2(prod.activityVariance)).toBe(r2(prod.pool.budget.fixed * 0.4));
  });

  it('le plan de 100 unités reçoit 100 × le taux, et le même montant quel que soit le nombre de plans chiffrés', async () => {
    const m = await engine.periodModel(fx.storeId, MONTH);
    const prod = m.centres.find(c => c.code === 'PROD')!;
    const alone = await cout.computePlanCost(planIds[0]);
    const line = alone.analytic!.lines.find(l => l.code === 'PROD')!;
    expect(line.quantity).toBe(100);
    expect(line.total).toBe(r2((prod.rateFixed + prod.rateVariable) * 100));
    // Le bug : seul plan chiffré du mois, il recevait toutes les charges du mois. Ici 10 % (100 / 1 000).
    expect(line.total).toBeLessThan(r2(prod.pool.budget.fixed * 0.11));
    for (const id of planIds.slice(1)) await cout.calculateAndSave(id, fx.userId);
    const after = await cout.computePlanCost(planIds[0]);
    expect(after.coutCharges).toBe(alone.coutCharges);
  });

  it('niveaux de coût : structure dans le revient complet, pas dans le coût de production (valeur du stock)', async () => {
    await cout.calculateAndSave(planIds[0], fx.userId);
    const row = (await p().query(
      `SELECT cout_total::float8 AS total, cout_production::float8 AS prod, cout_charges_structure::float8 AS struct, cout_charges_fixes::float8 AS ch,
              cout_charges_appro::float8 AS appro, cout_charges_production::float8 AS cprod, cout_charges_directes::float8 AS dir, niveaux, methodes
         FROM production_cout_reel WHERE plan_id = $1`, [planIds[0]])).rows[0];
    expect(row.struct).toBeGreaterThan(0);
    expect(r2(row.total - row.prod)).toBe(row.struct);
    expect(r2(row.appro + row.cprod + row.struct + row.dir)).toBe(row.ch);
    expect(row.niveaux.cout_revient_complet).toBe(row.total);
    expect(row.niveaux.cout_production_complet).toBe(row.prod);
    expect(row.niveaux.ventes_ht).toBe(500);
    expect(row.niveaux.marge).toBe(r2(500 - row.total));
    expect(row.methodes.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(['rationnelle', 'complet_reel', 'abc', 'variable', 'direct']));
  });

  it('contrôle de période : imputé + sous-activité + écart sur budget = charges', async () => {
    const m = await engine.periodModel(fx.storeId, MONTH, { fresh: true });
    expect(m.totals.control).toBe(0);
    expect(m.totals.activityVariance).toBeGreaterThan(0);
    expect(r2(m.totals.imputed + m.totals.activityVariance + m.totals.budgetVariance)).toBe(m.totals.charges);
  });

  it('un montant réel saisi pour le mois crée un écart sur budget, le contrôle reste à 0', async () => {
    await p().query(`INSERT INTO analytic_charge_actuals (charge_id, period, amount) VALUES ($1, $2::date, 12000)`, [chargeIds[0], `${MONTH}-01`]);
    const m = await engine.periodModel(fx.storeId, MONTH, { fresh: true });
    expect(m.totals.control).toBe(0);
    const prod = m.centres.find(c => c.code === 'PROD')!;
    expect(r2(prod.budgetVariance)).toBe(2000);
    await p().query(`DELETE FROM analytic_charge_actuals WHERE charge_id = $1`, [chargeIds[0]]);
  });
});
