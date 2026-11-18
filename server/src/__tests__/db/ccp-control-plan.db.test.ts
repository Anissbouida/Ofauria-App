/**
 * M7-03 — le CCP comme cas particulier du plan de contrôle (mig 574).
 *  - les CCP actuels (cuisson, refroidissement) sont des lignes bloquantes du plan de contrôle ;
 *  - un type d'étape déclaré CCP par le seul plan de contrôle rejoint la garde de clôture ;
 *    la ligne retirée, il en sort ;
 *  - consultation unique d'un ordre : relevés de procédé et inspections ensemble.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('CCP dans le plan de contrôle (M7-03)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let refs: typeof import('../../services/process-referentials.js');
  let cp: typeof import('../../repositories/quality-control-plan.repository.js')['qualityControlPlanRepository'];
  let q: typeof import('../../repositories/quality.repository.js')['qualityRepository'];
  let fx: Fixtures; let lineId: string | undefined; let planId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    refs = await import('../../services/process-referentials.js');
    cp = (await import('../../repositories/quality-control-plan.repository.js')).qualityControlPlanRepository;
    q = (await import('../../repositories/quality.repository.js')).qualityRepository;
    fx = await createBaseFixtures();
    const productId = (await createProductWithRecipe(fx, { name: 'Pain M703', price: 2, ingredients: [] })).productId;
    const pl = await repos.productionRepository.create({ planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 5 }] });
    planId = pl.id; fx.ids.plans.push(planId);
  }, 60_000);

  afterAll(async () => {
    if (lineId) await cp.deactivate(lineId).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('les CCP actuels sont des lignes bloquantes du plan', async () => {
    const lines = (await p().query(`SELECT step_type_code FROM quality_control_plan_lines WHERE is_active AND is_blocking AND step_type_code IS NOT NULL ORDER BY 1`)).rows;
    expect(lines.map(l => l.step_type_code)).toEqual(expect.arrayContaining(['cuisson', 'refroidissement']));
  });

  it('un CCP déclaré par le plan de contrôle rejoint la garde, retiré il en sort', async () => {
    expect((await refs.ccpStepTypes()).has('petrissage')).toBe(false);
    lineId = (await p().query(
      `INSERT INTO quality_control_plan_lines (stage, step_type_code, characteristic, char_type, frequency, is_blocking)
       VALUES ('en_cours', 'petrissage', 'CCP — Pétrissage', 'mesure', 'chaque_lot', true) RETURNING id`)).rows[0].id;
    expect((await refs.ccpStepTypes()).has('petrissage')).toBe(true);
    await cp.deactivate(lineId!);
    expect((await refs.ccpStepTypes()).has('petrissage')).toBe(false);
    lineId = undefined;
  });

  it('consultation unique : relevés et inspections de l\'ordre', async () => {
    const itemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0].id;
    const etapeId = (await p().query(
      `INSERT INTO production_item_etapes (plan_item_id, ordre, nom, est_bloquante, timer_auto, controle_qualite, checklist_items, est_repetable, nb_repetitions_cible, type_etape)
       VALUES ($1, 1, 'Cuisson', true, false, false, '[]', false, 1, 'cuisson') RETURNING id`, [itemId])).rows[0].id;
    await p().query(
      `INSERT INTO production_step_readings (etape_id, parametre, consigne, tolerance, mesure, conforme, est_ccp, mesure_par, mesure_a)
       VALUES ($1, 'temp_four', 220, 10, 225, true, true, $2, now())`, [etapeId, fx.userId]);
    await q.createInspection({ title: 'Aspect M703', results: [{ label: 'Dorure', kind: 'ok', ok: true }], userId: fx.userId, planId });
    const rec = await q.recordsForPlan(planId);
    expect(rec.readings).toMatchObject([{ parametre: 'temp_four', mesure: 225, conforme: true, est_ccp: true }]);
    expect(rec.inspections.map((i: { title: string }) => i.title)).toEqual(['Aspect M703']);
  });
});
