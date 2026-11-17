/**
 * G5-06 — date de disponibilité promise (services/promise-date.ts).
 * Un produit fabriqué a 5 en stock dont 2 réservés (libre 3), un ordre libre de 4 demain
 * et un ordre de 10 déjà affecté à une autre commande :
 *  - 2 → aujourd'hui (stock) ; 6 → demain (planifié) ; 20 → à produire (aujourd'hui + délai) ;
 *  - deux lignes du même produit se partagent le disponible ;
 *  - l'ordre affecté à une commande n'est pas promis ;
 *  - un produit acheté sans stock : à approvisionner, sans date.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Date de disponibilité promise (G5-06)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let svc: typeof import('../../services/promise-date.js');
  let fx: Fixtures; let made: string; let bought: string; let orderId: string;
  const p = () => testPool();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    repos = await importRepositories();
    svc = await import('../../services/promise-date.js');
    fx = await createBaseFixtures();
    const flour = await createIngredient(fx, { name: 'Farine G506', unit: 'kg', unitCost: 8 });
    made = (await createProductWithRecipe(fx, { name: 'Tarte G506', price: 40, ingredients: [{ ingredientId: flour, quantity: 0.2, unit: 'kg' }] })).productId;
    bought = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 5) RETURNING id`, [`Soda G506 ${RUN}`, `soda-g506-${RUN}`])).rows[0].id;
    fx.ids.products.push(bought);
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity, reserved_quantity) VALUES ($1, $2, 5, 2)`, [made, fx.storeId]);
    const free = await repos.productionRepository.create({ planDate: tomorrow, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId: made, plannedQuantity: 4 }] });
    fx.ids.plans.push(free.id);
    const tied = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId: made, plannedQuantity: 10 }] });
    fx.ids.plans.push(tied.id);
    orderId = (await p().query(`INSERT INTO orders (order_number, user_id, type, subtotal, total) VALUES ($1, $2, 'pro', 400, 400) RETURNING id`, [`C-G506-${RUN}`, fx.userId])).rows[0].id;
    const oi = (await p().query(`INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 10, 40, 400) RETURNING id`, [orderId, made])).rows[0].id;
    await p().query(`UPDATE production_plan_items SET order_item_id = $1 WHERE plan_id = $2`, [oi, tied.id]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE production_plan_items SET order_item_id = NULL WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [orderId]).catch(() => undefined);
    await p().query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]).catch(() => undefined);
    await p().query(`DELETE FROM orders WHERE id = $1`, [orderId]).catch(() => undefined);
    await p().query(`DELETE FROM product_store_stock WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('stock, planifié, à produire', async () => {
    const [a, b, c] = await svc.promiseDates(fx.storeId, [{ productId: made, quantity: 2 }], today)
      .then(async x => [x[0], ...(await svc.promiseDates(fx.storeId, [{ productId: made, quantity: 6 }], today)),
                         ...(await svc.promiseDates(fx.storeId, [{ productId: made, quantity: 20 }], today))]);
    expect(a).toMatchObject({ date: today, source: 'stock', available_now: 3 });
    expect(b).toMatchObject({ date: tomorrow, source: 'planifie' });
    expect(c).toMatchObject({ source: 'a_produire' });
    expect(c.date! >= today).toBe(true);
    // L'ordre affecté à la commande n'apparaît pas dans le planifié promis.
    expect(b.planned).toEqual([{ date: tomorrow, qty: 4 }]);
  });

  it('deux lignes du même produit se partagent le disponible', async () => {
    const r = await svc.promiseDates(fx.storeId, [{ productId: made, quantity: 2 }, { productId: made, quantity: 2 }], today);
    expect(r.map(x => x.source)).toEqual(['stock', 'planifie']);
  });

  it('produit acheté sans stock : à approvisionner, sans date', async () => {
    expect((await svc.promiseDates(fx.storeId, [{ productId: bought, quantity: 1 }], today))[0]).toMatchObject({ date: null, source: 'a_approvisionner' });
  });
});
