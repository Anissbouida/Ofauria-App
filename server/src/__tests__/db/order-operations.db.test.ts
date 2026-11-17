/**
 * M5-02 — opérations de gamme instanciées sur l'ordre (mig 567).
 * Gamme de la fiche : façonnage (bloquant, opérateur affecté) puis cuisson.
 *  - politique « json » (défaut) : routing_id écrit à la confirmation, mais aucune étape
 *    issue de la gamme au lancement (comportement historique inchangé) ;
 *  - politique « gamme » : autant d'étapes que d'opérations, temps prévus pour la quantité ;
 *  - l'opération bloquante non terminée empêche la déclaration ; terminée, la déclaration passe,
 *    les quantités par opération sont gardées et le temps alimente production_temps_travail.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Opérations d\'ordre (M5-02)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let rr: typeof import('../../repositories/routing.repository.js')['routingRepository'];
  let et: typeof import('../../repositories/production-etapes.repository.js')['productionEtapesRepository'];
  let pol: typeof import('../../services/policies.js');
  let fx: Fixtures; let productId: string; let recipeId: string; let routingId: string; let employeeId: string;
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);
  const newPlan = async () => {
    const pl = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 40 }] });
    fx.ids.plans.push(pl.id);
    const itemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [pl.id])).rows[0].id as string;
    await repos.productionRepository.confirm(pl.id, fx.userId);
    await repos.productionRepository.start(pl.id, fx.userId);
    await repos.productionRepository.startItems(pl.id, [itemId], fx.userId);
    return { planId: pl.id as string, itemId };
  };

  beforeAll(async () => {
    repos = await importRepositories();
    rr = (await import('../../repositories/routing.repository.js')).routingRepository;
    et = (await import('../../repositories/production-etapes.repository.js')).productionEtapesRepository;
    pol = await import('../../services/policies.js');
    fx = await createBaseFixtures();
    const d = await createProductWithRecipe(fx, { name: 'Pain M502', price: 3, ingredients: [] });
    productId = d.productId; recipeId = d.recipeId;
    routingId = (await rr.createRouting({ name: `Gamme M502 ${RUN}`, recipeId, batchSize: 40, userId: fx.userId }))!.id;
    await rr.updateRouting(routingId, { operations: [
      { operationName: 'Façonnage', durationMin: 0, setupMin: 5, laborMinPerUnit: 0.5, baseQuantity: 1, isBlocking: true },
      { operationName: 'Cuisson', durationMin: 25, opType: 'execution' },
    ] });
    employeeId = (await p().query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, hourly_rate) VALUES ('Op', $1, 'boulanger', CURRENT_DATE, 30) RETURNING id`, [`M502 ${RUN}`])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await pol.setPolicy('production.steps_source', 'company', '', null, fx?.userId).catch(() => undefined);
    pol.invalidatePolicies();
    if (routingId) await rr.setRoutingActive(routingId, false).catch(() => undefined);
    if (employeeId) await p().query(`UPDATE employees SET is_active = false WHERE id = $1`, [employeeId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('politique « json » : gamme écrite sur la ligne, aucune opération instanciée', async () => {
    const { itemId } = await newPlan();
    expect((await p().query(`SELECT routing_id FROM production_plan_items WHERE id = $1`, [itemId])).rows[0].routing_id).toBe(routingId);
    expect((await p().query(`SELECT count(*)::int AS n FROM production_item_etapes WHERE plan_item_id = $1 AND routing_operation_id IS NOT NULL`, [itemId])).rows[0].n).toBe(0);
  });

  it('politique « gamme » : opérations, blocage, quantités et temps de travail', async () => {
    const set = await pol.setPolicy('production.steps_source', 'company', '', { source: 'gamme' }, fx.userId);
    expect('error' in set).toBe(false);
    pol.invalidatePolicies();
    const { planId, itemId } = await newPlan();
    const ops = (await p().query(`SELECT id, nom, est_bloquante, planned_labor_min FROM production_item_etapes WHERE plan_item_id = $1 ORDER BY ordre`, [itemId])).rows;
    expect(ops.map(o => o.nom)).toEqual(['Façonnage', 'Cuisson']);
    expect(Number(ops[0].planned_labor_min)).toBeCloseTo(25, 2); // 5 + 40 × 0,5
    expect(Number(ops[1].planned_labor_min)).toBeCloseTo(25, 2);

    const blocked = await repos.productionRepository.produceItems(planId, [{ planItemId: itemId, actualQuantity: 40 }], fx.userId, fx.storeId);
    expect(blocked.warnings.join(' ')).toMatch(/Opérations bloquantes/);

    await et.assign(ops[0].id, { assignedEmployeeId: employeeId });
    await et.updateStatus(ops[0].id, 'in_progress', fx.userId);
    const done = await et.updateStatus(ops[0].id, 'completed', fx.userId, { duree_reelle_min: 30, good_qty: 39, scrap_qty: 1 });
    expect([Number(done.good_qty), Number(done.scrap_qty), done.labor_logged]).toEqual([39, 1, true]);
    const tt = (await p().query(`SELECT employee_id, duree_minutes FROM production_temps_travail WHERE plan_item_id = $1`, [itemId])).rows;
    expect(tt).toEqual([{ employee_id: employeeId, duree_minutes: 30 }]);

    const ok = await repos.productionRepository.produceItems(planId, [{ planItemId: itemId, actualQuantity: 39 }], fx.userId, fx.storeId);
    expect(ok.warnings.join(' ')).not.toMatch(/Opérations bloquantes/);
    expect((await p().query(`SELECT status FROM production_plan_items WHERE id = $1`, [itemId])).rows[0].status).toBe('produced');
  });
});
