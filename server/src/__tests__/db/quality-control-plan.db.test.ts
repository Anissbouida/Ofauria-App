/**
 * M7-02 — plan de contrôle par article (mig 573).
 *  - article avec contrôle final « chaque lot » (poids 60-70 g) : la déclaration de production
 *    crée une inspection à faire sur le lot produit, avec ses points ;
 *  - un article sans plan de contrôle n'en crée aucune ;
 *  - la réalisation hors bornes donne « non conforme » et propose une non-conformité ;
 *  - fréquence « 1 lot sur 2 » : contrôle au 1er et au 3e passage, pas au 2e.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Plan de contrôle (M7-02)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let cp: typeof import('../../repositories/quality-control-plan.repository.js')['qualityControlPlanRepository'];
  let q: typeof import('../../repositories/quality.repository.js')['qualityRepository'];
  let fx: Fixtures; let controlled: string; let free: string; const lineIds: string[] = [];
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);
  const produce = async (productId: string) => {
    const pl = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 10 }] });
    fx.ids.plans.push(pl.id);
    const itemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [pl.id])).rows[0].id as string;
    await repos.productionRepository.confirm(pl.id, fx.userId);
    await repos.productionRepository.start(pl.id, fx.userId);
    await repos.productionRepository.produceItems(pl.id, [{ planItemId: itemId, actualQuantity: 10 }], fx.userId, fx.storeId);
    return pl.id as string;
  };
  const pendingOf = async (planId: string) => (await p().query(
    `SELECT id, pending_items, product_lot_id FROM quality_inspections WHERE plan_id = $1 AND status = 'a_faire' AND control_stage = 'final'`, [planId])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    cp = (await import('../../repositories/quality-control-plan.repository.js')).qualityControlPlanRepository;
    q = (await import('../../repositories/quality.repository.js')).qualityRepository;
    fx = await createBaseFixtures();
    controlled = (await createProductWithRecipe(fx, { name: `Croissant M702 ${RUN}`, price: 2, ingredients: [] })).productId;
    free = (await createProductWithRecipe(fx, { name: `Pain M702 ${RUN}`, price: 2, ingredients: [] })).productId;
    lineIds.push((await cp.create({ productId: controlled, stage: 'final', characteristic: 'Poids unitaire', charType: 'mesure', minValue: 60, maxValue: 70, unit: 'g', frequency: 'chaque_lot' }, fx.userId)).id);
  }, 60_000);

  afterAll(async () => {
    for (const id of lineIds) await cp.deactivate(id).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('contrôle final « chaque lot » : inspection à faire sur le lot ; rien sans plan', async () => {
    const planId = await produce(controlled);
    const pend = await pendingOf(planId);
    expect(pend).toHaveLength(1);
    expect(pend[0].product_lot_id).toBeTruthy();
    expect(pend[0].pending_items).toMatchObject([{ label: 'Poids unitaire', kind: 'measure', min: 60, max: 70, unit: 'g' }]);
    expect(await pendingOf(await produce(free))).toHaveLength(0);

    // Réalisation hors bornes → non conforme + non-conformité proposée.
    const done = await q.createInspection({ title: 'x', userId: fx.userId, pendingId: pend[0].id,
      results: [{ label: 'Poids unitaire', kind: 'measure', ok: false, value: 55 }] });
    expect(done).toMatchObject({ status: 'faite', conformity: false });
    const nc = (await p().query(`SELECT status, source FROM quality_nonconformities WHERE reference_note = $1`, [`inspection:${pend[0].id}`])).rows;
    expect(nc).toEqual([{ status: 'open', source: 'inspection' }]);
  });

  it('fréquence « 1 lot sur 2 »', async () => {
    await cp.deactivate(lineIds[0]);
    lineIds.push((await cp.create({ productId: controlled, stage: 'final', characteristic: 'Aspect', charType: 'visuel', frequency: 'un_sur_n', frequencyN: 2 }, fx.userId)).id);
    const counts = [];
    for (let i = 0; i < 3; i++) counts.push((await pendingOf(await produce(controlled))).length);
    expect(counts).toEqual([1, 0, 1]);
  });
});
