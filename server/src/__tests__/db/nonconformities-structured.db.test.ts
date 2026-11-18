/**
 * M7-05 — non-conformités structurées (mig 576).
 *  - une inspection finale non conforme crée une non-conformité rattachée à l'inspection,
 *    au lot et à l'ordre ;
 *  - cause du référentiel (cause inconnue refusée), action corrective, vérification d'efficacité
 *    seulement sur une action faite ;
 *  - décision « détruit » : le lot part aux pertes, motif « qualité non conforme » ;
 *  - tableau de bord : comptage par cause et par fournisseur, actions en retard.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Non-conformités structurées (M7-05)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let cp: typeof import('../../repositories/quality-control-plan.repository.js')['qualityControlPlanRepository'];
  let q: typeof import('../../repositories/quality.repository.js')['qualityRepository'];
  let ncr: typeof import('../../repositories/nonconformity.repository.js')['nonconformityRepository'];
  let fx: Fixtures; let productId: string; let lineId: string; let planId: string; let lotId: string; let ncId: string; let supplierId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    cp = (await import('../../repositories/quality-control-plan.repository.js')).qualityControlPlanRepository;
    q = (await import('../../repositories/quality.repository.js')).qualityRepository;
    ncr = (await import('../../repositories/nonconformity.repository.js')).nonconformityRepository;
    fx = await createBaseFixtures();
    productId = (await createProductWithRecipe(fx, { name: `Éclair M705 ${RUN}`, price: 4, ingredients: [] })).productId;
    lineId = (await cp.create({ productId, stage: 'final', characteristic: 'Glaçage', charType: 'visuel', frequency: 'chaque_lot' }, fx.userId)).id;
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur M705 ${RUN}`])).rows[0].id;
    const pl = await repos.productionRepository.create({ planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 4 }] });
    planId = pl.id; fx.ids.plans.push(planId);
    const itemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0].id;
    await repos.productionRepository.confirm(planId, fx.userId);
    await repos.productionRepository.start(planId, fx.userId);
    await repos.productionRepository.produceItems(planId, [{ planItemId: itemId, actualQuantity: 4 }], fx.userId, fx.storeId);
    lotId = (await p().query(`SELECT id FROM product_lots WHERE production_plan_id = $1`, [planId])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    if (lineId) await cp.deactivate(lineId).catch(() => undefined);
    await p().query(`UPDATE quality_nonconformities SET supplier_id = NULL WHERE supplier_id = $1`, [supplierId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('inspection non conforme → non-conformité rattachée', async () => {
    const pending = (await p().query(`SELECT id FROM quality_inspections WHERE product_lot_id = $1 AND status = 'a_faire'`, [lotId])).rows[0].id;
    await q.createInspection({ title: 'x', userId: fx.userId, pendingId: pending, results: [{ label: 'Glaçage', kind: 'ok', ok: false }] });
    const nc = (await p().query(`SELECT id, inspection_id, product_lot_id, plan_id FROM quality_nonconformities WHERE inspection_id = $1`, [pending])).rows[0];
    expect(nc).toMatchObject({ inspection_id: pending, product_lot_id: lotId, plan_id: planId });
    ncId = nc.id;
  });

  it('cause, actions et efficacité', async () => {
    await expect(ncr.setDetails(ncId, { causeCode: 'inconnue_m705' })).rejects.toThrow(/Cause inconnue/);
    const d = await ncr.setDetails(ncId, { causeCode: 'machine', supplierId });
    expect(d).toMatchObject({ cause_code: 'machine', cause_label: 'Machine', supplier_id: supplierId });
    const a = await ncr.addAction(ncId, { actionType: 'corrective', description: 'Régler la température de la glaceuse', dueDate: '2020-01-01' }, fx.userId);
    await expect(ncr.updateAction(a.id, { effectivenessResult: 'efficace' })).rejects.toThrow(/action faite/);
    const dash = await ncr.dashboard(null);
    expect(dash.overdue_actions.map((x: { id: string }) => x.id)).toContain(a.id);
    expect(dash.by_cause.find((c: { label: string }) => c.label === 'Machine')?.count).toBeGreaterThanOrEqual(1);
    expect(dash.by_supplier.find((c: { label: string }) => c.label === `Fournisseur M705 ${RUN}`)?.count).toBe(1);
    const done = await ncr.updateAction(a.id, { status: 'faite', effectivenessResult: 'efficace', effectivenessNote: 'Plus de défaut sur 3 fournées' });
    expect(done).toMatchObject({ status: 'faite', effectiveness_result: 'efficace' });
  });

  it('décision « détruit » : le lot part aux pertes, motif qualité', async () => {
    const after = await ncr.decideLot(ncId, 'detruit', fx.userId, 'Lot entier');
    expect(after?.lot_decision).toBe('detruit');
    const loss = (await p().query(`SELECT reason FROM product_losses WHERE product_id = $1 ORDER BY created_at DESC LIMIT 1`, [productId])).rows[0];
    expect(loss.reason).toBe('qualite_non_conforme');
    await expect(ncr.decideLot(ncId, 'accepte', fx.userId)).rejects.toThrow(/déjà prise/);
  });
});
