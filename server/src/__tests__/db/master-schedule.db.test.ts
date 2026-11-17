/**
 * G5-05 — plan directeur enregistré (mig 553).
 * Un produit neuf (sans historique, donc sans prévision) reçoit 70 pour la semaine :
 *  - la grille montre la saisie ;
 *  - le calcul des besoins phasé lit 10 par jour sur la semaine au lieu de la prévision ;
 *  - effacer la saisie rend la prévision (rien à produire).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Plan directeur enregistré (G5-05)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let mps: typeof import('../../repositories/master-schedule.repository.js');
  let mrp: typeof import('../../services/mrp-phased.js');
  let fx: Fixtures; let productId: string; let monday: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    mps = await import('../../repositories/master-schedule.repository.js');
    mrp = await import('../../services/mrp-phased.js');
    fx = await createBaseFixtures();
    const flour = await createIngredient(fx, { name: 'Farine G505', unit: 'kg', unitCost: 8 });
    productId = (await createProductWithRecipe(fx, { name: 'Pain G505', price: 3, ingredients: [{ ingredientId: flour, quantity: 0.3, unit: 'kg' }] })).productId;
    monday = mps.mondayOf(new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' }));
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM master_schedule_entries WHERE product_id = $1`, [productId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('saisie de la semaine, visible dans la grille', async () => {
    await mps.masterScheduleRepository.save(fx.storeId, [{ productId, weekStart: monday, quantity: 70 }], fx.userId);
    const g = await mps.masterScheduleRepository.grid(fx.storeId, monday, 2);
    expect(g.weeks[0]).toBe(monday);
    expect(g.rows.find(r => r.product_id === productId)!.weeks[monday]).toMatchObject({ forecast: 0, planned: 70 });
  });

  it('le calcul phasé lit le plan directeur à la place de la prévision', async () => {
    const inp = await mrp.loadMrpInput(fx.storeId, monday, 7);
    const d = inp.demand[`p:${productId}`];
    expect(Object.keys(d)).toHaveLength(7);
    expect(Object.values(d).reduce((t, q) => t + q, 0)).toBeCloseTo(70, 6);
    expect(d[monday]).toBeCloseTo(10, 6);
    // Explosion : 70 pains × 0,3 kg de farine.
    const r = mrp.planPhased(inp);
    expect(r.proposals.filter(x => x.kind === 'ingredient').reduce((t, x) => t + x.qty, 0)).toBeCloseTo(21, 3);
  });

  it('effacer la saisie rend la prévision', async () => {
    await mps.masterScheduleRepository.save(fx.storeId, [{ productId, weekStart: monday, quantity: null }], fx.userId);
    const inp = await mrp.loadMrpInput(fx.storeId, monday, 7);
    expect(inp.demand[`p:${productId}`]).toBeUndefined();
  });
});
