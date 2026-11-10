/**
 * Phase 3.8 — lots pour articles achetés/reçus. createReceivedLot crée un lot
 * NON issu de la production (production_plan_id NULL) avec la DLC de l'emballage,
 * ou à défaut une DLC dérivée de shelf_life_days. Même table product_lots que
 * les lots de production → DLC, FEFO, rappel s'appliquent. Transaction annulée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)("Lot d'article acheté/reçu", () => {
  let fx: Fixtures;
  let lots: typeof import('../../repositories/product-lot.repository.js').productLotRepository;
  let productId: string;

  beforeAll(async () => {
    fx = await createBaseFixtures();
    lots = (await import('../../repositories/product-lot.repository.js')).productLotRepository;
    ({ productId } = await createProductWithRecipe(fx, { name: 'Négoce', price: 10, ingredients: [] }));
  });

  afterAll(async () => {
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('crée un lot reçu avec la DLC fournie, sans plan de production', async () => {
    const client = await testPool().connect();
    try {
      await client.query('BEGIN');
      const lot = await lots.createReceivedLot(client, {
        productId, storeId: fx.storeId, quantity: 12,
        lotNumber: `ACH-${RUN}`, expiresAt: '2027-03-01', unitCost: 4.5,
      });
      expect(lot.production_plan_id).toBeNull();
      expect(Number(lot.backroom_qty)).toBe(12);
      expect(Number(lot.quantity_total)).toBe(12);
      expect(lot.status).toBe('active');
      // expires_at (type date) revient en Date à minuit local : on compare les
      // composantes locales pour rester insensible au fuseau.
      const d = new Date(lot.expires_at as unknown as string);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      expect(ymd).toBe('2027-03-01');
      expect(lot.lot_number).toBe(`ACH-${RUN}`);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('sans DLC fournie, dérive la DLC de shelf_life_days et suffixe un n° déjà pris', async () => {
    const client = await testPool().connect();
    try {
      await client.query('BEGIN');
      const a = await lots.createReceivedLot(client, { productId, storeId: fx.storeId, quantity: 5, lotNumber: `DUP-${RUN}`, shelfLifeDays: 10 });
      const b = await lots.createReceivedLot(client, { productId, storeId: fx.storeId, quantity: 5, lotNumber: `DUP-${RUN}`, shelfLifeDays: 10 });
      expect(a.lot_number).toBe(`DUP-${RUN}`);
      expect(b.lot_number).toBe(`DUP-${RUN}-2`); // n° déjà pris → suffixé
      expect(a.expires_at).not.toBeNull(); // DLC jamais absente
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
