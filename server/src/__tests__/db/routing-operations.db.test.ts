/**
 * M5-01 — opérations de gamme complètes (mig 566).
 * Gamme rattachée à une fiche, fournée de 50 :
 *  - pétrissage : réglage 10 min, MO 0,2 min/unité, machine 0,4 min/unité pour 1 → MO 20, machine 30 ;
 *  - cuisson (ancienne forme, durée fixe 25 min) → MO 25, machine 0 : coût identique à avant ;
 *  - la gamme se retrouve par la fiche ; une seule gamme active par fiche.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Opérations de gamme (M5-01)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let rr: typeof import('../../repositories/routing.repository.js')['routingRepository'];
  let fx: Fixtures; let recipeId: string; let routingId: string; let wcId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    rr = (await import('../../repositories/routing.repository.js')).routingRepository;
    fx = await createBaseFixtures();
    recipeId = (await createProductWithRecipe(fx, { name: 'Pain M501', price: 3, ingredients: [] })).recipeId;
    wcId = (await rr.createWorkCenter({ name: `Pétrin M501 ${RUN}`, hourlyCost: 60, userId: fx.userId })).id;
    routingId = (await rr.createRouting({ name: `Gamme M501 ${RUN}`, recipeId, batchSize: 50, userId: fx.userId }))!.id;
    await rr.updateRouting(routingId, { operations: [
      { operationName: 'Pétrissage', workCenterId: wcId, durationMin: 0, opType: 'execution', setupMin: 10, laborMinPerUnit: 0.2, machineMinPerUnit: 0.4, baseQuantity: 1, isBlocking: true, controlPoint: 'T° pâte 24 °C' },
      { operationName: 'Cuisson', workCenterId: wcId, durationMin: 25 },
    ] });
  }, 60_000);

  afterAll(async () => {
    if (routingId) await rr.deleteRouting(routingId).catch(() => undefined);
    if (wcId) await p().query(`UPDATE work_centers SET is_active = false WHERE id = $1`, [wcId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('temps prévus par opération et coût MO de la fournée', async () => {
    const r = await rr.getRoutingForRecipe(recipeId);
    expect(r?.id).toBe(routingId);
    const [petr, cuis] = r!.operations as Record<string, any>[];
    expect([petr.planned_labor_min, petr.planned_machine_min]).toEqual([20, 30]);
    expect(petr.is_blocking).toBe(true);
    expect(petr.control_point).toBe('T° pâte 24 °C');
    expect([cuis.planned_labor_min, cuis.planned_machine_min]).toEqual([25, 0]);
    expect(r!.total_minutes).toBe(45);
    expect(r!.labor_cost).toBeCloseTo(45, 2); // 45 min × 60 / h
  });

  it('une seule gamme active par fiche', async () => {
    await expect(rr.createRouting({ name: `Doublon M501 ${RUN}`, recipeId, userId: fx.userId })).rejects.toThrow(/uq_routings_active_recipe/);
  });
});
