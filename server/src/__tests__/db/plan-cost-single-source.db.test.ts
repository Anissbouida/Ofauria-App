/**
 * G0-23 — coût de revient d'un plan : une seule définition.
 *  - le coût du tableau de bord égale celui de la fiche, pour dix plans ;
 *  - il comprend les emballages et l'énergie (le tableau de bord oubliait l'énergie,
 *    personne ne comptait les emballages) ;
 *  - mode « charges mensuelles » : les charges saisies sont réparties au prorata des
 *    matières des plans du mois, et leur somme égale le montant saisi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

const num = (v: unknown) => parseFloat(String(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

describe.skipIf(!hasTestDb)('Coût de revient d\'un plan, source unique (G0-23)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let cout: typeof import('../../repositories/production-cout.repository.js')['productionCoutRepository'];
  let fx: Fixtures;
  let ingredientId: string, packagingId: string, equipementId: string;
  let previous: Record<string, unknown>;
  const planIds: string[] = [];
  const p = () => testPool();

  const settings = (method: 'rate' | 'monthly', loyer = 0) => p().query(
    `UPDATE company_settings SET production_charges_method = $1, production_charges_fixes_pct = 0.40,
            production_charge_loyer = $2, production_charge_energie = 0, production_charge_autres = 0 WHERE id = 1`, [method, loyer]);
  /** Plan terminé du 2027-09 avec `kg` de matière à 10 DH, `boites` emballages à 0,50 DH, `minutes` de four à 30 DH/h. */
  const plan = async (day: number, kg: number, boites: number, minutes: number) => {
    const id = (await p().query(
      `INSERT INTO production_plans (plan_date, type, status, created_by, store_id) VALUES ($1, 'daily', 'completed', $2, $3) RETURNING id`,
      [`2027-09-${String(day).padStart(2, '0')}`, fx.userId, fx.storeId])).rows[0].id as string;
    planIds.push(id); fx.ids.plans.push(id);
    await p().query(
      `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, production_plan_id, store_id) VALUES ($1, 'production', $2, $3, $4)`,
      [ingredientId, -kg, id, fx.storeId]);
    if (boites > 0) await p().query(
      `INSERT INTO packaging_stock_transactions (packaging_id, store_id, type, quantity_change, stock_after, reference_id, reference_type, unit_cost)
       VALUES ($1, $2, 'consumption', $3, 0, $4, 'production_plan', 0.5)`, [packagingId, fx.storeId, -boites, id]);
    if (minutes > 0) await p().query(
      `INSERT INTO production_equipement_usage (plan_id, equipement_id, debut, duree_minutes, cout_horaire_snapshot) VALUES ($1, $2, now(), $3, 30)`,
      [id, equipementId, minutes]);
    return id;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    ({ productionCoutRepository: cout } = await import('../../repositories/production-cout.repository.js'));
    fx = await createBaseFixtures();
    previous = (await p().query(
      `SELECT production_charges_method, production_charges_fixes_pct, production_charge_loyer, production_charge_energie, production_charge_autres
         FROM company_settings WHERE id = 1`)).rows[0];
    ingredientId = await createIngredient(fx, { name: 'Farine G023', unit: 'kg', unitCost: 10 });
    packagingId = (await p().query(
      `INSERT INTO packaging_items (name, unit, unit_cost, category) VALUES ($1, 'piece', 0.5, 'autre') RETURNING id`, [`Boîte G023 ${RUN}`])).rows[0].id;
    equipementId = (await p().query(
      `INSERT INTO production_equipements (nom, type, cout_horaire) VALUES ($1, 'four', 30) RETURNING id`, [`Four G023 ${RUN}`])).rows[0].id;
    await settings('rate');
    for (let i = 1; i <= 10; i++) await plan(i, i * 2, i % 2 === 0 ? i * 10 : 0, i % 3 === 0 ? 60 : 0);
    for (const id of planIds) await cout.calculateAndSave(id, fx.userId);
  }, 120_000);

  afterAll(async () => {
    if (previous) await p().query(
      `UPDATE company_settings SET production_charges_method = $1, production_charges_fixes_pct = $2, production_charge_loyer = $3,
              production_charge_energie = $4, production_charge_autres = $5 WHERE id = 1`,
      [previous.production_charges_method, previous.production_charges_fixes_pct, previous.production_charge_loyer,
       previous.production_charge_energie, previous.production_charge_autres]).catch(() => undefined);
    await p().query(`DELETE FROM production_cout_reel WHERE plan_id = ANY($1)`, [planIds]).catch(() => undefined);
    await p().query(`DELETE FROM production_equipement_usage WHERE plan_id = ANY($1)`, [planIds]).catch(() => undefined);
    await p().query(`DELETE FROM packaging_stock_transactions WHERE packaging_id = $1`, [packagingId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM packaging_items WHERE id = $1`, [packagingId]).catch(() => undefined);
    await p().query(`DELETE FROM production_equipements WHERE id = $1`, [equipementId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('plan n° 6 : matières 120, emballages 30, énergie 30, charges 48 (40 % des matières), revient 228', async () => {
    const c = await cout.computePlanCost(planIds[5]);
    expect({ m: r2(c.coutMatieres), e: c.coutEmballages, en: c.coutEnergie, ch: c.coutCharges, t: r2(c.coutTotal) })
      .toEqual({ m: 120, e: 30, en: 30, ch: 48, t: 228 });
    expect(c.detailEmballages[0]).toMatchObject({ qty: 60, unit_cost: 0.5, total: 30 });
    expect(num((await cout.findByPlan(planIds[5])).cout_total)).toBe(228);
  });

  it('dix plans : le coût du tableau de bord égale celui de la fiche, énergie et emballages compris', async () => {
    const dash = await cout.getPlansWithCost(fx.storeId, '2027-09-01', '2027-09-30');
    expect(dash).toHaveLength(10);
    let sum = 0;
    for (const row of dash) {
      const fiche = await cout.findByPlan(row.plan_id);
      expect(num(row.plan_cout_revient)).toBe(num(fiche.cout_total));
      expect(num(row.plan_cout_revient)).toBe(r2(num(row.plan_cout_matieres) + num(row.plan_cout_emballages) + num(row.plan_cout_mo)
        + num(row.plan_cout_energie) + num(row.plan_cout_charges)));
      sum = r2(sum + num(fiche.cout_total));
    }
    const stats = await cout.getStats(fx.storeId, '2027-09-01', '2027-09-30');
    expect(num(stats.total_cout)).toBe(sum);
    expect(num(stats.total_energie)).toBe(90);           // plans 3, 6, 9 : une heure de four à 30 DH
    expect(num(stats.total_emballages)).toBe(150);       // 20 + 40 + 60 + 80 + 100 boîtes à 0,50 DH
    const days = await cout.getByDay(fx.storeId, '2027-09-01', '2027-09-30');
    expect(r2(days.reduce((s: number, d: { total: string }) => s + num(d.total), 0))).toBe(sum);
  });

  it('charges mensuelles : 11 000 DH répartis au prorata des matières, la somme des parts égale le montant saisi', async () => {
    await settings('monthly', 11000);
    for (const id of planIds) await cout.calculateAndSave(id, fx.userId);
    const rows = (await p().query(
      `SELECT plan_id, cout_matieres::float8 AS m, cout_charges_fixes::float8 AS c FROM production_cout_reel WHERE plan_id = ANY($1)`, [planIds])).rows;
    // Matières du mois : 20 + 40 + … + 200 = 1 100 DH ; chaque plan porte 10 DH de charges par DH de matière.
    for (const r of rows) expect(r.c).toBe(r2(r.m * 10));
    expect(r2(rows.reduce((s, r) => s + r.c, 0))).toBe(11000);
    const fiche = await cout.findByPlan(planIds[5]);
    expect(num(fiche.cout_total)).toBe(120 + 30 + 30 + 1200);
    expect(fiche.detail_charges_fixes[0]).toMatchObject({ base: 11000, part: 1200 });
  }, 60_000);
});
