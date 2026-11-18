/**
 * M7-01 — inspections rattachées (mig 572).
 *  - une inspection rattachée à un ordre et à un lot de produit se retrouve par l'un et l'autre ;
 *  - une inspection d'un autre ordre n'apparaît pas ; l'historique sans rattachement reste lisible ;
 *  - une inspection « à faire » ne se réalise qu'une fois.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Inspections rattachées (M7-01)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let q: typeof import('../../repositories/quality.repository.js')['qualityRepository'];
  let fx: Fixtures; let planA: string; let planB: string; let lotId: string; const ids: string[] = [];
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);
  const ok = [{ label: 'Aspect', kind: 'ok' as const, ok: true }];

  beforeAll(async () => {
    repos = await importRepositories();
    q = (await import('../../repositories/quality.repository.js')).qualityRepository;
    fx = await createBaseFixtures();
    const productId = (await createProductWithRecipe(fx, { name: 'Brioche M701', price: 4, ingredients: [] })).productId;
    for (const k of ['A', 'B']) {
      const pl = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 5 }] });
      fx.ids.plans.push(pl.id);
      if (k === 'A') planA = pl.id; else planB = pl.id;
    }
    lotId = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, produced_at, production_plan_id) VALUES ($1, $2, $3, 5, now(), $4) RETURNING id`,
      [productId, fx.storeId, `L-M701-${RUN}`, planA])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    if (ids.length) await p().query(`UPDATE quality_inspections SET plan_id = NULL, product_lot_id = NULL WHERE id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('rattachement à l\'ordre et au lot, filtres', async () => {
    const a = await q.createInspection({ title: `Contrôle final M701 ${RUN}`, results: ok, storeId: fx.storeId, userId: fx.userId, planId: planA, productLotId: lotId });
    const b = await q.createInspection({ title: `Autre ordre M701 ${RUN}`, results: ok, storeId: fx.storeId, userId: fx.userId, planId: planB });
    ids.push(a.id, b.id);
    expect(a).toMatchObject({ plan_id: planA, product_lot_id: lotId, status: 'faite', conformity: true });
    expect((await q.listInspections({ limit: 50, planId: planA })).map((r: { id: string }) => r.id)).toEqual([a.id]);
    expect((await q.listInspections({ limit: 50, productLotId: lotId })).map((r: { id: string }) => r.id)).toEqual([a.id]);
  });

  it('inspection à faire : réalisée une seule fois', async () => {
    const pending = (await p().query(
      `INSERT INTO quality_inspections (template_name, title, results, conformity, store_id, status, plan_id) VALUES ('Plan de contrôle', $1, '[]', false, $2, 'a_faire', $3) RETURNING id`,
      [`À faire M701 ${RUN}`, fx.storeId, planA])).rows[0].id;
    ids.push(pending);
    const done = await q.createInspection({ title: 'x', results: ok, userId: fx.userId, pendingId: pending });
    expect(done).toMatchObject({ id: pending, status: 'faite', conformity: true });
    await expect(q.createInspection({ title: 'x', results: ok, userId: fx.userId, pendingId: pending })).rejects.toThrow(/déjà réalisée/);
  });
});
