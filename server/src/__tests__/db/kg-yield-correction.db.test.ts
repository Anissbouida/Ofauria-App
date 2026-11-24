/**
 * Régularisation des sorties des plans semi-finis au kilo (2026-11-24, voir
 * services/kg-yield-correction.ts) : avant le correctif, 16 kg d'une base qui rend 8 kg
 * (nb_par_defaut resté à 10) sortaient 16 kg de farine au lieu de 20.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Régularisation des plans semi-finis au kilo', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let svc: typeof import('../../services/kg-yield-correction.js');
  let fx: Fixtures;
  let farine: string, planId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    svc = await import('../../services/kg-yield-correction.js');
    const { recipeComponentRepository } = await import('../../repositories/recipe-component.repository.js');
    fx = await createBaseFixtures();
    farine = await createIngredient(fx, { name: 'Farine régul kg', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: farine, lotNumber: `RK-${RUN}`, pesage: 50, expiresInDays: 30 });

    const base = (await p().query(
      `INSERT INTO recipes (name, is_base, yield_quantity, yield_unit, mode_cout)
       VALUES ($1, true, 1, 'kg', 'compose') RETURNING id`, [`Base régul kg ${RUN}`])).rows[0].id as string;
    fx.ids.recipes.push(base);
    const fmt = (await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_active, is_default)
       VALUES ($1, 1, 10, true, true) RETURNING id`, [base])).rows[0].id as string;
    await recipeComponentRepository.replaceForFormat(base, fmt, {
      components: [{ sourceIngredientId: farine, quantite: 10, unite: 'kg', ordre: 0 }],
      rendementUnite: 'kg', rendementKg: 8,
    } as never);

    planId = (await p().query(
      `INSERT INTO production_plans (plan_date, type, status, created_by, store_id, is_semi_finished_plan)
       VALUES (CURRENT_DATE, 'daily', 'completed', $1, $2, true) RETURNING id`, [fx.userId, fx.storeId])).rows[0].id;
    fx.ids.plans.push(planId);
    await p().query(
      `INSERT INTO production_plan_items (plan_id, base_recipe_id, planned_quantity, actual_quantity, status)
       VALUES ($1, $2, 16, 16, 'produced')`, [planId, base]);
    // Sortie enregistrée avant le correctif : 16 kg / 10 = 1,6 fournée × 10 kg = 16 kg.
    await p().query(
      `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, production_plan_id, store_id)
       VALUES ($1, 'production', -16, 'Production base', $2, $3)`, [farine, planId, fx.storeId]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const mine = (plans: Awaited<ReturnType<typeof svc.planKgYieldCorrections>>) => plans.filter(x => x.planId === planId);

  it('la simulation calcule le complément sans rien écrire', async () => {
    const client = await repos.db.getClient();
    try {
      const plans = mine(await svc.planKgYieldCorrections(client));
      expect(plans).toHaveLength(1);
      expect(plans[0].divisorOld).toBe(10);
      expect(plans[0].divisorNew).toBe(8);
      const l = plans[0].lines.find(x => x.ingredientId === farine)!;
      expect(l.recorded).toBeCloseTo(16, 3);
      expect(l.expected).toBeCloseTo(20, 3);
      expect(l.delta).toBeCloseTo(4, 3);
    } finally { client.release(); }
    const n = (await p().query(`SELECT count(*)::int AS n FROM inventory_transactions WHERE production_plan_id = $1`, [planId])).rows[0].n;
    expect(n).toBe(1);
  });

  it('l\'application sort le complément (mouvement, lot) et ne se rejoue pas', async () => {
    const client = await repos.db.getClient();
    try {
      const plans = mine(await svc.planKgYieldCorrections(client));
      const shortages = await svc.applyKgYieldCorrections(client, plans, fx.userId);
      expect(shortages).toEqual([]);
      expect(mine(await svc.planKgYieldCorrections(client))).toEqual([]);
    } finally { client.release(); }

    const tx = (await p().query(
      `SELECT -SUM(quantity_change)::numeric AS q FROM inventory_transactions
        WHERE production_plan_id = $1 AND ingredient_id = $2 AND type = 'production'`, [planId, farine])).rows[0];
    expect(Number(tx.q)).toBeCloseTo(20, 3);
    const lot = (await p().query(`SELECT quantity_remaining FROM ingredient_lots WHERE ingredient_id = $1`, [farine])).rows[0];
    expect(Number(lot.quantity_remaining)).toBeCloseTo(46, 3);
  });
});
