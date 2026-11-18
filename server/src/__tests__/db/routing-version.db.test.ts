/**
 * M5-01 (reste) — la gamme figée avec la version de nomenclature (mig 595).
 *  - activer une version fige la gamme de la fiche (opérations et temps) ;
 *  - modifier une opération de la gamme met la fiche « en modification non activée » ;
 *  - un ordre suit la gamme de sa version : temps prévus de l'instantané, pas de la gamme modifiée ;
 *  - la version suivante reprend la gamme modifiée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Gamme figée avec la version (M5-01)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let rr: typeof import('../../repositories/routing.repository.js')['routingRepository'];
  let bom: typeof import('../../repositories/bom-version.repository.js')['bomVersionRepository'];
  let pol: typeof import('../../services/policies.js');
  let fx: Fixtures; let productId: string; let recipeId: string; let routingId: string;
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);
  const plannedLabor = async () => {
    const pl = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 40 }] });
    fx.ids.plans.push(pl.id);
    const itemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [pl.id])).rows[0].id as string;
    await repos.productionRepository.confirm(pl.id, fx.userId);
    expect((await p().query(`SELECT routing_id FROM production_plan_items WHERE id = $1`, [itemId])).rows[0].routing_id).toBe(routingId);
    await repos.productionRepository.start(pl.id, fx.userId);
    await repos.productionRepository.startItems(pl.id, [itemId], fx.userId);
    return (await p().query(`SELECT planned_labor_min FROM production_item_etapes WHERE plan_item_id = $1 ORDER BY ordre`, [itemId])).rows
      .map(r => Number(r.planned_labor_min));
  };

  beforeAll(async () => {
    repos = await importRepositories();
    rr = (await import('../../repositories/routing.repository.js')).routingRepository;
    bom = (await import('../../repositories/bom-version.repository.js')).bomVersionRepository;
    pol = await import('../../services/policies.js');
    fx = await createBaseFixtures();
    const d = await createProductWithRecipe(fx, { name: 'Pain M501', price: 3, ingredients: [] });
    productId = d.productId; recipeId = d.recipeId;
    routingId = (await rr.createRouting({ name: `Gamme M501 ${RUN}`, recipeId, batchSize: 40, userId: fx.userId }))!.id;
    await rr.updateRouting(routingId, { operations: [{ operationName: 'Façonnage', durationMin: 0, setupMin: 5, laborMinPerUnit: 0.5, baseQuantity: 1 }] });
    await bom.activate(recipeId, { reason: 'Version 1 avec gamme' }, fx.userId);
    const set = await pol.setPolicy('production.steps_source', 'company', '', { source: 'gamme' }, fx.userId);
    expect('error' in set).toBe(false);
    pol.invalidatePolicies();
  }, 60_000);

  afterAll(async () => {
    await pol.setPolicy('production.steps_source', 'company', '', null, fx?.userId).catch(() => undefined);
    pol.invalidatePolicies();
    await p().query(`UPDATE production_plan_items SET bom_version_id = NULL WHERE plan_id = ANY($1::uuid[])`, [fx?.ids.plans ?? []]).catch(() => undefined);
    await p().query(`DELETE FROM bom_versions WHERE recipe_id = $1`, [recipeId]).catch(() => undefined);
    if (routingId) await rr.setRoutingActive(routingId, false).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la version fige la gamme ; une opération modifiée = modification non activée', async () => {
    const v1 = (await p().query(`SELECT routing_id, jsonb_array_length(routing_snapshot) AS n FROM bom_versions WHERE recipe_id = $1 AND status = 'active'`, [recipeId])).rows[0];
    expect(v1).toMatchObject({ routing_id: routingId, n: 1 });
    expect((await bom.list(recipeId)).pendingChanges).toBe(false);
    await p().query(`UPDATE routing_operations SET setup_min = 10 WHERE routing_id = $1`, [routingId]);
    expect((await bom.list(recipeId)).pendingChanges).toBe(true);
  });

  it('l\'ordre suit la gamme de sa version (5 + 40 × 0,5), pas la gamme modifiée', async () => {
    expect(await plannedLabor()).toEqual([25]);
  });

  it('la version 2 reprend la gamme modifiée (10 + 40 × 0,5)', async () => {
    await bom.activate(recipeId, { reason: 'Réglage allongé' }, fx.userId);
    expect((await bom.list(recipeId)).pendingChanges).toBe(false);
    expect(await plannedLabor()).toEqual([30]);
    await expect(p().query(`UPDATE bom_versions SET routing_snapshot = '[]'::jsonb WHERE recipe_id = $1 AND status = 'active'`, [recipeId])).rejects.toThrow(/VERSION_FIGEE/);
  });
});
