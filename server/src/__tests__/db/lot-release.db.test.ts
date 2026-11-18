/**
 * M7-04 — libération du lot (mig 575).
 * Article avec contrôle final « chaque lot » :
 *  - le lot produit naît « en attente de libération » ;
 *  - vente refusée en caisse (checkSaleability) et expédition refusée au bon de livraison ;
 *  - libération manuelle → lot actif, plus de refus ;
 *  - second lot : inspection conforme → libération automatique (politique par défaut).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Libération du lot (M7-04)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let cp: typeof import('../../repositories/quality-control-plan.repository.js')['qualityControlPlanRepository'];
  let q: typeof import('../../repositories/quality.repository.js')['qualityRepository'];
  let rel: typeof import('../../repositories/lot-release.repository.js')['lotReleaseRepository'];
  let lots: typeof import('../../repositories/product-lot.repository.js')['productLotRepository'];
  let ship: typeof import('../../services/product-shipment.js');
  let fx: Fixtures; let productId: string; let lineId: string;
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);
  const produce = async () => {
    const pl = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 6 }] });
    fx.ids.plans.push(pl.id);
    const itemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [pl.id])).rows[0].id as string;
    await repos.productionRepository.confirm(pl.id, fx.userId);
    await repos.productionRepository.start(pl.id, fx.userId);
    await repos.productionRepository.produceItems(pl.id, [{ planItemId: itemId, actualQuantity: 6 }], fx.userId, fx.storeId);
    return (await p().query(`SELECT id, status FROM product_lots WHERE production_plan_id = $1`, [pl.id])).rows[0] as { id: string; status: string };
  };
  const tryShip = async () => {
    const c = await repos.db.getClient();
    try {
      await c.query('BEGIN');
      await ship.shipProduct(c, { productId, storeId: fx.storeId, quantity: 2, strict: true, ref: { type: 'test', id: '00000000-0000-0000-0000-000000000000' }, label: 'Test M704', userId: fx.userId });
      return 'ok';
    } catch (e) { return (e as Error).message; } finally { await c.query('ROLLBACK'); c.release(); }
  };

  beforeAll(async () => {
    repos = await importRepositories();
    cp = (await import('../../repositories/quality-control-plan.repository.js')).qualityControlPlanRepository;
    q = (await import('../../repositories/quality.repository.js')).qualityRepository;
    rel = (await import('../../repositories/lot-release.repository.js')).lotReleaseRepository;
    lots = (await import('../../repositories/product-lot.repository.js')).productLotRepository;
    ship = await import('../../services/product-shipment.js');
    fx = await createBaseFixtures();
    productId = (await createProductWithRecipe(fx, { name: `Flan M704 ${RUN}`, price: 3, ingredients: [] })).productId;
    lineId = (await cp.create({ productId, stage: 'final', characteristic: 'Aspect', charType: 'visuel', frequency: 'chaque_lot' }, fx.userId)).id;
  }, 60_000);

  afterAll(async () => {
    if (lineId) await cp.deactivate(lineId).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('lot en attente : vente et expédition refusées, libération manuelle', async () => {
    const lot = await produce();
    expect(lot.status).toBe('pending_release');
    expect((await lots.checkSaleability(productId, fx.storeId))?.reason).toBe('LOT_EN_ATTENTE_LIBERATION');
    expect(await tryShip()).toMatch(/en attente de libération/);
    await rel.releaseProductLot(lot.id, fx.userId, 'Contrôle visuel fait hors système');
    expect((await p().query(`SELECT status FROM product_lots WHERE id = $1`, [lot.id])).rows[0].status).toBe('active');
    expect(await lots.checkSaleability(productId, fx.storeId)).toBeNull();
    expect(await tryShip()).toBe('ok');
    await expect(rel.releaseProductLot(lot.id, fx.userId, 'deux fois')).rejects.toThrow(/déjà libéré/);
  });

  it('inspection conforme → libération automatique', async () => {
    const lot = await produce();
    expect(lot.status).toBe('pending_release');
    const pending = (await p().query(`SELECT id FROM quality_inspections WHERE product_lot_id = $1 AND status = 'a_faire'`, [lot.id])).rows[0].id;
    await q.createInspection({ title: 'x', userId: fx.userId, pendingId: pending, results: [{ label: 'Aspect', kind: 'ok', ok: true }] });
    expect((await p().query(`SELECT status, release_note FROM product_lots WHERE id = $1`, [lot.id])).rows[0]).toMatchObject({ status: 'active' });
  });
});
