/**
 * Phase 3.7 (mig 469 item_kind) — l'appro suit la nature de l'article.
 * computeSourcingAndCreatePlan route le manque de stock :
 *   - fabriqué   → plan de production (ligne production_plan_items)
 *   - revente    → sourceType 'purchase', AUCUN plan (pas de recette à produire)
 *   - service    → sourceType 'service', rien à approvisionner (intangible)
 * Tout se joue dans une transaction annulée (ROLLBACK) : aucune trace en base.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';
import { computeSourcingAndCreatePlan } from '../../repositories/sourcing.helper.js';

describe.skipIf(!hasTestDb)("Appro selon la nature de l'article", () => {
  let fx: Fixtures;
  let products: typeof import('../../repositories/product.repository.js').productRepository;
  let made: string;
  let resale: string;
  let service: string;

  beforeAll(async () => {
    fx = await createBaseFixtures();
    products = (await import('../../repositories/product.repository.js')).productRepository;
    ({ productId: made } = await createProductWithRecipe(fx, { name: 'Fab', price: 10, ingredients: [] }));
    ({ productId: resale } = await createProductWithRecipe(fx, { name: 'Rev', price: 10, ingredients: [] }));
    ({ productId: service } = await createProductWithRecipe(fx, { name: 'Svc', price: 10, ingredients: [] }));
    await products.update(resale, { itemKind: 'resale' });
    await products.update(service, { itemKind: 'service' });
  });

  afterAll(async () => {
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('route le manque par nature (production / purchase / service)', async () => {
    const client = await testPool().connect();
    try {
      await client.query('BEGIN');
      // Commande support (FK de production_plans.order_id) — annulée au ROLLBACK.
      const order = await client.query(
        `INSERT INTO orders (order_number, user_id, type, subtotal, total) VALUES ($1, $2, 'pro', 30, 30) RETURNING id`,
        [`C-${RUN}`, fx.userId]);
      const orderId = order.rows[0].id;

      // Aucun stock magasin pour ces produits → tout le demandé est un manque.
      const res = await computeSourcingAndCreatePlan(client, {
        items: [
          { itemId: 'i-made', productId: made, requestedQuantity: 3 },
          { itemId: 'i-resale', productId: resale, requestedQuantity: 3 },
          { itemId: 'i-service', productId: service, requestedQuantity: 3 },
        ],
        storeId: fx.storeId, createdBy: fx.userId, planLabel: 'test', targetRole: null,
        linkColumn: 'order_id', linkId: orderId, needDate: null,
      });

      const by = Object.fromEntries(res.items.map(i => [i.productId, i]));
      expect(by[made].sourceType).toBe('production');
      expect(by[made].productionPlanId).not.toBeNull();
      expect(by[resale].sourceType).toBe('purchase');
      expect(by[resale].productionPlanId).toBeNull();
      expect(by[resale].qtyToProduce).toBe(3); // manque à acheter
      expect(by[service].sourceType).toBe('service');
      expect(by[service].qtyToProduce).toBe(0); // intangible, rien à sourcer

      // Le plan ne contient QUE l'article fabriqué.
      const planProducts = (await client.query(
        `SELECT product_id FROM production_plan_items WHERE plan_id = $1`, [res.productionPlanId])).rows.map(r => r.product_id);
      expect(planProducts).toEqual([made]);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
